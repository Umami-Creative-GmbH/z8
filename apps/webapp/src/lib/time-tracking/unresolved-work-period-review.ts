import { type SQL, sql } from "drizzle-orm";
import { approvalRequest, approvalWorkflow } from "@/db/schema";

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
 *
 * The `work_period` columns are qualified by hand: selected without a join,
 * Drizzle renders `${workPeriod.id}` as a bare "id", which binds to the
 * subquery's own table (#1073).
 */
export function unresolvedWorkPeriodReviewSql(): SQL<boolean> {
	return sql<boolean>`(
		"work_period"."approval_status" = 'pending'
		or exists (
			select 1 from ${approvalRequest}
			where ${approvalRequest.organizationId} = "work_period"."organization_id"
				and ${approvalRequest.entityType} = 'time_entry'
				and ${approvalRequest.entityId} = "work_period"."id"
				and ${approvalRequest.status} = 'pending'
		)
		or exists (
			select 1 from ${approvalWorkflow}
			where ${approvalWorkflow.organizationId} = "work_period"."organization_id"
				and ${approvalWorkflow.sourceType} = 'time_entry'
				and ${approvalWorkflow.sourceId} = "work_period"."id"
				and ${approvalWorkflow.status} = 'pending'
		)
	)`;
}
