import { type SQL, sql } from "drizzle-orm";
import { approvalRequest, approvalWorkflow, workPeriod } from "@/db/schema";

/**
 * The set-based form of `assertNoUnresolvedWorkPeriodReview`
 * (`work-period-review.ts`): a work period has an unresolved review while it is
 * `pending` itself, or a pending legacy approval request or a pending canonical
 * approval workflow of any type exists for it. Billable Time reports count such
 * work ("pending correction or submission", #902), and the hand-off holds it
 * back (#903).
 *
 * A boolean SQL expression over the `work_period` row in scope of the query:
 * select it as a column or use it as a condition. Keep it in step with the
 * guard.
 */
export function unresolvedWorkPeriodReviewSql(): SQL<boolean> {
	return sql<boolean>`(
		${workPeriod.approvalStatus} = 'pending'
		or exists (
			select 1 from ${approvalRequest}
			where ${approvalRequest.organizationId} = ${workPeriod.organizationId}
				and ${approvalRequest.entityType} = 'time_entry'
				and ${approvalRequest.entityId} = ${workPeriod.id}
				and ${approvalRequest.status} = 'pending'
		)
		or exists (
			select 1 from ${approvalWorkflow}
			where ${approvalWorkflow.organizationId} = ${workPeriod.organizationId}
				and ${approvalWorkflow.sourceType} = 'time_entry'
				and ${approvalWorkflow.sourceId} = ${workPeriod.id}
				and ${approvalWorkflow.status} = 'pending'
		)
	)`;
}
