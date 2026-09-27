/**
 * The Clocking module's clock-out, through `run` only (#478): legacy and append
 * admission × client, derived and server operation identities.
 *
 * Local contract: pnpm --filter webapp test:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Live work is started through the real web clock-in. The work transactions are
 * the real coordinated adapter, and follow-ups are recorded. Only billing
 * provisioning and the Next request/cache boundaries are replaced.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	billing: { canAccess: true } as { canAccess: boolean; reason?: string },
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 12,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => null } } }));
vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => harness.billing,
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const { createClocking } = await import("./clocking");
const { recordingFollowUps } = await import("./follow-ups");
const { coordinatedTransactions } = await import("./transactions");
const { clockInAs } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { db } = await import("@/db");
type ClockCommand = import("./types").ClockCommand;
type ClockTransactions = import("./transactions").ClockTransactions;

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`Clocking PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t478-clocking-org",
	user: "t478-employee-user",
	otherUser: "t478-other-user",
	employee: "f4780000-0000-4000-8000-000000000001",
	other: "f4780000-0000-4000-8000-000000000002",
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

describeIntegration("Clocking clock-out through run on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

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
			receipts: number;
		}>(
			`select wp.is_active, wp.clock_out_id, wp.duration_minutes, wp.project_id,
			        tr.duration_minutes as record_duration,
			        (select count(*)::int from completed_work_operation where work_period_id = wp.id) as receipts
			 from work_period wp left join time_record tr on tr.id = wp.canonical_record_id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id in ($1, $2)', [ids.user, ids.otherUser]);
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
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Employee', 't478-employee@example.test', $3, $3),
			 ($2, 'Other', 't478-other@example.test', $3, $3)`,
			[ids.user, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't478-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.user, ids.otherUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'employee', $6)`,
			[ids.employee, ids.user, ids.other, ids.otherUser, ids.organization, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[[ids.user, ids.otherUser], timestamp],
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

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") throw new Error("Clocking PostgreSQL is disabled");
	});

	beforeEach(async () => {
		harness.billing = { canAccess: true };
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
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

			// Only the append writer keeps receipts.
			expect(own).toEqual(
				admission === "append"
					? {
							found: true,
							kind: "close_active_work",
							result: expect.objectContaining({ clockOutEntryId: command.identity.id }),
						}
					: { found: false },
			);
			expect(foreign).toEqual({ found: false });
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
				kind: "coordinated",
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
	});
});
