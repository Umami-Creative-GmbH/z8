/**
 * #1622 (spec #1590, Organization ADR 0006): a departure revokes the departing
 * employee's report share links, as a deactivation does. Every link of theirs
 * that was live at the cutoff is revoked inside the departure transaction,
 * audited under the departure's initiator and naming the departure; a re-run
 * revokes nothing more. Driven through the public departure commands; the
 * links are observed through their stored rows and audit entries.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "./commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "./testing/database.test.fixture";
import type { DepartureClockOutPort, LifecycleActor } from "./types";

const clockOut: DepartureClockOutPort = {
	async close() {
		return { kind: "not_running" };
	},
};

describe("report share links at a departure", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-09-14T08:00:00Z");
	const clock = { nowInstant: () => now };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function commands() {
		return createDepartureCommands({ db: fixture.db, clock, clockOut });
	}

	function owner(): LifecycleActor {
		return {
			userId: fixture.ownerUserId,
			organizationId: fixture.organizationId,
		};
	}

	async function seedShareLink(
		creator: SeededEmployee,
		input: { createdAt?: string; expiresAt: string; revokedAt?: string },
	): Promise<string> {
		const revoked = input.revokedAt !== undefined;
		const { rows } = await fixture.pool.query<{ id: string }>(
			`insert into report_share_link
			 (organization_id, created_by, creator_employee_id, kind, project_ids, from_day, to_day, figures,
			  creator_locale, token_digest, token_hash_version, snapshot, created_at, expires_at,
			  revoked_at, revoked_by, revoke_reason)
			 values ($1, $2, $3, 'project', array[$4::uuid], '2026-08-01', '2026-08-31', 'hours', 'en', $5, 'v1',
			  case when $9 then null else '{}'::jsonb end, $6, $7,
			  $8::timestamptz,
			  case when $9 then $2 else null end,
			  case when $9 then 'manual' else null end)
			 returning id`,
			[
				fixture.organizationId,
				creator.userId,
				creator.employeeId,
				randomUUID(),
				createHash("sha256").update(randomUUID()).digest("hex"),
				input.createdAt ?? "2026-08-31T08:00:00Z",
				input.expiresAt,
				input.revokedAt ?? null,
				revoked,
			],
		);
		return rows[0]?.id ?? "";
	}

	async function linkRows(ids: string[]) {
		const { rows } = await fixture.pool.query<{
			id: string;
			revoked_at: Date | null;
			revoked_by: string | null;
			revoke_reason: string | null;
			has_snapshot: boolean;
		}>(
			`select id, revoked_at, revoked_by, revoke_reason, snapshot is not null as has_snapshot
			 from report_share_link where id = any($1::uuid[]) order by array_position($1::uuid[], id)`,
			[ids],
		);
		return rows;
	}

	async function linkAudits(ids: string[]) {
		const { rows } = await fixture.pool.query<{
			action: string;
			performed_by: string;
			entity_id: string;
			metadata: string | null;
		}>(
			`select action, performed_by, entity_id, metadata from audit_log
			 where organization_id = $1 and entity_type = 'report_share_link'
			   and entity_id = any($2::text[])
			 order by entity_id`,
			[fixture.organizationId, ids],
		);
		return rows.map((row) => ({
			action: row.action,
			performedBy: row.performed_by,
			linkId: row.entity_id,
			metadata: row.metadata ? JSON.parse(row.metadata) : null,
		}));
	}

	it("revokes the leaver's links live at the cutoff, at the cutoff, audited under the departure, and nothing more on a re-run", async () => {
		const leaver = await fixture.seedEmployee();
		const colleague = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");

		const live = await seedShareLink(leaver, {
			expiresAt: "2026-12-01T00:00:00Z",
		});
		// Live at the cutoff, expired by the time the late worker runs.
		const expiresAfterCutoff = await seedShareLink(leaver, {
			expiresAt: "2026-10-02T00:00:00Z",
		});
		const expired = await seedShareLink(leaver, {
			expiresAt: "2026-09-20T00:00:00Z",
		});
		const alreadyRevoked = await seedShareLink(leaver, {
			expiresAt: "2026-12-01T00:00:00Z",
			revokedAt: "2026-09-01T08:00:00Z",
		});
		const colleaguesLink = await seedShareLink(colleague, {
			expiresAt: "2026-12-01T00:00:00Z",
		});

		const scheduled = await commands().scheduleDeparture(owner(), {
			employeeId: leaver.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		const cutoff = new Date("2026-10-01T00:00:00Z");
		const identity = {
			organizationId: fixture.organizationId,
			employeeId: leaver.employeeId,
			employmentPeriodId: leaver.employmentPeriodId,
			departureId: scheduled.departureId,
			revision: scheduled.revision,
		};

		// Scheduling revokes nothing early.
		expect((await linkRows([live]))[0]?.revoked_at).toBeNull();

		now = parseInstant("2026-10-03T11:00:00Z");
		expect(await commands().executeDeparture(identity)).toMatchObject({
			status: "effective",
		});

		const ids = [
			live,
			expiresAfterCutoff,
			expired,
			alreadyRevoked,
			colleaguesLink,
		];
		const revokedByDeparture = {
			revoked_at: cutoff,
			revoked_by: fixture.ownerUserId,
			revoke_reason: "creator_lost_access",
			has_snapshot: false,
		};
		const after = await linkRows(ids);
		expect(after).toEqual([
			{ id: live, ...revokedByDeparture },
			{ id: expiresAfterCutoff, ...revokedByDeparture },
			// Expired before the cutoff: the expiry sweep's, not the departure's.
			{
				id: expired,
				revoked_at: null,
				revoked_by: null,
				revoke_reason: null,
				has_snapshot: true,
			},
			{
				id: alreadyRevoked,
				revoked_at: new Date("2026-09-01T08:00:00Z"),
				revoked_by: leaver.userId,
				revoke_reason: "manual",
				has_snapshot: false,
			},
			{
				id: colleaguesLink,
				revoked_at: null,
				revoked_by: null,
				revoke_reason: null,
				has_snapshot: true,
			},
		]);

		const audits = await linkAudits(ids);
		expect(audits.map((audit) => audit.linkId).toSorted()).toEqual(
			[live, expiresAfterCutoff].toSorted(),
		);
		for (const audit of audits) {
			expect(audit).toMatchObject({
				action: "report_share_link.auto_revoked",
				performedBy: fixture.ownerUserId,
				metadata: {
					reason: "employee_departure",
					departureId: scheduled.departureId,
					employmentPeriodId: leaver.employmentPeriodId,
				},
			});
		}

		// A re-run of the effective transition revokes nothing more and does not fail.
		const retries = await Promise.all(
			Array.from({ length: 3 }, () => commands().executeDeparture(identity)),
		);
		expect(retries).toEqual(
			Array.from({ length: 3 }, () => ({ status: "obsolete" })),
		);
		expect(await linkRows(ids)).toEqual(after);
		expect(await linkAudits(ids)).toHaveLength(2);
	});

	it("revokes a link of the leaver's created after a past cutoff, never before it was created", async () => {
		const leaver = await fixture.seedEmployee();
		now = parseInstant("2026-09-14T08:00:00Z");
		const scheduled = await commands().scheduleDeparture(owner(), {
			employeeId: leaver.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		// Nothing processed the departure yet when the link was created.
		const late = await seedShareLink(leaver, {
			createdAt: "2026-10-02T08:00:00Z",
			expiresAt: "2026-12-01T00:00:00Z",
		});

		now = parseInstant("2026-10-03T11:00:00Z");
		expect(
			await commands().executeDeparture({
				organizationId: fixture.organizationId,
				employeeId: leaver.employeeId,
				employmentPeriodId: leaver.employmentPeriodId,
				departureId: scheduled.departureId,
				revision: scheduled.revision,
			}),
		).toMatchObject({ status: "effective" });

		expect(await linkRows([late])).toEqual([
			{
				id: late,
				revoked_at: new Date("2026-10-02T08:00:00Z"),
				revoked_by: fixture.ownerUserId,
				revoke_reason: "creator_lost_access",
				has_snapshot: false,
			},
		]);
	});
});
