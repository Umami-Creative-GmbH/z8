/**
 * The Clocking module's frozen clock commands, through `run` and `lookup` only
 * (#481): a command that carries its frozen bytes as `payload`, its age window as
 * `freshness` and an explicit close target, as the v2 commands route sends it.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * The work transactions are the real coordinated adapter, and follow-ups are
 * recorded. Only billing provisioning and the Next request/cache boundaries are
 * replaced.
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

const { createClocking } = await import("./clocking");
const { recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions } = await import("./transactions");
type ClockInCommand = import("./types").ClockInCommand;
type ClockOutCommand = import("./types").ClockOutCommand;
type BreakCommand = import("./types").BreakCommand;
type ClockTarget = import("./types").ClockTarget;

const ids = {
	organization: "t481-frozen-org",
	user: "t481-employee-user",
	employee: "f4810000-0000-4000-8000-000000000001",
} as const;
const startAt = parseInstant("2026-09-20T08:00:00Z");
const MINUTES = 60_000;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

/** An immediate window around the server's instant, as the v2 adapter chooses it. */
function immediateWindow(now: Instant) {
	return {
		earliest: now.subtract({ milliseconds: 5 * MINUTES }),
		latest: now.add({ milliseconds: 5 * MINUTES }),
	};
}

describe("Clocking frozen clock commands through run on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let now = startAt;

	function newClocking() {
		const followUps = recordingFollowUps();
		const clocking = createClocking({
			clock: { nowInstant: () => now } as never,
			transactions: coordinatedTransactions(),
			followUps,
		});
		return { clocking, followUps };
	}

	/** The frozen bytes; the receipt stores them verbatim. */
	function payloadOf(kind: string, operationId: string, fields: Record<string, unknown>) {
		return { version: 2, operationId, kind, occurredAt: now.toString(), ...fields };
	}

	function common(at: Instant) {
		const id = randomUUID();
		return {
			organizationId: ids.organization,
			principal: { kind: "user" as const, userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client" as const, id },
			channel: "api" as const,
			at: { kind: "occurred" as const, instant: at },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
			freshness: immediateWindow(now),
		};
	}

	function frozenClockIn(at: Instant = now): ClockInCommand {
		const base = common(at);
		return {
			...base,
			payload: payloadOf("clock_in", base.identity.id, { workLocationType: "home" }),
			body: { kind: "clock_in", workLocationType: "home" },
		};
	}

	function frozenClockOut(target: ClockTarget, at: Instant = now): ClockOutCommand {
		const base = common(at);
		const attribution = {
			project: { kind: "preserve" },
			workCategory: { kind: "preserve" },
		} as const;
		return {
			...base,
			payload: payloadOf("clock_out", base.identity.id, { target, ...attribution }),
			body: { kind: "clock_out", target, ...attribution },
		};
	}

	/** A confirmed idle break: closed at the idle start, resumed at `at`. */
	function frozenBreak(
		target: ClockTarget,
		start: Instant,
		at: Instant,
		observed: Instant[] = [],
	): BreakCommand {
		const base = common(at);
		const breakStart = { at: start.toString(), timezone: "Europe/Lisbon" };
		return {
			...base,
			// Delayed: the idle start lies up to seven days back.
			freshness: { ...base.freshness, earliest: now.subtract({ hours: 7 * 24 }), observed },
			payload: payloadOf("break", base.identity.id, {
				target,
				workLocationType: "office",
				breakStart,
			}),
			body: { kind: "break", target, start: { instant: start, zone: "Europe/Lisbon" } },
		};
	}

	async function entry(id: string) {
		const { rows } = await admin.query(
			"select type, timestamp, utc_offset_minutes, timezone from time_entry where id = $1",
			[id],
		);
		return only(rows);
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** Every row a command can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function receipt(operationId: string) {
		const { rows } = await admin.query(
			"select kind, writer, command_version, command from completed_work_operation where id = $1",
			[operationId],
		);
		return only(rows);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T481 frozen', $1, $2)`,
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
			 values ($1, 'Employee', 't481-employee@example.test', $2, $2)`,
			[ids.user, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t481-member', $1, $2, 'member', 'approved', $3)`,
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
		await setAdmission("active");
	}

	beforeEach(async () => {
		now = startAt;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("commits the frozen bytes under the direct-HTTP writer and replays a retry after its age window", async () => {
		const { clocking } = newClocking();
		const command = frozenClockIn();

		const executed = await clocking.run(command);

		expect(executed).toMatchObject({
			outcome: "executed",
			result: { id: command.identity.id, type: "clock_in", deviceInfo: "api" },
		});
		expect(await receipt(command.identity.id)).toEqual({
			kind: "start_live_work",
			writer: "direct_http",
			command_version: 2,
			command: command.payload,
		});

		// The retry arrives nine days later, far outside its original window.
		now = now.add({ hours: 9 * 24 });
		const before = await snapshot();
		const retried = await clocking.run({ ...command, freshness: immediateWindow(now) });

		expect(retried).toEqual({ ...executed, outcome: "replayed" });
		expect(await snapshot()).toEqual(before);
	});

	it("refuses fresh frozen commands in a legacy organization and still replays committed ones", async () => {
		const { clocking, followUps } = newClocking();
		const committed = frozenClockIn();
		await expect(clocking.run(committed)).resolves.toMatchObject({ outcome: "executed" });
		await setAdmission("inactive");
		const before = await snapshot();

		const replayed = await clocking.run(committed);
		now = now.add({ hours: 1 });
		const close = await clocking.run(
			frozenClockOut({ kind: "started_by", operationId: committed.identity.id }),
		);
		// Live work would otherwise refuse the start first: admission precedes it.
		const start = await clocking.run(frozenClockIn());

		expect(replayed.outcome).toBe("replayed");
		expect(close).toEqual({ outcome: "refused", failure: { code: "frozen_not_accepted" } });
		expect(start).toEqual({ outcome: "refused", failure: { code: "frozen_not_accepted" } });
		expect(await snapshot()).toEqual(before);
		expect(followUps.closures).toEqual([]);
	});

	it("closes only the work its target names, never other active work", async () => {
		const { clocking, followUps } = newClocking();
		const first = frozenClockIn();
		await clocking.run(first);
		const firstTarget = { kind: "started_by", operationId: first.identity.id } as const;
		now = now.add({ hours: 1 });
		await expect(clocking.run(frozenClockOut(firstTarget))).resolves.toMatchObject({
			outcome: "executed",
		});
		now = now.add({ hours: 1 });
		const second = frozenClockIn();
		await clocking.run(second);
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where clock_in_id = $1",
			[first.identity.id],
		);
		const before = await snapshot();

		const stale = await clocking.run(frozenClockOut(firstTarget));
		const byPeriod = await clocking.run(
			frozenClockOut({ kind: "period", workPeriodId: only(rows).id }),
		);
		const unknown = await clocking.run(
			frozenClockOut({ kind: "started_by", operationId: randomUUID() }),
		);

		expect(stale).toEqual({ outcome: "refused", failure: { code: "target_not_active" } });
		expect(byPeriod).toEqual({ outcome: "refused", failure: { code: "target_not_active" } });
		expect(unknown).toEqual({ outcome: "refused", failure: { code: "target_unknown" } });
		expect(await snapshot()).toEqual(before);
		expect(followUps.closures).toHaveLength(1);
	});

	it("closes a frozen break at its observed start in that zone and resumes at its instant", async () => {
		const { clocking, followUps } = newClocking();
		const start = frozenClockIn();
		await clocking.run(start);
		const target = { kind: "started_by", operationId: start.identity.id } as const;
		const idleStart = startAt.add({ hours: 2 });
		const returned = startAt.add({ hours: 2, minutes: 25 });
		now = returned.add({ minutes: 5 });
		const before = await snapshot();

		// A confirmation observed beyond the window refuses the break before any write.
		const early = await clocking.run(
			frozenBreak(target, idleStart, returned, [now.add({ minutes: 5, milliseconds: 1 })]),
		);
		expect(early).toEqual({
			outcome: "refused",
			failure: { code: "admission_window", reason: "in_future" },
		});
		expect(await snapshot()).toEqual(before);

		const command = frozenBreak(target, idleStart, returned, [returned.add({ minutes: 4 })]);
		const executed = await clocking.run(command);

		expect(executed.outcome).toBe("executed");
		expect(await receipt(command.identity.id)).toEqual({
			kind: "close_resume_work",
			writer: "direct_http",
			command_version: 2,
			command: command.payload,
		});
		const { rows } = await admin.query<{ clock_out_id: string }>(
			"select clock_out_id from work_period where clock_in_id = $1",
			[start.identity.id],
		);
		expect(await entry(only(rows).clock_out_id)).toEqual({
			type: "clock_out",
			timestamp: new Date("2026-09-20T10:00:00Z"),
			utc_offset_minutes: 60,
			timezone: "Europe/Lisbon",
		});
		expect(await entry(command.identity.id)).toEqual({
			type: "clock_in",
			timestamp: new Date("2026-09-20T10:25:00Z"),
			utc_offset_minutes: 120,
			timezone: "Europe/Berlin",
		});
		expect(followUps.closures).toEqual([
			expect.objectContaining({ durationMinutes: 120, timezone: "UTC" }),
		]);
	});

	it("looks up committed receipts without running anything", async () => {
		const { clocking } = newClocking();
		const command = frozenClockIn();
		await clocking.run(command);
		const unknown = frozenClockIn();
		const before = await snapshot();

		const committed = await clocking.lookup(command);
		const notCommitted = await clocking.lookup(unknown);
		// The identity is held by work of another writer: nothing is disclosed.
		const otherWriter = await clocking.lookup({ ...command, channel: "web" });

		expect(committed).toEqual({
			outcome: "committed",
			receipt: {
				kind: "start_live_work",
				result: expect.objectContaining({ clockInEntryId: command.identity.id }),
			},
			command: command.payload,
			evidence: "standing",
		});
		expect(notCommitted).toEqual({ outcome: "not_committed" });
		expect(otherWriter).toEqual({ outcome: "conflict" });
		expect(await snapshot()).toEqual(before);

		// Later changes to the work do not unmake the commit, but are reported.
		await admin.query("update work_period set deleted_at = now() where clock_in_id = $1", [
			command.identity.id,
		]);
		await expect(clocking.lookup(command)).resolves.toMatchObject({
			outcome: "committed",
			evidence: "changed",
		});
	});

	it("holds committed evidence it cannot interpret as a collision, never an unknown outcome", async () => {
		const { clocking } = newClocking();
		const start = frozenClockIn();
		await clocking.run(start);
		now = now.add({ hours: 1 });
		const close = frozenClockOut({ kind: "started_by", operationId: start.identity.id });
		await clocking.run(close);
		// A receipt version this code does not know.
		await admin.query("update completed_work_operation set result_version = 99 where id = $1", [
			close.identity.id,
		]);

		await expect(clocking.run(close)).resolves.toMatchObject({
			outcome: "refused",
			failure: { code: "collision" },
		});
	});

	it("treats a frozen identity that receipt-less work already holds as a collision", async () => {
		const { clocking } = newClocking();
		await setAdmission("inactive");
		// A legacy web clock-in: its entry takes the identity, and it keeps no receipt.
		const frozen = frozenClockIn();
		const { payload: _payload, freshness: _freshness, ...live } = frozen;
		await expect(clocking.run({ ...live, channel: "web" })).resolves.toMatchObject({
			outcome: "executed",
		});
		const before = await snapshot();

		const reused = await clocking.run(frozen);

		expect(reused).toMatchObject({ outcome: "refused", failure: { code: "collision" } });
		expect(await clocking.lookup(frozen)).toEqual({ outcome: "conflict" });
		expect(await snapshot()).toEqual(before);
	});
});
