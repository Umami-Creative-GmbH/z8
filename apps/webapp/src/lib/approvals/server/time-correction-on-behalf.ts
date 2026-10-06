import "server-only";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import type { db } from "@/db";
import { approvalRequest, approvalStageAssignment, approvalWorkflow, employee } from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import {
	getEligibleManagerIdsForRequester,
	isEligibleManagerForApprovalRequest,
} from "@/lib/approvals/policies/manager-eligibility-db";
import { decideTimeCorrectionWithStableTargetEffect } from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";

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

/** Whether the work period still has a pending time correction in either lifecycle. */
export async function hasPendingTimeCorrectionForWorkPeriod(input: {
	db: ReadDb;
	organizationId: string;
	workPeriodId: string;
}): Promise<boolean> {
	const [legacyPending, canonicalPending] = await Promise.all([
		input.db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.workPeriodId),
				eq(approvalRequest.status, "pending"),
			),
			columns: { id: true },
		}),
		input.db.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.workflowType, "time_correction"),
				eq(approvalWorkflow.sourceType, "time_entry"),
				eq(approvalWorkflow.sourceId, input.workPeriodId),
				eq(approvalWorkflow.status, "pending"),
			),
			columns: { id: true },
		}),
	]);
	return Boolean(legacyPending || canonicalPending);
}

/**
 * Whether the editor is an approver of the correction's current stage: the
 * legacy request's approver or one of its eligible managers, or a pending
 * canonical assignment. Organization-wide approval rights do not count here;
 * an admin who is not a configured approver leaves the change to the chain.
 */
export async function isEditorCurrentCorrectionApprover(input: {
	db: ReadDb;
	organizationId: string;
	workPeriodId: string;
	approvalRequestId: string;
	editorEmployeeId: string;
}): Promise<boolean> {
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
		if (legacy.approverId === input.editorEmployeeId) return true;
		return isEligibleManagerForApprovalRequest({
			db: input.db as never,
			approvalRequestId: legacy.id,
			managerEmployeeId: input.editorEmployeeId,
			organizationId: input.organizationId,
		});
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
	if (!workflow) return false;
	const assignment = await input.db.query.approvalStageAssignment.findFirst({
		where: and(
			eq(approvalStageAssignment.organizationId, input.organizationId),
			eq(approvalStageAssignment.workflowId, workflow.id),
			eq(approvalStageAssignment.approverEmployeeId, input.editorEmployeeId),
			eq(approvalStageAssignment.status, "pending"),
		),
		columns: { id: true },
	});
	return Boolean(assignment);
}

/**
 * After an on-behalf submission committed pending, the editor decides the
 * stage they are an approver of, through the ordinary approval decision. A
 * later chain stage stays pending for its own approver. A failed decision
 * leaves the request pending in the editor's inbox; the submission stands.
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
		const isApprover = await isEditorCurrentCorrectionApprover({
			db: readDb,
			organizationId: input.organizationId,
			workPeriodId: input.workPeriodId,
			approvalRequestId: input.approvalRequestId,
			editorEmployeeId: input.editorEmployeeId,
		});
		if (!isApprover) return "pending";

		const editor = await readDb.query.employee.findFirst({
			where: and(
				eq(employee.id, input.editorEmployeeId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
			with: { user: true },
		});
		if (!editor) return "pending";

		await Effect.runPromise(
			decideTimeCorrectionWithStableTargetEffect(
				input.dbService,
				editor as Parameters<typeof decideTimeCorrectionWithStableTargetEffect>[1],
				input.approvalRequestId,
				"approve",
			),
		);
	} catch (error) {
		logger.error(
			{ error, workPeriodId: input.workPeriodId, approvalRequestId: input.approvalRequestId },
			"On-behalf time correction stayed pending: editor approval failed",
		);
		return "pending";
	}

	const stillPending = await hasPendingTimeCorrectionForWorkPeriod({
		db: readDb,
		organizationId: input.organizationId,
		workPeriodId: input.workPeriodId,
	});
	return stillPending ? "pending" : "approved";
}
