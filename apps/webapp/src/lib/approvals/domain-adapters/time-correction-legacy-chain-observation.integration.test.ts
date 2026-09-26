/**
 * Regression: a legacy time correction that routes to a multi-stage policy
 * chain must be observed in `shadow` and `ready` rollout modes.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Three defects used to fail every such correction:
 * - the capture only selected an expected chain once it was terminal, so the
 *   capture after a submission or a stage decision found no chain;
 * - legacy chain rows take `created_at` from `defaultNow()`, so PostgreSQL
 *   stores microseconds, and the capture handed those raw values to the shadow
 *   mirror, which only accepts millisecond-representable instants;
 * - the capture after a cancellation expected the retained request, which the
 *   cancellation had just unlinked from its chain stage.
 *
 * The real clocking, correction submission, inbox decision and cancellation
 * actions run against the database here; only the request/session, billing
 * guard, notification delivery, the Next cache and the edit-policy capability
 * are replaced.
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
			max: 8,
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
								name: harness.userId,
								email: `${harness.userId}@example.test`,
							},
							session: { activeOrganizationId: harness.organizationId },
						}
					: null,
		},
	},
}));

vi.mock("@/lib/auth-helpers", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth-helpers")>()),
	isOrgAdminCasl: async () => false,
	canApproveFor: async () => false,
	// React `cache` would pin the first actor for the whole test process.
	getAuthContext: async () => {
		if (!harness.userId || !harness.organizationId) return null;
		const { db } = await import("@/db");
		const { employee } = await import("@/db/schema");
		const { and, eq } = await import("drizzle-orm");
		const [row] = await db
			.select()
			.from(employee)
			.where(
				and(
					eq(employee.userId, harness.userId),
					eq(employee.organizationId, harness.organizationId),
				),
			)
			.limit(1);
		return {
			user: { id: harness.userId, name: harness.userId, email: `${harness.userId}@example.test` },
			session: { activeOrganizationId: harness.organizationId },
			employee: row
				? { id: row.id, organizationId: row.organizationId, role: row.role, teamId: row.teamId }
				: null,
		};
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/policy-helpers", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/policy-helpers")
	>()),
	getEditCapabilityForPeriod: async () => ({ type: "approval_required" }),
}));

const { clockIn, clockOut } = await import("@/app/[locale]/(app)/time-tracking/actions/clocking");
const { requestTimeCorrection } = await import(
	"@/app/[locale]/(app)/time-tracking/actions/corrections"
);
await import("@/lib/approvals/init");
const { approveApprovalInboxItem } = await import("@/lib/approvals/inbox/decision-service");
const { cancelMyTimeCorrectionRequest } = await import("@/app/[locale]/(app)/my-requests/actions");

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
	describe.skip(`legacy time correction chain observation PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "ltcs-legacy-chain-org",
	requesterUser: "ltcs-requester-user",
	managerUser: "ltcs-manager-user",
	secondManagerUser: "ltcs-second-manager-user",
	requester: "e3290000-0000-4000-8000-000000000001",
	manager: "e3290000-0000-4000-8000-000000000002",
	secondManager: "e3290000-0000-4000-8000-000000000003",
	managerLink: "e3291000-0000-4000-8000-000000000001",
	policy: "e3293000-0000-4000-8000-000000000001",
	firstStage: "e3293000-0000-4000-8000-000000000002",
	secondStage: "e3293000-0000-4000-8000-000000000003",
} as const;
type ObservingRolloutMode = "shadow" | "ready";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

function at(value: string): Instant {
	return parseInstant(value);
}

describeIntegration("legacy time correction chain observation (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser],
		]);
	}

	async function seed(mode: ObservingRolloutMode) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		const users = [ids.requesterUser, ids.managerUser, ids.secondManagerUser];
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'Legacy time correction chain observation', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'policy_clock_out', 'legacy', 'legacy', $3, $3),
			        ($1, 'time_correction', $2, 'legacy', $3, $3)`,
			[ids.organization, mode, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'ltcs-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, users],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $7, 'employee', $8), ($3, $4, $7, 'manager', $8),
			 ($5, $6, $7, 'manager', $8)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.secondManager,
				ids.secondManagerUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'UTC', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into approval_policy
			 (id, organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, 'Two stages', true, 1, $3, $4)`,
			[ids.policy, ids.organization, ids.managerUser, timestamp],
		);
		await admin.query(
			`insert into approval_policy_stage
			 (id, organization_id, policy_id, step_order, label, approver_type,
			  approver_employee_id, fallback_behavior, updated_at) values
			 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
			 ($2, $3, $4, 2, 'Second', 'specific_employee', $5, 'fail', $6)`,
			[ids.firstStage, ids.secondStage, ids.organization, ids.policy, ids.secondManager, timestamp],
		);
	}

	/** Real clock-in and clock-out for a legacy (not adopted) organization. */
	async function recordWork(start: Instant, end: Instant) {
		actAs(ids.requesterUser);
		await expect(
			clockIn("office", { instant: start, browserTimezone: "UTC" }),
		).resolves.toMatchObject({ success: true });
		await expect(
			clockOut(undefined, undefined, {
				submissionId: randomUUID(),
				instant: end,
				browserTimezone: "UTC",
			}),
		).resolves.toMatchObject({ success: true });
		const { rows } = await admin.query<{ id: string }>(
			`select id from work_period
			 where organization_id = $1 and employee_id = $2 and start_time = $3
			   and deleted_at is null`,
			[ids.organization, ids.requester, new Date(start.epochMilliseconds)],
		);
		return only(rows).id;
	}

	async function pendingRequest(workPeriodId: string) {
		const { rows } = await admin.query<{ id: string; approver_id: string }>(
			`select id, approver_id from approval_request
			 where organization_id = $1 and entity_type = 'time_entry' and entity_id = $2
			   and status = 'pending'`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	async function approveAs(userId: string, employeeId: string, workPeriodId: string) {
		const request = await pendingRequest(workPeriodId);
		expect(request.approver_id).toBe(employeeId);
		actAs(userId);
		return approveApprovalInboxItem({
			approvalId: request.id,
			actorEmployeeId: employeeId,
			organizationId: ids.organization,
		});
	}

	async function observedWorkflow(workPeriodId: string) {
		const { rows } = await admin.query<{
			status: string;
			current_stage_order: number | null;
			submitted_matches_chain: boolean;
			chain_sub_millisecond: boolean;
		}>(
			`select workflow.status::text as status,
			   workflow.current_stage_order,
			   workflow.submitted_at =
			     date_trunc('milliseconds', chain.created_at) at time zone 'UTC'
			     as submitted_matches_chain,
			   extract(microseconds from chain.created_at)::bigint % 1000 <> 0
			     as chain_sub_millisecond
			 from approval_workflow workflow
			 join approval_chain_instance chain
			   on chain.organization_id = workflow.organization_id
			  and chain.entity_id = workflow.source_id
			 where workflow.organization_id = $1
			   and workflow.workflow_type = 'time_correction'
			   and workflow.source_id = $2`,
			[ids.organization, workPeriodId],
		);
		return only(rows);
	}

	async function periodStart(workPeriodId: string): Promise<Date> {
		const { rows } = await admin.query<{ start_time: Date }>(
			`select start_time from work_period where organization_id = $1 and id = $2`,
			[ids.organization, workPeriodId],
		);
		return only(rows).start_time;
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
			throw new Error("Legacy time correction chain observation PostgreSQL is disabled");
		}
		// `defaultNow()` almost always yields microseconds; pin them so the case
		// never depends on the clock landing on a whole millisecond.
		await admin.query(
			`create or replace function ltcs_sub_millisecond_created_at()
			 returns trigger language plpgsql as $$ begin
			   new.created_at := date_trunc('milliseconds', new.created_at)
			     + interval '456 microseconds';
			   return new;
			 end $$`,
		);
		for (const table of ["approval_chain_instance", "approval_chain_stage_instance"]) {
			await admin.query(
				`create trigger ltcs_sub_millisecond_created_at before insert on ${table}
				 for each row when (new.organization_id = '${ids.organization}')
				 execute function ltcs_sub_millisecond_created_at()`,
			);
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
	});

	afterAll(async () => {
		await cleanup();
		for (const table of ["approval_chain_instance", "approval_chain_stage_instance"]) {
			await admin.query(`drop trigger if exists ltcs_sub_millisecond_created_at on ${table}`);
		}
		await admin.query("drop function if exists ltcs_sub_millisecond_created_at()");
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	/** Records work and submits a chain-routed correction moving clock-in to 08:30. */
	async function submitChainCorrection(mode: ObservingRolloutMode) {
		await seed(mode);
		const workPeriodId = await recordWork(at("2026-07-22T08:00:00Z"), at("2026-07-22T10:00:00Z"));

		actAs(ids.requesterUser);
		const submitted = await requestTimeCorrection({
			workPeriodId,
			submissionId: randomUUID(),
			newClockInDate: "2026-07-22",
			newClockInTime: "08:30",
			newClockOutDate: "2026-07-22",
			newClockOutTime: "10:00",
			reason: "Forgot to clock in on time",
			workLocationType: "office",
			workCategoryId: null,
		});
		if (!submitted.success) {
			throw new Error(`Submission failed: ${submitted.error}`);
		}
		expect(submitted.data.status).toBe("pending");

		// The observed submission keeps the chain's own instant, only without the
		// sub-millisecond digits the canonical model cannot represent.
		expect(await observedWorkflow(workPeriodId)).toEqual({
			status: "pending",
			current_stage_order: 1,
			submitted_matches_chain: true,
			chain_sub_millisecond: true,
		});
		return workPeriodId;
	}

	it.each<ObservingRolloutMode>(["shadow", "ready"])(
		"observes a %s-mode chain correction and its stage decisions with millisecond chain instants",
		async (mode) => {
			const workPeriodId = await submitChainCorrection(mode);

			await expect(approveAs(ids.managerUser, ids.manager, workPeriodId)).resolves.toBeDefined();
			expect(await observedWorkflow(workPeriodId)).toMatchObject({
				status: "pending",
				current_stage_order: 2,
				submitted_matches_chain: true,
			});

			await expect(
				approveAs(ids.secondManagerUser, ids.secondManager, workPeriodId),
			).resolves.toBeDefined();
			expect(await observedWorkflow(workPeriodId)).toMatchObject({
				status: "approved",
				current_stage_order: null,
				submitted_matches_chain: true,
			});
			expect(await periodStart(workPeriodId)).toEqual(new Date("2026-07-22T08:30:00Z"));
		},
	);

	it.each<ObservingRolloutMode>(["shadow", "ready"])(
		"observes the cancellation of a pending %s-mode chain correction",
		async (mode) => {
			const workPeriodId = await submitChainCorrection(mode);

			await expect(approveAs(ids.managerUser, ids.manager, workPeriodId)).resolves.toBeDefined();
			actAs(ids.requesterUser);
			await expect(cancelMyTimeCorrectionRequest(workPeriodId)).resolves.toEqual({
				success: true,
			});

			expect(await observedWorkflow(workPeriodId)).toMatchObject({
				status: "cancelled",
				submitted_matches_chain: true,
			});
			expect(await periodStart(workPeriodId)).toEqual(new Date("2026-07-22T08:00:00Z"));
		},
	);
});
