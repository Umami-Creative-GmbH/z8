import "server-only";

import { and, eq } from "drizzle-orm";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import type { db } from "@/db";
import { approvalRequest, approvalStageAssignment, approvalWorkflow, employee } from "@/db/schema";
import type { DecisionRight } from "@/lib/approvals/decision-right";
import {
	getEligibleManagerIdsForRequester,
	isEligibleManagerForApprovalRequest,
} from "@/lib/approvals/policies/manager-eligibility-db";
import { decideTimeApproval } from "@/lib/approvals/server/time-approval-decision";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { hasOrganizationRole } from "@/lib/auth/organization-role";

/**
 * On-behalf time corrections (#507): a manager, admin or owner edits or
 * deletes another employee's completed work. The change is submitted as the
 * owner's time correction, so the owner's configured approval chain decides it.
 * The editor never bypasses that chain; they only decide a stage they are an
 * approver of, exactly as they could from the approvals inbox.
 */

type ReadDb = Pick<typeof db, "query">;

export type OnBehalfCorrectionAuthority = "organization_admin" | "eligible_manager";

/**
 * Who may change another employee's time entries: organization admins/owners,
 * and the owner's eligible managers (direct manager links and team managers).
 */
export async function resolveOnBehalfCorrectionAuthority(input: {
	db: ReadDb;
	organizationId: string;
	actorEmployeeId: string;
	actorMemberRole: string | null | undefined;
	ownerEmployeeId: string;
}): Promise<OnBehalfCorrectionAuthority | null> {
	if (input.actorEmployeeId === input.ownerEmployeeId) return null;
	if (
		hasOrganizationRole(input.actorMemberRole, "owner") ||
		hasOrganizationRole(input.actorMemberRole, "admin")
	) {
		return "organization_admin";
	}
	const managerIds = await getEligibleManagerIdsForRequester({
		db: input.db as never,
		requesterEmployeeId: input.ownerEmployeeId,
		organizationId: input.organizationId,
	});
	return managerIds.includes(input.actorEmployeeId) ? "eligible_manager" : null;
}

/** What the editor claims for the correction's current stage: one approval and one right. */
export interface EditorDecisionClaim {
	approvalId: string;
	right: DecisionRight;
}

/**
 * The right the editor holds for the correction's current stage: the legacy
 * request's approver, else one of its eligible managers; or the holder of a
 * pending canonical assignment. Manager of approvals is never claimed; an
 * organization admin who is not a configured approver leaves the change to
 * the chain.
 */
export async function resolveEditorDecisionClaim(input: {
	db: ReadDb;
	organizationId: string;
	workPeriodId: string;
	approvalRequestId: string;
	editorEmployeeId: string;
}): Promise<EditorDecisionClaim | null> {
	const legacy = await input.db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalRequestId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.entityId, input.workPeriodId),
			eq(approvalRequest.status, "pending"),
		),
		columns: { id: true, approverId: true },
	});
	if (legacy) {
		if (legacy.approverId === input.editorEmployeeId) {
			return { approvalId: legacy.id, right: { as: "approver" } };
		}
		const eligible = await isEligibleManagerForApprovalRequest({
			db: input.db as never,
			approvalRequestId: legacy.id,
			managerEmployeeId: input.editorEmployeeId,
			organizationId: input.organizationId,
		});
		return eligible ? { approvalId: legacy.id, right: { as: "eligible_manager" } } : null;
	}

	const workflow = await input.db.query.approvalWorkflow.findFirst({
		where: and(
			eq(approvalWorkflow.organizationId, input.organizationId),
			eq(approvalWorkflow.workflowType, "time_correction"),
			eq(approvalWorkflow.sourceType, "time_entry"),
			eq(approvalWorkflow.sourceId, input.workPeriodId),
			eq(approvalWorkflow.status, "pending"),
		),
		columns: { id: true },
	});
	if (!workflow) return null;
	const assignment = await input.db.query.approvalStageAssignment.findFirst({
		where: and(
			eq(approvalStageAssignment.organizationId, input.organizationId),
			eq(approvalStageAssignment.workflowId, workflow.id),
			eq(approvalStageAssignment.approverEmployeeId, input.editorEmployeeId),
			eq(approvalStageAssignment.status, "pending"),
		),
		columns: { id: true },
	});
	return assignment ? { approvalId: assignment.id, right: { as: "approver" } } : null;
}

/**
 * After an on-behalf submission committed pending, the editor decides the
 * stage they are an approver of through the time approval decision, under the
 * one right they hold for it. A later chain stage stays pending for its own
 * approver. A refused or failed decision leaves the correction pending in the
 * editor's inbox; the submission stands.
 */
export async function approveOnBehalfCorrectionAsEditor(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	approvalRequestId: string;
	editorEmployeeId: string;
}): Promise<"approved" | "pending"> {
	const readDb = input.dbService.db as unknown as ReadDb;
	try {
		const claim = await resolveEditorDecisionClaim({
			db: readDb,
			organizationId: input.organizationId,
			workPeriodId: input.workPeriodId,
			approvalRequestId: input.approvalRequestId,
			editorEmployeeId: input.editorEmployeeId,
		});
		if (!claim) return "pending";

		const editor = await readDb.query.employee.findFirst({
			where: and(
				eq(employee.id, input.editorEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
			columns: { id: true, userId: true },
		});
		if (!editor) return "pending";

		const result = await decideTimeApproval({
			organizationId: input.organizationId,
			approvalId: claim.approvalId,
			actor: { employeeId: editor.id, userId: editor.userId },
			right: claim.right,
			decision: { kind: "approve" },
			database: input.dbService.db,
		});
		if (result.status === "refused") {
			logger.warn(
				{
					reason: result.reason,
					right: claim.right.as,
					workPeriodId: input.workPeriodId,
					approvalId: claim.approvalId,
				},
				"On-behalf time correction stayed pending: editor decision refused",
			);
			return "pending";
		}
		return result.outcome === "approved" ? "approved" : "pending";
	} catch (error) {
		logger.error(
			{ error, workPeriodId: input.workPeriodId, approvalRequestId: input.approvalRequestId },
			"On-behalf time correction stayed pending: editor approval failed",
		);
		return "pending";
	}
}
