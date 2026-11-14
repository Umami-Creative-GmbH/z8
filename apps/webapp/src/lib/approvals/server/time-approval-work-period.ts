import { and, eq } from "drizzle-orm";
import { approvalRequest, approvalStageAssignment, approvalWorkflow } from "@/db/schema";
import type { ApprovalDatabase } from "./types";

/**
 * Whether a time approval (a legacy request id or a canonical assignment id)
 * is about the given work period, within the organization. For callers that
 * show one work period and decide its approval by id (#1678).
 */
export async function isTimeApprovalAboutWorkPeriod(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string; workPeriodId: string },
): Promise<boolean> {
	const request = await database.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
		),
		columns: { entityId: true },
	});
	if (request) return request.entityId === input.workPeriodId;
	const [assignment] = await database
		.select({ sourceId: approvalWorkflow.sourceId })
		.from(approvalStageAssignment)
		.innerJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.sourceType, "time_entry"),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.id, input.approvalId),
				eq(approvalStageAssignment.organizationId, input.organizationId),
			),
		)
		.limit(1);
	return assignment?.sourceId === input.workPeriodId;
}
