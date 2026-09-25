/**
 * #285 / T21 runtime evidence: runtime demo generation, correction and cleanup
 * through the shared work coordination, append and completed-work persistence.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real demo server actions and the real web `clockIn` action run against that
 * database. Only the request/session, billing provisioning and Next cache boundaries
 * are replaced. `Math.random` is pinned so the generated work pattern is exact, and
 * only `Date` is faked so the "last 30 days" range is fixed. Adoption is enabled per
 * test organization by inserting its append control row directly: production has
 * no activation setter.
 */

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { calculateHash } from "@/lib/time-tracking/blockchain";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

const {
	assignWorkCategoriesToPeriodsStepAction,
	clearTimeDataAction,
	deleteNonAdminDataAction,
	generatePendingTimeCorrectionApprovalsStepAction,
	generateTimeEntriesStepAction,
} = await import("@/app/[locale]/(app)/settings/demo/actions");
const { clockIn } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");

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
	describe.skip(`runtime demo work PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t285-demo-org",
	otherOrganization: "t285-other-org",
	adminUser: "t285-admin-user",
	requesterUser: "t285-requester-user",
	managerUser: "t285-manager-user",
	peerUser: "t285-peer-user",
	otherUser: "t285-other-user",
	admin: "f1000000-0000-4000-8000-000000000001",
	requester: "f1000000-0000-4000-8000-000000000002",
	manager: "f1000000-0000-4000-8000-000000000003",
	peer: "f1000000-0000-4000-8000-000000000004",
	other: "f1000000-0000-4000-8000-000000000005",
	managerLink: "f2000000-0000-4000-8000-000000000001",
	category: "f3000000-0000-4000-8000-000000000001",
} as const;

// "Last 30 days" from Friday 2026-07-24 12:00 UTC covers 23 weekdays, 2026-06-24..07-24.
const fixedNow = new Date("2026-07-24T12:00:00Z");
const weekdays = 23;
// Math.random = 0.5: every day is worked, no afternoon break, 08:30-13:00 and 13:45-17:30.
const sessionsPerDay = 2;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("runtime demo work on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAsAdmin() {
		// Not the active organization: `canUseDemoData` then checks the admin membership.
		harness.userId = ids.adminUser;
		harness.organizationId = null;
	}

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function setAdmission(mode: "active" | "inactive") {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[ids.organization, mode],
		);
	}

	function stepInput(employeeIds: string[]) {
		return {
			organizationId: ids.organization,
			dateRangeType: "last30" as const,
			employeeIds,
		};
	}

	async function generate(employeeIds: string[]) {
		actAsAdmin();
		return generateTimeEntriesStepAction(stepInput(employeeIds));
	}

	/** Every row a demo operation can write, to prove "no writes" by equality. */
	async function snapshot(organizationId: string = ids.organization) {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as approvals`,
			[organizationId],
		);
		return only(rows);
	}

	async function position(employeeId: string) {
		const { rows } = await admin.query<{
			tip_entry_id: string;
			tip_hash: string;
			version: number;
			entry_count: number;
			admission: string;
			admitted_tip_entry_id: string | null;
			admitted_entry_count: number;
			admitted_operation: string;
			last_operation: string;
		}>("select * from time_entry_append_position where employee_id = $1", [employeeId]);
		return rows[0] ?? null;
	}

	async function entryCount(employeeId: string) {
		const { rows } = await admin.query<{ count: number }>(
			"select count(*)::int as count from time_entry where employee_id = $1",
			[employeeId],
		);
		return only(rows).count;
	}

	/** The explicit tip: the only entry no other entry names as its predecessor. */
	async function explicitTip(employeeId: string) {
		const { rows } = await admin.query<{ id: string; hash: string }>(
			`select e.id, e.hash from time_entry e
			 where e.employee_id = $1
			   and not exists (select 1 from time_entry s where s.previous_entry_id = e.id)`,
			[employeeId],
		);
		return only(rows);
	}

	type SeedEntry = {
		id: string;
		type: "clock_in" | "clock_out";
		timestamp: string;
		previous: string | null;
		createdAt: string;
	};

	/** Inserts a hash-linked history with explicit IDs and chosen creation times. */
	async function seedHistory(employeeId: string, entries: SeedEntry[], createdBy: string) {
		const hashes = new Map<string, string>();
		for (const entry of entries) {
			const previousHash = entry.previous ? (hashes.get(entry.previous) ?? null) : null;
			const hash = calculateHash({
				employeeId,
				type: entry.type,
				timestamp: new Date(entry.timestamp).toISOString(),
				previousHash,
			});
			hashes.set(entry.id, hash);
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, hash, previous_hash, previous_entry_id,
				  created_by, created_at, utc_offset_minutes, timezone, timezone_source)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 'UTC', 'backfill')`,
				[
					entry.id,
					employeeId,
					ids.organization,
					entry.type,
					new Date(entry.timestamp),
					hash,
					previousHash,
					entry.previous,
					createdBy,
					new Date(entry.createdAt),
				],
			);
		}
	}

	async function seedPeriod(employeeId: string, clockInId: string, clockOutId: string) {
		await admin.query(
			`insert into work_period
			 (employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
			  duration_minutes, is_active, updated_at)
			 select $1, $2, i.id, o.id, i.timestamp, o.timestamp,
			        extract(epoch from o.timestamp - i.timestamp)::int / 60, false, now()
			 from time_entry i, time_entry o where i.id = $3 and o.id = $4`,
			[employeeId, ids.organization, clockInId, clockOutId],
		);
	}

	async function cleanup() {
		await admin.query("drop function if exists t285_fail() cascade");
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.adminUser, ids.requesterUser, ids.managerUser, ids.peerUser, ids.otherUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-06-01T00:00:00Z");
		for (const organizationId of [ids.organization, ids.otherOrganization]) {
			await admin.query(
				`insert into organization (id, name, slug, created_at) values ($1, $1, $1, $2)`,
				[organizationId, timestamp],
			);
		}
		const people = [
			[ids.adminUser, ids.admin, "admin", "admin", ids.organization],
			[ids.requesterUser, ids.requester, "member", "employee", ids.organization],
			[ids.managerUser, ids.manager, "member", "manager", ids.organization],
			[ids.peerUser, ids.peer, "member", "employee", ids.organization],
			[ids.otherUser, ids.other, "member", "employee", ids.otherOrganization],
		] as const;
		for (const [userId, employeeId, memberRole, employeeRole, organizationId] of people) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)`,
				[userId, `${userId}@example.test`, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ($1, $2, $3, $4, 'approved', $5)`,
				[`member-${userId}`, organizationId, userId, memberRole, timestamp],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ($1, $2, $3, $4, $5)`,
				[employeeId, userId, organizationId, employeeRole, timestamp],
			);
			await admin.query(
				`insert into user_settings (user_id, timezone, updated_at) values ($1, 'UTC', $2)`,
				[userId, timestamp],
			);
		}
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[ids.managerLink, ids.requester, ids.manager, ids.adminUser],
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
		if (enabled.status !== "enabled") {
			throw new Error("Runtime demo work PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ["Date"], now: fixedNow });
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		await seed();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	describe("generation", () => {
		it("keeps legacy chaining, now atomic per day and without creation-time ties", async () => {
			const result = await generate([ids.requester]);

			expect(result).toEqual({
				success: true,
				data: {
					timeEntriesCreated: weekdays * sessionsPerDay * 2,
					workPeriodsCreated: weekdays * sessionsPerDay,
					employeesHeldForReview: 0,
				},
			});
			const { rows } = await admin.query<{
				periods_with_record: number;
				max_revision: number;
				receipts: number;
				positions: number;
				distinct_created: number;
				entries: number;
			}>(
				`select
				   (select count(*)::int from work_period where employee_id = $1 and canonical_record_id is not null) as periods_with_record,
				   (select max(graph_revision)::int from work_period where employee_id = $1) as max_revision,
				   (select count(*)::int from completed_work_operation where employee_id = $1) as receipts,
				   (select count(*)::int from time_entry_append_position where employee_id = $1) as positions,
				   (select count(distinct created_at)::int from time_entry where employee_id = $1) as distinct_created,
				   (select count(*)::int from time_entry where employee_id = $1) as entries`,
				[ids.requester],
			);
			expect(only(rows)).toEqual({
				periods_with_record: 0,
				max_revision: 0,
				receipts: 0,
				positions: 0,
				distinct_created: weekdays * sessionsPerDay * 2,
				entries: weekdays * sessionsPerDay * 2,
			});
			// Each entry links the latest-created one before it, by ID and hash.
			const { rows: misordered } = await admin.query(
				`select e.id from time_entry e
				 where e.employee_id = $1 and e.previous_entry_id is not null
				   and e.previous_entry_id <> (
				     select p.id from time_entry p where p.employee_id = e.employee_id
				       and p.created_at < e.created_at order by p.created_at desc limit 1)`,
				[ids.requester],
			);
			expect(misordered).toEqual([]);

			// The legacy output is one verified lineage: after adoption the next live
			// clock-in is admitted to its exact tip.
			const tip = await explicitTip(ids.requester);
			await setAdmission("active");
			vi.useRealTimers();
			actAs(ids.requesterUser);
			await expect(clockIn("office", { browserTimezone: "UTC" })).resolves.toMatchObject({
				success: true,
			});
			expect(await position(ids.requester)).toMatchObject({
				admission: "verified_lineage",
				admitted_tip_entry_id: tip.id,
				admitted_entry_count: weekdays * sessionsPerDay * 2,
				last_operation: "live_clock_in",
			});
		});

		it("appends adopted demo work to the true tip of tied and backdated history", async () => {
			await setAdmission("active");
			// True lineage e1 -> e2 -> e3 -> e4. e1/e2 tie on creation time and e3 was
			// created after e4, so latest-created selection would pick e3.
			const e = (n: number) => `f4000000-0000-4000-8000-00000000000${n}`;
			await seedHistory(
				ids.requester,
				[
					{
						id: e(1),
						type: "clock_in",
						timestamp: "2026-07-23T08:00:00Z",
						previous: null,
						createdAt: "2026-07-23T18:00:00Z",
					},
					{
						id: e(2),
						type: "clock_out",
						timestamp: "2026-07-23T12:00:00Z",
						previous: e(1),
						createdAt: "2026-07-23T18:00:00Z",
					},
					{
						id: e(3),
						type: "clock_in",
						timestamp: "2026-07-23T12:30:00Z",
						previous: e(2),
						createdAt: "2026-07-23T18:00:02Z",
					},
					{
						id: e(4),
						type: "clock_out",
						timestamp: "2026-07-23T14:00:00Z",
						previous: e(3),
						createdAt: "2026-07-23T18:00:01Z",
					},
				],
				ids.requesterUser,
			);
			await seedPeriod(ids.requester, e(1), e(2));
			await seedPeriod(ids.requester, e(3), e(4));

			const result = await generate([ids.requester]);

			// 2026-07-23 is occupied by existing work and left untouched.
			const days = weekdays - 1;
			expect(result).toEqual({
				success: true,
				data: {
					timeEntriesCreated: days * sessionsPerDay * 2,
					workPeriodsCreated: days * sessionsPerDay,
					employeesHeldForReview: 0,
				},
			});
			// The first demo entry is backdated to 2026-06-24 but follows e4 exactly.
			const { rows: successors } = await admin.query<{
				type: string;
				timestamp: Date;
				previous_hash: string;
				created_by: string;
			}>(
				"select type, timestamp, previous_hash, created_by from time_entry where previous_entry_id = $1",
				[e(4)],
			);
			const e4Hash = only(
				(await admin.query<{ hash: string }>("select hash from time_entry where id = $1", [e(4)]))
					.rows,
			).hash;
			expect(only(successors)).toEqual({
				type: "clock_in",
				timestamp: new Date("2026-06-24T08:30:00Z"),
				previous_hash: e4Hash,
				created_by: ids.adminUser,
			});
			expect(
				(await admin.query("select id from time_entry where previous_entry_id = $1", [e(3)])).rows,
			).toEqual([{ id: e(4) }]);
			const tip = await explicitTip(ids.requester);
			expect(await position(ids.requester)).toMatchObject({
				tip_entry_id: tip.id,
				tip_hash: tip.hash,
				version: days * sessionsPerDay * 2,
				entry_count: 4 + days * sessionsPerDay * 2,
				admission: "verified_lineage",
				admitted_tip_entry_id: e(4),
				admitted_entry_count: 4,
				admitted_operation: "demo_generation",
				last_operation: "demo_generation",
			});

			// Complete work: canonical base/detail agree with the period, one receipt each.
			const { rows: graph } = await admin.query<{
				agreeing: number;
				receipts: number;
				overlapping: number;
				durations: number[];
			}>(
				`select
				   (select count(*)::int from work_period wp
				      join time_record tr on tr.id = wp.canonical_record_id
				      join time_record_work w on w.record_id = tr.id
				      where wp.employee_id = $1 and tr.start_at = wp.start_time and tr.end_at = wp.end_time
				        and tr.duration_minutes = wp.duration_minutes and tr.approval_state = 'approved'
				        and wp.approval_status = 'approved' and tr.origin = 'clock' and tr.created_by = $2
				        and w.work_category_id is null) as agreeing,
				   (select count(*)::int from completed_work_operation c
				      join work_period wp on wp.id = c.work_period_id
				      where c.employee_id = $1 and c.kind = 'create_completed_work' and c.writer = 'runtime_demo'
				        and c.actor_kind = 'system' and c.actor_user_id is null and c.append_admission = 'append') as receipts,
				   (select count(*)::int from work_period a join work_period b
				      on a.employee_id = b.employee_id and a.id < b.id
				      and a.start_time < b.end_time and b.start_time < a.end_time
				      where a.employee_id = $1) as overlapping,
				   (select array_agg(distinct duration_minutes order by duration_minutes)
				      from work_period where employee_id = $1 and canonical_record_id is not null) as durations`,
				[ids.requester, ids.adminUser],
			);
			expect(only(graph)).toMatchObject({
				agreeing: days * sessionsPerDay,
				receipts: days * sessionsPerDay,
				overlapping: 0,
				durations: [225, 270],
			});
			const { rows: firstReceipt } = await admin.query<{
				command: Record<string, unknown>;
				result: Record<string, unknown>;
				work_period_id: string;
			}>(
				`select c.command, c.result, c.work_period_id from completed_work_operation c
				 join work_period wp on wp.id = c.work_period_id
				 where c.employee_id = $1 order by wp.start_time limit 1`,
				[ids.requester],
			);
			const receipt = only(firstReceipt);
			expect(receipt.command).toEqual({
				version: 1,
				runId: expect.any(String),
				sessionIndex: 0,
				startAt: "2026-06-24T08:30:00Z",
				endAt: "2026-06-24T13:00:00Z",
			});
			expect(receipt.result).toMatchObject({
				version: 1,
				owner: { employeeId: ids.requester },
				actors: {
					executing: { kind: "system", process: "runtime_demo" },
					triggeredBy: { kind: "human", userId: ids.adminUser },
				},
				workPeriodId: receipt.work_period_id,
				segment: {
					startAt: "2026-06-24T08:30:00Z",
					endAt: "2026-06-24T13:00:00Z",
					durationMinutes: 270,
					startUtcOffsetMinutes: 0,
					endUtcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "backfill",
				},
				revisions: { workPeriod: { source: null, result: 0 } },
				append: {
					admission: "append",
					clockIn: { previousEntryId: e(4), previousHash: e4Hash },
				},
				approvalState: "approved",
				approval: { participation: "none" },
				followUps: [
					{
						kind: "work_balance_refresh",
						delivery: "committed_intent",
						dirtyFromDate: "2026-06-24",
					},
				],
			});
			const { rows: balance } = await admin.query(
				"select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1",
				[ids.requester],
			);
			expect(only(balance)).toEqual({ is_dirty: true, dirty_from_date: "2026-06-24" });

			// The next live clock-in follows the demo tip, not the event-latest entry.
			vi.useRealTimers();
			actAs(ids.requesterUser);
			await expect(clockIn("office", { browserTimezone: "UTC" })).resolves.toMatchObject({
				success: true,
			});
			const { rows: clockInRows } = await admin.query(
				"select previous_entry_id from time_entry where employee_id = $1 and created_by = $2 and type = 'clock_in' and created_at > $3",
				[ids.requester, ids.requesterUser, fixedNow],
			);
			expect(clockInRows).toEqual([{ previous_entry_id: tip.id }]);
		});

		it("serializes concurrent adopted generations into one lineage without overlap", async () => {
			await setAdmission("active");

			const [first, second] = await Promise.all([
				generate([ids.requester]),
				generate([ids.requester]),
			]);

			// Each day is written by exactly one run; the other finds it occupied.
			expect(first.success && second.success).toBe(true);
			const created =
				(first.success ? first.data.workPeriodsCreated : 0) +
				(second.success ? second.data.workPeriodsCreated : 0);
			expect(created).toBe(weekdays * sessionsPerDay);
			const { rows } = await admin.query<{ overlapping: number; roots: number; forks: number }>(
				`select
				   (select count(*)::int from work_period a join work_period b
				      on a.employee_id = b.employee_id and a.id < b.id
				      and a.start_time < b.end_time and b.start_time < a.end_time
				      where a.employee_id = $1) as overlapping,
				   (select count(*)::int from time_entry where employee_id = $1 and previous_entry_id is null) as roots,
				   (select count(*)::int from (select previous_entry_id from time_entry
				      where employee_id = $1 and previous_entry_id is not null
				      group by previous_entry_id having count(*) > 1) f) as forks`,
				[ids.requester],
			);
			expect(only(rows)).toEqual({ overlapping: 0, roots: 1, forks: 0 });
			const tip = await explicitTip(ids.requester);
			expect(await position(ids.requester)).toMatchObject({
				tip_entry_id: tip.id,
				entry_count: weekdays * sessionsPerDay * 2,
			});
		});

		it("holds only the employee whose history needs review", async () => {
			await setAdmission("active");
			const e = (n: number) => `f5000000-0000-4000-8000-00000000000${n}`;
			// A fork: e2 and e3 both follow e1.
			await seedHistory(
				ids.requester,
				[
					{
						id: e(1),
						type: "clock_in",
						timestamp: "2026-05-04T08:00:00Z",
						previous: null,
						createdAt: "2026-05-04T18:00:00Z",
					},
					{
						id: e(2),
						type: "clock_out",
						timestamp: "2026-05-04T12:00:00Z",
						previous: e(1),
						createdAt: "2026-05-04T18:00:01Z",
					},
					{
						id: e(3),
						type: "clock_out",
						timestamp: "2026-05-04T13:00:00Z",
						previous: e(1),
						createdAt: "2026-05-04T18:00:02Z",
					},
				],
				ids.requesterUser,
			);
			const before = await snapshot();

			const result = await generate([ids.requester, ids.peer]);

			expect(result).toEqual({
				success: true,
				data: {
					timeEntriesCreated: weekdays * sessionsPerDay * 2,
					workPeriodsCreated: weekdays * sessionsPerDay,
					employeesHeldForReview: 1,
				},
			});
			expect(await entryCount(ids.requester)).toBe(3);
			expect(await position(ids.requester)).toBeNull();
			const after = await snapshot();
			expect(
				(after.entries as { employee_id: string }[]).filter(
					(row) => row.employee_id === ids.requester,
				),
			).toEqual(before.entries);
			expect(await position(ids.peer)).toMatchObject({
				admission: "empty_history",
				admitted_tip_entry_id: null,
				entry_count: weekdays * sessionsPerDay * 2,
			});
		});

		it("rolls back a failed adopted day completely and keeps committed days positioned", async () => {
			await setAdmission("active");
			// Fail the receipt of the first 2026-07-01 session: entries, position, canonical
			// rows and the period of that day were already written in its transaction.
			await admin.query(`
				create function t285_fail() returns trigger language plpgsql as $$
				begin
				  if new.result -> 'segment' ->> 'startAt' like '2026-07-01%' then
				    raise exception 't285 injected receipt failure';
				  end if;
				  return new;
				end $$`);
			await admin.query(
				"create trigger t285_fail before insert on completed_work_operation for each row execute function t285_fail()",
			);

			const result = await generate([ids.requester]);

			expect(result.success).toBe(false);
			// Committed: the five weekdays 2026-06-24..06-30.
			const committed = 5 * sessionsPerDay;
			const { rows } = await admin.query<{
				periods: number;
				records: number;
				receipts: number;
				july: number;
				latest: Date;
			}>(
				`select
				   (select count(*)::int from work_period where employee_id = $1) as periods,
				   (select count(*)::int from time_record where employee_id = $1) as records,
				   (select count(*)::int from completed_work_operation where employee_id = $1) as receipts,
				   (select count(*)::int from time_entry where employee_id = $1 and timestamp >= '2026-07-01') as july,
				   (select max(timestamp) from time_entry where employee_id = $1) as latest`,
				[ids.requester],
			);
			expect(only(rows)).toEqual({
				periods: committed,
				records: committed,
				receipts: committed,
				july: 0,
				latest: new Date("2026-06-30T17:30:00Z"),
			});
			const tip = await explicitTip(ids.requester);
			expect(await position(ids.requester)).toMatchObject({
				tip_entry_id: tip.id,
				entry_count: committed * 2,
				version: committed * 2,
			});
		});

		it("rolls back a failed legacy day without orphaned entries", async () => {
			await admin.query(`
				create function t285_fail() returns trigger language plpgsql as $$
				begin
				  if new.start_time >= '2026-07-01' then
				    raise exception 't285 injected period failure';
				  end if;
				  return new;
				end $$`);
			await admin.query(
				"create trigger t285_fail before insert on work_period for each row execute function t285_fail()",
			);

			const result = await generate([ids.requester]);

			expect(result.success).toBe(false);
			const { rows } = await admin.query<{ entries: number; periods: number }>(
				`select
				   (select count(*)::int from time_entry where employee_id = $1) as entries,
				   (select count(*)::int from work_period where employee_id = $1) as periods`,
				[ids.requester],
			);
			expect(only(rows)).toEqual({ entries: 5 * sessionsPerDay * 2, periods: 5 * sessionsPerDay });
		});
	});

	describe("corrections", () => {
		async function generateCorrections() {
			actAsAdmin();
			return generatePendingTimeCorrectionApprovalsStepAction(stepInput([ids.requester]));
		}

		it("admits adopted demo corrections at the position and keeps strict replay checks", async () => {
			await setAdmission("active");
			await generate([ids.requester]);
			const generatedTip = await explicitTip(ids.requester);
			const generated = await position(ids.requester);

			const result = await generateCorrections();

			expect(result).toEqual({ success: true, data: { pendingTimeCorrectionApprovalsCreated: 5 } });
			const { rows: corrections } = await admin.query<{
				id: string;
				previous_entry_id: string;
				previous_hash: string;
				hash: string;
				is_superseded: boolean;
				created_by: string;
			}>(
				`select id, previous_entry_id, previous_hash, hash, is_superseded, created_by
				 from time_entry where employee_id = $1 and type = 'correction'`,
				[ids.requester],
			);
			expect(corrections).toHaveLength(5);
			// One linear continuation from the generated tip, each by exact ID and hash.
			const first = only(corrections.filter((row) => row.previous_entry_id === generatedTip.id));
			expect(first.previous_hash).toBe(generatedTip.hash);
			let cursor = first;
			for (let index = 1; index < corrections.length; index += 1) {
				cursor = only(corrections.filter((row) => row.previous_entry_id === cursor.id));
				expect(cursor.previous_hash).toBe(
					only(corrections.filter((row) => row.id === cursor.previous_entry_id)).hash,
				);
			}
			expect(
				corrections.every((row) => row.is_superseded && row.created_by === ids.adminUser),
			).toBe(true);
			const tip = await explicitTip(ids.requester);
			expect(tip.id).toBe(cursor.id);
			expect(await position(ids.requester)).toMatchObject({
				tip_entry_id: tip.id,
				version: (generated?.version ?? 0) + 5,
				entry_count: (generated?.entry_count ?? 0) + 5,
				admitted_operation: "demo_generation",
				last_operation: "demo_correction",
			});
			const { rows: approvals } = await admin.query(
				`select count(*)::int as count from approval_request
				 where organization_id = $1 and entity_type = 'time_entry' and status = 'pending'
				   and requested_by = $2 and approver_id = $3`,
				[ids.organization, ids.requester, ids.manager],
			);
			expect(only(approvals)).toEqual({ count: 5 });

			// A second run replays the five committed corrections and seeds the next five
			// periods, continuing the same lineage.
			await expect(generateCorrections()).resolves.toEqual({
				success: true,
				data: { pendingTimeCorrectionApprovalsCreated: 5 },
			});
			const { rows: replaced } = await admin.query<{ entries: number; sources: number }>(
				`select count(*)::int as entries, count(distinct replaces_entry_id)::int as sources
				 from time_entry where employee_id = $1 and type = 'correction'`,
				[ids.requester],
			);
			expect(only(replaced)).toEqual({ entries: 10, sources: 10 });
			const secondTip = await explicitTip(ids.requester);
			expect(await position(ids.requester)).toMatchObject({
				tip_entry_id: secondTip.id,
				version: (generated?.version ?? 0) + 10,
				entry_count: (generated?.entry_count ?? 0) + 10,
			});

			// The established demo replay checks still apply before any fresh admission: a
			// committed correction that no longer matches is refused, with no writes.
			await admin.query("update time_entry set notes = 'tampered' where id = $1", [first.id]);
			const before = await snapshot();
			await expect(generateCorrections()).resolves.toMatchObject({ success: false });
			expect(await snapshot()).toEqual(before);
		});

		it("rolls an admitted correction back with its position when submission fails", async () => {
			await setAdmission("active");
			await generate([ids.requester]);
			await admin.query(`
				create function t285_fail() returns trigger language plpgsql as $$
				begin
				  raise exception 't285 injected approval failure';
				end $$`);
			await admin.query(
				"create trigger t285_fail before insert on approval_request for each row execute function t285_fail()",
			);
			const before = await snapshot();

			await expect(generateCorrections()).resolves.toMatchObject({ success: false });
			// The correction entry and its position advance were written before the
			// approval insert failed; both roll back.
			expect(await snapshot()).toEqual(before);
		});

		it("holds adopted corrections after an unexpected history write", async () => {
			await setAdmission("active");
			await generate([ids.requester]);
			const tip = await explicitTip(ids.requester);
			// A non-participating writer appends after the recorded tip.
			await seedHistory(
				ids.requester,
				[
					{
						id: "f6000000-0000-4000-8000-000000000001",
						type: "clock_in",
						timestamp: "2026-07-25T08:00:00Z",
						previous: null,
						createdAt: "2026-07-25T08:00:00Z",
					},
				],
				ids.requesterUser,
			);
			await admin.query(
				"update time_entry set previous_entry_id = $1, previous_hash = $2 where id = $3",
				[tip.id, tip.hash, "f6000000-0000-4000-8000-000000000001"],
			);
			const before = await snapshot();

			await expect(generateCorrections()).resolves.toEqual({
				success: true,
				data: { pendingTimeCorrectionApprovalsCreated: 0 },
			});
			expect(await snapshot()).toEqual(before);
		});

		it("keeps legacy correction chaining after the organization returns to inactive", async () => {
			await setAdmission("active");
			await generate([ids.requester]);
			const adopted = await position(ids.requester);
			const tip = await explicitTip(ids.requester);
			await setAdmission("inactive");

			await expect(generateCorrections()).resolves.toEqual({
				success: true,
				data: { pendingTimeCorrectionApprovalsCreated: 5 },
			});
			// Legacy links each correction to the latest-created row; the position is untouched.
			const { rows } = await admin.query<{ previous_entry_id: string }>(
				`select previous_entry_id from time_entry
				 where employee_id = $1 and type = 'correction' order by created_at limit 1`,
				[ids.requester],
			);
			expect(only(rows).previous_entry_id).toBe(tip.id);
			expect(await position(ids.requester)).toEqual(adopted);
		});
	});

	describe("attribution", () => {
		it("assigns adopted categories to the canonical detail and advances the revision", async () => {
			await setAdmission("active");
			await admin.query(
				`insert into work_category (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, 'Normal Work', $3, now())`,
				[ids.category, ids.organization, ids.adminUser],
			);
			await generate([ids.requester]);

			actAsAdmin();
			const result = await assignWorkCategoriesToPeriodsStepAction(stepInput([ids.requester]));

			// Math.random = 0.5 assigns ceil(25 %) of the completed periods.
			const expected = Math.ceil(weekdays * sessionsPerDay * 0.25);
			expect(result).toEqual({ success: true, data: { workCategoriesAssigned: expected } });
			const { rows } = await admin.query<{
				assigned: number;
				agreeing: number;
				revised: number;
				unassigned_untouched: number;
			}>(
				`select
				   (select count(*)::int from work_period where employee_id = $1 and work_category_id = $2) as assigned,
				   (select count(*)::int from work_period wp join time_record_work w on w.record_id = wp.canonical_record_id
				      where wp.employee_id = $1 and w.work_category_id is not distinct from wp.work_category_id) as agreeing,
				   (select count(*)::int from work_period where employee_id = $1 and work_category_id = $2 and graph_revision = 1) as revised,
				   (select count(*)::int from work_period where employee_id = $1 and work_category_id is null and graph_revision = 0) as unassigned_untouched`,
				[ids.requester, ids.category],
			);
			expect(only(rows)).toEqual({
				assigned: expected,
				agreeing: weekdays * sessionsPerDay,
				revised: expected,
				unassigned_untouched: weekdays * sessionsPerDay - expected,
			});
		});
	});

	describe("cleanup", () => {
		async function seedOtherOrganizationHistory() {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, hash, previous_hash, created_by,
				  utc_offset_minutes, timezone, timezone_source)
				 values ('f7000000-0000-4000-8000-000000000001', $1, $2, 'clock_in', '2026-07-01T08:00:00Z',
				         'other-hash', null, $3, 0, 'UTC', 'backfill')`,
				[ids.other, ids.otherOrganization, ids.otherUser],
			);
		}

		it("clears adopted history atomically per employee under its employee key", async () => {
			await setAdmission("active");
			await generate([ids.requester, ids.peer]);
			await seedOtherOrganizationHistory();
			const otherBefore = await snapshot(ids.otherOrganization);
			const requesterEntries = await entryCount(ids.requester);

			// A concurrent writer holds the requester's employee key.
			const holder = await admin.connect();
			await holder.query("begin");
			await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [ids.requester]);
			actAsAdmin();
			const clearing = clearTimeDataAction(ids.organization);
			await vi.waitFor(
				async () => {
					const { rows } = await admin.query(
						"select 1 from pg_locks where locktype = 'advisory' and not granted",
					);
					expect(rows.length).toBeGreaterThan(0);
				},
				{ timeout: 10_000, interval: 50 },
			);
			// Nothing of the requester's graph is removed while the key is held.
			expect(await entryCount(ids.requester)).toBe(requesterEntries);
			expect(await position(ids.requester)).not.toBeNull();
			await holder.query("commit");
			holder.release();

			const result = await clearing;

			expect(result).toMatchObject({
				success: true,
				data: {
					timeEntriesDeleted: 2 * weekdays * sessionsPerDay * 2,
					workPeriodsDeleted: 2 * weekdays * sessionsPerDay,
				},
			});
			const { rows } = await admin.query(
				`select
				   (select count(*)::int from time_entry where organization_id = $1) as entries,
				   (select count(*)::int from work_period where organization_id = $1) as periods,
				   (select count(*)::int from time_record where organization_id = $1) as records,
				   (select count(*)::int from time_entry_append_position where organization_id = $1) as positions,
				   (select count(*)::int from completed_work_operation where organization_id = $1) as receipts`,
				[ids.organization],
			);
			expect(only(rows)).toEqual({ entries: 0, periods: 0, records: 0, positions: 0, receipts: 0 });
			expect(await snapshot(ids.otherOrganization)).toEqual(otherBefore);

			// No stale evidence: the next clock-in starts from genuinely empty history.
			vi.useRealTimers();
			actAs(ids.requesterUser);
			await expect(clockIn("office", { browserTimezone: "UTC" })).resolves.toMatchObject({
				success: true,
			});
			expect(await position(ids.requester)).toMatchObject({
				admission: "empty_history",
				entry_count: 1,
			});
		});

		it("clears adopted history after corrections and commits the balance intent", async () => {
			await setAdmission("active");
			await generate([ids.requester]);
			actAsAdmin();
			await expect(
				generatePendingTimeCorrectionApprovalsStepAction(stepInput([ids.requester])),
			).resolves.toEqual({ success: true, data: { pendingTimeCorrectionApprovalsCreated: 5 } });
			await admin.query(
				"update employee_work_balance set is_dirty = false, dirty_from_date = null where employee_id = $1",
				[ids.requester],
			);

			actAsAdmin();
			await expect(clearTimeDataAction(ids.organization)).resolves.toMatchObject({
				success: true,
			});

			const { rows } = await admin.query(
				`select
				   (select count(*)::int from time_entry where employee_id = $1) as entries,
				   (select count(*)::int from work_period where employee_id = $1) as periods,
				   (select count(*)::int from time_entry_append_position where employee_id = $1) as positions,
				   (select count(*)::int from completed_work_operation where employee_id = $1) as receipts,
				   (select count(*)::int from time_record where employee_id = $1) as records,
				   (select count(distinct canonical_record_id)::int from approval_request
				      where organization_id = $2 and canonical_record_id is not null) as referenced,
				   (select is_dirty from employee_work_balance where employee_id = $1) as dirty,
				   (select dirty_from_date::text from employee_work_balance where employee_id = $1) as dirty_from`,
				[ids.requester, ids.organization],
			);
			const result = only(rows) as Record<string, unknown>;
			// Only canonical records a retained approval request still references remain.
			expect(result).toEqual({
				entries: 0,
				periods: 0,
				positions: 0,
				receipts: 0,
				records: result.referenced,
				referenced: result.referenced,
				dirty: true,
				dirty_from: "2026-06-24",
			});
		});

		it("deletes non-admin history while the admin's adopted graph stays admissible", async () => {
			await setAdmission("active");
			await generate([ids.admin, ids.requester]);
			await seedOtherOrganizationHistory();
			const otherBefore = await snapshot(ids.otherOrganization);
			const adminPosition = await position(ids.admin);
			const { rows: adminRowsBefore } = await admin.query(
				`select
				   (select count(*)::int from time_entry where employee_id = $1) as entries,
				   (select count(*)::int from time_record where employee_id = $1) as records,
				   (select count(*)::int from completed_work_operation where employee_id = $1) as receipts`,
				[ids.admin],
			);

			actAsAdmin();
			const result = await deleteNonAdminDataAction(ids.organization);

			expect(result).toMatchObject({
				success: true,
				data: { timeEntriesDeleted: weekdays * sessionsPerDay * 2, employeesDeleted: 3 },
			});
			const { rows: adminRowsAfter } = await admin.query(
				`select
				   (select count(*)::int from time_entry where employee_id = $1) as entries,
				   (select count(*)::int from time_record where employee_id = $1) as records,
				   (select count(*)::int from completed_work_operation where employee_id = $1) as receipts`,
				[ids.admin],
			);
			expect(adminRowsAfter).toEqual(adminRowsBefore);
			expect(await position(ids.admin)).toEqual(adminPosition);
			expect(await snapshot(ids.otherOrganization)).toEqual(otherBefore);

			vi.useRealTimers();
			actAs(ids.adminUser);
			await expect(clockIn("office", { browserTimezone: "UTC" })).resolves.toMatchObject({
				success: true,
			});
			expect(await position(ids.admin)).toMatchObject({
				version: (adminPosition?.version ?? 0) + 1,
				last_operation: "live_clock_in",
			});
		});
	});
});
