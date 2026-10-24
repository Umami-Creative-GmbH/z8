import { sql } from "drizzle-orm";
import type { ApprovalStageReviewerDirectory } from "@/lib/approvals/routing/approver-resolver";
import {
	loadApprovalStageDirectory,
	resolveStageReviewersWithout,
} from "@/lib/approvals/routing/stage-activation-resolver";
import type { ApprovalRoutingContext } from "@/lib/approvals/routing/types";
import type { JsonObject } from "@/lib/approvals/workflow/ports";
import { AuditAction } from "@/lib/audit-logger";
import { captureDeactivationHandoverDuties } from "../approval-handover";
import { FUTURE_STAGE_REVIEW_REASON } from "../review-reasons";
import {
	type ApprovalDutiesApplied,
	type ApprovalDutiesPlan,
	type AreaApplyResult,
	type DeactivationApplyContext,
	type DeactivationPlanContext,
	type DeactivationReader,
	type DeactivationWriter,
	deactivationAuditMetadata,
} from "./types";

/** Reason of a legacy-only duty, as the departure's handover records it. */
const LEGACY_AUTHORITY_REASON = "legacy_authority";

type CurrentStageDuty = {
	assignment_id: string;
	workflow_id: string;
	stage_id: string;
	requester_employee_id: string | null;
	workflow_type: ApprovalRoutingContext["workflowType"];
	source_type: string;
	source_id: string;
	policy_kind: string | null;
	resolver_snapshot: JsonObject;
	pending_approver_ids: string[];
};

/**
 * The approval duties the person holds, planned with the predicates the
 * capture applies (#1440, Organization ADR 0006):
 *
 * - a pending duty in the current human stage of a pending workflow is handed
 *   over to the replacement chosen for that requester, otherwise to the stage's
 *   reviewers re-resolved without the person (D2: their other manager, the
 *   organization admins, …), otherwise nobody, which the worker turns into an
 *   *Approval duties need a replacement* review;
 * - a waiting stage naming only the person with a `fail` fallback, whose
 *   requester has no replacement, becomes a review now, because stage
 *   activation could not route it;
 * - a pending legacy-only approval request becomes a review.
 *
 * Requests the person submitted are not duties and stay decidable. Read-only.
 *
 * `replacements` are only the picks the manager links validated
 * (`validatedReplacementManagers`): a pick for a requester who keeps another
 * manager, or who isn't the person's report, never decides a target.
 */
export async function planApprovalDuties(
	reader: Pick<DeactivationReader, "execute">,
	ctx: DeactivationPlanContext,
	replacements: Readonly<Record<string, string>>,
): Promise<ApprovalDutiesPlan> {
	const duties = await reader.execute<CurrentStageDuty>(sql`
		SELECT a.id AS assignment_id, a.workflow_id, a.stage_id, w.requester_employee_id,
			w.workflow_type, w.source_type, w.source_id, w.policy_snapshot->>'kind' AS policy_kind,
			s.resolver_snapshot,
			coalesce((
				SELECT json_agg(other.approver_employee_id)
				FROM approval_stage_assignment other
				WHERE other.organization_id = a.organization_id AND other.stage_id = a.stage_id
					AND other.status = 'pending'
			), '[]'::json) AS pending_approver_ids
		FROM approval_stage_assignment a
		JOIN approval_workflow_stage s
			ON s.id = a.stage_id AND s.organization_id = a.organization_id
		JOIN approval_workflow w
			ON w.id = a.workflow_id AND w.organization_id = a.organization_id
		WHERE a.organization_id = ${ctx.organizationId}
			AND a.approver_employee_id = ${ctx.employeeId}::uuid AND a.status = 'pending'
			AND w.status = 'pending' AND s.status = 'pending' AND s.activation_mode = 'human'
			AND s.stage_order = w.current_stage_order
		ORDER BY w.submitted_at, a.id
	`);

	// The organization's directory, the same for every duty: the person's own
	// replacement is the requester's validated pick, already consulted.
	let directory: ApprovalStageReviewerDirectory | null = null;
	const handovers: ApprovalDutiesPlan["handovers"] = [];
	for (const duty of duties.rows) {
		const requesterEmployeeId = duty.requester_employee_id;
		let targetEmployeeId: string | null = null;
		if (requesterEmployeeId) {
			targetEmployeeId = replacements[requesterEmployeeId] ?? null;
			if (targetEmployeeId === null) {
				directory ??= await loadApprovalStageDirectory(reader, {
					organizationId: ctx.organizationId,
					namedApproverId: null,
				});
				const reviewers = resolveStageReviewersWithout({
					directory,
					employeeId: ctx.employeeId,
					workflow: {
						id: duty.workflow_id,
						organizationId: ctx.organizationId,
						workflowType: duty.workflow_type,
						sourceType: duty.source_type,
						sourceId: duty.source_id,
						requesterEmployeeId,
						policyKind: duty.policy_kind,
					},
					resolverSnapshot: duty.resolver_snapshot,
				});
				// One reviewer takes the duty over; never someone already deciding this stage.
				targetEmployeeId =
					reviewers.find(
						(id) => id !== requesterEmployeeId && !duty.pending_approver_ids.includes(id),
					) ?? null;
			}
		}
		handovers.push({
			assignmentId: duty.assignment_id,
			workflowId: duty.workflow_id,
			stageId: duty.stage_id,
			requesterEmployeeId,
			targetEmployeeId,
		});
	}

	const futureStages = await reader.execute<{
		stage_id: string;
		workflow_id: string;
		requester_employee_id: string | null;
	}>(sql`
		SELECT s.id AS stage_id, s.workflow_id, w.requester_employee_id
		FROM approval_workflow_stage s
		JOIN approval_workflow w
			ON w.id = s.workflow_id AND w.organization_id = s.organization_id
		WHERE s.organization_id = ${ctx.organizationId}
			AND w.status = 'pending' AND s.status = 'waiting'
			AND s.resolver_snapshot->>'approverType' = 'specific_employee'
			AND s.resolver_snapshot->>'approverEmployeeId' = ${ctx.employeeId}
			AND s.resolver_snapshot->>'fallbackBehavior' = 'fail'
		ORDER BY w.submitted_at, s.stage_order, s.id
	`);
	const legacy = await reader.execute<{ id: string }>(sql`
		SELECT r.id
		FROM approval_request r
		WHERE r.organization_id = ${ctx.organizationId}
			AND r.approver_id = ${ctx.employeeId}::uuid AND r.status = 'pending'
			AND NOT EXISTS (
				SELECT 1 FROM approval_workflow_stage s
				WHERE s.organization_id = r.organization_id AND s.legacy_approval_request_id = r.id
			)
		ORDER BY r.created_at, r.id
	`);

	return {
		handovers,
		reviews: [
			// Stage activation routes a stage whose requester has a replacement to it.
			...futureStages.rows
				.filter(
					(stage) =>
						!stage.requester_employee_id || !replacements[stage.requester_employee_id],
				)
				.map((stage) => ({
					workflowId: stage.workflow_id,
					stageId: stage.stage_id,
					approvalRequestId: null,
					reason: FUTURE_STAGE_REVIEW_REASON,
				})),
			...legacy.rows.map((request) => ({
				workflowId: null,
				stageId: null,
				approvalRequestId: request.id,
				reason: LEGACY_AUTHORITY_REASON,
			})),
		],
	};
}

/**
 * Captures the planned duties in the deactivation transaction as handover
 * tasks and reviews anchored to the deactivation. The worker delivers the
 * tasks after the commit through the departure's handover handler, so nothing
 * runs after commit here. Each task and review is audited under the acting
 * admin (`approval_duty.handed_over` / `approval_duty.review_raised`, target
 * `deactivation_follow_up`); the transfer itself is recorded in the approval
 * workflow with the deactivation's lineage. A departure's capture writes no
 * audit row, as before.
 */
export async function applyApprovalDuties(
	tx: Pick<DeactivationWriter, "execute" | "insert">,
	ctx: DeactivationApplyContext,
	plan: ApprovalDutiesPlan,
): Promise<AreaApplyResult<ApprovalDutiesApplied>> {
	if (plan.handovers.length === 0 && plan.reviews.length === 0) {
		return { applied: { handoverTaskIds: [], reviewIds: [] }, afterCommit: [] };
	}
	// Tasks and reviews belong to an employment period. An employee who is
	// still active always has one (resolveCurrentEmploymentPeriod backfills a
	// legacy period), so a missing period here is an invariant violation.
	if (!ctx.employmentPeriodId) {
		throw new Error("Approval duties need the employment period of the deactivated employee");
	}
	const captured = await captureDeactivationHandoverDuties(
		tx,
		{
			organizationId: ctx.organizationId,
			employeeId: ctx.employeeId,
			employmentPeriodId: ctx.employmentPeriodId,
			deactivationId: ctx.deactivationId,
		},
		{
			handovers: plan.handovers.map((handover) => ({
				assignmentId: handover.assignmentId,
				targetEmployeeId: handover.targetEmployeeId,
			})),
			futureStageIds: plan.reviews.flatMap((review) => (review.stageId ? [review.stageId] : [])),
			legacyRequestIds: plan.reviews.flatMap((review) =>
				review.approvalRequestId ? [review.approvalRequestId] : [],
			),
		},
	);
	for (const handover of captured.handovers) {
		await ctx.audit.record(tx, {
			organizationId: ctx.organizationId,
			action: AuditAction.APPROVAL_DUTY_HANDED_OVER,
			actorUserId: ctx.actorUserId,
			targetType: "deactivation_follow_up",
			targetId: handover.taskId,
			employeeId: ctx.employeeId,
			metadata: {
				...deactivationAuditMetadata(ctx),
				assignmentId: handover.assignmentId,
				workflowId: handover.workflowId,
				// Null: no target, so the worker raises a review on delivery.
				targetEmployeeId: handover.targetEmployeeId,
			},
		});
	}
	for (const review of captured.reviews) {
		await ctx.audit.record(tx, {
			organizationId: ctx.organizationId,
			action: AuditAction.APPROVAL_DUTY_REVIEW_RAISED,
			actorUserId: ctx.actorUserId,
			targetType: "deactivation_follow_up",
			targetId: review.reviewId,
			employeeId: ctx.employeeId,
			metadata: {
				...deactivationAuditMetadata(ctx),
				subjectId: review.subjectId,
				reviewReason: review.reason,
			},
		});
	}
	return {
		applied: {
			handoverTaskIds: captured.handovers.map((handover) => handover.taskId),
			reviewIds: captured.reviews.map((review) => review.reviewId),
		},
		afterCommit: [],
	};
}
