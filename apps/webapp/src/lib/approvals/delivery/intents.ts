import { sql } from "drizzle-orm";
import type { ApprovalDeliveryIntentEvent } from "@/db/schema";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalWorkflowType } from "../workflow/ports";

/**
 * Writes the lifecycle intent of a legacy-authoritative submission or decision
 * (#296) in the caller's transaction, the counterpart of a canonical workflow's
 * outbox row. Only kinds with a delivery control get one: without a control no
 * card is owned, and nothing accumulates. Returns whether an intent was written
 * (the caller then kicks the owner after commit).
 */
export async function recordLegacyDeliveryIntent(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflowType: ApprovalWorkflowType;
		sourceType: string;
		sourceId: string;
		approvalRequestId: string;
		event: ApprovalDeliveryIntentEvent;
	},
): Promise<boolean> {
	const result = await database.execute(sql`
		insert into approval_delivery_intent (
			organization_id, workflow_type, source_type, source_id,
			legacy_approval_request_id, event
		)
		select ${input.organizationId}, ${input.workflowType}::approval_workflow_type,
			${input.sourceType}, ${input.sourceId}::uuid,
			${input.approvalRequestId}::uuid, ${input.event}
		where exists (
			select 1 from approval_delivery_control c
			where c.organization_id = ${input.organizationId}
				and c.workflow_type = ${input.workflowType}::approval_workflow_type
		)
		returning id
	`);
	const rows =
		result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
			? result.rows
			: [];
	return rows.length > 0;
}
