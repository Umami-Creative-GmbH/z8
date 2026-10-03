import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { employee, organizationTimeTrackingSettings } from "@/db/schema";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureClockOut } from "@/lib/employee-lifecycle/clock-out";
import { runDepartureTransaction } from "@/lib/employee-lifecycle/departure-transaction";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { executeDepartureInTransaction } from "@/lib/employee-lifecycle/transition";
import { createClocking } from "../clocking/clocking";
import { recordingFollowUps } from "../clocking/follow-ups";
import { coordinatedTransactions } from "../clocking/transactions";
import { createClockingService, createDatabaseClockingStore } from "../clocking-core";
import { runWorkTransaction, withOrganizationConfigurationMutation } from "../work-transaction";
import { createAutoClockOutCommands } from "./commands";
import { listDueAutoClockOutCandidates } from "./discovery";
import { deriveAutoClockOutOperationId } from "./identity";
import { saveAutoClockOutSettings } from "./settings";

vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));

const start = parseInstant("2026-10-24T18:00:00Z");
const now = parseInstant("2026-10-25T06:00:00Z");
const clock = { nowInstant: () => now };
function latch() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

describe("automatic clock-out work transactions", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});
	async function seed(admission: "legacy" | "append") {
		const organizationId = await fixture.createOrganization();
		const person = await fixture.seedEmployee({ organizationId });
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		const service = createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
		const opened = await service.clockIn({
			organizationId,
			employeeId: person.employeeId,
			createdBy: owner.userId,
			action: {
				instant: start,
				timezone: "Europe/Berlin",
				utcOffsetMinutes: 120,
				timezoneSource: "user_setting",
			},
			source: { deviceInfo: "test", ipAddress: null },
			workLocationType: "office",
		});
		if (!("period" in opened)) throw new Error("Expected live work");
		await fixture.pool.query(
			"insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())",
			[person.userId],
		);
		if (admission === "append")
			await fixture.pool.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
				[organizationId],
			);
		const candidate = {
			organizationId,
			employeeId: person.employeeId,
			workPeriodId: opened.period.id,
		};
		return { candidate, person, owner };
	}
	function commands(at = now) {
		return createAutoClockOutCommands({ database: fixture.db, clock: { nowInstant: () => at } });
	}
	async function snapshot(organizationId: string) {
		const entries = await fixture.pool.query(
			"select * from time_entry where organization_id = $1 and type = 'clock_out'",
			[organizationId],
		);
		const executions = await fixture.pool.query(
			"select * from automatic_clock_out_execution where organization_id = $1",
			[organizationId],
		);
		const tasks = await fixture.pool.query(
			"select * from automatic_clock_out_task where organization_id = $1 order by kind",
			[organizationId],
		);
		const periods = await fixture.pool.query(
			"select * from work_period where organization_id = $1 order by start_time",
			[organizationId],
		);
		return {
			entries: entries.rows,
			executions: executions.rows,
			tasks: tasks.rows,
			periods: periods.rows,
		};
	}
	async function waitForBlockedWriter() {
		await expect
			.poll(async () =>
				Number(
					(
						await fixture.pool.query(
							"select count(*) from pg_stat_activity where datname = current_database() and wait_event = 'advisory'",
						)
					).rows[0].count,
				),
			)
			.toBeGreaterThan(0);
	}
	for (const admission of ["legacy", "append"] as const)
		describe(admission, () => {
			it("commits one closure and two durable intents under duplicate workers, retaining immutable capture and actor facts", async () => {
				const { candidate, person, owner } = await seed(admission);
				const outcomes = await Promise.all([
					commands().close(candidate),
					commands().close(candidate),
				]);
				expect(outcomes.map((x) => x.status).sort()).toEqual(["closed", "replayed"]);
				const state = await snapshot(candidate.organizationId);
				expect(state.entries).toHaveLength(1);
				expect(state.executions).toHaveLength(1);
				expect(state.tasks.map((x) => x.kind)).toEqual(["follow_up", "plan_notification"]);
				expect(state.executions[0]).toMatchObject({
					start_time: dateFromInstant(start),
					cutoff_time: dateFromInstant(now),
					timezone: "Europe/Berlin",
					utc_offset_minutes: 60,
					recipient_user_id: person.userId,
					provenance_user_id: owner.userId,
					settings_revision: 0,
					closure_payload: {
						version: 1,
						reason: "automatic_clock_out",
						start: "2026-10-24T18:00:00Z",
						end: "2026-10-25T06:00:00Z",
						durationMinutes: 720,
						completingActor: { kind: "system", process: "automatic_clock_out" },
						balanceRefreshCommitted: admission === "append",
					},
				});
				expect(state.entries[0]).toMatchObject({
					created_by: owner.userId,
					timestamp: dateFromInstant(now),
					timezone_source: "system_target_user_setting",
				});
				const receipts = await fixture.pool.query(
					"select * from completed_work_operation where organization_id = $1",
					[candidate.organizationId],
				);
				expect(receipts.rows).toHaveLength(admission === "append" ? 1 : 0);
				await saveAutoClockOutSettings(
					{
						organizationId: candidate.organizationId,
						autoClockOutEnabled: false,
						maxUninterruptedMinutes: 480,
					},
					{ database: fixture.db, clock },
				);
				expect(await commands().close(candidate)).toMatchObject({ status: "replayed" });
			});
			it("rechecks current settings and pins a lowered eight-hour limit after ten hours", async () => {
				const { candidate } = await seed(admission);
				expect(await commands(start.add({ hours: 10 })).close(candidate)).toEqual({
					status: "skipped",
					reason: "not_due",
				});
				await saveAutoClockOutSettings(
					{
						organizationId: candidate.organizationId,
						autoClockOutEnabled: false,
						maxUninterruptedMinutes: 720,
					},
					{ database: fixture.db, clock },
				);
				expect(await commands().close(candidate)).toEqual({
					status: "skipped",
					reason: "disabled",
				});
				await saveAutoClockOutSettings(
					{
						organizationId: candidate.organizationId,
						autoClockOutEnabled: true,
						maxUninterruptedMinutes: 480,
					},
					{ database: fixture.db, clock },
				);
				expect(await commands(start.add({ hours: 10 })).close(candidate)).toMatchObject({
					status: "closed",
				});
				expect((await snapshot(candidate.organizationId)).executions[0]).toMatchObject({
					cutoff_time: new Date("2026-10-25T02:00:00Z"),
					settings_revision: 2,
				});
			});
			for (const minutes of [480, 720, 900, null])
				it(`waits for concurrent configuration ${minutes ?? "disable"} before deciding`, async () => {
					const { candidate } = await seed(admission);
					if (minutes === 720)
						await saveAutoClockOutSettings(
							{
								organizationId: candidate.organizationId,
								autoClockOutEnabled: false,
								maxUninterruptedMinutes: 720,
							},
							{ database: fixture.db, clock },
						);
					const entered = latch();
					const release = latch();
					const mutation = withOrganizationConfigurationMutation(
						fixture.db,
						candidate.organizationId,
						async (tx) => {
							await tx
								.insert(organizationTimeTrackingSettings)
								.values({
									organizationId: candidate.organizationId,
									autoClockOutEnabled: minutes !== null,
									maxUninterruptedMinutes: minutes ?? 720,
									revision: 1,
								})
								.onConflictDoUpdate({
									target: organizationTimeTrackingSettings.organizationId,
									set: { autoClockOutEnabled: true, revision: 2 },
								});
							entered.release();
							await release.promise;
						},
					);
					await entered.promise;
					const closing = commands().close(candidate);
					try {
						await waitForBlockedWriter();
					} finally {
						release.release();
					}
					await mutation;
					expect(await closing).toMatchObject(
						minutes === 480 || minutes === 720
							? { status: "closed" }
							: { status: "skipped", reason: minutes === null ? "disabled" : "not_due" },
					);
					if (minutes === 480)
						expect((await snapshot(candidate.organizationId)).executions[0].cutoff_time).toEqual(
							new Date("2026-10-25T02:00:00Z"),
						);
				});
			for (const action of ["manual", "on_behalf", "break"] as const)
				it(`waits for competing ${action} and never closes resumed work`, async () => {
					const { candidate, person, owner } = await seed(admission);
					const entered = latch();
					const release = latch();
					const ordinary = coordinatedTransactions();
					const human = createClocking({
						clock,
						followUps: recordingFollowUps(),
						transactions: {
							...ordinary,
							run: (input, body) =>
								ordinary.run(input, async (scope) => {
									const value = await body(scope);
									entered.release();
									await release.promise;
									return value;
								}),
						},
					});
					const changing = human.run({
						organizationId: candidate.organizationId,
						principal: {
							kind: "user",
							userId: action === "on_behalf" ? owner.userId : person.userId,
						},
						subject: {
							employeeId: person.employeeId,
							...(action === "on_behalf" ? { onBehalf: true } : {}),
						},
						identity: { origin: "server", id: randomUUID() },
						channel: "web",
						at: { kind: "occurred", instant: now.add({ minutes: 10 }) },
						zone: { device: "Europe/Berlin", fallback: "Europe/Berlin" },
						body:
							action === "break"
								? { kind: "break", breakMinutes: 15 }
								: {
										kind: "clock_out",
										target: { kind: "period", workPeriodId: candidate.workPeriodId },
										project: { kind: "preserve" },
										workCategory: { kind: "preserve" },
									},
					});
					await entered.promise;
					const closing = commands().close(candidate);
					try {
						await waitForBlockedWriter();
					} finally {
						release.release();
					}
					expect(await changing).toMatchObject({ outcome: "executed" });
					expect(await closing).toEqual({ status: "skipped", reason: "not_live" });
					const state = await snapshot(candidate.organizationId);
					expect(state.entries).toHaveLength(1);
					expect(state.executions).toEqual([]);
					expect(state.tasks).toEqual([]);
					if (action === "break")
						expect(state.periods[1]).toMatchObject({ is_active: true, end_time: null });
					expect(
						await listDueAutoClockOutCandidates({ now, after: null, limit: 1000 }, fixture.db),
					).not.toContainEqual(candidate);
				});
			it("restarts when the routed employee user changes and captures the new recipient timezone", async () => {
				const { candidate, person } = await seed(admission);
				const replacement = await fixture.seedEmployee();
				await fixture.pool.query(
					"insert into user_settings (user_id, timezone, updated_at) values ($1, 'America/New_York', now())",
					[replacement.userId],
				);
				const entered = latch();
				const release = latch();
				const changing = runWorkTransaction(
					{
						database: fixture.db,
						organizationId: candidate.organizationId,
						route: async () => ({
							users: [person.userId, replacement.userId],
							employees: [person.employeeId],
							writeTargets: [person.employeeId],
							guards: { users: "exclusive" as const },
						}),
					},
					async (scope) => {
						await scope.db
							.update(employee)
							.set({ userId: replacement.userId })
							.where(
								and(
									eq(employee.organizationId, candidate.organizationId),
									eq(employee.id, person.employeeId),
								),
							);
						entered.release();
						await release.promise;
					},
				);
				await entered.promise;
				const closing = commands().close(candidate);
				try {
					await waitForBlockedWriter();
				} finally {
					release.release();
				}
				await changing;
				expect(await closing).toMatchObject({ status: "closed" });
				expect((await snapshot(candidate.organizationId)).executions[0]).toMatchObject({
					recipient_user_id: replacement.userId,
					timezone: "America/New_York",
					utc_offset_minutes: -240,
				});
			});
			it("waits for a departure closure and stages no automatic notification", async () => {
				const { candidate, person, owner } = await seed(admission);
				const scheduled = await fixture.pool.query(
					`insert into employee_departure
				(organization_id, employee_id, employment_period_id, mode, last_working_day, timezone, cutoff_at, created_by, request_id, request_fingerprint, revision, status)
				values ($1, $2, $3, 'scheduled', '2026-10-25', 'Europe/Berlin', $4, $5, gen_random_uuid(), 'test', 1, 'pending') returning id`,
					[
						candidate.organizationId,
						person.employeeId,
						person.employmentPeriodId,
						dateFromInstant(now),
						owner.userId,
					],
				);
				const identity = {
					organizationId: candidate.organizationId,
					employeeId: person.employeeId,
					employmentPeriodId: person.employmentPeriodId,
					departureId: scheduled.rows[0].id,
					revision: 1,
				};
				const entered = latch();
				const release = latch();
				const departing = runDepartureTransaction(fixture.db, identity, async (scope) => {
					const result = await executeDepartureInTransaction(
						scope,
						identity,
						now,
						createDepartureClockOut(),
					);
					entered.release();
					await release.promise;
					return result;
				});
				await entered.promise;
				const closing = commands().close(candidate);
				try {
					await waitForBlockedWriter();
				} finally {
					release.release();
				}
				await departing;
				expect(await closing).toEqual({ status: "skipped", reason: "not_live" });
				const state = await snapshot(candidate.organizationId);
				expect(state.entries).toHaveLength(1);
				expect(state.tasks).toEqual([]);
				expect(state.executions).toEqual([]);
			});
			it("rolls back entry, canonical work, receipt and execution when staging fails", async () => {
				const { candidate } = await seed(admission);
				const constraint = `reject_${randomUUID().replaceAll("-", "")}`;
				await fixture.pool.query(
					`alter table automatic_clock_out_task add constraint ${constraint} check (organization_id <> '${candidate.organizationId}')`,
				);
				try {
					await expect(commands().close(candidate)).rejects.toThrow();
				} finally {
					await fixture.pool.query(
						`alter table automatic_clock_out_task drop constraint ${constraint}`,
					);
				}
				const state = await snapshot(candidate.organizationId);
				expect(state.entries).toEqual([]);
				expect(state.executions).toEqual([]);
				expect(state.tasks).toEqual([]);
				expect(state.periods[0]).toMatchObject({
					is_active: true,
					end_time: null,
					clock_out_id: null,
					canonical_record_id: null,
				});
				expect(
					(
						await fixture.pool.query(
							"select * from completed_work_operation where organization_id = $1",
							[candidate.organizationId],
						)
					).rows,
				).toEqual([]);
				expect(await commands().close(candidate)).toMatchObject({ status: "closed" });
			});
			it("defers an existing identity collision without staging success intents", async () => {
				const { candidate, owner } = await seed(admission);
				const id = deriveAutoClockOutOperationId({
					...candidate,
					start,
					cutoff: now,
					settings: { autoClockOutEnabled: true, maxUninterruptedMinutes: 720, revision: 0 },
					timezone: "Europe/Berlin",
					provenanceUserId: owner.userId,
				});
				await fixture.pool.query(
					`insert into time_entry (id, organization_id, employee_id, type, timestamp, hash, created_by, timezone, utc_offset_minutes, timezone_source)
				select $1, organization_id, employee_id, 'clock_in', timestamp, 'collision-test', created_by, timezone, utc_offset_minutes, timezone_source from time_entry where organization_id = $2 and employee_id = $3 limit 1`,
					[id, candidate.organizationId, candidate.employeeId],
				);
				expect(await commands().close(candidate)).toEqual({
					status: "deferred",
					reason: "collision",
				});
				const state = await snapshot(candidate.organizationId);
				expect(state.entries).toEqual([]);
				expect(state.executions).toEqual([]);
				expect(state.tasks).toEqual([]);
				expect(state.periods[0]).toMatchObject({ is_active: true, end_time: null });
			});
			it("skips deleted periods, deleted organizations, and mismatched tenant ownership without intents", async () => {
				const { candidate } = await seed(admission);
				expect(
					await commands().close({ ...candidate, organizationId: fixture.organizationId }),
				).toEqual({ status: "skipped", reason: "not_found" });
				await fixture.pool.query(
					"update work_period set deleted_at = now() where organization_id = $1 and id = $2",
					[candidate.organizationId, candidate.workPeriodId],
				);
				expect(await commands().close(candidate)).toMatchObject({ status: "skipped" });
				const second = await seed(admission);
				await fixture.pool.query("update organization set deleted_at = now() where id = $1", [
					second.candidate.organizationId,
				]);
				expect(await commands().close(second.candidate)).toEqual({
					status: "skipped",
					reason: "not_found",
				});
				expect((await snapshot(candidate.organizationId)).tasks).toEqual([]);
			});
		});
	it("defers append history review without staging success intents", async () => {
		const { candidate } = await seed("append");
		await fixture.pool.query(
			`insert into time_entry (id, organization_id, employee_id, type, timestamp, hash, created_by, timezone, utc_offset_minutes, timezone_source)
			select gen_random_uuid(), organization_id, employee_id, 'clock_in', timestamp, 'separate-root', created_by, timezone, utc_offset_minutes, timezone_source from time_entry where organization_id = $1 and employee_id = $2 limit 1`,
			[candidate.organizationId, candidate.employeeId],
		);
		expect(await commands().close(candidate)).toEqual({
			status: "deferred",
			reason: "append_review_required",
		});
		const state = await snapshot(candidate.organizationId);
		expect(state.entries).toEqual([]);
		expect(state.executions).toEqual([]);
		expect(state.tasks).toEqual([]);
		expect(state.periods[0]).toMatchObject({ is_active: true, end_time: null });
	});
	it("propagates a failed database connection for per-candidate reporting", async () => {
		const { candidate } = await seed("legacy");
		const connection = await fixture.openCrashableConnection();
		await connection.close();
		await expect(
			createAutoClockOutCommands({ database: connection.db, clock }).close(candidate),
		).rejects.toThrow();
		expect((await snapshot(candidate.organizationId)).tasks).toEqual([]);
	});
});
