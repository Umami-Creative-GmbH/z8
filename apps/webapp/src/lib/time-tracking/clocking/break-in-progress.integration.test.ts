/**
 * A break in progress (#861, Time Tracking ADR 0007), through the Clocking
 * module only: starting and resuming it, and every closure of live work ending
 * at its start, in legacy and append admission.
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

const harness = vi.hoisted(() => ({
	billing: { canAccess: true } as { canAccess: boolean; reason?: string },
}));

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => harness.billing,
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { createClocking } = await import("./clocking");
const { recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions } = await import("./transactions");
type BreakCommand = import("./types").BreakCommand;
type ClockOutCommand = import("./types").ClockOutCommand;
type BreakInProgressCommand = import("./break-in-progress").BreakInProgressCommand;
type ClockTransactions = import("./transactions").ClockTransactions;

const ids = {
	organization: "t861-clocking-org",
	user: "t861-employee-user",
	managerUser: "t861-manager-user",
	employee: "f8610000-0000-4000-8000-000000000001",
	manager: "f8610000-0000-4000-8000-000000000002",
} as const;
const workStart = parseInstant("2026-07-22T08:00:00Z");
const breakStart = parseInstant("2026-07-22T09:45:00Z");
const resumeAt = parseInstant("2026-07-22T10:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("Clocking break in progress on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function newClocking(now: Instant, transactions: ClockTransactions = coordinatedTransactions()) {
		const followUps = recordingFollowUps();
		const clocking = createClocking({
			clock: { nowInstant: () => now } as never,
			transactions,
			followUps,
		});
		return { clocking, followUps };
	}

	function breakCommand(overrides: Partial<BreakInProgressCommand> = {}): BreakInProgressCommand {
		return {
			organizationId: ids.organization,
			principal: { kind: "user", userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client", id: randomUUID() },
			channel: "web",
			at: { kind: "now" },
			zone: { device: "Europe/Berlin", fallback: "UTC" },
			...overrides,
		};
	}

	function clockOut(overrides: Partial<ClockOutCommand> = {}): ClockOutCommand {
		return {
			...breakCommand(),
			body: {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
			...overrides,
		};
	}

	async function startWork(at: Instant = workStart) {
		const { clocking } = newClocking(at);
		await expect(
			clocking.run({
				...breakCommand(),
				body: { kind: "clock_in", workLocationType: "office" },
			}),
		).resolves.toMatchObject({ outcome: "executed" });
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and end_time is null",
			[ids.employee],
		);
		return only(rows);
	}

	async function startBreak(at: Instant = breakStart) {
		const { clocking } = newClocking(at);
		const outcome = await clocking.startBreak(breakCommand());
		expect(outcome).toMatchObject({ outcome: "executed" });
		return outcome;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	/** The work records a break leaves, without generated identities. */
	async function workRecords() {
		const { rows: periods } = await admin.query(
			`select start_time, end_time, duration_minutes, is_active, approval_status, work_location_type,
			        break_started_at, break_started_zone
			 from work_period where employee_id = $1 and deleted_at is null order by start_time`,
			[ids.employee],
		);
		const { rows: entries } = await admin.query(
			`select type, timestamp, timezone, utc_offset_minutes
			 from time_entry where employee_id = $1 order by timestamp, created_at`,
			[ids.employee],
		);
		const { rows: records } = await admin.query(
			`select tr.start_at, tr.end_at, tr.duration_minutes
			 from work_period wp join time_record tr on tr.id = wp.canonical_record_id
			 where wp.employee_id = $1 order by tr.start_at`,
			[ids.employee],
		);
		return { periods, entries, records };
	}

	/** Every row a break in progress can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
			[ids.organization],
		);
		return only(rows);
	}

	async function periods() {
		const { rows } = await admin.query<{
			id: string;
			end_time: Date | null;
			is_active: boolean;
			break_started_at: Date | null;
			break_started_zone: string | null;
		}>(
			`select id, end_time, is_active, break_started_at, break_started_zone
			 from work_period where employee_id = $1 and deleted_at is null order by start_time`,
			[ids.employee],
		);
		return rows;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.user, ids.managerUser]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T861 clocking', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Employee', 't861-employee@example.test', $3, $3),
			 ($2, 'Manager', 't861-manager@example.test', $3, $3)`,
			[ids.user, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t861-member-employee', $1, $2, 'member', 'approved', $4),
			 ('t861-member-manager', $1, $3, 'admin', 'approved', $4)`,
			[ids.organization, ids.user, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'admin', $6)`,
			[ids.employee, ids.user, ids.manager, ids.managerUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.user, ids.managerUser], timestamp],
		);
	}

	beforeEach(async () => {
		harness.billing = { canAccess: true };
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe.each([
		["legacy", "inactive"],
		["append", "active"],
	] as const)("%s admission", (_admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("records a break in progress on the live work, which keeps it live", async () => {
			const active = await startWork();

			const outcome = await newClocking(breakStart).clocking.startBreak(breakCommand());

			expect(outcome).toEqual({
				outcome: "executed",
				result: { workPeriodId: active.id, start: expect.anything() },
			});
			expect(outcome.outcome === "executed" && outcome.result.start.toString()).toBe(
				"2026-07-22T09:45:00Z",
			);
			expect(await periods()).toEqual([
				{
					id: active.id,
					end_time: null,
					is_active: true,
					break_started_at: new Date("2026-07-22T09:45:00Z"),
					break_started_zone: "Europe/Berlin",
				},
			]);
		});

		it("start then resume writes the same work records as one break command with that start", async () => {
			await startWork();
			const single: BreakCommand = {
				...breakCommand(),
				body: { kind: "break", start: { instant: breakStart, zone: "Europe/Berlin" } },
			};
			await expect(newClocking(resumeAt).clocking.run(single)).resolves.toMatchObject({
				outcome: "executed",
			});
			const expected = await workRecords();

			await seed();
			await setAdmission(mode);
			await startWork();
			await startBreak();
			const { clocking, followUps } = newClocking(resumeAt);
			const resumed = await clocking.resumeBreak(breakCommand());

			expect(resumed).toMatchObject({ outcome: "executed" });
			expect(await workRecords()).toEqual(expected);
			expect(followUps.closures).toHaveLength(1);
			expect(followUps.closures[0]?.end.toString()).toBe("2026-07-22T09:45:00Z");
		});

		it("refuses a start without live work, a second start and a resume without a break, without writes", async () => {
			const { clocking } = newClocking(breakStart);
			await expect(clocking.startBreak(breakCommand())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "not_clocked_in" },
			});
			await startWork();
			await expect(newClocking(resumeAt).clocking.resumeBreak(breakCommand())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "no_break_in_progress" },
			});
			await startBreak();
			const before = await snapshot();

			await expect(newClocking(resumeAt).clocking.startBreak(breakCommand())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "already_on_break" },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("refuses a start on behalf, by another user and at or before the work's start", async () => {
			await startWork();
			const { clocking } = newClocking(breakStart);
			const before = await snapshot();

			await expect(
				clocking.startBreak(breakCommand({ subject: { employeeId: ids.employee, onBehalf: true } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "access_denied" } });
			await expect(
				clocking.startBreak(breakCommand({ principal: { kind: "user", userId: ids.managerUser } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "access_denied" } });
			await expect(newClocking(workStart).clocking.startBreak(breakCommand())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "invalid_interval" },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("replays a retried start and a retried resume without writes", async () => {
			const active = await startWork();
			const start = breakCommand();
			const started = await newClocking(breakStart).clocking.startBreak(start);
			await expect(newClocking(breakStart).clocking.startBreak(start)).resolves.toEqual({
				...started,
				outcome: "replayed",
			});
			const resume = breakCommand();
			const resumed = await newClocking(resumeAt).clocking.resumeBreak(resume);
			expect(resumed).toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			await expect(newClocking(resumeAt).clocking.resumeBreak(resume)).resolves.toEqual({
				outcome: "replayed",
				result: resumed.outcome === "executed" && { ...resumed.result },
			});
			// The start replays after its break ended, at the closed work's end.
			await expect(newClocking(resumeAt).clocking.startBreak(start)).resolves.toEqual({
				outcome: "replayed",
				result: { workPeriodId: active.id, start: expect.anything() },
			});
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses another break while a break in progress is open", async () => {
			await startWork();
			await startBreak();
			const before = await snapshot();
			const { clocking } = newClocking(resumeAt);

			await expect(
				clocking.run({ ...breakCommand(), body: { kind: "break", breakMinutes: 5 } }),
			).resolves.toEqual({ outcome: "refused", failure: { code: "on_break" } });
			expect(await snapshot()).toEqual(before);
		});

		it("ending the day while on break clocks out at the break's start and clears it", async () => {
			const active = await startWork();
			await startBreak();
			const { clocking, followUps } = newClocking(parseInstant("2026-07-22T17:00:00Z"));

			const outcome = await clocking.run(clockOut());

			expect(outcome).toMatchObject({ outcome: "executed", durationMinutes: 105 });
			expect(await periods()).toEqual([
				{
					id: active.id,
					end_time: new Date("2026-07-22T09:45:00Z"),
					is_active: false,
					break_started_at: null,
					break_started_zone: null,
				},
			]);
			expect(followUps.closures[0]?.end.toString()).toBe("2026-07-22T09:45:00Z");
			const { rows } = await admin.query(
				`select type, timestamp, timezone from time_entry where employee_id = $1 and type = 'clock_out'`,
				[ids.employee],
			);
			expect(rows).toEqual([
				{
					type: "clock_out",
					timestamp: new Date("2026-07-22T09:45:00Z"),
					timezone: "Europe/Berlin",
				},
			]);
			await expect(newClocking(resumeAt).clocking.resumeBreak(breakCommand())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "no_break_in_progress" },
			});
		});

		it("an on-behalf clock-out ends the work at the open break's start and clears it", async () => {
			const active = await startWork();
			await startBreak();
			const { clocking } = newClocking(parseInstant("2026-07-22T17:00:00Z"));

			const outcome = await clocking.run(
				clockOut({
					principal: { kind: "user", userId: ids.managerUser },
					subject: { employeeId: ids.employee, onBehalf: true },
					body: {
						kind: "clock_out",
						target: { kind: "period", workPeriodId: active.id },
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
					},
				}),
			);

			expect(outcome).toMatchObject({ outcome: "executed", durationMinutes: 105 });
			expect(await periods()).toMatchObject([
				{
					end_time: new Date("2026-07-22T09:45:00Z"),
					break_started_at: null,
					break_started_zone: null,
				},
			]);
		});

		it("a clock-out that happened before the break started ends there and clears the break", async () => {
			await startWork();
			await startBreak();
			const { clocking } = newClocking(resumeAt);

			await expect(
				clocking.run(
					clockOut({ at: { kind: "occurred", instant: parseInstant("2026-07-22T09:30:00Z") } }),
				),
			).resolves.toMatchObject({ outcome: "executed", durationMinutes: 90 });
			expect(await periods()).toMatchObject([
				{ end_time: new Date("2026-07-22T09:30:00Z"), break_started_at: null },
			]);
		});

		it("serializes a break that starts while a clock-out plans its closure: the work ends at the break's start", async () => {
			await startWork();
			const real = coordinatedTransactions();
			let transactionsRun = 0;
			// After the replay transaction the clock-out reads its target without a
			// break; the break then commits before the closure's transaction locks.
			const { clocking } = newClocking(parseInstant("2026-07-22T17:00:00Z"), {
				...real,
				async run(scope, operation) {
					transactionsRun += 1;
					if (transactionsRun === 2) await startBreak();
					return real.run(scope, operation);
				},
			});

			await expect(clocking.run(clockOut())).resolves.toMatchObject({
				outcome: "executed",
				durationMinutes: 105,
			});
			expect(await periods()).toMatchObject([
				{ end_time: new Date("2026-07-22T09:45:00Z"), is_active: false, break_started_at: null },
			]);
		});

		it("serializes a start and a clock-out sent together", async () => {
			await startWork();
			const [started, closed] = await Promise.all([
				newClocking(breakStart).clocking.startBreak(breakCommand()),
				newClocking(parseInstant("2026-07-22T17:00:00Z")).clocking.run(clockOut()),
			]);

			expect(closed).toMatchObject({ outcome: "executed" });
			const [period] = await periods();
			expect(period?.break_started_at).toBeNull();
			if (started.outcome === "executed") {
				// The break started first: the closure ended the work at its start.
				expect(period?.end_time).toEqual(new Date("2026-07-22T09:45:00Z"));
			} else {
				expect(started).toEqual({ outcome: "refused", failure: { code: "not_clocked_in" } });
				expect(period?.end_time).toEqual(new Date("2026-07-22T17:00:00Z"));
			}
		});
	});
});
