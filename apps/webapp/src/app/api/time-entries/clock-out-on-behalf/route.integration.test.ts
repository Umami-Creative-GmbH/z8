/**
 * #276 / T12 runtime evidence: manager on-behalf clock-out through the
 * completed-work operation.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real `POST /api/time-entries/clock-out-on-behalf` handler runs against that
 * database through the real target authorization, coordinator, completed-work
 * operation, append collaborator and post-commit follow-ups. The target's running
 * work is started by the real web `clockIn` action. Only the session, external
 * billing provisioning, the authoritative server clock, the compliance follow-up
 * (to inject a post-commit failure) and the Next cache are replaced. Adoption is
 * enabled per test organization by inserting its append control row directly:
 * production has no activation setter.
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
	userId: null as string | null,
	organizationId: null as string | null,
	now: null as Instant | null,
	failCompliance: false,
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
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t276-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billing/guard")>()),
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: Object.freeze({
			nowInstant: () => harness.now ?? original.systemClock.nowInstant(),
		}),
	};
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/compliance", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/app/[locale]/(app)/time-tracking/actions/compliance")>();
	return {
		...original,
		checkComplianceAfterClockOut: async (
			...args: Parameters<typeof original.checkComplianceAfterClockOut>
		) => {
			if (harness.failCompliance) throw new Error("t276 injected post-commit failure");
			return original.checkComplianceAfterClockOut(...args);
		},
	};
});

const route = await import("./route");
const { clockIn } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
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
	describe.skip(`on-behalf clock-out PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t276-on-behalf-org",
	otherOrganization: "t276-on-behalf-other-org",
	managerUser: "t276-manager-user",
	targetUser: "t276-target-user",
	outsiderUser: "t276-outsider-user",
	peerUser: "t276-peer-user",
	ownerUser: "t276-owner-user",
	foreignUser: "t276-foreign-user",
	manager: "f2760000-0000-4000-8000-000000000001",
	target: "f2760000-0000-4000-8000-000000000002",
	outsider: "f2760000-0000-4000-8000-000000000003",
	peer: "f2760000-0000-4000-8000-000000000004",
	owner: "f2760000-0000-4000-8000-000000000005",
	foreign: "f2760000-0000-4000-8000-000000000006",
	managerLink: "f2760000-0000-4000-8000-000000000010",
	projectA: "f2761000-0000-4000-8000-000000000001",
	projectB: "f2761000-0000-4000-8000-000000000002",
	assignmentA: "f2761000-0000-4000-8000-000000000003",
	categoryA: "f2761000-0000-4000-8000-000000000004",
	categoryB: "f2761000-0000-4000-8000-000000000005",
} as const;
const clockInAt = parseInstant("2026-09-20T08:00:00Z");
// 8h0m40s after the clock-in: the operation rounds half up to 481 minutes.
const clockOutAt = parseInstant("2026-09-20T16:00:40Z");
const baseUrl = "https://app.t276.test";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

async function post(body: unknown) {
	const response = await route.POST(
		new Request(`${baseUrl}/api/time-entries/clock-out-on-behalf`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}) as never,
	);
	return { status: response.status, body: (await response.json()) as Record<string, any> };
}

describeIntegration("manager on-behalf clock-out on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string | null, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function setAdmission(
		mode: "active" | "inactive",
		organizationId: string = ids.organization,
	) {
		await admin.query(
			`insert into time_entry_append_control (organization_id, mode) values ($1, $2)
			 on conflict (organization_id) do update set mode = excluded.mode, updated_at = now()`,
			[organizationId, mode],
		);
	}

	/** Every row an on-behalf closure can write, to prove "no writes" by equality. */
	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = any($1)) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = any($1)) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = any($1)) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = any($1)) as details,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = any($1)) as allocations,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = any($1)) as positions,
			   (select json_agg(row_to_json(t) order by t.employee_id) from employee_work_balance t where organization_id = any($1)) as balances,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = any($1)) as receipts`,
			[[ids.organization, ids.otherOrganization]],
		);
		return only(rows);
	}

	async function receipts() {
		const { rows } = await admin.query(
			"select * from completed_work_operation where organization_id = any($1) order by created_at",
			[[ids.organization, ids.otherOrganization]],
		);
		return rows;
	}

	async function graph(periodId: string) {
		const { rows } = await admin.query(
			`select wp.is_active, wp.end_time, wp.duration_minutes, wp.clock_out_id, wp.project_id,
			        wp.work_category_id, wp.approval_status, wp.graph_revision, wp.canonical_record_id,
			        tr.created_by as record_created_by, tr.duration_minutes as record_minutes,
			        tr.approval_state as record_state, trw.work_category_id as record_category,
			        (select json_agg(tra.project_id) from time_record_allocation tra where tra.record_id = tr.id) as record_projects,
			        cin.created_by as clock_in_created_by, cout.created_by as clock_out_created_by,
			        cout.device_info as clock_out_device, cout.timezone as clock_out_timezone,
			        cout.timezone_source as clock_out_timezone_source,
			        cout.utc_offset_minutes as clock_out_offset, cout.previous_entry_id as clock_out_previous
			 from work_period wp
			 join time_entry cin on cin.id = wp.clock_in_id
			 left join time_entry cout on cout.id = wp.clock_out_id
			 left join time_record tr on tr.id = wp.canonical_record_id
			 left join time_record_work trw on trw.record_id = tr.id
			 where wp.id = $1`,
			[periodId],
		);
		return only(rows);
	}

	/** Starts the employee's running work through the real web clock-in action. */
	async function clockInAs(userId: string, organizationId: string = ids.organization) {
		actAs(userId, organizationId);
		await expect(
			clockIn("office", { instant: clockInAt, browserTimezone: "America/New_York" }),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string; clock_in_id: string }>(
			`select wp.id, wp.clock_in_id from work_period wp join employee e on e.id = wp.employee_id
			 where e.user_id = $1 and wp.organization_id = $2 and wp.end_time is null`,
			[userId, organizationId],
		);
		return only(rows);
	}

	function closeAs(userId: string, body: Record<string, unknown>) {
		actAs(userId);
		return post(body);
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1)', [
			[
				ids.managerUser,
				ids.targetUser,
				ids.outsiderUser,
				ids.peerUser,
				ids.ownerUser,
				ids.foreignUser,
			],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T276 on-behalf', $1, 'Europe/Berlin', $3), ($2, 'T276 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 select organization_id, 'policy_clock_out', 'legacy', 'legacy', $2, $2
			 from unnest($1::text[]) as organization_id`,
			[[ids.organization, ids.otherOrganization], timestamp],
		);
		const users = [
			[ids.managerUser, "Manager"],
			[ids.targetUser, "Target"],
			[ids.outsiderUser, "Outsider"],
			[ids.peerUser, "Peer"],
			[ids.ownerUser, "Owner"],
			[ids.foreignUser, "Foreign"],
		] as const;
		for (const [id, name] of users) {
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, $4, $4)`,
				[id, name, `${id}@example.test`, timestamp],
			);
		}
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't276-member-' || user_id, $1, user_id,
			        case when user_id = $4 then 'owner' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.managerUser, ids.targetUser, ids.outsiderUser, ids.peerUser, ids.ownerUser],
				ids.ownerUser,
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t276-member-foreign', $1, $2, 'member', 'approved', $3),
			 ('t276-member-manager-other', $1, $4, 'member', 'approved', $3)`,
			[ids.otherOrganization, ids.foreignUser, timestamp, ids.managerUser],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $13, 'manager', $14), ($3, $4, $13, 'employee', $14),
			 ($5, $6, $13, 'employee', $14), ($7, $8, $13, 'employee', $14),
			 ($9, $10, $13, 'employee', $14), ($11, $12, $15, 'employee', $14)`,
			[
				ids.manager,
				ids.managerUser,
				ids.target,
				ids.targetUser,
				ids.outsider,
				ids.outsiderUser,
				ids.peer,
				ids.peerUser,
				ids.owner,
				ids.ownerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[ids.managerLink, ids.target, ids.manager, ids.ownerUser, timestamp],
		);
		// The manager's saved zone differs from the target's: only the target's counts.
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at) values
			 ($1, 'Asia/Tokyo', $3), ($2, 'America/New_York', $3)`,
			[ids.managerUser, ids.targetUser, timestamp],
		);
		await admin.query(
			`insert into project (id, organization_id, name, status, is_active, created_by, updated_at) values
			 ($1, $3, 'Project A', 'active', true, $4, $5), ($2, $3, 'Project B', 'active', true, $4, $5)`,
			[ids.projectA, ids.projectB, ids.organization, ids.ownerUser, timestamp],
		);
		// Project A is the target's; project B is assigned to nobody.
		await admin.query(
			`insert into project_assignment (id, project_id, organization_id, assignment_type, employee_id, created_by)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[ids.assignmentA, ids.projectA, ids.organization, ids.target, ids.ownerUser],
		);
		await admin.query(
			`insert into work_category (id, organization_id, name, created_by, updated_at) values
			 ($1, $3, 'Category A', $4, $5), ($2, $3, 'Category B', $4, $5)`,
			[ids.categoryA, ids.categoryB, ids.organization, ids.ownerUser, timestamp],
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
			throw new Error("On-behalf clock-out PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		harness.now = clockOutAt;
		harness.failCompliance = false;
		await seed();
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("closes the target's running work as one graph owned by the target and completed by the manager", async () => {
		const running = await clockInAs(ids.targetUser);
		const operationId = randomUUID();

		const executed = await closeAs(ids.managerUser, { workPeriodId: running.id, operationId });

		expect(executed.status).toBe(201);
		expect(executed.body).toMatchObject({
			outcome: "executed",
			operationId,
			entry: { id: operationId, type: "clock_out", employeeId: ids.target },
			receipt: {
				version: 1,
				operationId,
				owner: { employeeId: ids.target },
				// The target's clock-in keeps its own actor; the manager completes.
				actors: {
					clockIn: { kind: "human", userId: ids.targetUser },
					completing: { kind: "human", userId: ids.managerUser },
				},
				workPeriodId: running.id,
				clockInEntryId: running.clock_in_id,
				clockOutEntryId: operationId,
				segment: {
					startAt: "2026-09-20T08:00:00Z",
					endAt: "2026-09-20T16:00:40Z",
					durationMinutes: 481,
					startUtcOffsetMinutes: -240,
					// The target's saved zone, never the manager's zone or browser.
					endUtcOffsetMinutes: -240,
					endTimezone: "America/New_York",
					endTimezoneSource: "manager_target_user_setting",
				},
				attribution: { projectId: null, workCategoryId: null, workLocationType: "office" },
				revisions: { workPeriod: { source: 0, result: 1 } },
				append: { admission: "append", previousEntryId: running.clock_in_id },
				approvalState: "approved",
				approval: { participation: "none" },
			},
		});
		expect(await graph(running.id)).toMatchObject({
			is_active: false,
			end_time: new Date("2026-09-20T16:00:40Z"),
			duration_minutes: 481,
			clock_out_id: operationId,
			approval_status: "approved",
			graph_revision: 1,
			record_created_by: ids.managerUser,
			record_minutes: 481,
			record_state: "approved",
			clock_in_created_by: ids.targetUser,
			clock_out_created_by: ids.managerUser,
			clock_out_device: "web-on-behalf",
			clock_out_timezone: "America/New_York",
			clock_out_timezone_source: "manager_target_user_setting",
			clock_out_offset: -240,
			clock_out_previous: running.clock_in_id,
		});
		expect(only(await receipts())).toMatchObject({
			id: operationId,
			organization_id: ids.organization,
			employee_id: ids.target,
			kind: "close_active_work",
			writer: "manager_on_behalf",
			writer_version: 1,
			command_version: 1,
			command: {
				version: 1,
				operationId,
				identity: "client",
				workPeriodId: running.id,
				project: { kind: "preserve" },
				workCategory: { kind: "preserve" },
			},
			append_admission: "append",
			actor_kind: "human",
			actor_user_id: ids.managerUser,
			work_period_id: running.id,
		});
		const { rows: positions } = await admin.query(
			"select tip_entry_id, version, last_operation from time_entry_append_position where employee_id = $1",
			[ids.target],
		);
		expect(only(positions)).toEqual({
			tip_entry_id: operationId,
			version: 2,
			last_operation: "live_clock_out",
		});
		const { rows: balances } = await admin.query(
			"select is_dirty, dirty_from_date from employee_work_balance where employee_id = $1",
			[ids.target],
		);
		expect(only(balances)).toMatchObject({ is_dirty: true });
	});

	it("preserves omitted attribution and validates explicit changes against the target", async () => {
		const running = await clockInAs(ids.targetUser);
		await admin.query(
			"update work_period set project_id = $2, work_category_id = $3 where id = $1",
			[running.id, ids.projectA, ids.categoryA],
		);
		const before = await snapshot();

		// Project B is not assigned to the target; category B is outside their set.
		expect(
			await closeAs(ids.managerUser, {
				workPeriodId: running.id,
				operationId: randomUUID(),
				projectId: ids.projectB,
			}),
		).toMatchObject({ status: 422, body: { code: "attribution_not_allowed", field: "projectId" } });
		expect(
			await closeAs(ids.managerUser, {
				workPeriodId: running.id,
				operationId: randomUUID(),
				workCategoryId: ids.categoryB,
			}),
		).toMatchObject({
			status: 422,
			body: { code: "attribution_not_allowed", field: "workCategoryId" },
		});
		expect(await snapshot()).toEqual(before);

		const preserved = await closeAs(ids.managerUser, {
			workPeriodId: running.id,
			operationId: randomUUID(),
		});

		expect(preserved.status).toBe(201);
		expect(preserved.body.receipt.attribution).toEqual({
			projectId: ids.projectA,
			workCategoryId: ids.categoryA,
			workLocationType: "office",
		});
		expect(await graph(running.id)).toMatchObject({
			project_id: ids.projectA,
			work_category_id: ids.categoryA,
			record_category: ids.categoryA,
			record_projects: [ids.projectA],
		});
	});

	it("clears attribution only on an explicit clear", async () => {
		const running = await clockInAs(ids.targetUser);
		await admin.query("update work_period set project_id = $2 where id = $1", [
			running.id,
			ids.projectA,
		]);

		const cleared = await closeAs(ids.managerUser, {
			workPeriodId: running.id,
			operationId: randomUUID(),
			projectId: null,
		});

		expect(cleared.status).toBe(201);
		expect(await graph(running.id)).toMatchObject({ project_id: null, record_projects: null });
		expect(only(await receipts()).command.project).toEqual({ kind: "clear" });
	});

	it("refuses unauthorized, own and cross-organization targets without writes", async () => {
		const target = await clockInAs(ids.targetUser);
		const outsider = await clockInAs(ids.outsiderUser);
		const own = await clockInAs(ids.managerUser);
		await setAdmission("active", ids.otherOrganization);
		const foreign = await clockInAs(ids.foreignUser, ids.otherOrganization);
		const before = await snapshot();
		const attempt = (userId: string, workPeriodId: string) =>
			closeAs(userId, { workPeriodId, operationId: randomUUID() });

		// Read or self-service access alone never authorizes closing another's work.
		expect(await attempt(ids.peerUser, target.id)).toMatchObject({
			status: 403,
			body: { code: "access_denied" },
		});
		// A manager only closes work of their direct reports.
		expect(await attempt(ids.managerUser, outsider.id)).toMatchObject({
			status: 403,
			body: { code: "access_denied" },
		});
		expect(await attempt(ids.managerUser, own.id)).toMatchObject({
			status: 403,
			body: { code: "access_denied" },
		});
		// Another organization's period does not exist in the active organization.
		expect(await attempt(ids.managerUser, foreign.id)).toMatchObject({
			status: 404,
			body: { code: "target_unknown" },
		});
		actAs(null);
		expect(await post({ workPeriodId: target.id, operationId: randomUUID() })).toMatchObject({
			status: 401,
		});
		expect(await snapshot()).toEqual(before);

		// Organization owners may close work for any active employee.
		expect(await attempt(ids.ownerUser, outsider.id)).toMatchObject({
			status: 201,
			body: { receipt: { actors: { completing: { userId: ids.ownerUser } } } },
		});
	});

	it("replays the exact committed closure and treats a changed command as a collision", async () => {
		const running = await clockInAs(ids.targetUser);
		const operationId = randomUUID();
		const first = await closeAs(ids.managerUser, { workPeriodId: running.id, operationId });
		expect(first.status).toBe(201);
		const committed = await snapshot();
		harness.now = clockOutAt.add({ hours: 30 });

		const replayed = await closeAs(ids.managerUser, { workPeriodId: running.id, operationId });

		expect(replayed).toEqual({
			status: 200,
			body: { ...first.body, outcome: "replayed" },
		});
		expect(
			await closeAs(ids.managerUser, {
				workPeriodId: running.id,
				operationId,
				projectId: ids.projectA,
			}),
		).toMatchObject({ status: 409, body: { code: "collision" } });
		// The same identity from another authorized actor is not this command.
		expect(await closeAs(ids.ownerUser, { workPeriodId: running.id, operationId })).toMatchObject({
			status: 409,
			body: { code: "collision" },
		});
		expect(await snapshot()).toEqual(committed);

		// A committed receipt keeps replaying after the organization returns to legacy.
		await setAdmission("inactive");
		expect(await closeAs(ids.managerUser, { workPeriodId: running.id, operationId })).toEqual(
			replayed,
		);
	});

	it("keeps committed work saved when a post-commit follow-up fails and recovers the lost status by replay", async () => {
		const running = await clockInAs(ids.targetUser);
		const operationId = randomUUID();
		harness.failCompliance = true;

		const executed = await closeAs(ids.managerUser, { workPeriodId: running.id, operationId });

		expect(executed).toMatchObject({ status: 201, body: { outcome: "executed", operationId } });
		const committed = await snapshot();
		// The caller never saw that status: resending the same identity returns the
		// original committed outcome and writes nothing.
		harness.failCompliance = false;
		expect(await closeAs(ids.managerUser, { workPeriodId: running.id, operationId })).toEqual({
			status: 200,
			body: { ...executed.body, outcome: "replayed" },
		});
		expect(await snapshot()).toEqual(committed);
	});

	it("serializes competing closures of the same work into one closure", async () => {
		const running = await clockInAs(ids.targetUser);
		const operationIds = [randomUUID(), randomUUID()];

		const results = await Promise.all(
			operationIds.map((operationId) =>
				closeAs(ids.managerUser, { workPeriodId: running.id, operationId }),
			),
		);

		expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
		expect(results.find((result) => result.status === 409)?.body).toMatchObject({
			code: "target_not_active",
		});
		expect(await receipts()).toHaveLength(1);
		const { rows } = await admin.query(
			"select count(*)::int as count from time_entry where employee_id = $1 and type = 'clock_out'",
			[ids.target],
		);
		expect(only(rows).count).toBe(1);
	});

	it("returns one committed outcome for concurrent identical submissions", async () => {
		const running = await clockInAs(ids.targetUser);
		const operationId = randomUUID();

		const results = await Promise.all(
			[0, 1, 2].map(() => closeAs(ids.managerUser, { workPeriodId: running.id, operationId })),
		);

		expect(results.map((result) => result.status).sort()).toEqual([200, 200, 201]);
		for (const result of results) {
			expect(result.body.receipt).toEqual(results[0]?.body.receipt);
		}
		expect(await receipts()).toHaveLength(1);
	});

	it.each([
		["time_record", "insert"],
		["time_record_work", "insert"],
		["time_record_allocation", "insert"],
		["time_entry", "insert"],
		["time_entry_append_position", "update"],
		["work_period", "update"],
		["employee_work_balance", "insert"],
		["completed_work_operation", "insert"],
	])("rolls back the complete graph when the %s %s fails", async (table, event) => {
		const running = await clockInAs(ids.targetUser);
		await admin.query("update work_period set project_id = $2 where id = $1", [
			running.id,
			ids.projectA,
		]);
		const operationId = randomUUID();
		const before = await snapshot();
		await admin.query(
			`create function t276_fail() returns trigger language plpgsql as $$
			 begin raise exception 't276 injected failure'; end $$`,
		);
		await admin.query(
			`create trigger t276_fail before ${event} on ${table} for each row execute function t276_fail()`,
		);

		const failed = await closeAs(ids.managerUser, { workPeriodId: running.id, operationId });
		await admin.query("drop function t276_fail() cascade");

		expect(failed).toEqual({
			status: 500,
			body: { error: "Internal server error", outcome: "unknown", operationId },
		});
		expect(await snapshot()).toEqual(before);
		// The identity was not consumed: resending it commits the work once.
		expect(await closeAs(ids.managerUser, { workPeriodId: running.id, operationId })).toMatchObject(
			{ status: 201, body: { outcome: "executed" } },
		);
	});

	it("closes identity-less requests from old clients through the operation with a server identity", async () => {
		const running = await clockInAs(ids.targetUser);

		const executed = await closeAs(ids.managerUser, { workPeriodId: running.id });

		expect(executed).toMatchObject({ status: 201, body: { outcome: "executed" } });
		expect(only(await receipts())).toMatchObject({
			id: executed.body.operationId,
			command: { identity: "server", workPeriodId: running.id },
		});
		// Without its identity a retry cannot prove it is the same request.
		expect(await closeAs(ids.managerUser, { workPeriodId: running.id })).toMatchObject({
			status: 409,
			body: { code: "target_not_active" },
		});
	});

	it("keeps the legacy closure before adoption, preserving attribution and replaying its identity", async () => {
		await setAdmission("inactive");
		const running = await clockInAs(ids.targetUser);
		await admin.query("update work_period set project_id = $2 where id = $1", [
			running.id,
			ids.projectA,
		]);
		const operationId = randomUUID();

		const executed = await closeAs(ids.managerUser, { workPeriodId: running.id, operationId });

		expect(executed).toMatchObject({
			status: 201,
			body: { outcome: "executed", operationId, entry: { id: operationId }, receipt: null },
		});
		expect(await graph(running.id)).toMatchObject({
			is_active: false,
			duration_minutes: 481,
			clock_out_id: operationId,
			// Omission no longer clears the target's project.
			project_id: ids.projectA,
			graph_revision: 0,
			clock_out_created_by: ids.managerUser,
			clock_out_timezone: "America/New_York",
			clock_out_timezone_source: "manager_target_user_setting",
		});
		expect(await receipts()).toEqual([]);
		const committed = await snapshot();

		expect(await closeAs(ids.managerUser, { workPeriodId: running.id, operationId })).toEqual({
			status: 200,
			body: { ...executed.body, outcome: "replayed" },
		});
		expect(
			await closeAs(ids.managerUser, { workPeriodId: running.id, operationId, projectId: null }),
		).toMatchObject({ status: 409, body: { code: "collision" } });
		// After adoption the receipt-less legacy commit still replays and gains no receipt.
		await setAdmission("active");
		expect(await closeAs(ids.managerUser, { workPeriodId: running.id, operationId })).toEqual({
			status: 200,
			body: { ...executed.body, outcome: "replayed" },
		});
		expect(await snapshot()).toEqual(committed);
	});

	it("removes on-behalf receipts with the organization's time data", async () => {
		const running = await clockInAs(ids.targetUser);
		await closeAs(ids.managerUser, { workPeriodId: running.id, operationId: randomUUID() });
		expect(await receipts()).toHaveLength(1);

		await clearOrganizationTimeData(ids.organization);

		expect(await receipts()).toEqual([]);
	});
});
