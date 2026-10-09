/**
 * Position stamp retention (#829, Time Tracking ADR 0004): the daily purge
 * deletes stamps past their purge date in every organization and never their
 * clock events, and shortening an organization's retention brings existing
 * purge dates forward while lengthening leaves them.
 *
 * Stamps are recorded through the Clocking module's `run`, so the clock events
 * carry a real hash chain. Only billing and the Next request/cache boundaries
 * are replaced.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { db } = await import("@/db");
const { createClocking } = await import("../clocking/clocking");
const { recordingFollowUps } = await import("../clocking/follow-ups");
const { coordinatedTransactions } = await import("../clocking/transactions");
const { readEmployeeAppendAssurance } = await import("../append-assurance-reader");
const { savePositionCaptureSettings } = await import("./store");
const { purgeExpiredPositionStamps } = await import("./purge");
type ClockCommand = import("../clocking/types").ClockCommand;

type Tenant = {
	organization: string;
	user: string;
	member: string;
	employee: string;
	notice: string;
	consent: string;
};

const tenants = {
	a: {
		organization: "t829-purge-org-a",
		user: "t829-employee-user-a",
		member: "t829-member-a",
		employee: "f8290000-0000-4000-8000-0000000000a1",
		notice: "f8290000-0000-4000-8000-0000000000a2",
		consent: "f8290000-0000-4000-8000-0000000000a3",
	},
	b: {
		organization: "t829-purge-org-b",
		user: "t829-employee-user-b",
		member: "t829-member-b",
		employee: "f8290000-0000-4000-8000-0000000000b1",
		notice: "f8290000-0000-4000-8000-0000000000b2",
		consent: "f8290000-0000-4000-8000-0000000000b3",
	},
} as const satisfies Record<string, Tenant>;

const startAt = parseInstant("2026-09-20T08:00:00Z");
const consentedAt = parseInstant("2026-09-01T09:00:00Z");
const RETENTION_DAYS = 30;
const PURPOSE = "Proof of on-site attendance";

describe("position stamp retention on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now = startAt;

	function newClocking() {
		return createClocking({
			clock: { nowInstant: () => now } as never,
			transactions: coordinatedTransactions(),
			followUps: recordingFollowUps(),
		});
	}

	function webCommand(tenant: Tenant, body: ClockCommand["body"]): ClockCommand {
		return {
			organizationId: tenant.organization,
			principal: { kind: "user", userId: tenant.user },
			subject: { employeeId: tenant.employee },
			identity: { origin: "client", id: randomUUID() },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
			position: {
				latitude: 52.520008,
				longitude: 13.404954,
				accuracyMeters: 18.5,
				fixedAt: now.subtract({ seconds: 20 }),
			},
			body,
		} as ClockCommand;
	}

	/** A stamped clock-in at `startAt` and a stamped clock-out four hours later. */
	async function workStampedShift(tenant: Tenant) {
		const clocking = newClocking();
		now = startAt;
		const clockIn = await clocking.run(
			webCommand(tenant, { kind: "clock_in", workLocationType: "office" }),
		);
		now = startAt.add({ hours: 4 });
		const clockOut = await clocking.run(
			webCommand(tenant, {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			}),
		);
		expect([clockIn.outcome, clockOut.outcome]).toEqual(["executed", "executed"]);
	}

	async function stamps(tenant: Tenant) {
		const { rows } = await admin.query<{ captured_at: Date; purge_at: Date }>(
			`select captured_at, purge_at from position_stamp
			  where organization_id = $1 order by captured_at`,
			[tenant.organization],
		);
		return rows.map((row) => ({
			capturedAt: row.captured_at.toISOString(),
			purgeAt: row.purge_at.toISOString(),
		}));
	}

	async function clockEvents(tenant: Tenant) {
		const { rows } = await admin.query<{ id: string; hash: string }>(
			"select id, hash from time_entry where organization_id = $1 order by timestamp",
			[tenant.organization],
		);
		return rows;
	}

	async function saveRetention(tenant: Tenant, retentionDays: number) {
		return db.transaction((tx) =>
			savePositionCaptureSettings(tx, {
				organizationId: tenant.organization,
				actorUserId: tenant.user,
				settings: { enabled: true, purposeStatement: PURPOSE, retentionDays },
			}),
		);
	}

	async function cleanup() {
		for (const tenant of Object.values(tenants)) {
			await admin.query("delete from organization where id = $1", [tenant.organization]);
			await admin.query('delete from "user" where id = $1', [tenant.user]);
		}
	}

	async function seed(tenant: Tenant) {
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)`,
			[tenant.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[tenant.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Employee', $1 || '@example.test', $2, $2)`,
			[tenant.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, 'member', 'approved', $4)`,
			[tenant.member, tenant.organization, tenant.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[tenant.employee, tenant.user, tenant.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)`,
			[tenant.user, timestamp],
		);
		await admin.query(
			`insert into position_capture_setting (organization_id, enabled, purpose_statement, retention_days)
			 values ($1, true, $2, $3)`,
			[tenant.organization, PURPOSE, RETENTION_DAYS],
		);
		await admin.query(
			`insert into position_capture_assignment
			 (organization_id, assignment_type, priority, capture_enabled, created_by)
			 values ($1, 'organization', 0, true, $2)`,
			[tenant.organization, tenant.user],
		);
		await admin.query(
			`insert into position_notice
			 (id, organization_id, version, purpose_statement, retention_days, template_revision)
			 values ($1, $2, 1, $3, $4, 1)`,
			[tenant.notice, tenant.organization, PURPOSE, RETENTION_DAYS],
		);
		await admin.query(
			`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at)
			 values ($1, $2, $3, $4, $5)`,
			[
				tenant.consent,
				tenant.organization,
				tenant.employee,
				tenant.notice,
				new Date(consentedAt.toString()),
			],
		);
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, 'active')`,
			[tenant.organization],
		);
	}

	function at(instant: Instant) {
		return instant.toString().replace("Z", ".000Z");
	}

	beforeEach(async () => {
		now = startAt;
		await cleanup();
		for (const tenant of Object.values(tenants)) await seed(tenant);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("deletes stamps past their purge date in every organization and keeps their clock events verifiable", async () => {
		await workStampedShift(tenants.a);
		await workStampedShift(tenants.b);
		const eventsBefore = await clockEvents(tenants.a);
		const assuranceBefore = await readEmployeeAppendAssurance(db, {
			organizationId: tenants.a.organization,
			employeeId: tenants.a.employee,
		});

		// Thirty days after the clock-in: the clock-in stamps are due, the clock-out stamps are not.
		const purged = await purgeExpiredPositionStamps(db, {
			now: parseInstant("2026-10-20T08:00:00Z"),
			batchSize: 1,
		});

		expect(purged).toEqual({ deletedCount: 2 });
		for (const tenant of [tenants.a, tenants.b]) {
			expect(await stamps(tenant)).toEqual([
				{ capturedAt: "2026-09-20T12:00:00.000Z", purgeAt: "2026-10-20T12:00:00.000Z" },
			]);
		}
		// The clock events and their hashes are untouched, and the chain still verifies.
		expect(await clockEvents(tenants.a)).toEqual(eventsBefore);
		const assuranceAfter = await readEmployeeAppendAssurance(db, {
			organizationId: tenants.a.organization,
			employeeId: tenants.a.employee,
		});
		expect(assuranceAfter).toEqual(assuranceBefore);
		expect(assuranceAfter.entryCount).toBe(2);
		expect(assuranceAfter.hashes).toEqual({
			reproduced: 2,
			notReproduced: [],
			inputUnavailable: [],
			duplicates: [],
		});
		// Consent records are never purged.
		const { rows: consents } = await admin.query(
			"select id from position_consent where organization_id = any($1)",
			[[tenants.a.organization, tenants.b.organization]],
		);
		expect(consents).toHaveLength(2);
	});

	it("is idempotent: a repeated run deletes nothing more", async () => {
		await workStampedShift(tenants.a);
		const due = parseInstant("2026-10-21T00:00:00Z");

		expect(await purgeExpiredPositionStamps(db, { now: due })).toEqual({ deletedCount: 2 });
		expect(await purgeExpiredPositionStamps(db, { now: due })).toEqual({ deletedCount: 0 });
		expect(await stamps(tenants.a)).toEqual([]);
		expect(await clockEvents(tenants.a)).toHaveLength(2);
	});

	it("keeps every stamp whose purge date has not passed", async () => {
		await workStampedShift(tenants.a);

		expect(
			await purgeExpiredPositionStamps(db, { now: parseInstant("2026-10-20T07:59:59.999Z") }),
		).toEqual({ deletedCount: 0 });
		expect(await stamps(tenants.a)).toHaveLength(2);
	});

	it("brings purge dates forward when retention is shortened, only in that organization", async () => {
		await workStampedShift(tenants.a);
		await workStampedShift(tenants.b);

		await saveRetention(tenants.a, 10);

		expect(await stamps(tenants.a)).toEqual([
			{ capturedAt: at(startAt), purgeAt: "2026-09-30T08:00:00.000Z" },
			{ capturedAt: "2026-09-20T12:00:00.000Z", purgeAt: "2026-09-30T12:00:00.000Z" },
		]);
		expect(await stamps(tenants.b)).toEqual([
			{ capturedAt: at(startAt), purgeAt: "2026-10-20T08:00:00.000Z" },
			{ capturedAt: "2026-09-20T12:00:00.000Z", purgeAt: "2026-10-20T12:00:00.000Z" },
		]);
	});

	it("leaves purge dates unchanged when retention is lengthened, and never moves one later", async () => {
		await workStampedShift(tenants.a);
		await saveRetention(tenants.a, 20);

		await saveRetention(tenants.a, 90);
		expect((await stamps(tenants.a)).map((stamp) => stamp.purgeAt)).toEqual([
			"2026-10-10T08:00:00.000Z",
			"2026-10-10T12:00:00.000Z",
		]);

		// Shortening from 90 to 40 days still keeps the earlier 20-day dates.
		await saveRetention(tenants.a, 40);
		expect((await stamps(tenants.a)).map((stamp) => stamp.purgeAt)).toEqual([
			"2026-10-10T08:00:00.000Z",
			"2026-10-10T12:00:00.000Z",
		]);
	});
});
