import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { approvalRequest, approvalWorkflow, type workPeriod } from "@/db/schema";
import { ConflictError } from "@/lib/effect/errors";
import type { WorkTransactionClient, WorkTransactionScope } from "./work-transaction";

/**
 * Structural changes to a work period wait while an ordinary approval or a time
 * correction for it is unresolved (#256): an amendment (#286) or a break that
 * splits active work (#281) must not change the facts under review.
 */
export async function assertNoUnresolvedWorkPeriodReview(
	tx: WorkTransactionScope["db"],
	organizationId: string,
	period: Pick<typeof workPeriod.$inferSelect, "id" | "approvalStatus">,
) {
	if (period.approvalStatus === "pending") {
		throw new ConflictError({
			message: "This work period is awaiting approval and cannot be edited",
			conflictType: "work_period_pending_approval",
		});
	}
	const [legacyPending, canonicalPending] = await Promise.all([
		tx
			.select({ id: approvalRequest.id })
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.organizationId, organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, period.id),
					eq(approvalRequest.status, "pending"),
				),
			)
			.limit(1),
		tx
			.select({ id: approvalWorkflow.id })
			.from(approvalWorkflow)
			.where(
				and(
					eq(approvalWorkflow.organizationId, organizationId),
					eq(approvalWorkflow.workflowType, "time_correction"),
					eq(approvalWorkflow.sourceType, "time_entry"),
					eq(approvalWorkflow.sourceId, period.id),
					eq(approvalWorkflow.status, "pending"),
				),
			)
			.limit(1),
	]);
	if (legacyPending.length > 0 || canonicalPending.length > 0) {
		throw new ConflictError({
			message: "A time correction approval is already pending for this work period",
			conflictType: "pending_time_correction_approval",
		});
	}
}

/**
 * The exact approval lifecycle whose own terminal transition a policy clock-out
 * break split resolves (#256 §7, #303). Built by the terminal finalizer from the
 * lifecycle it verified, never from a caller flag.
 */
export interface ResolvingWorkPeriodReview {
	readonly workPeriodId: string;
	readonly employeeId: string;
	readonly workflowType: "policy_clock_out";
	/**
	 * The workflow bound to the period for this lifecycle: the canonical authority,
	 * or the shadow mirror a legacy lifecycle is observed through.
	 */
	readonly workflowId: string | null;
	/** The resolving legacy request; null when the canonical workflow is the authority. */
	readonly approvalRequestId: string | null;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
	const rows = (result as { rows?: unknown } | null)?.rows;
	if (!Array.isArray(rows)) throw new Error("Work period review guard read failed");
	return rows as Record<string, unknown>[];
}

/**
 * The unresolved-review guard for a terminal break split. Only the resolving
 * lifecycle is exempt: its bound workflow and that workflow's legacy
 * compatibility mirror rows, or its legacy request. Any other pending ordinary
 * approval or time correction for the period still blocks the split. The
 * resolving identities are verified against the period and its owner first; a
 * mismatch is an integrity failure, not an exemption. The caller holds the
 * period row lock.
 */
export async function assertNoUnrelatedWorkPeriodReview(
	tx: Pick<WorkTransactionClient, "execute">,
	organizationId: string,
	resolving: ResolvingWorkPeriodReview,
) {
	const workflowId = resolving.workflowId;
	const approvalRequestId = resolving.approvalRequestId;
	if (!workflowId && !approvalRequestId) {
		throw new Error("Terminal split has no resolving approval lifecycle");
	}
	const result = await tx.execute(sql`
		select
			(${workflowId}::uuid is null or exists (
				select 1 from approval_workflow workflow
				where workflow.id = ${workflowId}::uuid
					and workflow.organization_id = ${organizationId}
					and workflow.workflow_type = ${resolving.workflowType}
					and workflow.source_type = 'time_entry'
					and workflow.source_id = ${resolving.workPeriodId}::uuid
					and workflow.requester_employee_id = ${resolving.employeeId}::uuid
			)) as "workflowMatches",
			(${approvalRequestId}::uuid is null or exists (
				select 1 from approval_request request
				where request.id = ${approvalRequestId}::uuid
					and request.organization_id = ${organizationId}
					and request.entity_type = 'time_entry'
					and request.entity_id = ${resolving.workPeriodId}::uuid
					and request.requested_by = ${resolving.employeeId}::uuid
			)) as "requestMatches",
			exists (
				select 1 from approval_request request
				where request.organization_id = ${organizationId}
					and request.entity_type = 'time_entry'
					and request.entity_id = ${resolving.workPeriodId}::uuid
					and request.status = 'pending'
					and request.id is distinct from ${approvalRequestId}::uuid
					and not exists (
						select 1 from approval_workflow_stage stage
						where stage.organization_id = request.organization_id
							and stage.workflow_id = ${workflowId}::uuid
							and stage.legacy_approval_request_id = request.id
					)
			) as "legacyPending",
			exists (
				select 1 from approval_workflow workflow
				where workflow.organization_id = ${organizationId}
					and workflow.source_type = 'time_entry'
					and workflow.source_id = ${resolving.workPeriodId}::uuid
					and workflow.status = 'pending'
					and workflow.id is distinct from ${workflowId}::uuid
			) as "canonicalPending"
	`);
	const [row] = rowsOf(result);
	if (row?.workflowMatches !== true || row.requestMatches !== true) {
		throw new Error("Terminal split resolving lifecycle does not match its period");
	}
	if (row.legacyPending !== false || row.canonicalPending !== false) {
		throw new ConflictError({
			message: "Another approval for this work period is still pending",
			conflictType: "work_period_pending_approval",
		});
	}
}

/** Whether an error is this guard's refusal. */
export function isUnresolvedWorkPeriodReview(error: unknown): error is ConflictError {
	return (
		error instanceof ConflictError &&
		(error.conflictType === "work_period_pending_approval" ||
			error.conflictType === "pending_time_correction_approval")
	);
}
