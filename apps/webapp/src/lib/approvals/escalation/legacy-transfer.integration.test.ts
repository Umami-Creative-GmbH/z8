/**
 * #299 / T35 runtime evidence for legacy-authoritative escalation transfer.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Real callers run against that database: absence submission
 * (`requestAbsenceEffect`), the scheduled processor (`processDueEscalations`),
 * the management settings actions, the absence decision actions and approval
 * maintenance, with the real write gate, legacy capture, shadow mirror,
 * journal and attention store. Only the request/session, billing guard,
 * e-mail/notification delivery, calendar queue and work-balance marking
 * boundaries are replaced.
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
	getOrganizationBaseUrl: async () => "https://t299.example.test",
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
const { listApprovalEscalationCandidates, transferApprovalEscalationAssignment } = await import(
	"@/app/[locale]/(app)/settings/approval-escalation/actions"
);
const { processDueEscalations } = await import("./transfer");
const { db } = await import("@/db");
const { deleteApproval } = await import("@/lib/approvals/maintenance");
const { parseInstant } = await import("@/lib/datetime/temporal-core");

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
	describe.skip(`legacy escalation transfer PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t299-legacy-transfer-org",
	requesterUser: "t299-requester-user",
	managerUser: "t299-manager-user",
	backupUser: "t299-backup-user",
	adminUser: "t299-admin-user",
	thirdUser: "t299-third-user",
	requester: "e2990000-0000-4000-8000-000000000001",
	manager: "e2990000-0000-4000-8000-000000000002",
	backup: "e2990000-0000-4000-8000-000000000003",
	admin: "e2990000-0000-4000-8000-000000000004",
	third: "e2990000-0000-4000-8000-000000000005",
	managerLink: "e2991000-0000-4000-8000-000000000001",
	backupLink: "e2991000-0000-4000-8000-000000000002",
	thirdLink: "e2991000-0000-4000-8000-000000000003",
	category: "e2992000-0000-4000-8000-000000000001",
	policy: "e2993000-0000-4000-8000-000000000001",
	firstStage: "e2993000-0000-4000-8000-000000000002",
	secondStage: "e2993000-0000-4000-8000-000000000003",
} as const;
type RolloutMode = "legacy" | "shadow" | "canonical";

function only<T>(rows: readonly T[]): T {
	const [row] = rows;
	if (rows.length !== 1 || row === undefined) {
		throw new Error(`Expected exactly one row, received ${rows.length}`);
	}
	return row;
}

describeIntegration("legacy escalation transfer (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	function actAs(userId: string) {
		harness.userId = userId;
		harness.organizationId = ids.organization;
	}

	async function cleanup() {
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.adminUser, ids.thirdUser],
		]);
	}

	async function seed(
		options: { mode?: RolloutMode; twoStageChain?: boolean; thirdManager?: boolean } = {},
	) {
		await cleanup();
		const timestamp = new Date("2026-07-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, created_at)
			 values ($1, 'T299 legacy transfers', $1, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', $2, 'legacy', $3, $3)`,
			[ids.organization, options.mode ?? "legacy", timestamp],
		);
		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, $2)`,
			[ids.organization, timestamp],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance)
			 values ($1, true, 1, 1, '{"source":"t299"}'::jsonb)`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't299-requester@example.test', $5, $5),
			 ($2, 'Morgan Manager', 't299-manager@example.test', $5, $5),
			 ($3, 'Blake Backup', 't299-backup@example.test', $5, $5),
			 ($4, 'Ada Admin', 't299-admin@example.test', $5, $5)`,
			[ids.requesterUser, ids.managerUser, ids.backupUser, ids.adminUser, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't299-member-' || user_id, $1, user_id,
			   case when user_id = $4 then 'admin' else 'member' end, 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[
				ids.organization,
				timestamp,
				[ids.requesterUser, ids.managerUser, ids.backupUser, ids.adminUser],
				ids.adminUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $9, 'employee', $10), ($3, $4, $9, 'manager', $10),
			 ($5, $6, $9, 'manager', $10), ($7, $8, $9, 'admin', $10)`,
			[
				ids.requester,
				ids.requesterUser,
				ids.manager,
				ids.managerUser,
				ids.backup,
				ids.backupUser,
				ids.admin,
				ids.adminUser,
				ids.organization,
				timestamp,
			],
		);
		// Both are direct managers: the former holder stays an eligible manager.
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $3, $4, true, $6, $7, $7), ($2, $3, $5, false, $6, $7, $7)`,
			[
				ids.managerLink,
				ids.backupLink,
				ids.requester,
				ids.manager,
				ids.backup,
				ids.managerUser,
				timestamp,
			],
		);
		if (options.thirdManager) {
			// Another eligible direct manager who never holds the request; linked
			// later, so the backup stays the first candidate.
			await admin.query(
				`insert into "user" (id, name, email, created_at, updated_at)
				 values ($1, 'Taylor Third', 't299-third@example.test', $2, $2)`,
				[ids.thirdUser, timestamp],
			);
			await admin.query(
				`insert into member (id, organization_id, user_id, role, status, created_at)
				 values ('t299-member-third', $1, $2, 'member', 'approved', $3)`,
				[ids.organization, ids.thirdUser, timestamp],
			);
			await admin.query(
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ($1, $2, $3, 'manager', $4)`,
				[ids.third, ids.thirdUser, ids.organization, timestamp],
			);
			await admin.query(
				`insert into employee_managers
				 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
				 values ($1, $2, $3, false, $4, $5, $5)`,
				[
					ids.thirdLink,
					ids.requester,
					ids.third,
					ids.managerUser,
					new Date("2026-07-02T00:00:00Z"),
				],
			);
		}
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
				 values ($1, $2, 'T299 two stages', true, 1, $3, $4)`,
				[ids.policy, ids.organization, ids.managerUser, timestamp],
			);
			await admin.query(
				`insert into approval_policy_stage
				 (id, organization_id, policy_id, step_order, label, approver_type,
				  approver_employee_id, fallback_behavior, updated_at) values
				 ($1, $3, $4, 1, 'Manager', 'direct_manager', null, 'fail', $6),
				 ($2, $3, $4, 2, 'Second', 'specific_employee', $5, 'fail', $6)`,
				[ids.firstStage, ids.secondStage, ids.organization, ids.policy, ids.admin, timestamp],
			);
		}
	}

	async function submit(): Promise<{ absenceId: string; requestId: string; createdAt: Date }> {
		actAs(ids.requesterUser);
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate: "2026-08-03",
			endDate: "2026-08-04",
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
			notes: "T299",
		});
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		const { rows } = await admin.query<{ id: string; created_at: Date }>(
			// Legacy timestamps are UTC wall time without a zone.
			`select id, created_at at time zone 'UTC' as created_at from approval_request
			 where organization_id = $1 and entity_id = $2 and status = 'pending'`,
			[ids.organization, result.data.absenceId],
		);
		const request = only(rows);
		return {
			absenceId: result.data.absenceId,
			requestId: request.id,
			createdAt: request.created_at,
		};
	}

	/** The scheduled processor at an instant relative to the request's creation. */
	function processAt(createdAt: Date, plusMinutes: number) {
		return processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(createdAt.getTime() + plusMinutes * 60_000).toISOString()),
		});
	}

	async function request(requestId: string) {
		const { rows } = await admin.query(
			"select approver_id, status, metadata from approval_request where id = $1",
			[requestId],
		);
		return only(rows);
	}

	async function journal() {
		const { rows } = await admin.query(
			`select * from approval_escalation_transfer
			 where organization_id = $1 order by created_at, id`,
			[ids.organization],
		);
		return rows;
	}

	async function openAttention() {
		const { rows } = await admin.query(
			`select reason, dedupe_key, evidence from approval_escalation_attention
			 where organization_id = $1 and status = 'open' order by first_raised_at, id`,
			[ids.organization],
		);
		return rows;
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
			throw new Error("Legacy escalation transfer PostgreSQL is disabled");
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

	it("transfers a due legacy request atomically with system attribution, then only the replacement decides", async () => {
		await seed();
		const { absenceId, requestId, createdAt } = await submit();
		expect((await request(requestId)).approver_id).toBe(ids.manager);

		const early = await processAt(createdAt, 59);
		expect(early).toMatchObject({ authority: "legacy", transferred: 0 });
		expect(await journal()).toEqual([]);

		const due = await processAt(createdAt, 60);
		expect(due).toMatchObject({ status: "processed", authority: "legacy", transferred: 1 });

		const moved = await request(requestId);
		expect(moved.approver_id).toBe(ids.backup);
		expect(moved.status).toBe("pending");
		expect(moved.metadata.escalation).toMatchObject({
			version: 1,
			transfers: [
				{
					sequence: 0,
					fromApproverEmployeeId: ids.manager,
					toApproverEmployeeId: ids.backup,
					initiator: "scheduled",
					actorEmployeeId: null,
				},
			],
		});
		const transfer = only(await journal());
		expect(transfer).toMatchObject({
			authority_mode: "legacy",
			initiator: "scheduled",
			workflow_type: "absence",
			workflow_id: null,
			stage_id: null,
			source_assignment_id: null,
			replacement_assignment_id: null,
			workflow_event_id: null,
			lineage_root_assignment_id: null,
			legacy_approval_request_id: requestId,
			legacy_source_sequence: 0,
			observed_workflow_id: null,
			observed_event_id: null,
			source_approver_employee_id: ids.manager,
			replacement_approver_employee_id: ids.backup,
			requester_employee_id: ids.requester,
			actionable_evidence: "legacy_request_created_at",
			policy_revision: 1,
			actor_kind: "system",
			actor_system_id: "approval-escalation",
			actor_user_id: null,
			actor_employee_id: null,
			receipt_actor_fingerprint: 'v2:["system","approval-escalation",1]',
			operation_key: `escalation:auto:legacy:v1:${requestId}:0:${ids.manager}`,
		});
		expect(transfer.receipt_idempotency_key).toBe(transfer.operation_key);
		expect(transfer.actionable_at.toISOString()).toBe(createdAt.toISOString());
		expect(transfer.deadline_at.getTime()).toBe(createdAt.getTime() + 3_600_000);
		const { rows: events } = await admin.query(
			"select event_type, payload, expansion_status from approval_escalation_transfer_event where transfer_id = $1",
			[transfer.id],
		);
		expect(only(events)).toMatchObject({
			event_type: "assignment_transferred",
			expansion_status: "pending",
			payload: {
				authorityMode: "legacy",
				workflowId: null,
				legacyApprovalRequestId: requestId,
				legacySourceSequence: 0,
				sourceId: absenceId,
				formerApproverEmployeeId: ids.manager,
				replacementApproverEmployeeId: ids.backup,
			},
		});
		// No human is fabricated for the scheduled capability, and no canonical
		// workflow is invented for the legacy authority.
		const { rows: audits } = await admin.query(
			"select id from audit_log where organization_id = $1 and entity_type = 'approval_escalation_transfer'",
			[ids.organization],
		);
		expect(audits).toEqual([]);
		const { rows: workflows } = await admin.query(
			"select id from approval_workflow where organization_id = $1",
			[ids.organization],
		);
		expect(workflows).toEqual([]);

		// The former holder is still an eligible manager of the requester, but
		// eligibility does not bypass the replacement.
		actAs(ids.managerUser);
		const stale = await approveAbsenceEffect(absenceId, {
			approvalRequestId: requestId,
			allowAnyApprover: true,
		});
		expect(stale.success).toBe(false);
		expect(JSON.stringify(stale)).toContain("reassigned");
		expect((await request(requestId)).status).toBe("pending");

		actAs(ids.backupUser);
		expect(await approveAbsenceEffect(absenceId, { approvalRequestId: requestId })).toEqual({
			success: true,
			data: undefined,
		});
		const decided = await request(requestId);
		expect(decided.status).toBe("approved");
		const { rows: absences } = await admin.query(
			"select status, approved_by from absence_entry where id = $1",
			[absenceId],
		);
		expect(only(absences)).toMatchObject({ status: "approved", approved_by: ids.backup });
	});

	it("never transfers a lineage twice automatically and replays nothing on later runs", async () => {
		await seed();
		const { requestId, createdAt } = await submit();
		await processAt(createdAt, 60);
		const transferredAt = only(await journal()).transferred_at as Date;

		const rerun = await processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(new Date(transferredAt.getTime() + 3_600_000).toISOString()),
		});

		expect(rerun).toMatchObject({ transferred: 0, held: { replacement_overdue: 1 } });
		expect(await journal()).toHaveLength(1);
		expect((await request(requestId)).approver_id).toBe(ids.backup);
		expect(only(await openAttention())).toMatchObject({
			reason: "replacement_overdue",
			dedupe_key: `replacement_overdue:approval:${requestId}:approver:${ids.backup}`,
			evidence: expect.objectContaining({ actionableEvidence: "legacy_transfer_at" }),
		});
	});

	it("serializes simultaneous scheduled attempts into one committed transfer", async () => {
		await seed();
		const { requestId, createdAt } = await submit();

		const results = await Promise.all([processAt(createdAt, 60), processAt(createdAt, 60)]);

		expect(results.reduce((total, result) => total + result.transferred, 0)).toBe(1);
		expect(results.every((result) => result.failed === 0)).toBe(true);
		expect(await journal()).toHaveLength(1);
		expect((await request(requestId)).approver_id).toBe(ids.backup);
	});

	it("lets exactly one of a transfer and a concurrent decision by the current holder win", async () => {
		await seed();
		const { absenceId, requestId, createdAt } = await submit();

		actAs(ids.managerUser);
		const [processed, decision] = await Promise.all([
			processAt(createdAt, 60),
			approveAbsenceEffect(absenceId, { approvalRequestId: requestId }),
		]);

		const final = await request(requestId);
		const transfers = await journal();
		if (decision.success) {
			expect(final).toMatchObject({ status: "approved", approver_id: ids.manager });
			expect(transfers).toEqual([]);
		} else {
			expect(final).toMatchObject({ status: "pending", approver_id: ids.backup });
			expect(transfers).toHaveLength(1);
			expect(processed.transferred).toBe(1);
		}
		expect(processed.failed).toBe(0);
	});

	it("serializes an eligible non-holder's decision behind an in-flight transfer and then refuses it", async () => {
		await seed({ thirdManager: true });
		const { absenceId, requestId } = await submit();

		// Play the transfer's transaction by hand and keep its row lock open.
		const transferring = await admin.connect();
		let decisionSettled = false;
		try {
			await transferring.query("begin");
			await transferring.query("select id from approval_request where id = $1 for update", [
				requestId,
			]);
			await transferring.query("update approval_request set approver_id = $2 where id = $1", [
				requestId,
				ids.backup,
			]);
			await transferring.query(
				`insert into approval_escalation_transfer
				 (organization_id, operation_key, initiator, authority_mode, workflow_type,
				  legacy_approval_request_id, legacy_source_sequence,
				  source_approver_employee_id, replacement_approver_employee_id, requester_employee_id,
				  receipt_idempotency_key, receipt_actor_fingerprint, receipt_command_fingerprint,
				  request_fingerprint, actor_kind, actor_user_id, actor_employee_id, transferred_at)
				 values ($1, 't299-in-flight', 'human', 'legacy', 'absence', $2, 0,
				  $3, $4, $5, 't299-in-flight', 'v1', 'v1', 'v1', 'user', $6, $7, now())`,
				[
					ids.organization,
					requestId,
					ids.manager,
					ids.backup,
					ids.requester,
					ids.adminUser,
					ids.admin,
				],
			);

			actAs(ids.thirdUser);
			const decision = approveAbsenceEffect(absenceId, {
				approvalRequestId: requestId,
				allowAnyApprover: true,
			}).finally(() => {
				decisionSettled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			// The decision waits on the transfer instead of deciding around it.
			expect(decisionSettled).toBe(false);

			await transferring.query("commit");
			const refused = await decision;
			expect(refused.success).toBe(false);
			expect(JSON.stringify(refused)).toContain("reassigned");
		} finally {
			await transferring.query("rollback").catch(() => undefined);
			transferring.release();
		}
		expect(await request(requestId)).toMatchObject({
			status: "pending",
			approver_id: ids.backup,
		});
	});

	it("transfers through the management action with audit, exact replay and idempotency mismatch", async () => {
		await seed();
		const { absenceId, requestId } = await submit();

		actAs(ids.adminUser);
		const candidates = await listApprovalEscalationCandidates({ approvalRequestId: requestId });
		expect(candidates).toMatchObject({
			success: true,
			data: {
				currentApprover: { employeeId: ids.manager, name: "Morgan Manager" },
				candidates: [{ employeeId: ids.backup, recommended: true }],
			},
		});
		const key = "e2994000-0000-4000-8000-000000000001";
		const request1 = {
			approvalRequestId: requestId,
			recipientEmployeeId: ids.backup,
			idempotencyKey: key,
			reason: "Morgan is on leave",
		};
		expect(await transferApprovalEscalationAssignment(request1)).toEqual({
			success: true,
			data: { replayed: false },
		});
		expect(await transferApprovalEscalationAssignment(request1)).toEqual({
			success: true,
			data: { replayed: true },
		});
		const mismatch = await transferApprovalEscalationAssignment({
			...request1,
			reason: "A different reason",
		});
		expect(mismatch).toMatchObject({ success: false });
		expect(JSON.stringify(mismatch)).toContain("different details");

		const transfer = only(await journal());
		expect(transfer).toMatchObject({
			initiator: "human",
			authority_mode: "legacy",
			actor_kind: "user",
			actor_user_id: ids.adminUser,
			actor_employee_id: ids.admin,
			actionable_at: null,
			deadline_at: null,
			reason: "Morgan is on leave",
			legacy_source_sequence: 0,
		});
		const { rows: audits } = await admin.query(
			`select performed_by, employee_id, action from audit_log
			 where organization_id = $1 and entity_id = $2`,
			[ids.organization, transfer.id],
		);
		expect(only(audits)).toMatchObject({
			performed_by: ids.adminUser,
			employee_id: ids.admin,
			action: "approval_escalation.transferred",
		});
		expect((await request(requestId)).metadata.escalation.transfers[0]).toMatchObject({
			initiator: "human",
			actorEmployeeId: ids.admin,
		});

		// A human transfer does not consume the automatic allowance.
		const { rows: requestRows } = await admin.query<{ updated_at: Date }>(
			"select updated_at at time zone 'UTC' as updated_at from approval_request where id = $1",
			[requestId],
		);
		const later = await processDueEscalations({
			organizationId: ids.organization,
			now: parseInstant(
				new Date(only(requestRows).updated_at.getTime() + 2 * 3_600_000).toISOString(),
			),
		});
		expect(later.transferred + (later.held.no_eligible_backup ?? 0)).toBe(1);

		// Explicit organization management remains a separate decision path.
		actAs(ids.adminUser);
		const managed = await approveAbsenceEffect(absenceId, {
			approvalRequestId: requestId,
			allowOrganizationWideApprover: true,
		});
		expect(managed).toEqual({ success: true, data: undefined });
	});

	it("mirrors the transfer into the shadow observation and keeps that history through the decision", async () => {
		await seed({ mode: "shadow" });
		const { absenceId, requestId, createdAt } = await submit();
		const { rows: observedBefore } = await admin.query(
			`select stage.id as stage_id, assignment.id, assignment.assigned_at
			 from approval_workflow workflow
			 join approval_workflow_stage stage on stage.workflow_id = workflow.id
			 join approval_stage_assignment assignment on assignment.stage_id = stage.id
			 where workflow.organization_id = $1 and workflow.source_id = $2`,
			[ids.organization, absenceId],
		);
		const original = only(observedBefore);

		expect(await processAt(createdAt, 60)).toMatchObject({ transferred: 1 });

		const transfer = only(await journal());
		expect(transfer.observed_workflow_id).not.toBeNull();
		const { rows: assignments } = await admin.query(
			`select id, approver_employee_id, status, assigned_at, resolved_by_actor_kind,
			   reassigned_from_assignment_id, reassignment_metadata
			 from approval_stage_assignment
			 where workflow_id = $1 order by assignment_sequence`,
			[transfer.observed_workflow_id],
		);
		expect(assignments).toMatchObject([
			{
				id: original.id,
				approver_employee_id: ids.manager,
				status: "cancelled",
				resolved_by_actor_kind: "system",
				reassigned_from_assignment_id: null,
			},
			{
				approver_employee_id: ids.backup,
				status: "pending",
				reassigned_from_assignment_id: original.id,
				reassignment_metadata: { kind: "escalation" },
			},
		]);
		expect(assignments[0]?.assigned_at.toISOString()).toBe(original.assigned_at.toISOString());
		const { rows: observedEvents } = await admin.query(
			`select id, event_type, actor_kind from approval_workflow_event
			 where workflow_id = $1 and event_type = 'assignment.escalated'`,
			[transfer.observed_workflow_id],
		);
		expect(only(observedEvents)).toMatchObject({
			id: transfer.observed_event_id,
			actor_kind: "system",
		});

		actAs(ids.backupUser);
		expect(await approveAbsenceEffect(absenceId, { approvalRequestId: requestId })).toEqual({
			success: true,
			data: undefined,
		});
		const { rows: afterDecision } = await admin.query(
			`select id, status, approver_employee_id from approval_stage_assignment
			 where workflow_id = $1 order by assignment_sequence`,
			[transfer.observed_workflow_id],
		);
		expect(afterDecision).toEqual([
			{ id: original.id, status: "cancelled", approver_employee_id: ids.manager },
			{ id: assignments[1]?.id, status: "approved", approver_employee_id: ids.backup },
		]);
		const { rows: workflowRows } = await admin.query(
			"select status from approval_workflow where id = $1",
			[transfer.observed_workflow_id],
		);
		expect(only(workflowRows).status).toBe("approved");
	});

	it("holds a request a Teams channel checker may have moved instead of transferring it", async () => {
		await seed();
		const { requestId, createdAt } = await submit();
		await admin.query(
			`insert into teams_escalation
			 (organization_id, approval_request_id, original_approver_id, escalated_to_approver_id,
			  timeout_hours, escalated_at)
			 values ($1, $2, $3, $3, 24, now())`,
			[ids.organization, requestId, ids.manager],
		);

		expect(await processAt(createdAt, 60)).toMatchObject({
			transferred: 0,
			held: { ambiguous_history: 1 },
		});
		expect(await journal()).toEqual([]);
		expect((await request(requestId)).approver_id).toBe(ids.manager);
		expect(only(await openAttention()).evidence).toMatchObject({
			cause: "teams_escalation_attempt",
		});
	});

	it("holds a legacy chain stage as an unsupported route once due", async () => {
		await seed({ twoStageChain: true });
		const { requestId, createdAt } = await submit();

		expect(await processAt(createdAt, 30)).toMatchObject({ transferred: 0, held: {} });
		expect(await processAt(createdAt, 60)).toMatchObject({
			transferred: 0,
			held: { unsupported_route: 1 },
		});
		expect((await request(requestId)).approver_id).toBe(ids.manager);
		expect(only(await openAttention()).evidence).toMatchObject({ route: "legacy_chain_stage" });
	});

	it("selects canonical discovery once absences are canonically decided", async () => {
		await seed({ mode: "canonical" });
		const { createdAt } = await submit();

		const summary = await processAt(createdAt, 60);

		expect(summary.authority).toBe("canonical");
		const legacyRows = (await journal()).filter((row) => row.authority_mode === "legacy");
		expect(legacyRows).toEqual([]);
	});

	it("removes the lifecycle's legacy journal through approval maintenance", async () => {
		await seed();
		const { requestId, createdAt } = await submit();
		await processAt(createdAt, 60);
		const transfer = only(await journal());

		const deleted = await deleteApproval(db as never, ids.organization, requestId);

		expect(deleted.legacyRequests).toEqual([requestId]);
		expect(deleted.escalationTransfers).toEqual([transfer.id]);
		expect(await journal()).toEqual([]);
		const { rows: events } = await admin.query(
			"select id from approval_escalation_transfer_event where transfer_id = $1",
			[transfer.id],
		);
		expect(events).toEqual([]);
	});

	it("rejects legacy journal rows that name canonical workflow identities", async () => {
		await seed();
		const { requestId, createdAt } = await submit();
		await processAt(createdAt, 60);
		const transfer = only(await journal());

		await expect(
			admin.query(
				`insert into approval_escalation_transfer
				 (organization_id, operation_key, initiator, authority_mode, workflow_type,
				  workflow_id, legacy_approval_request_id, legacy_source_sequence,
				  source_approver_employee_id, replacement_approver_employee_id, requester_employee_id,
				  receipt_idempotency_key, receipt_actor_fingerprint, receipt_command_fingerprint,
				  request_fingerprint, actor_kind, actor_user_id, actor_employee_id, transferred_at)
				 values ($1, 'forged', 'human', 'legacy', 'absence', gen_random_uuid(), $2, 1,
				  $3, $4, $5, 'forged', 'v1', 'v1', 'v1', 'user', $6, $7, now())`,
				[
					ids.organization,
					requestId,
					ids.backup,
					ids.manager,
					ids.requester,
					ids.adminUser,
					ids.admin,
				],
			),
		).rejects.toThrow(/approval_escalation_transfer_mode_check/);
		await expect(
			admin.query(
				`insert into approval_escalation_transfer
				 (organization_id, operation_key, initiator, authority_mode, workflow_type,
				  legacy_approval_request_id, legacy_source_sequence,
				  source_approver_employee_id, replacement_approver_employee_id, requester_employee_id,
				  receipt_idempotency_key, receipt_actor_fingerprint, receipt_command_fingerprint,
				  request_fingerprint, actor_kind, actor_user_id, actor_employee_id, transferred_at)
				 values ($1, 'duplicate-position', 'human', 'legacy', 'absence', $2, 0,
				  $3, $4, $5, 'dup', 'v1', 'v1', 'v1', 'user', $6, $7, now())`,
				[
					ids.organization,
					requestId,
					ids.backup,
					ids.manager,
					ids.requester,
					ids.adminUser,
					ids.admin,
				],
			),
		).rejects.toThrow(/approvalEscalationTransfer_org_legacy_source_idx/);
		await expect(
			admin.query("update approval_escalation_transfer set reason = 'x' where id = $1", [
				transfer.id,
			]),
		).rejects.toThrow(/immutable/);
	});
});
