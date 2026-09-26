/**
 * Regression: a legacy absence submission that routes to a multi-stage policy
 * chain must be observed in `shadow` and `ready` rollout modes.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Legacy chain rows take `created_at` from `defaultNow()`, so PostgreSQL stores
 * microseconds. The shadow mirror only accepts millisecond-representable
 * instants, and the capture used to hand those raw values to it. The real
 * submission and decision actions run against the database here; only the
 * request/session, billing guard, e-mail/notification delivery, calendar queue
 * and work-balance marking boundaries are replaced.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

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

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://chain-observation.example.test",
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async () => ({ success: true }),
}));

vi.mock("@/lib/email/render", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/email/render")>();
	return {
		...original,
		renderAbsenceRequestSubmitted: async () => "<p>submitted</p>",
		renderAbsenceRequestPendingApproval: async () => "<p>pending</p>",
		renderAbsenceRequestApproved: async () => "<p>approved</p>",
		renderAbsenceRequestRejected: async () => "<p>rejected</p>",
	};
});

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	const ignore = async () => undefined;
	return {
		...original,
		onAbsenceRequestSubmitted: ignore,
		onAbsenceRequestPendingApproval: ignore,
		onAbsenceRequestApproved: ignore,
		onAbsenceRequestRejected: ignore,
		onApprovedAbsenceCancelledByEmployee: ignore,
	};
});

vi.mock("@/lib/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/queue")>()),
	addCalendarSyncJob: async () => undefined,
}));

vi.mock("@/lib/work-balance/service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { approveAbsenceEffect } = await import("@/lib/approvals/server/absence-approvals");

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
	describe.skip(`legacy absence chain observation PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "lacs-legacy-chain-org",
	requesterUser: "lacs-requester-user",
	managerUser: "lacs-manager-user",
	secondManagerUser: "lacs-second-manager-user",
	requester: "e3190000-0000-4000-8000-000000000001",
	manager: "e3190000-0000-4000-8000-000000000002",
	secondManager: "e3190000-0000-4000-8000-000000000003",
	managerLink: "e3191000-0000-4000-8000-000000000001",
	category: "e3192000-0000-4000-8000-000000000001",
	policy: "e3193000-0000-4000-8000-000000000001",
	firstStage: "e3193000-0000-4000-8000-000000000002",
	secondStage: "e3193000-0000-4000-8000-000000000003",
} as const;
type ObservingRolloutMode = "shadow" | "ready";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("legacy absence chain observation (PostgreSQL)", () => {
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
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'Legacy chain observation', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, 'legacy', $3, $3)`,
			[ids.organization, mode, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 'lacs-requester@example.test', $4, $4),
			 ($2, 'Morgan Manager', 'lacs-manager@example.test', $4, $4),
			 ($3, 'Sam Second', 'lacs-second@example.test', $4, $4)`,
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 'lacs-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser, ids.secondManagerUser]],
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
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation,
			  is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, true, true, $3)`,
			[ids.category, ids.organization, timestamp],
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

	async function pendingRequestId(absenceId: string): Promise<string> {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, absenceId],
		);
		return only(rows).id;
	}

	async function observedWorkflow(absenceId: string) {
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
			 where workflow.organization_id = $1 and workflow.source_id = $2`,
			[ids.organization, absenceId],
		);
		return only(rows);
	}

	async function absenceStatus(absenceId: string): Promise<string> {
		const { rows } = await admin.query<{ status: string }>(
			`select status::text as status from absence_entry
			 where organization_id = $1 and id = $2`,
			[ids.organization, absenceId],
		);
		return only(rows).status;
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
			throw new Error("Legacy absence chain observation PostgreSQL is disabled");
		}
		// `defaultNow()` almost always yields microseconds; pin them so the case
		// never depends on the clock landing on a whole millisecond.
		await admin.query(
			`create or replace function lacs_sub_millisecond_created_at()
			 returns trigger language plpgsql as $$ begin
			   new.created_at := date_trunc('milliseconds', new.created_at)
			     + interval '456 microseconds';
			   return new;
			 end $$`,
		);
		for (const table of ["approval_chain_instance", "approval_chain_stage_instance"]) {
			await admin.query(
				`create trigger lacs_sub_millisecond_created_at before insert on ${table}
				 for each row when (new.organization_id = '${ids.organization}')
				 execute function lacs_sub_millisecond_created_at()`,
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
			await admin.query(`drop trigger if exists lacs_sub_millisecond_created_at on ${table}`);
		}
		await admin.query("drop function if exists lacs_sub_millisecond_created_at()");
		await admin.end();
	});

	it.each<ObservingRolloutMode>(["shadow", "ready"])(
		"observes a %s-mode chain submission and its stage decisions with millisecond chain instants",
		async (mode) => {
			await seed(mode);

			actAs(ids.requesterUser);
			const submitted = await requestAbsenceEffect({
				categoryId: ids.category,
				startDate: "2026-08-03",
				endDate: "2026-08-04",
				startPeriod: "full_day",
				endPeriod: "full_day",
				durationKind: "full_day",
				notes: null,
			});
			if (!submitted.success) {
				throw new Error(`Submission failed: ${submitted.error}`);
			}
			const absenceId = submitted.data.absenceId;

			// The observed submission keeps the chain's own instant, only without the
			// sub-millisecond digits the canonical model cannot represent.
			expect(await observedWorkflow(absenceId)).toEqual({
				status: "pending",
				current_stage_order: 1,
				submitted_matches_chain: true,
				chain_sub_millisecond: true,
			});

			const firstRequestId = await pendingRequestId(absenceId);
			actAs(ids.managerUser);
			expect(
				await approveAbsenceEffect(absenceId, {
					approvalRequestId: firstRequestId,
				}),
			).toEqual({ success: true, data: undefined });
			expect(await observedWorkflow(absenceId)).toMatchObject({
				status: "pending",
				current_stage_order: 2,
				submitted_matches_chain: true,
			});

			const secondRequestId = await pendingRequestId(absenceId);
			actAs(ids.secondManagerUser);
			expect(
				await approveAbsenceEffect(absenceId, {
					approvalRequestId: secondRequestId,
				}),
			).toEqual({ success: true, data: undefined });
			expect(await observedWorkflow(absenceId)).toMatchObject({
				status: "approved",
				current_stage_order: null,
				submitted_matches_chain: true,
			});
			expect(await absenceStatus(absenceId)).toBe("approved");
		},
	);
});
