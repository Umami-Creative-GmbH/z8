import "server-only";

import { and, eq } from "drizzle-orm";
import { approvalRequest, approvalWorkflow, type workPeriod } from "@/db/schema";
import { ConflictError } from "@/lib/effect/errors";
import type { WorkTransactionScope } from "./work-transaction";

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

/** Whether an error is this guard's refusal. */
export function isUnresolvedWorkPeriodReview(error: unknown): error is ConflictError {
	return (
		error instanceof ConflictError &&
		(error.conflictType === "work_period_pending_approval" ||
			error.conflictType === "pending_time_correction_approval")
	);
}
