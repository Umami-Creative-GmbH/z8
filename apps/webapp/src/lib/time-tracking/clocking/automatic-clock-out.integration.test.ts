import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { workPeriod } from "@/db/schema";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { createLifecycleDatabaseFixture } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { AutoClockOutDecision } from "../automatic-clock-out/types";
import { createClockingService, createDatabaseClockingStore } from "../clocking-core";
import { runWorkTransaction, type WorkTransactionScope } from "../work-transaction";
import { createClocking } from "./clocking";
import { recordingFollowUps } from "./follow-ups";
import { automaticClockOutTransactions, coordinatedTransactions } from "./transactions";
import type { ClockCommand, ClockOutCommand } from "./types";

// Any browser-session lookup or billing gate would make the system closure fail.
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: () => {
				throw new Error("No browser session in maintenance");
			},
		},
	},
}));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({
		canAccess: false,
		reason: "subscription_required",
	}),
	isBillingMutationAllowed: () => false,
}));

const start = parseInstant("2026-10-24T18:00:00Z");
const cutoff = parseInstant("2026-10-25T06:00:00Z");
const now = parseInstant("2026-10-25T06:17:00Z");

describe("automatic Clocking authority in PostgreSQL", () => {
	let fixture: Awaited<ReturnType<typeof createLifecycleDatabaseFixture>>;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});

	async function seed(admission: "legacy" | "append") {
		// Seed through the legacy writer before enabling append for this fresh tenant.
		const organizationId = await fixture.createOrganization();
		const employee = await fixture.seedEmployee({ organizationId });
		const service = createClockingService({
			transaction: (body) => fixture.db.transaction((tx) => body(createDatabaseClockingStore(tx))),
		});
		const opened = await service.clockIn({
			organizationId,
			employeeId: employee.employeeId,
			createdBy: fixture.ownerUserId,
			action: {
				instant: start,
				timezone: "Europe/Berlin",
				utcOffsetMinutes: 120,
				timezoneSource: "user_setting",
			},
			source: { deviceInfo: "test", ipAddress: null },
			workLocationType: "office",
		});
		if (!("period" in opened)) throw new Error("Expected new live work");
		await fixture.pool.query(
			"insert into user_settings (user_id, timezone, updated_at) values ($1, 'Europe/Berlin', now())",
			[employee.userId],
		);
		if (admission === "append")
			await fixture.pool.query(
				"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
				[organizationId],
			);
		const decision: AutoClockOutDecision = {
			organizationId,
			employeeId: employee.employeeId,
			workPeriodId: opened.period.id,
			settings: {
				autoClockOutEnabled: true,
				maxUninterruptedMinutes: 720,
				revision: 0,
			},
			start,
			cutoff,
			timezone: "Europe/Berlin",
			provenanceUserId: fixture.ownerUserId,
			operationId: randomUUID(),
		};
		return { decision, employee };
	}

	function command(decision: AutoClockOutDecision): ClockOutCommand {
		return {
			organizationId: decision.organizationId,
			principal: {
				kind: "automatic_clock_out",
				userId: decision.provenanceUserId,
				operationId: decision.operationId,
				workPeriodId: decision.workPeriodId,
			},
			subject: { employeeId: decision.employeeId },
			identity: { origin: "derived", id: decision.operationId },
			channel: "automatic-clock-out",
			at: { kind: "occurred", instant: decision.cutoff },
			zone: { device: null, fallback: decision.timezone },
			body: {
				kind: "clock_out",
				target: { kind: "period", workPeriodId: decision.workPeriodId },
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
		};
	}

	function enlist<T>(
		decision: AutoClockOutDecision,
		ownerUserId: string,
		operation: (scope: WorkTransactionScope) => Promise<T>,
	) {
		return runWorkTransaction(
			{
				database: fixture.db,
				organizationId: decision.organizationId,
				route: async () => ({
					users: [ownerUserId, decision.provenanceUserId],
					employees: [decision.employeeId],
					writeTargets: [decision.employeeId],
				}),
				lockRows: async (tx) => {
					await tx
						.select()
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.id, decision.workPeriodId),
								eq(workPeriod.organizationId, decision.organizationId),
								eq(workPeriod.employeeId, decision.employeeId),
							),
						)
						.for("update");
				},
			},
			operation,
		);
	}

	function clocking(transactions = coordinatedTransactions()) {
		const followUps = recordingFollowUps();
		return {
			followUps,
			clock: createClocking({
				clock: { nowInstant: () => now } as never,
				transactions,
				followUps,
			}),
		};
	}

	for (const admission of ["legacy", "append"] as const) {
		describe(admission, () => {
			it("refuses automatic authority outside its bound work transaction", async () => {
				const { decision, employee } = await seed(admission);
				const refusedOutsideScope = await clocking().clock.run(command(decision));
				expect(refusedOutsideScope).toMatchObject({
					outcome: "refused",
					failure: { code: "access_denied" },
				});
				// Even a principal naming the employee's own user is not human authority.
				expect(
					await clocking().clock.run(command({ ...decision, provenanceUserId: employee.userId })),
				).toMatchObject({
					outcome: "refused",
					failure: { code: "access_denied" },
				});
			});

			it("refuses every change to the bound closure and refuses human commands in its scope", async () => {
				const { decision, employee } = await seed(admission);
				await enlist(decision, employee.userId, async (scope) => {
					const { clock } = clocking(automaticClockOutTransactions(scope, decision));
					const valid = command(decision);
					const attempts: ClockCommand[] = [
						{ ...valid, organizationId: fixture.organizationId },
						{ ...valid, subject: { employeeId: fixture.employeeId } },
						{ ...valid, identity: { origin: "derived", id: randomUUID() } },
						{
							...valid,
							principal: {
								...valid.principal,
								kind: "automatic_clock_out",
								operationId: randomUUID(),
								workPeriodId: decision.workPeriodId,
							},
						},
						{ ...valid, principal: { kind: "user", userId: employee.userId } },
						{
							...valid,
							principal: {
								kind: "automatic_clock_out",
								userId: employee.userId,
								operationId: decision.operationId,
								workPeriodId: decision.workPeriodId,
							},
						},
						{
							...valid,
							principal: {
								kind: "automatic_clock_out",
								userId: decision.provenanceUserId,
								operationId: decision.operationId,
								workPeriodId: randomUUID(),
							},
						},
						{
							...valid,
							body: {
								...valid.body,
								target: { kind: "period", workPeriodId: randomUUID() },
							},
						},
						{ ...valid, body: { ...valid.body, target: { kind: "active" } } },
						{
							...valid,
							body: { kind: "clock_in", workLocationType: "office" },
						},
						{ ...valid, body: { kind: "break", breakMinutes: 30 } },
						{ ...valid, at: { kind: "occurred", instant: now } },
						{ ...valid, zone: { device: "America/New_York", fallback: "UTC" } },
						{ ...valid, body: { ...valid.body, project: { kind: "clear" } } },
						{ ...valid, channel: "web" },
					];
					for (const attempt of attempts)
						expect(await clock.run(attempt)).toMatchObject({
							outcome: "refused",
							failure: { code: "access_denied" },
						});
					await expect(
						automaticClockOutTransactions(scope, decision).start(
							{
								organizationId: decision.organizationId,
								employeeId: decision.employeeId,
								userId: employee.userId,
							},
							async () => undefined,
						),
					).rejects.toThrow();
				});
				const { rows } = await fixture.pool.query(
					"select end_time from work_period where organization_id = $1 and id = $2",
					[decision.organizationId, decision.workPeriodId],
				);
				expect(rows).toEqual([{ end_time: null }]);
			});

			it("closes at the cutoff with system evidence, original creator and preserved attribution, then replays", async () => {
				const { decision, employee } = await seed(admission);
				const projectId = randomUUID();
				await fixture.pool.query(
					"insert into project (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Existing work', $3, now())",
					[projectId, decision.organizationId, fixture.ownerUserId],
				);
				await fixture.pool.query(
					"update work_period set project_id = $1 where organization_id = $2 and id = $3",
					[projectId, decision.organizationId, decision.workPeriodId],
				);
				// Access revocation must not prevent ending already-live work.
				await fixture.pool.query(
					"update employee set is_active = false where organization_id = $1 and id = $2",
					[decision.organizationId, decision.employeeId],
				);
				await enlist(decision, employee.userId, async (scope) => {
					const { clock, followUps } = clocking(automaticClockOutTransactions(scope, decision));
					const result = await clock.run(command(decision));
					expect(result).toMatchObject({
						outcome: "executed",
						durationMinutes: 720,
						result: {
							createdBy: fixture.ownerUserId,
							timestamp: dateFromInstant(cutoff),
							utcOffsetMinutes: 60,
							timezone: "Europe/Berlin",
							timezoneSource: "system_target_user_setting",
							deviceInfo: "automatic-clock-out",
						},
					});
					expect(followUps.closures).toMatchObject([
						{
							completingActor: {
								kind: "system",
								process: "automatic_clock_out",
							},
							actorUserId: fixture.ownerUserId,
							projectId,
						},
					]);
					expect(await clock.run(command(decision))).toMatchObject({
						outcome: "replayed",
						durationMinutes: 720,
					});
				});
				const { rows: receipts } = await fixture.pool.query(
					"select actor_kind, actor_user_id, result from completed_work_operation where organization_id = $1 and id = $2",
					[decision.organizationId, decision.operationId],
				);
				if (admission === "append")
					expect(receipts).toMatchObject([
						{
							actor_kind: "system",
							actor_user_id: null,
							result: {
								actors: {
									completing: {
										kind: "system",
										process: "automatic_clock_out",
									},
								},
							},
						},
					]);
				else expect(receipts).toEqual([]);
				const { rows } = await fixture.pool.query(
					"select tr.created_by, tr.end_at, wp.project_id from work_period wp join time_record tr on tr.id = wp.canonical_record_id where wp.organization_id = $1 and wp.id = $2",
					[decision.organizationId, decision.workPeriodId],
				);
				expect(rows).toEqual([
					{
						created_by: fixture.ownerUserId,
						end_at: dateFromInstant(cutoff),
						project_id: projectId,
					},
				]);
			});
		});
	}
});
