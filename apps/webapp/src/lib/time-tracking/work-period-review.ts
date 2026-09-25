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
 * lifecycle it verified, never from a caller flag. Exactly one identity is set.
 */
export interface ResolvingWorkPeriodReview {
	readonly workPeriodId: string;
	readonly employeeId: string;
	readonly workflowType: "policy_clock_out";
	/** The canonical workflow that is the lifecycle's authority. */
	readonly workflowId: string | null;
	/** The legacy request that is the lifecycle's authority. */
	readonly approvalRequestId: string | null;
}

function rowsOf(result: unknown): Record<string, unknown>[] {
	const rows = (result as { rows?: unknown } | null)?.rows;
	if (!Array.isArray(rows)) throw new Error("Work period review guard read failed");
	return rows as Record<string, unknown>[];
}

/**
 * The unresolved-review guard for a terminal break split. Only the resolving
 * lifecycle is exempt, identified by linkage rather than by what the period is
 * bound to:
 *
 * - a canonical lifecycle: its workflow and the legacy compatibility rows its
 *   stages mirror;
 * - a legacy lifecycle: its request and any shadow mirror workflow of the same
 *   kind whose stage mirrors that request, with the other rows that mirror
 *   mirrors.
 *
 * Any other pending ordinary approval or time correction for the period, such
 * as an older cycle's workflow, still blocks the split. The authority's identity
 * is verified against the period and its owner first; a mismatch is an
 * integrity failure, not an exemption. The caller holds the period row lock.
 */
export async function assertNoUnrelatedWorkPeriodReview(
	tx: Pick<WorkTransactionClient, "execute">,
	organizationId: string,
	resolving: ResolvingWorkPeriodReview,
) {
	const workflowId = resolving.workflowId;
	const approvalRequestId = resolving.approvalRequestId;
	if ((workflowId === null) === (approvalRequestId === null)) {
		throw new Error("Terminal split needs exactly one resolving approval authority");
	}
	const result = await tx.execute(sql`
		with exempt_workflow as (
			select workflow.id
			from approval_workflow workflow
			where workflow.organization_id = ${organizationId}
				and workflow.workflow_type = ${resolving.workflowType}
				and workflow.source_type = 'time_entry'
				and workflow.source_id = ${resolving.workPeriodId}::uuid
				and workflow.requester_employee_id = ${resolving.employeeId}::uuid
				and (
					workflow.id = ${workflowId}::uuid
					or exists (
						select 1 from approval_workflow_stage stage
						where stage.organization_id = workflow.organization_id
							and stage.workflow_id = workflow.id
							and stage.legacy_approval_request_id = ${approvalRequestId}::uuid
					)
				)
		)
		select
			(${workflowId}::uuid is null
				or ${workflowId}::uuid in (select id from exempt_workflow)) as "workflowMatches",
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
							and stage.workflow_id in (select id from exempt_workflow)
							and stage.legacy_approval_request_id = request.id
					)
			) as "legacyPending",
			exists (
				select 1 from approval_workflow workflow
				where workflow.organization_id = ${organizationId}
					and workflow.source_type = 'time_entry'
					and workflow.source_id = ${resolving.workPeriodId}::uuid
					and workflow.status = 'pending'
					and workflow.id not in (select id from exempt_workflow)
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
