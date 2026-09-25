/**
 * #286 / T22 runtime evidence: direct corrections and attribution changes through
 * the completed-work amendment operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real server actions (`updateWorkPeriodTimes`, `editSameDayTimeEntry`,
 * `updateWorkPeriodProject`, `clockIn`/`clockOut`) and the real
 * `POST /api/time-entries/corrections` route run against that database. Only the
 * request/session, external billing provisioning, Next cache, the change-policy
 * capability and the CASL preflights (`isOrgAdminCasl`, `canApproveFor`) are
 * replaced. The preflights are forced so the operation's own in-transaction
 * authorization is what decides. Adoption is enabled per test organization by
 * inserting its append control row directly: production has no activation setter.
 */

import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	isOrgAdmin: false,
	canApprove: false,
	logs: [] as { context: unknown; message: unknown }[],
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

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

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
							user: {
								id: harness.userId,
								role: "user",
								name: "Actor",
								email: "actor@example.test",
							},
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => harness.isOrgAdmin,
	canApproveFor: async () => harness.canApprove,
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("./policy-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("./policy-helpers")>()),
	checkClockOutNeedsApproval: async () => false,
	getEditCapabilityForPeriod: async () => ({ type: "direct", reason: "no_policy" }),
}));

vi.mock("./shared", async (importOriginal) => {
	const original = await importOriginal<typeof import("./shared")>();
	const record = (context: unknown, message?: unknown) => {
		harness.logs.push({ context, message });
	};
	return {
		...original,
		logger: { ...original.logger, error: record, warn: record, info: () => {}, debug: () => {} },
	};
});

const { clockIn, clockOut } = await import("./clocking");
const { updateWorkPeriodTimes } = await import("./work-period-time-edit");
const { editSameDayTimeEntry } = await import("./corrections");
const { updateWorkPeriodProject } = await import("../actions");
const { POST: postCorrection } = await import("@/app/api/time-entries/corrections/route");
const { clearOrganizationTimeData } = await import("@/lib/demo/demo-data.service");

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
	describe.skip(`work period amendment PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t286-amendment-org",
	requesterUser: "t286-requester-user",
	managerUser: "t286-manager-user",
	adminUser: "t286-admin-user",
	peerUser: "t286-peer-user",
	requester: "e2860000-0000-4000-8000-000000000001",
	manager: "e2860000-0000-4000-8000-000000000002",
	admin: "e2860000-0000-4000-8000-000000000003",
	peer: "e2860000-0000-4000-8000-000000000004",
	managerLink: "e2860000-0000-4000-8000-000000000011",
	projectA: "e2860000-0000-4000-8000-000000000021",
	projectB: "e2860000-0000-4000-8000-000000000022",
	projectUnassigned: "e2860000-0000-4000-8000-000000000023",
	assignmentA: "e2860000-0000-4000-8000-000000000031",
	assignmentB: "e2860000-0000-4000-8000-000000000032",
} as const;
const collision =
	"This change conflicts with an earlier request or changed work. Please refresh and try again.";
const occupied = "The time range overlaps other recorded work";
const needsReview = "This work needs review before it can be changed";
const dayStart = parseInstant("2026-07-22T08:00:00Z");

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration(
	"direct work amendments through the completed-work operation on PostgreSQL",
	() => {
		vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
		const admin = new Pool({ connectionString: databaseUrl, max: 6 });

		function actAs(userId: string, roles: { isOrgAdmin?: boolean; canApprove?: boolean } = {}) {
			harness.userId = userId;
			harness.organizationId = ids.organization;
			harness.isOrgAdmin = roles.isOrgAdmin ?? false;
			harness.canApprove = roles.canApprove ?? false;
		}

		async function setAdmission(mode: "active" | "inactive") {
			await admin.query(
				`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
				[ids.organization, mode],
			);
		}

		/** Real adopted clock-in and clock-out: a complete graph with a receipt. */
		async function recordWork(start: Instant, end: Instant, projectId?: string) {
			actAs(ids.requesterUser);
			await expect(
				clockIn("office", { instant: start, browserTimezone: "UTC" }),
			).resolves.toMatchObject({ success: true });
			await expect(
				clockOut(projectId, undefined, {
					submissionId: randomUUID(),
					instant: end,
					browserTimezone: "UTC",
				}),
			).resolves.toMatchObject({ success: true });
			const { rows } = await admin.query<{ id: string; clock_in_id: string; clock_out_id: string }>(
				`select id, clock_in_id, clock_out_id from work_period
			 where employee_id = $1 and start_time = $2 and deleted_at is null`,
				[ids.requester, new Date(start.epochMilliseconds)],
			);
			return only(rows);
		}

		function adminEdit(
			workPeriodId: string,
			values: { clockInTime?: string; clockOutTime: string; clockOutDate?: string },
			submissionId: string = randomUUID(),
		) {
			actAs(ids.adminUser, { isOrgAdmin: true });
			return updateWorkPeriodTimes({
				workPeriodId,
				submissionId,
				clockInDate: "2026-07-22",
				clockInTime: values.clockInTime ?? "08:00",
				clockOutDate: values.clockOutDate ?? "2026-07-22",
				clockOutTime: values.clockOutTime,
				reason: "Forgot to clock out",
			});
		}

		function postDirectCorrection(
			body: Record<string, unknown>,
			options: { userId: string; canApprove: boolean; idempotencyKey?: string },
		) {
			actAs(options.userId, { canApprove: options.canApprove });
			return postCorrection(
				new NextRequest("http://localhost/api/time-entries/corrections", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
					},
					body: JSON.stringify(body),
				}),
			);
		}

		/** Every row an amendment can write, to prove "no writes" by equality. */
		async function snapshot() {
			const { rows } = await admin.query(
				`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as works,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = $1) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts`,
				[ids.organization],
			);
			return only(rows);
		}

		async function graph(periodId: string) {
			const { rows } = await admin.query<{
				start_time: Date;
				end_time: Date;
				duration_minutes: number;
				clock_in_id: string;
				clock_out_id: string;
				project_id: string | null;
				work_location_type: string | null;
				graph_revision: number;
				record_start: Date;
				record_end: Date;
				record_duration: number;
				record_updated_by: string;
				detail_location: string | null;
				allocations: string[] | null;
			}>(
				`select wp.start_time, wp.end_time, wp.duration_minutes, wp.clock_in_id, wp.clock_out_id,
			        wp.project_id, wp.work_location_type, wp.graph_revision,
			        tr.start_at as record_start, tr.end_at as record_end,
			        tr.duration_minutes as record_duration, tr.updated_by as record_updated_by,
			        w.work_location_type as detail_location,
			        (select array_agg(a.project_id::text order by a.project_id) from time_record_allocation a
			          where a.record_id = tr.id and a.allocation_kind = 'project') as allocations
			 from work_period wp
			 join time_record tr on tr.id = wp.canonical_record_id
			 join time_record_work w on w.record_id = tr.id
			 where wp.id = $1`,
				[periodId],
			);
			return only(rows);
		}

		async function receipts() {
			const { rows } = await admin.query<{
				id: string;
				kind: string;
				writer: string;
				actor_user_id: string;
				command: Record<string, unknown>;
				result: Record<string, unknown>;
			}>(
				`select id, kind, writer, actor_user_id, command, result from completed_work_operation
			 where organization_id = $1 and kind = 'amend_completed_work' order by created_at`,
				[ids.organization],
			);
			return rows;
		}

		async function cleanup() {
			await admin.query("drop function if exists t286_fail() cascade");
			await admin.query("delete from organization where id = $1", [ids.organization]);
			await admin.query('delete from "user" where id = any($1::text[])', [
				[ids.requesterUser, ids.managerUser, ids.adminUser, ids.peerUser],
			]);
		}

		async function seed() {
			await cleanup();
			const timestamp = new Date("2026-07-01T00:00:00Z");
			const users = [ids.requesterUser, ids.managerUser, ids.adminUser, ids.peerUser];
			await admin.query(
				`insert into organization (id, name, slug, created_at) values ($1, 'T286 amendments', $1, $2)`,
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
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
				[users, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t286-member-requester', $1, $2, 'member', 'approved', $6),
			 ('t286-member-manager', $1, $3, 'member', 'approved', $6),
			 ('t286-member-admin', $1, $4, 'admin', 'approved', $6),
			 ('t286-member-peer', $1, $5, 'member', 'approved', $6)`,
				[
					ids.organization,
					ids.requesterUser,
					ids.managerUser,
					ids.adminUser,
					ids.peerUser,
					timestamp,
				],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $9, 'employee', $10), ($7, $8, $9, 'employee', $10)`,
				[
					ids.requester,
					ids.requesterUser,
					ids.manager,
					ids.managerUser,
					ids.admin,
					ids.adminUser,
					ids.peer,
					ids.peerUser,
					ids.organization,
					timestamp,
				],
			);
			await admin.query(
				`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
				[ids.managerLink, ids.requester, ids.manager, ids.adminUser],
			);
			await admin.query(
				`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
				[users, timestamp],
			);
			await admin.query(
				`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $4, 'Project A', 'active', true, $5, $6),
			 ($2, $4, 'Project B', 'active', true, $5, $6),
			 ($3, $4, 'Unassigned', 'active', true, $5, $6)`,
				[
					ids.projectA,
					ids.projectB,
					ids.projectUnassigned,
					ids.organization,
					ids.adminUser,
					timestamp,
				],
			);
			await admin.query(
				`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $4, 'employee', $5, $6), ($3, $7, $4, 'employee', $5, $6)`,
				[
					ids.assignmentA,
					ids.projectA,
					ids.assignmentB,
					ids.organization,
					ids.requester,
					ids.adminUser,
					ids.projectB,
				],
			);
			await setAdmission("active");
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
				throw new Error("Work period amendment PostgreSQL is disabled");
			}
		});

		beforeEach(async () => {
			harness.logs.length = 0;
			await seed();
		});

		afterAll(async () => {
			await cleanup();
			await admin.end();
			const { pool } = (await import("@/db")) as unknown as { pool: Pool };
			await pool.end();
		});

		it("corrects adopted work atomically with one derived duration and exact append linkage", async () => {
			const period = await recordWork(
				dayStart,
				dayStart.add({ minutes: 60, seconds: 40 }),
				ids.projectA,
			);
			const submissionId = randomUUID();
			const { rows: before } = await admin.query<{ hash: string; version: number }>(
				`select te.hash, p.version from time_entry_append_position p
			 join time_entry te on te.id = p.tip_entry_id where p.employee_id = $1`,
				[ids.requester],
			);
			const tip = only(before);

			await expect(adminEdit(period.id, { clockOutTime: "09:31" }, submissionId)).resolves.toEqual({
				success: true,
				data: { status: "applied" },
			});

			const corrected = await graph(period.id);
			expect(corrected).toMatchObject({
				// The unchanged 08:00 minute kept its exact instant; only the end moved.
				start_time: new Date("2026-07-22T08:00:00Z"),
				end_time: new Date("2026-07-22T09:31:00Z"),
				duration_minutes: 91,
				clock_in_id: period.clock_in_id,
				project_id: ids.projectA,
				graph_revision: 2,
				record_start: new Date("2026-07-22T08:00:00Z"),
				record_end: new Date("2026-07-22T09:31:00Z"),
				record_duration: 91,
				record_updated_by: ids.adminUser,
				detail_location: "office",
				allocations: [ids.projectA],
			});
			const { rows: entries } = await admin.query<{
				id: string;
				type: string;
				replaces_entry_id: string | null;
				is_superseded: boolean;
				superseded_by_id: string | null;
				previous_entry_id: string | null;
				previous_hash: string | null;
				created_by: string;
			}>(
				`select id, type, replaces_entry_id, is_superseded, superseded_by_id, previous_entry_id,
			        previous_hash, created_by
			 from time_entry where employee_id = $1 order by created_at, id`,
				[ids.requester],
			);
			expect(entries).toHaveLength(3);
			const correction = only(entries.filter((entry) => entry.type === "correction"));
			expect(correction).toMatchObject({
				id: corrected.clock_out_id,
				replaces_entry_id: period.clock_out_id,
				is_superseded: false,
				previous_entry_id: period.clock_out_id,
				previous_hash: tip.hash,
				created_by: ids.adminUser,
			});
			// The replaced entry is retained as superseded predecessor evidence.
			expect(entries.find((entry) => entry.id === period.clock_out_id)).toMatchObject({
				is_superseded: true,
				superseded_by_id: correction.id,
			});
			const { rows: positions } = await admin.query(
				`select tip_entry_id, version, entry_count, last_operation
			 from time_entry_append_position where employee_id = $1`,
				[ids.requester],
			);
			expect(only(positions)).toEqual({
				tip_entry_id: correction.id,
				version: tip.version + 1,
				entry_count: 3,
				last_operation: "completed_work_correction",
			});
			const { rows: balances } = await admin.query(
				`select is_dirty, dirty_from_date::text from employee_work_balance where employee_id = $1`,
				[ids.requester],
			);
			expect(only(balances)).toEqual({ is_dirty: true, dirty_from_date: "2026-07-22" });

			const [committed] = await receipts();
			expect(committed).toMatchObject({
				id: submissionId,
				kind: "amend_completed_work",
				writer: "admin_time_edit",
				actor_user_id: ids.adminUser,
				command: {
					version: 1,
					operationId: submissionId,
					request: {
						workPeriodId: period.id,
						clockInDate: "2026-07-22",
						clockInTime: "08:00",
						clockOutDate: "2026-07-22",
						clockOutTime: "09:31",
						notes: "Forgot to clock out",
					},
				},
				result: {
					owner: { employeeId: ids.requester },
					actor: { kind: "human", userId: ids.adminUser },
					authority: "organization_admin",
					changes: {
						clockIn: false,
						clockOut: true,
						project: false,
						workCategory: false,
						workLocation: false,
					},
					source: { endAt: "2026-07-22T09:00:40Z", durationMinutes: 61 },
					segment: {
						clockInEntryId: period.clock_in_id,
						clockOutEntryId: correction.id,
						endAt: "2026-07-22T09:31:00Z",
						durationMinutes: 91,
					},
					corrections: [
						{
							endpoint: "clock_out",
							entryId: correction.id,
							replacesEntryId: period.clock_out_id,
							previousEntryId: period.clock_out_id,
							previousHash: tip.hash,
						},
					],
					revisions: { workPeriod: { source: 1, result: 2 } },
					followUps: [
						{
							kind: "work_balance_refresh",
							delivery: "committed_intent",
							dirtyFromDate: "2026-07-22",
						},
					],
				},
			});
		});

		it("derives half-up minutes from exact UTC endpoints, keeping positive zero-minute work", async () => {
			const period = await recordWork(dayStart, dayStart.add({ minutes: 5 }));
			const entryId = period.clock_out_id;
			const zero = await postDirectCorrection(
				{
					replacesEntryId: entryId,
					timestamp: "2026-07-22T08:00:29Z",
					notes: "Short",
					workLocationType: "office",
					workCategoryId: null,
				},
				{ userId: ids.requesterUser, canApprove: true },
			);
			expect(zero.status).toBe(201);
			expect(await graph(period.id)).toMatchObject({ duration_minutes: 0, record_duration: 0 });

			const { rows } = await admin.query<{ clock_out_id: string }>(
				"select clock_out_id from work_period where id = $1",
				[period.id],
			);
			const one = await postDirectCorrection(
				{
					replacesEntryId: only(rows).clock_out_id,
					timestamp: "2026-07-22T08:00:30Z",
					notes: "Half minute",
					workLocationType: "office",
					workCategoryId: null,
				},
				{ userId: ids.requesterUser, canApprove: true },
			);
			expect(one.status).toBe(201);
			expect(await graph(period.id)).toMatchObject({ duration_minutes: 1, record_duration: 1 });

			const equal = await postDirectCorrection(
				{
					replacesEntryId: (await graph(period.id)).clock_out_id,
					timestamp: "2026-07-22T08:00:00Z",
					notes: "Equal",
					workLocationType: "office",
					workCategoryId: null,
				},
				{ userId: ids.requesterUser, canApprove: true },
			);
			expect(equal.status).toBe(400);
		});

		it("replays an exact retry without writes and treats a changed command as a collision", async () => {
			const period = await recordWork(dayStart, dayStart.add({ minutes: 60, seconds: 40 }));
			const submissionId = randomUUID();
			await expect(
				adminEdit(period.id, { clockOutTime: "09:31" }, submissionId),
			).resolves.toMatchObject({
				success: true,
			});
			const committed = await snapshot();

			await expect(adminEdit(period.id, { clockOutTime: "09:31" }, submissionId)).resolves.toEqual({
				success: true,
				data: { status: "applied" },
			});
			expect(await snapshot()).toEqual(committed);

			await expect(adminEdit(period.id, { clockOutTime: "09:45" }, submissionId)).resolves.toEqual({
				success: false,
				error: collision,
				code: "completed_work_collision",
			});
			expect(await snapshot()).toEqual(committed);
		});

		it("never recreates corrected or deleted work from an old token", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			const first = randomUUID();
			await expect(adminEdit(period.id, { clockOutTime: "09:30" }, first)).resolves.toMatchObject({
				success: true,
			});
			await expect(adminEdit(period.id, { clockOutTime: "09:45" })).resolves.toMatchObject({
				success: true,
			});
			const corrected = await snapshot();
			await expect(adminEdit(period.id, { clockOutTime: "09:30" }, first)).resolves.toMatchObject({
				success: false,
				error: collision,
			});
			expect(await snapshot()).toEqual(corrected);

			// Business deletion (the correction finalizer's shape): retained entries, deleted period.
			await admin.query("update work_period set deleted_at = now() where id = $1", [period.id]);
			const deleted = await snapshot();
			// The action's target read already refuses deleted work before replay.
			await expect(adminEdit(period.id, { clockOutTime: "09:30" }, first)).resolves.toMatchObject({
				success: false,
				error: "Work period not found",
			});
			expect(await snapshot()).toEqual(deleted);
		});

		it("checks the resulting interval symmetrically, excluding only the replaced source", async () => {
			const morning = await recordWork(dayStart, dayStart.add({ hours: 2 }));
			const noon = await recordWork(dayStart.add({ hours: 4 }), dayStart.add({ hours: 5 }));
			const before = await snapshot();

			await expect(adminEdit(morning.id, { clockOutTime: "12:30" })).resolves.toEqual({
				success: false,
				error: occupied,
				code: "work_interval_occupied",
			});
			expect(await snapshot()).toEqual(before);

			// Adjacency is valid; moving within its own former interval excludes itself.
			await expect(adminEdit(morning.id, { clockOutTime: "12:00" })).resolves.toMatchObject({
				success: true,
			});
			await expect(
				adminEdit(morning.id, { clockInTime: "09:00", clockOutTime: "11:00" }),
			).resolves.toMatchObject({
				success: true,
			});

			// Rejected work still occupies its interval; deleted work does not.
			await admin.query("update work_period set approval_status = 'rejected' where id = $1", [
				noon.id,
			]);
			await expect(
				adminEdit(morning.id, { clockInTime: "09:00", clockOutTime: "12:30" }),
			).resolves.toMatchObject({
				error: occupied,
			});
			await admin.query("update work_period set deleted_at = now() where id = $1", [noon.id]);
			await expect(
				adminEdit(morning.id, { clockInTime: "09:00", clockOutTime: "12:30" }),
			).resolves.toMatchObject({
				success: true,
			});
		});

		it("treats active work, including a start on an earlier day, as occupying from its start", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			actAs(ids.requesterUser);
			await expect(
				clockIn("office", { instant: dayStart.add({ hours: 3 }), browserTimezone: "UTC" }),
			).resolves.toMatchObject({ success: true });
			const before = await snapshot();
			await expect(adminEdit(period.id, { clockOutTime: "11:30" })).resolves.toMatchObject({
				error: occupied,
			});
			expect(await snapshot()).toEqual(before);
		});

		it("rejects stale sources and serializes concurrent edits of one period", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			const results = await Promise.all([
				adminEdit(period.id, { clockOutTime: "09:30" }),
				adminEdit(period.id, { clockOutTime: "09:40" }),
			]);
			const succeeded = results.filter((result) => result.success);
			expect(succeeded).toHaveLength(1);
			expect(results.find((result) => !result.success)).toMatchObject({
				error: "Work period changed while editing",
			});
			const { rows } = await admin.query<{ count: number }>(
				"select count(*)::int as count from time_entry where employee_id = $1 and type = 'correction'",
				[ids.requester],
			);
			expect(only(rows).count).toBe(1);
			expect((await graph(period.id)).graph_revision).toBe(2);
		});

		it.each([
			["time_entry", "insert"],
			["time_entry", "update"],
			["time_entry_append_position", "update"],
			["work_period", "update"],
			["time_record", "update"],
			["time_record_allocation", "delete"],
			["time_record_allocation", "insert"],
			["employee_work_balance", "insert"],
			["completed_work_operation", "insert"],
		])("rolls back the whole graph when the %s %s fails", async (table, event) => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }), ids.projectA);
			const before = await snapshot();
			await admin.query(
				`create function t286_fail() returns trigger language plpgsql as $$
			 begin raise exception 't286 injected failure'; end $$`,
			);
			await admin.query(
				`create trigger t286_fail before ${event} on ${table} for each row execute function t286_fail()`,
			);
			try {
				const result =
					table === "time_record_allocation"
						? await (async () => {
								// Project changes exercise the allocation writes.
								actAs(ids.requesterUser);
								return updateWorkPeriodProject(period.id, ids.projectB);
							})()
						: await adminEdit(period.id, { clockOutTime: "09:30" });
				expect(result.success).toBe(false);
			} finally {
				await admin.query("drop function t286_fail() cascade");
			}
			expect(await snapshot()).toEqual(before);
		});

		it("changes metadata in both representations and preserves unaffected attribution", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }), ids.projectA);
			const submissionId = randomUUID();
			actAs(ids.requesterUser);
			await expect(
				editSameDayTimeEntry({
					workPeriodId: period.id,
					submissionId,
					newClockInDate: "2026-07-22",
					newClockInTime: "08:00",
					newClockOutDate: "2026-07-22",
					newClockOutTime: "09:00",
					workLocationType: "home",
					workCategoryId: null,
				}),
			).resolves.toEqual({ success: true, data: { workPeriodId: period.id } });
			expect(await graph(period.id)).toMatchObject({
				// Metadata only: endpoints, protected minutes and the project allocation stay.
				end_time: new Date("2026-07-22T09:00:00Z"),
				duration_minutes: 60,
				record_duration: 60,
				clock_out_id: period.clock_out_id,
				work_location_type: "home",
				detail_location: "home",
				project_id: ids.projectA,
				allocations: [ids.projectA],
				graph_revision: 2,
			});
			const [committed] = await receipts();
			expect(committed).toMatchObject({
				writer: "self_service_time_edit",
				result: {
					authority: "owner",
					changes: { clockIn: false, clockOut: false, workLocation: true, project: false },
					corrections: [],
					followUps: [],
				},
			});
			// The retry replays even though the submitted value is now the current value.
			const replayed = await snapshot();
			await expect(
				editSameDayTimeEntry({
					workPeriodId: period.id,
					submissionId,
					newClockInDate: "2026-07-22",
					newClockInTime: "08:00",
					newClockOutDate: "2026-07-22",
					newClockOutTime: "09:00",
					workLocationType: "home",
					workCategoryId: null,
				}),
			).resolves.toMatchObject({ success: true });
			expect(await snapshot()).toEqual(replayed);
		});

		it("replaces, clears and validates the project with its canonical allocation", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }), ids.projectA);
			actAs(ids.requesterUser);
			await expect(updateWorkPeriodProject(period.id, ids.projectB)).resolves.toMatchObject({
				success: true,
			});
			expect(await graph(period.id)).toMatchObject({
				project_id: ids.projectB,
				allocations: [ids.projectB],
				duration_minutes: 60,
				graph_revision: 2,
			});
			await expect(updateWorkPeriodProject(period.id, null)).resolves.toMatchObject({
				success: true,
			});
			expect(await graph(period.id)).toMatchObject({
				project_id: null,
				allocations: null,
				graph_revision: 3,
			});
			const before = await snapshot();
			await expect(
				updateWorkPeriodProject(period.id, ids.projectUnassigned),
			).resolves.toMatchObject({
				success: false,
			});
			expect(await snapshot()).toEqual(before);
			expect((await receipts()).map((row) => row.writer)).toEqual([
				"work_period_attribution_edit",
				"work_period_attribution_edit",
			]);
		});

		it("carries a project set on active work into the closed graph", async () => {
			actAs(ids.requesterUser);
			await expect(
				clockIn("office", { instant: dayStart, browserTimezone: "UTC" }),
			).resolves.toMatchObject({ success: true });
			const { rows } = await admin.query<{ id: string }>(
				"select id from work_period where employee_id = $1 and end_time is null",
				[ids.requester],
			);
			const active = only(rows);
			await expect(updateWorkPeriodProject(active.id, ids.projectB)).resolves.toMatchObject({
				success: true,
			});
			const { rows: revision } = await admin.query<{ graph_revision: number; project_id: string }>(
				"select graph_revision, project_id from work_period where id = $1",
				[active.id],
			);
			expect(only(revision)).toEqual({ graph_revision: 1, project_id: ids.projectB });
			await expect(
				clockOut(undefined, undefined, {
					submissionId: randomUUID(),
					instant: dayStart.add({ hours: 1 }),
					browserTimezone: "UTC",
				}),
			).resolves.toMatchObject({ success: true });
			expect(await graph(active.id)).toMatchObject({
				project_id: ids.projectB,
				allocations: [ids.projectB],
				graph_revision: 2,
			});
		});

		it("authorizes with current scoped authority inside the transaction, including replay", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			const body = {
				replacesEntryId: period.clock_out_id,
				timestamp: "2026-07-22T09:15:00Z",
				notes: "Manager correction",
				workLocationType: "office",
				workCategoryId: null,
			};
			const before = await snapshot();
			// The CASL preflight is forced open: the operation's own locks decide.
			const peer = await postDirectCorrection(body, { userId: ids.peerUser, canApprove: true });
			expect(peer.status).toBe(403);
			expect(await snapshot()).toEqual(before);

			const key = randomUUID();
			const managed = await postDirectCorrection(body, {
				userId: ids.managerUser,
				canApprove: true,
				idempotencyKey: key,
			});
			expect(managed.status).toBe(201);
			const created = (await managed.json()) as { entry: { id: string; createdBy: string } };
			expect(created.entry.createdBy).toBe(ids.managerUser);
			const committed = await snapshot();

			const replayed = await postDirectCorrection(body, {
				userId: ids.managerUser,
				canApprove: true,
				idempotencyKey: key,
			});
			expect(replayed.status).toBe(201);
			expect(((await replayed.json()) as { entry: { id: string } }).entry.id).toBe(
				created.entry.id,
			);
			expect(await snapshot()).toEqual(committed);

			// Replay keeps current access rules: a removed manager link denies it.
			await admin.query("delete from employee_managers where id = $1", [ids.managerLink]);
			const revoked = await postDirectCorrection(body, {
				userId: ids.managerUser,
				canApprove: true,
				idempotencyKey: key,
			});
			expect(revoked.status).toBe(403);
			expect(await snapshot()).toEqual(committed);
		});

		it("refuses changes while an approval over the work is unresolved", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			await admin.query(
				`insert into approval_request
			 (id, organization_id, entity_type, entity_id, requested_by, approver_id, status, reason, updated_at)
			 values ($1, $2, 'time_entry', $3, $4, $5, 'pending', 'Pending correction', now())`,
				[randomUUID(), ids.organization, period.id, ids.requester, ids.manager],
			);
			const before = await snapshot();
			actAs(ids.requesterUser);
			await expect(updateWorkPeriodProject(period.id, ids.projectB)).resolves.toMatchObject({
				success: false,
				error: "A time correction approval is already pending for this work period",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("holds work without a canonical record for review instead of rebuilding it", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			await admin.query("update work_period set canonical_record_id = null where id = $1", [
				period.id,
			]);
			const before = await snapshot();
			await expect(adminEdit(period.id, { clockOutTime: "09:30" })).resolves.toEqual({
				success: false,
				error: needsReview,
				code: "completed_work_review_required",
			});
			expect(await snapshot()).toEqual(before);
		});

		it("keeps the legacy writes for inactive organizations and still replays committed receipts", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			const submissionId = randomUUID();
			await expect(
				adminEdit(period.id, { clockOutTime: "09:30" }, submissionId),
			).resolves.toMatchObject({
				success: true,
			});
			await setAdmission("inactive");
			const committed = await snapshot();
			await expect(
				adminEdit(period.id, { clockOutTime: "09:30" }, submissionId),
			).resolves.toMatchObject({
				success: true,
			});
			expect(await snapshot()).toEqual(committed);

			await expect(adminEdit(period.id, { clockOutTime: "09:45" })).resolves.toMatchObject({
				success: true,
			});
			// Legacy writes: no receipt and no revision advance.
			expect(await receipts()).toHaveLength(1);
			expect(await graph(period.id)).toMatchObject({
				end_time: new Date("2026-07-22T09:45:00Z"),
				graph_revision: 2,
			});
		});

		it("removes amendment receipts with the organization's time data", async () => {
			const period = await recordWork(dayStart, dayStart.add({ hours: 1 }));
			await expect(adminEdit(period.id, { clockOutTime: "09:30" })).resolves.toMatchObject({
				success: true,
			});
			expect(await receipts()).toHaveLength(1);
			await clearOrganizationTimeData(ids.organization);
			expect(await receipts()).toHaveLength(0);
		});
	},
);
