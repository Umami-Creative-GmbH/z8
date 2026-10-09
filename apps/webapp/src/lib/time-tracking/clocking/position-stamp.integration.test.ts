/**
 * Position stamps on clock commands (#826, Time Tracking ADR 0004), through the
 * Clocking module's `run` only: the employee's own web and stamped frozen
 * commands keep their position when the capture check passes inside the work
 * transaction, and every other case silently drops it while the clock event
 * itself commits unchanged.
 *
 * The work transactions are the real coordinated adapter. Only billing and the
 * Next request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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
const { timeEntry } = await import("@/db/schema");
const { verifyHash } = await import("../blockchain");
const { createClocking } = await import("./clocking");
const { recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions } = await import("./transactions");
const { savePositionCaptureSettings, withdrawPositionConsent, agreeToPositionNotice } =
	await import("../position-capture/store");
type ClockCommand = import("./types").ClockCommand;
type ClockPosition = import("./types").ClockPosition;

const ids = {
	organization: "t826-stamp-org",
	user: "t826-employee-user",
	employee: "f8260000-0000-4000-8000-000000000001",
	notice: "f8260000-0000-4000-8000-0000000000a1",
	consent: "f8260000-0000-4000-8000-0000000000b1",
} as const;
const startAt = parseInstant("2026-09-20T08:00:00Z");
const consentedAt = parseInstant("2026-09-01T09:00:00Z");
const MINUTES = 60_000;

const position: ClockPosition = {
	latitude: 52.520008,
	longitude: 13.404954,
	accuracyMeters: 18.5,
	fixedAt: parseInstant("2026-09-20T07:59:30.250Z"),
};

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("position stamps on clock commands on PostgreSQL", () => {
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

	function common(stamp: ClockPosition | undefined = position) {
		return {
			organizationId: ids.organization,
			principal: { kind: "user" as const, userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client" as const, id: randomUUID() },
			channel: "web" as const,
			at: { kind: "now" as const },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
			...(stamp ? { position: stamp } : {}),
		};
	}

	function webClockIn(stamp?: ClockPosition): ClockCommand {
		return { ...common(stamp), body: { kind: "clock_in", workLocationType: "office" } };
	}

	function webClockOut(stamp?: ClockPosition): ClockCommand {
		return {
			...common(stamp),
			body: {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
		};
	}

	function webBreak(breakMinutes: number, stamp?: ClockPosition): ClockCommand {
		return { ...common(stamp), body: { kind: "break", breakMinutes } };
	}

	/** A stamped version 3 frozen clock-in, as the commands route sends it. */
	function frozenClockIn(at: Instant, stamp: ClockPosition = position): ClockCommand {
		const base = common(stamp);
		const window = { earliest: now.subtract({ hours: 7 * 24 }), latest: now.add({ minutes: 5 }) };
		return {
			...base,
			channel: "api",
			at: { kind: "occurred", instant: at },
			freshness: window,
			payload: {
				version: 3,
				operationId: base.identity.id,
				kind: "clock_in",
				occurredAt: at.toString(),
				workLocationType: "home",
				position: { ...stamp, fixedAt: stamp.fixedAt.toString() },
			},
			body: { kind: "clock_in", workLocationType: "home" },
		};
	}

	async function stamps() {
		const { rows } = await admin.query(
			`select time_entry_id, organization_id, employee_id, consent_id, latitude, longitude,
			        accuracy_meters, fixed_at, captured_at, purge_at
			   from position_stamp where organization_id = $1 order by captured_at`,
			[ids.organization],
		);
		return rows;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T826 stamps', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, 'Employee', 't826-employee@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t826-member', $1, $2, 'member', 'approved', $3)`,
			[ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', $4)`,
			[ids.employee, ids.user, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)`,
			[ids.user, timestamp],
		);
		// Capture on for the whole organization, 30 days retention, consent to notice 1.
		await admin.query(
			`insert into position_capture_setting (organization_id, enabled, purpose_statement, retention_days)
			 values ($1, true, 'Proof of on-site attendance', 30)`,
			[ids.organization],
		);
		await admin.query(
			`insert into position_capture_assignment
			 (organization_id, assignment_type, priority, capture_enabled, created_by)
			 values ($1, 'organization', 0, true, $2)`,
			[ids.organization, ids.user],
		);
		await admin.query(
			`insert into position_notice
			 (id, organization_id, version, purpose_statement, retention_days, template_revision)
			 values ($1, $2, 1, 'Proof of on-site attendance', 30, 1)`,
			[ids.notice, ids.organization],
		);
		await admin.query(
			`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at)
			 values ($1, $2, $3, $4, $5)`,
			[ids.consent, ids.organization, ids.employee, ids.notice, new Date(consentedAt.toString())],
		);
		await setAdmission("active");
	}

	beforeEach(async () => {
		now = startAt;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("stamps the clock-in and the clock-out with the position, purge date and consent", async () => {
		const clocking = newClocking();
		const clockIn = await clocking.run(webClockIn(position));
		now = now.add({ hours: 4 });
		const clockOut = await clocking.run(webClockOut(position));

		expect(clockIn.outcome).toBe("executed");
		expect(clockOut.outcome).toBe("executed");
		if (clockIn.outcome !== "executed" || clockOut.outcome !== "executed") return;
		expect(await stamps()).toEqual([
			{
				time_entry_id: clockIn.result.id,
				organization_id: ids.organization,
				employee_id: ids.employee,
				consent_id: ids.consent,
				latitude: 52.520008,
				longitude: 13.404954,
				accuracy_meters: 18.5,
				fixed_at: new Date("2026-09-20T07:59:30.250Z"),
				captured_at: new Date("2026-09-20T08:00:00Z"),
				purge_at: new Date("2026-10-20T08:00:00Z"),
			},
			expect.objectContaining({
				time_entry_id: clockOut.result.id,
				captured_at: new Date("2026-09-20T12:00:00Z"),
				purge_at: new Date("2026-10-20T12:00:00Z"),
			}),
		]);
		// The legacy column never holds a stamp, and the hash chain verifies unchanged.
		const entries = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.organizationId, ids.organization));
		expect(entries.map((entry) => entry.location)).toEqual([null, null]);
		expect(entries.every((entry) => verifyHash(entry).isValid)).toBe(true);
	});

	it("stamps only the resumed clock-in of a web break, never the earlier break start", async () => {
		const clocking = newClocking();
		await clocking.run(webClockIn());
		now = now.add({ hours: 3 });
		const taken = await clocking.run(webBreak(30, position));

		expect(taken.outcome).toBe("executed");
		const { rows } = await admin.query<{ id: string; type: string }>(
			"select id, type from time_entry where organization_id = $1 and timestamp = $2",
			[ids.organization, new Date("2026-09-20T11:00:00Z")],
		);
		const resume = only(rows);
		expect(resume.type).toBe("clock_in");
		expect((await stamps()).map((row) => row.time_entry_id)).toEqual([
			expect.any(String),
			resume.id,
		]);
	});

	it("stamps in an organization that has not adopted append admission", async () => {
		await setAdmission("inactive");
		const clocking = newClocking();
		const clockIn = await clocking.run(webClockIn());
		now = now.add({ hours: 2 });
		const taken = await clocking.run(webBreak(15));
		now = now.add({ hours: 2 });
		const clockOut = await clocking.run(webClockOut());

		expect([clockIn.outcome, taken.outcome, clockOut.outcome]).toEqual([
			"executed",
			"executed",
			"executed",
		]);
		expect(await stamps()).toHaveLength(3);
	});

	it("keeps a stamped frozen command's event-time position and replays an identical resubmission", async () => {
		const clocking = newClocking();
		const occurredAt = startAt.subtract({ hours: 2 });
		const command = frozenClockIn(occurredAt);

		const executed = await clocking.run(command);
		const replayed = await clocking.run(command);

		expect(executed.outcome).toBe("executed");
		expect(replayed).toEqual({ ...executed, outcome: "replayed" });
		expect(await stamps()).toEqual([
			expect.objectContaining({
				time_entry_id: command.identity.id,
				captured_at: new Date("2026-09-20T06:00:00Z"),
				purge_at: new Date("2026-10-20T06:00:00Z"),
			}),
		]);
	});

	it("drops the stamp but commits the event when capture is off for the employee", async () => {
		await admin.query(
			`insert into position_capture_assignment
			 (organization_id, assignment_type, employee_id, priority, capture_enabled, created_by)
			 values ($1, 'employee', $2, 2, false, $3)`,
			[ids.organization, ids.employee, ids.user],
		);
		const clocking = newClocking();

		await expect(clocking.run(webClockIn())).resolves.toMatchObject({ outcome: "executed" });
		expect(await stamps()).toEqual([]);
	});

	it("drops a queued stamp whose consent was withdrawn before it arrived", async () => {
		await db.transaction((tx) =>
			withdrawPositionConsent(tx, {
				organizationId: ids.organization,
				employeeId: ids.employee,
				now: startAt.subtract({ minutes: 1 }),
			}),
		);
		const clocking = newClocking();

		await expect(
			clocking.run(frozenClockIn(startAt.subtract({ hours: 2 }))),
		).resolves.toMatchObject({
			outcome: "executed",
		});
		expect(await stamps()).toEqual([]);
	});

	it("drops a stamp whose consent names an earlier notice version", async () => {
		await db.transaction((tx) =>
			savePositionCaptureSettings(tx, {
				organizationId: ids.organization,
				actorUserId: ids.user,
				settings: {
					enabled: true,
					purposeStatement: "Proof of on-site attendance and travel",
					retentionDays: 30,
				},
			}),
		);
		const clocking = newClocking();

		await expect(clocking.run(webClockIn())).resolves.toMatchObject({ outcome: "executed" });
		expect(await stamps()).toEqual([]);
	});

	it("drops a stamp of an event that happened before consent was given", async () => {
		await admin.query("delete from position_consent where organization_id = $1", [
			ids.organization,
		]);
		await db.transaction((tx) =>
			agreeToPositionNotice(tx, {
				organizationId: ids.organization,
				employeeId: ids.employee,
				noticeId: ids.notice,
				now: startAt.subtract({ minutes: 30 }),
			}),
		);
		const clocking = newClocking();

		// Queued offline an hour before the employee agreed.
		await expect(
			clocking.run(frozenClockIn(startAt.subtract({ hours: 1 }))),
		).resolves.toMatchObject({ outcome: "executed" });
		expect(await stamps()).toEqual([]);
	});

	it("never stamps the native mobile app, even with capture on and consent active", async () => {
		const clocking = newClocking();

		await expect(clocking.run({ ...webClockIn(), channel: "mobile" })).resolves.toMatchObject({
			outcome: "executed",
		});
		expect(await stamps()).toEqual([]);
	});

	it("deletes every stamp of the employee on withdrawal, but keeps them when capture is switched off", async () => {
		const clocking = newClocking();
		await clocking.run(webClockIn());
		now = now.add({ hours: 1, milliseconds: MINUTES });
		await clocking.run(webClockOut());
		expect(await stamps()).toHaveLength(2);

		await db.transaction((tx) =>
			savePositionCaptureSettings(tx, {
				organizationId: ids.organization,
				actorUserId: ids.user,
				settings: {
					enabled: false,
					purposeStatement: "Proof of on-site attendance",
					retentionDays: 30,
				},
			}),
		);
		expect(await stamps()).toHaveLength(2);

		const withdrawn = await db.transaction((tx) =>
			withdrawPositionConsent(tx, {
				organizationId: ids.organization,
				employeeId: ids.employee,
				now,
			}),
		);
		expect(withdrawn).toMatchObject({ deletedStampCount: 2 });
		expect(await stamps()).toEqual([]);
	});

	it("refuses to edit or move a stamp, and lets only its purge date move earlier", async () => {
		const clocking = newClocking();
		await clocking.run(webClockIn());

		await expect(
			admin.query("update position_stamp set latitude = 0 where organization_id = $1", [
				ids.organization,
			]),
		).rejects.toThrow(/immutable/);
		await expect(
			admin.query(
				"update position_stamp set purge_at = purge_at + interval '1 day' where organization_id = $1",
				[ids.organization],
			),
		).rejects.toThrow(/immutable/);
		await admin.query(
			"update position_stamp set purge_at = purge_at - interval '1 day' where organization_id = $1",
			[ids.organization],
		);
		expect(only(await stamps()).purge_at).toEqual(new Date("2026-10-19T08:00:00Z"));
	});
});
