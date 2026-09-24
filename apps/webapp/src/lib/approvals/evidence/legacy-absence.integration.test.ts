/**
 * #288 / T24 runtime evidence for legacy-authoritative absence approval evidence.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real absence server actions (`requestAbsenceEffect`, `approveAbsenceEffect`,
 * `rejectAbsenceEffect`, `cancelAbsenceRequest`) run against that database with
 * the real legacy owners, write gate, legacy capture, shadow mirror and evidence
 * store. Only the request/session, billing guard, e-mail/notification delivery,
 * calendar queue and work-balance marking boundaries are replaced.
 */

import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	notifications: [] as string[],
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import(
		"@/db/postgres-utc"
	);
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
	isBillingMutationAllowed: (access: { canAccess: boolean }) =>
		access.canAccess,
}));

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t288.example.test",
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
	const original =
		await importOriginal<typeof import("@/lib/notifications/triggers")>();
	const record = (event: string) => async () => {
		harness.notifications.push(event);
	};
	return {
		...original,
		onAbsenceRequestSubmitted: record("submitted"),
		onAbsenceRequestPendingApproval: record("pending"),
		onAbsenceRequestApproved: record("approved"),
		onAbsenceRequestRejected: record("rejected"),
		onApprovedAbsenceCancelledByEmployee: record("cancelled"),
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
const { cancelAbsenceRequest } = await import(
	"@/app/[locale]/(app)/absences/mutations"
);
const { approveAbsenceEffect, rejectAbsenceEffect } = await import(
	"@/lib/approvals/server/absence-approvals"
);
const { db } = await import("@/db");
const { deleteApproval, listApprovals } = await import(
	"@/lib/approvals/maintenance"
);
const { buildAbsenceReviewSections, prepareAbsenceReviewEvidence } =
	await import("@/lib/approvals/presentation/absence-review");
const {
	findLegacyDecisionEvidenceByRequest,
	loadCurrentAbsenceSubmittedRevision,
	loadLegacyAbsenceSubmittedRevision,
} = await import("./store");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired =
	process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration =
	resolveApprovalWorkflowRepositoryTestConfiguration({
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
	describe.skip(`legacy absence evidence PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t288-legacy-absence-org",
	otherOrganization: "t288-other-org",
	requesterUser: "t288-requester-user",
	managerUser: "t288-manager-user",
	secondManagerUser: "t288-second-manager-user",
	otherUser: "t288-other-user",
	requester: "e2880000-0000-4000-8000-000000000001",
	manager: "e2880000-0000-4000-8000-000000000002",
	secondManager: "e2880000-0000-4000-8000-000000000003",
	otherEmployee: "e2880000-0000-4000-8000-000000000004",
	managerLink: "e2881000-0000-4000-8000-000000000001",
	category: "e2882000-0000-4000-8000-000000000001",
	policy: "e2883000-0000-4000-8000-000000000001",
	firstStage: "e2883000-0000-4000-8000-000000000002",
	secondStage: "e2883000-0000-4000-8000-000000000003",
} as const;
type RolloutMode = "legacy" | "shadow";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("legacy absence approval evidence (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	function actAs(userId: string, organizationId = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[
				ids.requesterUser,
				ids.managerUser,
				ids.secondManagerUser,
				ids.otherUser,
			],
		]);
	}

	async function seed(
		options: {
			mode?: RolloutMode;
			capture?: boolean;
			requesterSelfApproves?: boolean;
			twoStageChain?: boolean;
		} = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T288 legacy absences', $1, $3), ($2, 'T288 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, 'legacy', $3, $3)`,
			[ids.organization, options.mode ?? "legacy", timestamp],
		);
		if (options.capture !== false) {
			await enableCapture();
		}
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't288-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't288-manager@example.test', $5, $5),
			 ($3, 'Sam Second', 't288-second@example.test', $5, $5),
			 ($4, 'Olive Other', 't288-other@example.test', $5, $5)`,
			[
				ids.requesterUser,
				ids.managerUser,
				ids.secondManagerUser,
				ids.otherUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't288-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.managerUser, ids.secondManagerUser],
			],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ('t288-member-other', $1, $2, 'member', 'approved', $3)`,
			[ids.otherOrganization, ids.otherUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, $12, $10), ($3, $4, $9, 'manager', $10),
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
				options.requesterSelfApproves ? "manager" : "employee",
			],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[
				ids.managerLink,
				ids.requester,
				options.requesterSelfApproves ? ids.requester : ids.manager,
				ids.managerUser,
				timestamp,
			],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation,
			  is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, true, true, $3)`,
			[ids.category, ids.organization, timestamp],
		);
		if (options.twoStageChain) {
			await admin.query(
				`insert into approval_policy
				 (id, organization_id, name, is_active, priority, created_by, updated_at)
				 values ($1, $2, 'T288 two stages', true, 1, $3, $4)`,
				[ids.policy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
				 ($2, $3, $4, 2, 'Second', 'specific_employee', $5, 'fail', $6)`,
				[
					ids.firstStage,
					ids.secondStage,
					ids.organization,
					ids.policy,
					ids.secondManager,
					timestamp,
				],
			);
		}
	}

	async function enableCapture() {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, 'absence', 'capture')
			 on conflict (organization_id, workflow_type) do update set mode = excluded.mode`,
			[ids.organization],
		);
	}

	async function submit(
		input: Partial<{
			startDate: string;
			endDate: string;
			durationKind: "full_day" | "partial_day";
			startTime: string;
			endTime: string;
		}> = {},
	): Promise<string> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: input.startDate ?? "2026-08-03",
			endDate: input.endDate ?? "2026-08-04",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: input.durationKind ?? "full_day",
			startTime: input.startTime,
			endTime: input.endTime,
			notes: "Private note that is never copied into evidence",
		});
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		return result.data.absenceId;
	}

	async function pendingRequestId(absenceId: string): Promise<string> {
		const { rows } = await admin.query<{ id: string }>(
			`select id from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, absenceId],
		);
		return only(rows).id;
	}

	async function revisions(absenceId: string) {
		const { rows } = await admin.query(
			`select * from approval_submitted_revision
			 where organization_id = $1 and source_id = $2`,
			[ids.organization, absenceId],
		);
		return rows;
	}

	async function decisions(absenceId: string) {
		const { rows } = await admin.query(
			`select decision.* from approval_decision_evidence decision
			 join approval_submitted_revision revision
			   on revision.id = decision.submitted_revision_id
			 where revision.organization_id = $1 and revision.source_id = $2
			 order by decision.decided_at, decision.id`,
			[ids.organization, absenceId],
		);
		return rows;
	}

	async function sourceState(absenceId: string) {
		const { rows } = await admin.query<{
			absence_status: string;
			requests: string[];
			record_state: string | null;
			decisions: number;
		}>(
			`select absence.status as absence_status,
			   coalesce((select array_agg(request.status::text order by request.created_at, request.id)
			     from approval_request request
			     where request.organization_id = absence.organization_id
			       and request.entity_id = absence.id), array[]::text[]) as requests,
			   (select record.approval_state::text from time_record record
			     where record.id = absence.canonical_record_id) as record_state,
			   (select count(*)::int from approval_decision_evidence decision
			     join approval_submitted_revision revision
			       on revision.id = decision.submitted_revision_id
			     where revision.source_id = absence.id) as decisions
			 from absence_entry absence
			 where absence.organization_id = $1 and absence.id = $2`,
			[ids.organization, absenceId],
		);
		return only(rows);
	}

	async function liveEntity(absenceId: string) {
		const entity = await db.query.absenceEntry.findFirst({
			where: (absence, { and, eq }) =>
				and(
					eq(absence.id, absenceId),
					eq(absence.organizationId, ids.organization),
				),
			with: { category: true },
		});
		if (!entity) throw new Error("Absence not found");
		return entity;
	}

	async function withInsertFailure<T>(
		table: "approval_submitted_revision" | "approval_decision_evidence",
		run: () => Promise<T>,
	): Promise<T> {
		await admin.query(
			`create or replace function t288_fail_evidence() returns trigger
			 language plpgsql as $$ begin
			   raise exception 't288 injected evidence failure';
			 end $$`,
		);
		await admin.query(
			`create trigger t288_fail_evidence before insert on ${table}
			 for each row execute function t288_fail_evidence()`,
		);
		try {
			return await run();
		} finally {
			await admin.query(`drop trigger t288_fail_evidence on ${table}`);
		}
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
			throw new Error("Legacy absence evidence PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.notifications = [];
		harness.userId = null;
		harness.organizationId = null;
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("captures a legacy submission and approval without inventing canonical authority, and replays the committed result", async () => {
		await seed();
		const absenceId = await submit();
		const requestId = await pendingRequestId(absenceId);

		const revision = only(await revisions(absenceId));
		const { rows: sources } = await admin.query<{ created_at: Date }>(
			"select created_at from absence_entry where id = $1",
			[absenceId],
		);
		expect(revision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: requestId,
			legacy_chain_instance_id: null,
			observed_workflow_id: null,
			request_cycle_key: `absence:${absenceId}:submission`,
			subject_employee_id: ids.requester,
			requester_employee_id: ids.requester,
			submitter_actor_kind: "employee",
			submitter_employee_id: ids.requester,
			submitter_user_id: ids.requesterUser,
			provenance: "captured_at_submission",
		});
		expect(revision.submitted_at.toISOString()).toBe(
			only(sources).created_at.toISOString(),
		);
		expect(revision.facts.coverage).toEqual({
			kind: "full_day",
			startDate: "2026-08-03",
			endDate: "2026-08-04",
		});
		expect(revision.labels).toEqual({
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
			categoryName: "Vacation",
		});
		expect(JSON.stringify(revision)).not.toContain("Private note");
		const { rows: workflows } = await admin.query(
			"select id from approval_workflow where organization_id = $1",
			[ids.organization],
		);
		expect(workflows).toEqual([]);

		harness.notifications = [];
		actAs(ids.managerUser);
		const approved = await approveAbsenceEffect(absenceId, {
			approvalRequestId: requestId,
		});
		expect(approved).toEqual({ success: true, data: undefined });

		const decision = only(await decisions(absenceId));
		const { rows: requestRows } = await admin.query<{ approved_at: Date }>(
			"select approved_at from approval_request where id = $1",
			[requestId],
		);
		expect(decision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			legacy_approval_request_id: requestId,
			legacy_chain_stage_id: null,
			submitted_revision_id: revision.id,
			operation_kind: "command",
			// The unchanged legacy key, stored verbatim.
			receipt_idempotency_key: `absence:${absenceId}:approve:initial:${sha256("")}`,
			action: "approve",
			stage_id: null,
			assignment_id: null,
			assignment_outcome: "approved",
			request_outcome: "approved",
			actor_kind: "employee",
			actor_employee_id: ids.manager,
			actor_user_id: ids.managerUser,
			event_ids: [],
			reviewed_binding_id: null,
		});
		expect(decision.decided_at.toISOString()).toBe(
			only(requestRows).approved_at.toISOString(),
		);
		expect(decision.result).toMatchObject({
			absenceStatus: "approved",
			legacyRequestStatus: "approved",
			decidedAtSource: "approval_request.approved_at",
			observation: null,
		});
		expect(decision.labels).toEqual({ actorName: "Morgan Manager" });
		expect(await sourceState(absenceId)).toEqual({
			absence_status: "approved",
			requests: ["approved"],
			record_state: "approved",
			decisions: 1,
		});
		expect(harness.notifications).toEqual(["approved"]);

		// Exact committed retry: receipt before fresh checks, no mutation or effects.
		harness.notifications = [];
		const replayed = await approveAbsenceEffect(absenceId, {
			approvalRequestId: requestId,
		});
		expect(replayed).toEqual({ success: true, data: undefined });
		expect(await decisions(absenceId)).toHaveLength(1);
		expect(harness.notifications).toEqual([]);

		// A different operation is not a replay; the legacy owner still refuses it.
		const conflicting = await rejectAbsenceEffect(absenceId, "Too late", {
			approvalRequestId: requestId,
		});
		expect(conflicting).toMatchObject({ success: false });
		expect(await decisions(absenceId)).toHaveLength(1);
		expect((await sourceState(absenceId)).absence_status).toBe("approved");

		await expect(
			admin.query(
				"update approval_decision_evidence set action = 'reject' where id = $1",
				[decision.id],
			),
		).rejects.toThrow(/approval evidence is immutable/);
		await expect(
			admin.query(
				"update approval_submitted_revision set labels = '{}'::jsonb where id = $1",
				[revision.id],
			),
		).rejects.toThrow(/approval evidence is immutable/);

		const review = await prepareAbsenceReviewEvidence({
			organizationId: ids.organization,
			entity: await liveEntity(absenceId),
		});
		expect(review).toMatchObject({
			status: "evidenced",
			authority: "legacy",
			comparison: { kind: "current", labelChanges: [] },
		});
		expect(review?.status === "evidenced" && review.decisions).toHaveLength(1);
		const sections = buildAbsenceReviewSections(review ?? { status: "not_captured", held: false });
		expect(sections.decisionsBlocked).toBe(false);
		expect(JSON.stringify(sections.sections)).toContain("Request approved");
	});

	it("records a rejection with its persisted decision time and no reason text", async () => {
		await seed();
		const absenceId = await submit();
		const requestId = await pendingRequestId(absenceId);

		actAs(ids.managerUser);
		const reason = "Team coverage is too thin that week";
		expect(
			await rejectAbsenceEffect(absenceId, reason, {
				approvalRequestId: requestId,
			}),
		).toEqual({ success: true, data: undefined });

		const decision = only(await decisions(absenceId));
		const { rows } = await admin.query<{ updated_at: Date }>(
			"select updated_at from approval_request where id = $1",
			[requestId],
		);
		expect(decision).toMatchObject({
			receipt_idempotency_key: `absence:${absenceId}:reject:initial:${sha256(reason)}`,
			action: "reject",
			assignment_outcome: "rejected",
			request_outcome: "rejected",
		});
		expect(decision.decided_at.toISOString()).toBe(
			only(rows).updated_at.toISOString(),
		);
		expect(decision.result).toMatchObject({
			decidedAtSource: "approval_request.updated_at",
		});
		expect(JSON.stringify(decision)).not.toContain(reason);
		expect((await sourceState(absenceId)).absence_status).toBe("rejected");
	});

	it("keeps an intermediate chain approval pending and records each stage under the same unchanged legacy key", async () => {
		await seed({ twoStageChain: true });
		const absenceId = await submit();
		const firstRequestId = await pendingRequestId(absenceId);
		const revision = only(await revisions(absenceId));
		const { rows: chains } = await admin.query<{ id: string }>(
			"select id from approval_chain_instance where entity_id = $1",
			[absenceId],
		);
		expect(revision).toMatchObject({
			legacy_approval_request_id: firstRequestId,
			legacy_chain_instance_id: only(chains).id,
		});

		actAs(ids.managerUser);
		expect(
			await approveAbsenceEffect(absenceId, {
				approvalRequestId: firstRequestId,
			}),
		).toEqual({ success: true, data: undefined });
		const secondRequestId = await pendingRequestId(absenceId);
		expect(secondRequestId).not.toBe(firstRequestId);
		const [intermediate] = await decisions(absenceId);
		expect(intermediate).toMatchObject({
			legacy_approval_request_id: firstRequestId,
			assignment_outcome: "approved",
			// An intermediate approval is not final approval.
			request_outcome: "pending",
			actor_employee_id: ids.manager,
		});
		const { rows: firstStage } = await admin.query<{
			id: string;
			decided_at: Date;
		}>(
			`select id, decided_at from approval_chain_stage_instance
			 where approval_request_id = $1`,
			[firstRequestId],
		);
		expect(intermediate.legacy_chain_stage_id).toBe(only(firstStage).id);
		expect(intermediate.decided_at.toISOString()).toBe(
			only(firstStage).decided_at.toISOString(),
		);
		expect((await sourceState(absenceId)).absence_status).toBe("pending");

		actAs(ids.secondManagerUser);
		expect(
			await approveAbsenceEffect(absenceId, {
				approvalRequestId: secondRequestId,
			}),
		).toEqual({ success: true, data: undefined });
		const [first, final] = await decisions(absenceId);
		expect(final).toMatchObject({
			legacy_approval_request_id: secondRequestId,
			assignment_outcome: "approved",
			request_outcome: "approved",
			actor_employee_id: ids.secondManager,
		});
		// Both stages share the legacy key; the receipt is scoped by legacy request.
		expect(final.receipt_idempotency_key).toBe(first.receipt_idempotency_key);
		expect((await sourceState(absenceId)).absence_status).toBe("approved");
	});

	it("holds a decision after a material change before any legacy mutation", async () => {
		await seed();
		const absenceId = await submit();
		const requestId = await pendingRequestId(absenceId);
		await admin.query(
			"update absence_entry set end_date = '2026-08-07' where id = $1",
			[absenceId],
		);
		const before = await sourceState(absenceId);

		actAs(ids.managerUser);
		const result = await approveAbsenceEffect(absenceId, {
			approvalRequestId: requestId,
		});
		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error: expect.stringContaining("cancelled and resubmitted"),
		});
		expect(await sourceState(absenceId)).toEqual(before);
		expect(before).toMatchObject({ requests: ["pending"], decisions: 0 });

		const review = await prepareAbsenceReviewEvidence({
			organizationId: ids.organization,
			entity: await liveEntity(absenceId),
		});
		expect(review).toMatchObject({
			status: "evidenced",
			comparison: { kind: "material_change", changedFields: ["endDate"] },
		});
		expect(
			buildAbsenceReviewSections(review ?? { status: "not_captured", held: false })
				.decisionsBlocked,
		).toBe(true);
	});

	it("is inert while capture is inactive and holds an uncaptured lifecycle once capture starts", async () => {
		await seed({ capture: false });
		const decidedId = await submit();
		const heldId = await submit({
			startDate: "2026-09-07",
			endDate: "2026-09-08",
		});
		expect(await revisions(decidedId)).toEqual([]);

		actAs(ids.managerUser);
		expect(
			await approveAbsenceEffect(decidedId, {
				approvalRequestId: await pendingRequestId(decidedId),
			}),
		).toEqual({ success: true, data: undefined });
		expect(await sourceState(decidedId)).toMatchObject({
			absence_status: "approved",
			decisions: 0,
		});

		await enableCapture();
		const before = await sourceState(heldId);
		const held = await approveAbsenceEffect(heldId, {
			approvalRequestId: await pendingRequestId(heldId),
		});
		expect(held).toMatchObject({
			success: false,
			code: "ConflictError",
			error: expect.stringContaining("were not captured"),
		});
		expect(await sourceState(heldId)).toEqual(before);
		expect(
			await prepareAbsenceReviewEvidence({
				organizationId: ids.organization,
				entity: await liveEntity(heldId),
			}),
		).toEqual({ status: "not_captured", held: true });
	});

	it("rolls back the legacy decision, chain progress and parity when evidence cannot be written", async () => {
		await seed();
		const absenceId = await submit();
		const requestId = await pendingRequestId(absenceId);
		const before = await sourceState(absenceId);
		const { rows: auditBefore } = await admin.query<{ count: number }>(
			"select count(*)::int as count from audit_log where organization_id = $1",
			[ids.organization],
		);

		actAs(ids.managerUser);
		const result = await withInsertFailure("approval_decision_evidence", () =>
			approveAbsenceEffect(absenceId, { approvalRequestId: requestId }),
		);
		expect(result).toMatchObject({ success: false });
		expect(await sourceState(absenceId)).toEqual(before);
		const { rows: auditAfter } = await admin.query<{ count: number }>(
			"select count(*)::int as count from audit_log where organization_id = $1",
			[ids.organization],
		);
		expect(auditAfter).toEqual(auditBefore);
		expect(harness.notifications).not.toContain("approved");

		// The same request is decidable once evidence can be written again.
		expect(
			await approveAbsenceEffect(absenceId, { approvalRequestId: requestId }),
		).toEqual({ success: true, data: undefined });
		expect((await sourceState(absenceId)).decisions).toBe(1);
	});

	it("rolls back the whole legacy submission when its revision cannot be written", async () => {
		await seed();
		actAs(ids.requesterUser);
		const result = await withInsertFailure("approval_submitted_revision", () =>
			requestAbsenceEffect({
				categoryId: ids.category,
				startDate: "2026-08-03",
				endDate: "2026-08-04",
				startPeriod: "full_day",
				endPeriod: "full_day",
				durationKind: "full_day",
			}),
		);
		expect(result).toMatchObject({ success: false });
		const { rows } = await admin.query<{
			absences: number;
			requests: number;
			records: number;
		}>(
			`select
			   (select count(*)::int from absence_entry where organization_id = $1) as absences,
			   (select count(*)::int from approval_request where organization_id = $1) as requests,
			   (select count(*)::int from time_record where organization_id = $1) as records`,
			[ids.organization],
		);
		expect(only(rows)).toEqual({ absences: 0, requests: 0, records: 0 });
		expect(harness.notifications).toEqual([]);
	});

	it("records requester auto-approval during submission as a system activation", async () => {
		await seed({ requesterSelfApproves: true });
		const absenceId = await submit();
		const decision = only(await decisions(absenceId));
		const { rows } = await admin.query<{ approved_at: Date }>(
			"select approved_at from absence_entry where id = $1",
			[absenceId],
		);
		expect(decision).toMatchObject({
			authority: "legacy",
			operation_kind: "submission_activation",
			receipt_idempotency_key: `absence:${absenceId}:submission`,
			actor_kind: "system",
			actor_employee_id: null,
			actor_user_id: null,
			assignment_outcome: null,
			request_outcome: "approved",
		});
		expect(decision.decided_at.toISOString()).toBe(
			only(rows).approved_at.toISOString(),
		);
	});

	it("records a shadow observation separately and never exposes legacy evidence as canonical", async () => {
		await seed({ mode: "shadow" });
		const absenceId = await submit();
		const requestId = await pendingRequestId(absenceId);
		const { rows: workflows } = await admin.query<{ id: string }>(
			`select id from approval_workflow
			 where organization_id = $1 and source_id = $2`,
			[ids.organization, absenceId],
		);
		const observedWorkflowId = only(workflows).id;
		const revision = only(await revisions(absenceId));
		expect(revision).toMatchObject({
			authority: "legacy",
			workflow_id: null,
			observed_workflow_id: observedWorkflowId,
		});
		// A stored observation does not promote authority.
		expect(
			await loadCurrentAbsenceSubmittedRevision(db, {
				organizationId: ids.organization,
				workflowId: observedWorkflowId,
			}),
		).toBeNull();

		actAs(ids.managerUser);
		expect(
			await approveAbsenceEffect(absenceId, { approvalRequestId: requestId }),
		).toEqual({ success: true, data: undefined });
		const decision = only(await decisions(absenceId));
		expect(decision).toMatchObject({
			workflow_id: null,
			observed_workflow_id: observedWorkflowId,
			event_ids: [],
			result: {
				observation: { kind: "shadow", workflowId: observedWorkflowId },
			},
		});
		const observedEventIds: string[] = decision.result.observation.eventIds;
		expect(observedEventIds.length).toBeGreaterThan(0);
		const { rows: events } = await admin.query<{ id: string }>(
			`select id from approval_workflow_event
			 where organization_id = $1 and workflow_id = $2 and id = any($3::uuid[])`,
			[ids.organization, observedWorkflowId, observedEventIds],
		);
		expect(events).toHaveLength(observedEventIds.length);
	});

	it("keeps legacy evidence organization-scoped", async () => {
		await seed();
		const absenceId = await submit();
		const requestId = await pendingRequestId(absenceId);
		actAs(ids.managerUser);
		await approveAbsenceEffect(absenceId, { approvalRequestId: requestId });

		expect(
			await loadLegacyAbsenceSubmittedRevision(db, {
				organizationId: ids.otherOrganization,
				absenceId,
			}),
		).toBeNull();
		expect(
			await findLegacyDecisionEvidenceByRequest(db, {
				organizationId: ids.otherOrganization,
				approvalRequestId: requestId,
			}),
		).toBeNull();
		expect(
			await prepareAbsenceReviewEvidence({
				organizationId: ids.otherOrganization,
				entity: await liveEntity(absenceId),
			}),
		).toBeNull();

		// A foreign actor cannot decide or replay through their own organization.
		actAs(ids.otherUser, ids.otherOrganization);
		expect(
			await approveAbsenceEffect(absenceId, { approvalRequestId: requestId }),
		).toMatchObject({ success: false });

		// Composite keys refuse evidence that crosses organizations.
		const revision = only(await revisions(absenceId));
		await expect(
			admin.query(
				`insert into approval_submitted_revision (
				   organization_id, authority, legacy_approval_request_id, workflow_type,
				   source_type, source_id, request_cycle_key, revision, subject_employee_id,
				   requester_employee_id, submitter_actor_kind, schema_version,
				   material_fingerprint, facts, labels, provenance, submitted_at
				 ) values ($1, 'legacy', $2, 'absence', 'absence_entry', $3, 'foreign', 1,
				   $4, $4, 'system', 1, 'x', '{}'::jsonb, '{}'::jsonb, 'captured_at_submission', now())`,
				[ids.organization, requestId, absenceId, ids.otherEmployee],
			),
		).rejects.toThrow(/foreign key/);
		// Legacy rows cannot name a workflow, and decisions cannot cross authorities.
		await expect(
			admin.query(
				`insert into approval_decision_evidence (
				   organization_id, authority, workflow_id, legacy_approval_request_id,
				   submitted_revision_id, operation_kind, receipt_idempotency_key,
				   receipt_actor_fingerprint, receipt_command_fingerprint, action,
				   request_outcome, actor_kind, decided_at, event_ids, result, labels, schema_version
				 ) values ($1, 'canonical', gen_random_uuid(), null, $2, 'command', 'k', 'a', 'c',
				   'approve', 'approved', 'system', now(), '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 1)`,
				[ids.organization, revision.id],
			),
		).rejects.toThrow(/foreign key|violates/);
	});

	it("keeps evidence through cancellation and removes exactly one lifecycle through privileged cleanup", async () => {
		await seed();
		const decidedId = await submit();
		const decidedRequestId = await pendingRequestId(decidedId);
		actAs(ids.managerUser);
		await approveAbsenceEffect(decidedId, {
			approvalRequestId: decidedRequestId,
		});
		const cancelledId = await submit({
			startDate: "2026-09-07",
			endDate: "2026-09-08",
		});
		const cancelledRevision = only(await revisions(cancelledId));

		actAs(ids.requesterUser);
		expect(await cancelAbsenceRequest(cancelledId)).toMatchObject({
			success: true,
		});
		const { rows: remainingRequests } = await admin.query(
			"select id from approval_request where entity_id = $1",
			[cancelledId],
		);
		expect(remainingRequests).toEqual([]);
		// Evidence survives ordinary cancellation and stays addressable.
		expect(await revisions(cancelledId)).toHaveLength(1);
		const listed = await listApprovals(db, ids.organization);
		expect(listed).toContainEqual(
			expect.objectContaining({
				storage_type: "legacy_evidence",
				id: cancelledRevision.id,
				source_id: cancelledId,
			}),
		);

		const decidedRevision = only(await revisions(decidedId));
		const decidedDecision = only(await decisions(decidedId));
		const removed = await deleteApproval(db, ids.organization, decidedRequestId);
		expect(removed).toMatchObject({
			legacyRequests: [decidedRequestId],
			evidence: {
				submittedRevisions: [decidedRevision.id],
				decisionEvidence: [decidedDecision.id],
				reviewBindings: [],
			},
		});
		expect(await revisions(decidedId)).toEqual([]);
		// Other cycles and the business record are preserved.
		expect(await revisions(cancelledId)).toHaveLength(1);
		const { rows: decidedAbsence } = await admin.query(
			"select status from absence_entry where id = $1",
			[decidedId],
		);
		expect(decidedAbsence).toEqual([{ status: "approved" }]);

		const removedEvidence = await deleteApproval(
			db,
			ids.organization,
			cancelledRevision.id,
		);
		expect(removedEvidence.evidence.submittedRevisions).toEqual([
			cancelledRevision.id,
		]);
		expect(await revisions(cancelledId)).toEqual([]);
	});
});
