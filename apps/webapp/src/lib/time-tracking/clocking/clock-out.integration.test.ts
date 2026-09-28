/**
 * The Clocking module's clock-out, through `run` only (#478): legacy and append
 * admission × client, derived and server operation identities × self-service,
 * on-behalf (#482) and departure (#485) principals.
 *
 * Local contract: pnpm --filter webapp test:integration
 *
 * Live work is started through the real web clock-in. The work transactions are
 * the real coordinated adapter, and follow-ups are recorded. Only billing
 * provisioning and the Next request/cache boundaries are replaced.
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
const { durableFollowUps, recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions, enlistedTransactions } = await import("./transactions");
const { runDepartureTransaction } = await import("@/lib/employee-lifecycle/departure-transaction");
const { clockInAs } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { db } = await import("@/db");
type ClockCommand = import("./types").ClockCommand;
type ClockTransactions = import("./transactions").ClockTransactions;

const ids = {
	organization: "t478-clocking-org",
	user: "t478-employee-user",
	otherUser: "t478-other-user",
	managerUser: "t478-manager-user",
	ownerUser: "t478-owner-user",
	adminUser: "t478-admin-user",
	employee: "f4780000-0000-4000-8000-000000000001",
	other: "f4780000-0000-4000-8000-000000000002",
	manager: "f4780000-0000-4000-8000-000000000003",
	owner: "f4780000-0000-4000-8000-000000000004",
	managerLink: "f4780000-0000-4000-8000-000000000005",
	admin: "f4780000-0000-4000-8000-000000000006",
	assignedProject: "f4780000-0000-4000-8000-000000000011",
	foreignProject: "f4780000-0000-4000-8000-000000000012",
	assignment: "f4780000-0000-4000-8000-000000000013",
	holidayCategory: "f4780000-0000-4000-8000-000000000021",
	holiday: "f4780000-0000-4000-8000-000000000022",
} as const;
const clockInAt = parseInstant("2026-07-22T08:00:00Z");
const clockOutAt = parseInstant("2026-07-22T09:00:40Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describe("Clocking clock-out through run on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	function newClocking(transactions: ClockTransactions = coordinatedTransactions()) {
		const followUps = recordingFollowUps();
		const clocking = createClocking({
			clock: { nowInstant: () => clockOutAt } as never,
			transactions,
			followUps,
		});
		return { clocking, followUps };
	}

	function clockOut(overrides: Partial<ClockCommand> = {}): ClockCommand {
		return {
			organizationId: ids.organization,
			principal: { kind: "user", userId: ids.user },
			subject: { employeeId: ids.employee },
			identity: { origin: "client", id: randomUUID() },
			channel: "web",
			at: { kind: "occurred", instant: clockOutAt },
			zone: { device: "UTC", fallback: "UTC" },
			body: {
				kind: "clock_out",
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
			...overrides,
		};
	}

	/** A clock-out of the employee's named period, on behalf of them by another principal. */
	function onBehalf(
		workPeriodId: string,
		userId: string,
		overrides: Partial<ClockCommand> = {},
	): ClockCommand {
		return clockOut({
			principal: { kind: "user", userId },
			subject: { employeeId: ids.employee, onBehalf: true },
			at: { kind: "now" },
			zone: { device: "America/New_York", fallback: "UTC" },
			body: {
				kind: "clock_out",
				target: { kind: "period", workPeriodId },
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
			...overrides,
		});
	}

	/** The committed clock-out entry's evidence. */
	async function clockOutEntry(entryId: string) {
		const { rows } = await admin.query(
			`select created_by, device_info, ip_address, timezone, timezone_source
			 from time_entry where id = $1`,
			[entryId],
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

	async function startWork(instant: Instant = clockInAt) {
		const employee = await db.query.employee.findFirst({
			where: (row, { eq }) => eq(row.id, ids.employee),
		});
		if (!employee) throw new Error("Employee missing");
		await expect(
			clockInAs({ userId: ids.user, employee, resolveTimezone: async () => "UTC" }, "office", {
				instant,
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			"select id from work_period where employee_id = $1 and end_time is null",
			[ids.employee],
		);
		return only(rows).id;
	}

	/** Every row a closure can write, to prove "no writes" by equality. */
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

	async function closedPeriod(periodId: string) {
		const { rows } = await admin.query<{
			is_active: boolean;
			clock_out_id: string;
			duration_minutes: number;
			project_id: string | null;
			record_duration: number | null;
			record_projects: string[] | null;
			receipts: number;
		}>(
			`select wp.is_active, wp.clock_out_id, wp.duration_minutes, wp.project_id,
			        tr.duration_minutes as record_duration,
			        (select json_agg(tra.project_id) from time_record_allocation tra
			         where tra.record_id = tr.id) as record_projects,
			        (select count(*)::int from completed_work_operation
			         where work_period_id = wp.id and kind = 'close_active_work') as receipts
			 from work_period wp left join time_record tr on tr.id = wp.canonical_record_id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	async function declareBlockingHoliday() {
		await admin.query(
			`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
			 values ($1, $2, 'public_holiday', 'Closed', true, now())`,
			[ids.holidayCategory, ids.organization],
		);
		await admin.query(
			`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
			 values ($1, $2, $3, 'Closing day', '2026-07-22T00:00:00', '2026-07-22T23:59:59', $4, now())`,
			[ids.holiday, ids.organization, ids.holidayCategory, ids.user],
		);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1)', [
			[ids.user, ids.otherUser, ids.managerUser, ids.ownerUser, ids.adminUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T478 clocking', $1, $2)`,
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
			 select id, id, id || '@example.test', $2, $2 from unnest($1::text[]) as id`,
			[[ids.user, ids.otherUser, ids.managerUser, ids.ownerUser, ids.adminUser], timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't478-member-' || user_id, $1, user_id,
			        case user_id when $4 then 'owner' when $5 then 'admin' else 'member' end,
			        'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.user, ids.otherUser, ids.managerUser, ids.ownerUser, ids.adminUser],
				ids.ownerUser,
				ids.adminUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'employee', $10),
			 ($5, $6, $9, 'manager', $10), ($7, $8, $9, 'employee', $10),
			 ($11, $12, $9, 'employee', $10)`,
			[
				ids.employee,
				ids.user,
				ids.other,
				ids.otherUser,
				ids.manager,
				ids.managerUser,
				ids.owner,
				ids.ownerUser,
				ids.organization,
				timestamp,
				ids.admin,
				ids.adminUser,
			],
		);
		// The manager's only direct report is the employee.
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[ids.managerLink, ids.employee, ids.manager, ids.ownerUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.user, ids.otherUser, ids.managerUser, ids.ownerUser, ids.adminUser], timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $3, 'Assigned', 'active', true, $4, $5), ($2, $3, 'Unassigned', 'active', true, $4, $5)`,
			[ids.assignedProject, ids.foreignProject, ids.organization, ids.user, timestamp],
		);
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.assignment, ids.assignedProject, ids.organization, ids.employee, ids.user],
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
	] as const)("%s admission", (admission, mode) => {
		beforeEach(async () => {
			await setAdmission(mode);
		});

		it("closes live work with one derived duration and follows it up once", async () => {
			const periodId = await startWork();
			const { clocking, followUps } = newClocking();
			const command = clockOut({
				body: {
					kind: "clock_out",
					project: { kind: "replace", id: ids.assignedProject },
					workCategory: { kind: "preserve" },
				},
			});

			const outcome = await clocking.run(command);

			expect(outcome).toMatchObject({
				outcome: "executed",
				result: { id: command.identity.id, type: "clock_out" },
				// 60m40s rounds half up in both representations.
				durationMinutes: 61,
			});
			expect(await closedPeriod(periodId)).toEqual({
				is_active: false,
				clock_out_id: command.identity.id,
				duration_minutes: 61,
				project_id: ids.assignedProject,
				record_duration: 61,
				record_projects: [ids.assignedProject],
				receipts: admission === "append" ? 1 : 0,
			});
			// Instants compare by their canonical strings.
			expect(
				followUps.closures.map(({ start, ...closure }) => ({
					...closure,
					start: start.toString(),
				})),
			).toEqual([
				{
					organizationId: ids.organization,
					employeeId: ids.employee,
					actorUserId: ids.user,
					workPeriodId: periodId,
					start: "2026-07-22T08:00:00Z",
					durationMinutes: 61,
					projectId: ids.assignedProject,
					surchargeSnapshot: expect.any(Object),
					balanceRefreshCommitted: admission === "append",
					timezone: "UTC",
				},
			]);
		});

		it.each(["client", "derived"] as const)(
			"replays a committed %s identity without writes or follow-ups",
			async (origin) => {
				await startWork();
				const { clocking, followUps } = newClocking();
				const command = clockOut({ identity: { origin, id: randomUUID() } });
				const first = await clocking.run(command);
				const committed = await snapshot();

				const retry = await clocking.run(command);

				expect(first).toMatchObject({ outcome: "executed" });
				expect(retry).toEqual({
					outcome: "replayed",
					result: expect.objectContaining({ id: command.identity.id }),
					durationMinutes: 61,
					receipt:
						admission === "append"
							? expect.objectContaining({ operationId: command.identity.id })
							: null,
				});
				expect(await snapshot()).toEqual(committed);
				expect(followUps.closures).toHaveLength(1);
			},
		);

		it("looks up a committed receipt for its own principal only", async () => {
			await startWork();
			const { clocking } = newClocking();
			const command = clockOut();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });

			const own = await clocking.lookup(command);
			const foreign = await clocking.lookup({
				...command,
				principal: { kind: "user", userId: ids.otherUser },
			});

			// Only the append writer keeps receipts; the legacy entry holds the identity.
			expect(own).toEqual(
				admission === "append"
					? {
							outcome: "committed",
							receipt: {
								kind: "close_active_work",
								result: expect.objectContaining({ clockOutEntryId: command.identity.id }),
							},
							command: expect.objectContaining({ operationId: command.identity.id }),
							evidence: "standing",
						}
					: { outcome: "conflict" },
			);
			expect(foreign).toEqual({ outcome: "access_denied" });
		});

		it("never replays a server identity", async () => {
			await startWork();
			const { clocking, followUps } = newClocking();
			const command = clockOut({
				channel: "slack-bot",
				identity: { origin: "server", id: randomUUID() },
			});
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			await expect(clocking.run(command)).resolves.toEqual({
				outcome: "refused",
				failure: { code: "not_clocked_in" },
			});

			expect(await snapshot()).toEqual(committed);
			expect(followUps.closures).toHaveLength(1);
		});

		it("refuses the same identity with a different command as a collision", async () => {
			await startWork();
			const { clocking } = newClocking();
			const command = clockOut();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			const committed = await snapshot();

			const changed = await clocking.run({
				...command,
				body: { ...command.body, project: { kind: "replace", id: ids.assignedProject } },
			});

			expect(changed).toMatchObject({ outcome: "refused", failure: { code: "collision" } });
			expect(await snapshot()).toEqual(committed);
		});

		it("re-checks replay when a matching commit races a late refusal", async () => {
			await startWork();
			const real = coordinatedTransactions();
			const { clocking: racing } = newClocking();
			const command = clockOut();
			let raced = false;
			// The real adapter, paused after the first (replay) transaction so the
			// matching command commits before this one reads its target.
			const { clocking, followUps } = newClocking({
				...real,
				async run(scope, operation) {
					const result = await real.run(scope, operation);
					if (!raced) {
						raced = true;
						await expect(racing.run(command)).resolves.toMatchObject({ outcome: "executed" });
					}
					return result;
				},
			});

			await expect(clocking.run(command)).resolves.toMatchObject({
				outcome: "replayed",
				result: { id: command.identity.id },
			});
			expect(followUps.closures).toEqual([]);
		});

		it("does not refuse a clock-out on a blocking holiday", async () => {
			// The holiday is declared while the employee works: ending that work is allowed.
			const periodId = await startWork();
			await declareBlockingHoliday();
			const { clocking } = newClocking();

			await expect(clocking.run(clockOut())).resolves.toMatchObject({ outcome: "executed" });

			expect(await closedPeriod(periodId)).toMatchObject({ is_active: false });
		});

		it("refuses billing, an ineligible project and another employee's work without writes", async () => {
			await startWork();
			const { clocking, followUps } = newClocking();
			const before = await snapshot();

			harness.billing = { canAccess: false, reason: "subscription_expired" };
			await expect(clocking.run(clockOut())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "billing_required", reason: "subscription_expired" },
			});
			harness.billing = { canAccess: true };
			await expect(
				clocking.run(
					clockOut({
						body: {
							kind: "clock_out",
							project: { kind: "replace", id: ids.foreignProject },
							workCategory: { kind: "preserve" },
						},
					}),
				),
			).resolves.toEqual({ outcome: "refused", failure: { code: "project_not_allowed" } });
			await expect(
				clocking.run(clockOut({ principal: { kind: "user", userId: ids.otherUser } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "access_denied" } });
			await expect(
				clocking.run(clockOut({ identity: { origin: "client", id: "not-a-uuid" } })),
			).resolves.toEqual({ outcome: "refused", failure: { code: "invalid_command" } });

			expect(await snapshot()).toEqual(before);
			expect(followUps.closures).toEqual([]);
		});

		/** A departure's clock-out of the employee's period, as its own departure principal. */
		function departureClockOut(departureId: string, periodId: string, target = true) {
			return clockOut({
				principal: { kind: "departure", departureId, userId: ids.ownerUser },
				identity: { origin: "derived", id: randomUUID() },
				channel: "employee-offboarding",
				zone: { device: null, fallback: "UTC" },
				body: {
					kind: "clock_out",
					...(target ? { target: { kind: "period", workPeriodId: periodId } } : {}),
					project: { kind: "preserve" },
					workCategory: { kind: "preserve" },
				},
			} as Partial<ClockCommand>);
		}

		function enlistedFor(scope: Parameters<typeof enlistedTransactions>[0], departureId: string) {
			return enlistedTransactions(scope, {
				organizationId: ids.organization,
				employeeId: ids.employee,
				departureId,
			});
		}

		// #476 decisions 8, 9, 16 and 20.
		it("runs a departure only enlisted in its own departure's transaction, billing and holiday exempt", async () => {
			const periodId = await startWork();
			await declareBlockingHoliday();
			const departureId = randomUUID();
			const departure = (id = departureId, target = true) =>
				departureClockOut(id, periodId, target);
			const before = await snapshot();

			const coordinated = newClocking();
			await expect(coordinated.clocking.run(departure())).resolves.toEqual({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(await snapshot()).toEqual(before);
			harness.billing = { canAccess: false, reason: "subscription_expired" };
			const outcomes = await runDepartureTransaction(
				db,
				{ organizationId: ids.organization, employeeId: ids.employee },
				async (scope) => {
					const { clocking, followUps } = newClocking(enlistedFor(scope, departureId));
					return {
						followUps,
						otherDeparture: await clocking.run(departure(randomUUID())),
						selfService: await clocking.run(clockOut()),
						unnamed: await clocking.run(departure(departureId, false)),
						executed: await clocking.run(departure()),
					};
				},
			);

			expect(outcomes.otherDeparture).toEqual({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(outcomes.selfService).toEqual({
				outcome: "refused",
				failure: { code: "access_denied" },
			});
			expect(outcomes.unnamed).toEqual({
				outcome: "refused",
				failure: { code: "invalid_command" },
			});
			expect(outcomes.executed).toMatchObject({
				outcome: "executed",
				result: { createdBy: ids.ownerUser, deviceInfo: "employee-offboarding" },
			});
			expect(outcomes.followUps.closures).toHaveLength(1);
			expect(await closedPeriod(periodId)).toMatchObject({
				is_active: false,
				record_duration: 61,
				receipts: admission === "append" ? 1 : 0,
			});
		});

		// A durable adapter stages inside the enlisting transaction: its failure leaves
		// the caller a written closure, which it must roll back.
		it("fails a departure as unconfirmed when its durable follow-ups cannot stage", async () => {
			const periodId = await startWork();
			const departureId = randomUUID();
			const before = await snapshot();
			let outcome: unknown;

			await runDepartureTransaction(
				db,
				{ organizationId: ids.organization, employeeId: ids.employee },
				async (scope) => {
					await scope
						.savepoint(async (savepoint) => {
							const clocking = createClocking({
								clock: { nowInstant: () => clockOutAt } as never,
								transactions: enlistedFor(savepoint, departureId),
								followUps: durableFollowUps(async () => {
									throw new Error("staging failed");
								}),
							});
							outcome = await clocking.run(departureClockOut(departureId, periodId));
							throw new Error("roll the closure back");
						})
						.catch(() => undefined);
				},
			);

			expect(outcome).toMatchObject({
				outcome: "refused",
				failure: { code: "unconfirmed", cause: new Error("staging failed") },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("refuses a stale command by its freshness, but replays it once committed", async () => {
			await startWork();
			const { clocking } = newClocking();
			const window = {
				earliest: clockOutAt.subtract({ minutes: 5 }),
				latest: clockOutAt.add({ minutes: 5 }),
			};
			const stale = clockOut({
				at: { kind: "occurred", instant: clockOutAt.subtract({ minutes: 10 }) },
				freshness: window,
			});
			await expect(clocking.run(stale)).resolves.toEqual({
				outcome: "refused",
				failure: { code: "admission_window", reason: "too_old" },
			});

			const command = clockOut();
			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			// Retried after its window passed: the committed result replays.
			await expect(
				clocking.run({
					...command,
					freshness: {
						earliest: clockOutAt.add({ hours: 1 }),
						latest: clockOutAt.add({ hours: 2 }),
					},
				}),
			).resolves.toMatchObject({ outcome: "replayed" });
		});

		it("keeps the period's attribution on preserve and replays it (#525)", async () => {
			const periodId = await startWork();
			await admin.query("update work_period set project_id = $2 where id = $1", [
				periodId,
				ids.assignedProject,
			]);
			const { clocking } = newClocking();
			const command = clockOut();

			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });
			expect(await closedPeriod(periodId)).toMatchObject({
				project_id: ids.assignedProject,
				record_projects: [ids.assignedProject],
			});
			const committed = await snapshot();

			await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "replayed" });
			// Clearing is a different command under the same identity.
			await expect(
				clocking.run({ ...command, body: { ...command.body, project: { kind: "clear" } } }),
			).resolves.toMatchObject({ outcome: "refused", failure: { code: "collision" } });
			expect(await snapshot()).toEqual(committed);
		});

		describe("on behalf", () => {
			it.each([
				["the direct manager", ids.managerUser],
				["an organization owner", ids.ownerUser],
				["an organization admin", ids.adminUser],
			])("closes the employee's named work for %s", async (_label, userId) => {
				const periodId = await startWork();
				const { clocking, followUps } = newClocking();
				const command = onBehalf(periodId, userId);

				const outcome = await clocking.run(command);

				expect(outcome).toMatchObject({
					outcome: "executed",
					result: { id: command.identity.id, employeeId: ids.employee, type: "clock_out" },
					durationMinutes: 61,
					receipt:
						admission === "append"
							? {
									actors: {
										clockIn: { kind: "human", userId: ids.user },
										completing: { kind: "human", userId },
									},
								}
							: null,
				});
				// Both admissions write the canonical work record (#476 decision 10).
				expect(await closedPeriod(periodId)).toEqual({
					is_active: false,
					clock_out_id: command.identity.id,
					duration_minutes: 61,
					project_id: null,
					record_duration: 61,
					record_projects: null,
					receipts: admission === "append" ? 1 : 0,
				});
				// The subject's zone, never the principal's device.
				expect(await clockOutEntry(command.identity.id)).toEqual({
					created_by: userId,
					device_info: "web-on-behalf",
					ip_address: null,
					timezone: "UTC",
					timezone_source: "manager_target_user_setting",
				});
				expect(followUps.closures).toMatchObject([
					{ employeeId: ids.employee, actorUserId: userId, workPeriodId: periodId },
				]);
			});

			it("replays for the same principal only", async () => {
				const periodId = await startWork();
				const { clocking, followUps } = newClocking();
				const command = onBehalf(periodId, ids.managerUser);
				const first = await clocking.run(command);
				expect(first).toMatchObject({ outcome: "executed" });
				const committed = await snapshot();

				const retry = await clocking.run(command);
				const foreign = await clocking.run({
					...command,
					principal: { kind: "user", userId: ids.ownerUser },
				});

				expect(retry).toMatchObject({
					outcome: "replayed",
					result: { id: command.identity.id },
					receipt: first.outcome === "executed" ? first.receipt : undefined,
				});
				expect(foreign).toMatchObject({ outcome: "refused", failure: { code: "collision" } });
				expect(await snapshot()).toEqual(committed);
				expect(followUps.closures).toHaveLength(1);
			});

			it("stores a server identity's receipt command under the manager's writer and never replays it", async () => {
				const periodId = await startWork();
				const { clocking } = newClocking();
				const command = onBehalf(periodId, ids.managerUser, {
					identity: { origin: "server", id: randomUUID() },
				});
				await expect(clocking.run(command)).resolves.toMatchObject({ outcome: "executed" });

				const { rows } = await admin.query(
					"select writer, command from completed_work_operation where id = $1",
					[command.identity.id],
				);
				expect(rows).toEqual(
					admission === "append"
						? [
								{
									writer: "manager_on_behalf",
									command: {
										version: 1,
										operationId: command.identity.id,
										identity: "server",
										workPeriodId: periodId,
										project: { kind: "preserve" },
										workCategory: { kind: "preserve" },
									},
								},
							]
						: [],
				);
				await expect(clocking.run(command)).resolves.toEqual({
					outcome: "refused",
					failure: { code: "target_not_active" },
				});
			});

			it("refuses without authority, for oneself, for other kinds and without a named period", async () => {
				const periodId = await startWork();
				const { clocking, followUps } = newClocking();
				const before = await snapshot();
				const denied = { outcome: "refused", failure: { code: "access_denied" } };

				// A peer has no authority over the employee's work.
				await expect(clocking.run(onBehalf(periodId, ids.otherUser))).resolves.toEqual(denied);
				// Never on behalf of oneself.
				await expect(clocking.run(onBehalf(periodId, ids.user))).resolves.toEqual(denied);
				// A manager may clock out, not clock in or take a break, on behalf.
				await expect(
					clocking.run(
						onBehalf(periodId, ids.managerUser, {
							body: { kind: "clock_in", workLocationType: "office" },
						}),
					),
				).resolves.toEqual(denied);
				await expect(
					clocking.run(
						onBehalf(periodId, ids.managerUser, { body: { kind: "break", breakMinutes: 15 } }),
					),
				).resolves.toEqual(denied);
				await expect(
					clocking.run(
						onBehalf(periodId, ids.managerUser, {
							body: {
								kind: "clock_out",
								project: { kind: "preserve" },
								workCategory: { kind: "preserve" },
							},
						}),
					),
				).resolves.toEqual({ outcome: "refused", failure: { code: "invalid_command" } });
				// Lookups answer self-service only.
				await expect(clocking.lookup(onBehalf(periodId, ids.managerUser))).resolves.toEqual({
					outcome: "access_denied",
				});

				expect(await snapshot()).toEqual(before);
				expect(followUps.closures).toEqual([]);
			});

			it("refuses a departed admin and an inactive employee's work", async () => {
				const periodId = await startWork();
				const { clocking } = newClocking();
				const denied = { outcome: "refused", failure: { code: "access_denied" } };

				// Membership alone does not carry an admin whose employee profile left.
				await admin.query("update employee set is_active = false where id = $1", [ids.admin]);
				await expect(clocking.run(onBehalf(periodId, ids.adminUser))).resolves.toEqual(denied);
				await admin.query("update employee set is_active = false where id = $1", [ids.employee]);
				await expect(clocking.run(onBehalf(periodId, ids.managerUser))).resolves.toEqual(denied);

				expect(await closedPeriod(periodId)).toMatchObject({ is_active: true });
			});

			it("refuses billing without writes", async () => {
				const periodId = await startWork();
				const { clocking } = newClocking();
				const before = await snapshot();
				harness.billing = { canAccess: false, reason: "subscription_expired" };

				await expect(clocking.run(onBehalf(periodId, ids.managerUser))).resolves.toEqual({
					outcome: "refused",
					failure: { code: "billing_required", reason: "subscription_expired" },
				});
				expect(await snapshot()).toEqual(before);
			});
		});
	});

	it("closes with a legacy command only under legacy admission, and replays it once adopted", async () => {
		await setAdmission("inactive");
		const periodId = await startWork();
		const { clocking, followUps } = newClocking();
		const command = clockOut({ channel: "api", legacy: true });
		await expect(clocking.run(command)).resolves.toMatchObject({
			outcome: "executed",
			result: { id: command.identity.id, deviceInfo: "api" },
		});
		// Every legacy close writes the canonical record and runs the follow-ups.
		expect(await closedPeriod(periodId)).toMatchObject({ record_duration: 61, receipts: 0 });
		expect(followUps.closures).toHaveLength(1);
		await setAdmission("active");
		await startWork(clockOutAt.add({ minutes: 1 }));
		const committed = await snapshot();

		await expect(clocking.run(command)).resolves.toMatchObject({
			outcome: "replayed",
			result: { id: command.identity.id },
		});
		// The new live work stays open for a fresh legacy closure, which is refused.
		for (const identity of [
			{ origin: "client", id: randomUUID() },
			{ origin: "server", id: randomUUID() },
		] as const) {
			await expect(
				clocking.run(
					clockOut({
						identity,
						channel: "api",
						legacy: true,
						at: { kind: "occurred", instant: clockOutAt.add({ hours: 1 }) },
					}),
				),
			).resolves.toEqual({ outcome: "refused", failure: { code: "legacy_not_accepted" } });
		}
		expect(await snapshot()).toEqual(committed);
		expect(followUps.closures).toHaveLength(1);
	});
});
