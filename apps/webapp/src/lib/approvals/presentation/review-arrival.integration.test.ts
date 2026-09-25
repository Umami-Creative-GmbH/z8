/**
 * #289 / T25 runtime evidence for exact-item authenticated approval review.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * A real legacy absence submission creates the compatibility approval. The
 * real outbound preparation builds its review link, and the real arrival
 * resolver and detail API authorize that link against current membership and
 * entitlement. Only the request/session, billing guard, delivery, calendar
 * queue and work-balance boundaries are replaced.
 */

import type { NextRequest } from "next/server";
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
	getOrganizationBaseUrl: async () => "https://t289.example.test",
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
const { GET: getApprovalDetail } = await import("@/app/api/approvals/inbox/[id]/route");
const { db } = await import("@/db");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { prepareApprovalPresentation } = await import("@/lib/approvals/presentation");
const { resolveApprovalReviewArrival } = await import("./review-arrival");
const { parseApprovalReviewTarget } = await import("./review-navigation");

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
	describe.skip(`approval review arrival PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t289-review-org",
	otherOrganization: "t289-other-org",
	requesterUser: "t289-requester-user",
	managerUser: "t289-manager-user",
	secondManagerUser: "t289-second-manager-user",
	otherUser: "t289-other-user",
	requester: "e2890000-0000-4000-8000-000000000001",
	manager: "e2890000-0000-4000-8000-000000000002",
	secondManager: "e2890000-0000-4000-8000-000000000003",
	otherEmployee: "e2890000-0000-4000-8000-000000000004",
	managerLink: "e2891000-0000-4000-8000-000000000001",
	category: "e2892000-0000-4000-8000-000000000001",
} as const;

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("exact-item approval review arrival (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	/** The arrival exactly as the review page performs it for the session. */
	function arrive(organizationId: string, kind: string, id: string) {
		if (!harness.userId) throw new Error("No session");
		return resolveApprovalReviewArrival({
			userId: harness.userId,
			activeOrganizationId: harness.organizationId,
			target: parseApprovalReviewTarget({ organizationId, kind, id }),
		});
	}

	/** The inbox detail API the review panel loads and decides through. */
	async function detail(id: string) {
		const response = await getApprovalDetail({} as NextRequest, {
			params: Promise.resolve({ id }),
		});
		return { status: response.status, body: await response.json() };
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser, ids.otherUser],
		]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T289 review', $1, $3), ($2, 'T289 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', 'legacy', 'legacy', $2, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'absence', 'capture')`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't289-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't289-manager@example.test', $5, $5),
			 ($3, 'Sam Second', 't289-second@example.test', $5, $5),
			 ($4, 'Olive Other', 't289-other@example.test', $5, $5)`,
			[ids.requesterUser, ids.managerUser, ids.secondManagerUser, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't289-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, timestamp, [ids.requesterUser, ids.managerUser, ids.secondManagerUser]],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t289-member-other', $1, $2, 'member', 'approved', $3)`,
			[ids.otherOrganization, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $9, 'manager', $10), ($7, $8, $11, 'manager', $10)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.secondManager,
				ids.secondManagerUser,
				ids.otherEmployee,
				ids.otherUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
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
	}

	async function submit(): Promise<{ absenceId: string; requestId: string }> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: "2026-08-03",
			endDate: "2026-08-04",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: "Private note that stays in authenticated review",
		});
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		return { absenceId: result.data.absenceId, requestId: only(rows).id };
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
			throw new Error("Approval review arrival PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("sends an exact link that the assigned approver's arrival opens with evidenced facts", async () => {
		await seed();
		const { requestId } = await submit();

		const notice = await prepareApprovalPresentation({
			approvalId: requestId,
			recipientEmployeeId: ids.manager,
			organizationId: ids.organization,
		});
		if (notice.status !== "review_required") throw new Error("Expected a review notice");
		const reviewUrl = new URL(notice.reviewUrl);
		expect(reviewUrl.origin).toBe("https://t289.example.test");
		expect(reviewUrl.pathname).toBe(
			`/approvals/review/${ids.organization}/compatibility/${requestId}`,
		);
		expect(reviewUrl.search).toBe("");

		// The receiving route's own segments, not invented query parameters.
		const [, , , organizationId, kind, id] = reviewUrl.pathname.split("/");
		actAs(ids.managerUser);
		const arrival = await arrive(organizationId, kind, id);
		expect(arrival).toMatchObject({
			status: "ready",
			item: { id: requestId, type: "absence_entry", status: "pending" },
		});

		const loaded = await detail(requestId);
		expect(loaded.status).toBe(200);
		expect(loaded.body.actions).toMatchObject({ canApprove: true, canReject: true });
		const sections = JSON.stringify(loaded.body.sections);
		expect(sections).toContain("Submitted request");
		expect(sections).toContain("Evidence history");
	});

	it("rechecks membership and entitlement instead of trusting link possession", async () => {
		await seed();
		const { requestId } = await submit();

		// Same organization, no approval relationship.
		actAs(ids.requesterUser);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toEqual({
			status: "unavailable",
		});
		// A foreign organization's user holding the link.
		actAs(ids.otherUser, ids.otherOrganization);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toEqual({
			status: "unavailable",
		});
		// A forged organization segment never reaches another tenant's item.
		await expect(arrive(ids.otherOrganization, "compatibility", requestId)).resolves.toEqual({
			status: "unavailable",
		});
		// The kind is part of the exact target: a request is not a canonical assignment.
		actAs(ids.managerUser);
		await expect(arrive(ids.organization, "canonical", requestId)).resolves.toEqual({
			status: "unavailable",
		});
		await expect(arrive(ids.organization, "compatibility", "not-a-uuid")).resolves.toEqual({
			status: "unavailable",
		});
	});

	it("asks a member of several organizations to switch before loading anything", async () => {
		await seed();
		const { requestId } = await submit();
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t289-member-manager-other', $1, $2, 'member', 'approved', now())`,
			[ids.otherOrganization, ids.managerUser],
		);

		actAs(ids.managerUser, ids.otherOrganization);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toEqual({
			status: "switch_organization",
			organizationId: ids.organization,
			organizationName: "T289 review",
		});

		actAs(ids.managerUser, ids.organization);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toMatchObject({
			status: "ready",
		});
	});

	it("gives a former assignee no access once assignment and relationship move on", async () => {
		await seed();
		const { requestId } = await submit();
		await admin.query("update approval_request set approver_id = $2 where id = $1", [
			requestId,
			ids.secondManager,
		]);
		await admin.query("update employee_managers set manager_id = $2 where id = $1", [
			ids.managerLink,
			ids.secondManager,
		]);

		actAs(ids.managerUser);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toEqual({
			status: "unavailable",
		});
		expect((await detail(requestId)).status).toBe(403);

		actAs(ids.secondManagerUser);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toMatchObject({
			status: "ready",
			item: { id: requestId },
		});
	});

	it("keeps a decided request reviewable as history and explains a purged lifecycle safely", async () => {
		await seed();
		const { absenceId, requestId } = await submit();

		actAs(ids.managerUser);
		await expect(
			approveAbsenceEffect(absenceId, { approvalRequestId: requestId }),
		).resolves.toEqual({ success: true, data: undefined });

		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toMatchObject({
			status: "ready",
			item: { id: requestId, status: "approved" },
		});
		const decided = await detail(requestId);
		expect(decided.status).toBe(200);
		expect(decided.body.actions).toMatchObject({ canApprove: false, canReject: false });
		expect(JSON.stringify(decided.body.sections)).toContain("Request approved");

		await deleteApproval(db, ids.organization, requestId);
		await expect(arrive(ids.organization, "compatibility", requestId)).resolves.toEqual({
			status: "unavailable",
		});
		expect((await detail(requestId)).status).toBe(404);
	});
});
