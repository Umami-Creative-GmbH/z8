import { and, eq } from "drizzle-orm";
import { approvalRequest, approvalStageAssignment, approvalWorkflow } from "@/db/schema";
import type { ApprovalDatabase } from "./types";

/**
 * A time approval by its id: a legacy request about a work period, else a
 * canonical assignment of a time-entry workflow. Every read is
 * organization-scoped; a workflow id is never a target.
 */
export type TimeApprovalTarget =
	| { authority: "legacy"; request: typeof approvalRequest.$inferSelect }
	| {
			authority: "canonical";
			assignment: {
				workflowId: string;
				stageId: string;
				approverEmployeeId: string;
				status: string;
			};
			workflow: { workflowType: string; sourceId: string; status: string };
	  };

export async function findTimeApprovalTarget(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string },
): Promise<TimeApprovalTarget | null> {
	const request = await database.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, input.approvalId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
		),
	});
	if (request) return { authority: "legacy", request };
	const [row] = await database
		.select({
			workflowId: approvalStageAssignment.workflowId,
			stageId: approvalStageAssignment.stageId,
			approverEmployeeId: approvalStageAssignment.approverEmployeeId,
			assignmentStatus: approvalStageAssignment.status,
			workflowType: approvalWorkflow.workflowType,
			sourceId: approvalWorkflow.sourceId,
			workflowStatus: approvalWorkflow.status,
		})
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
	if (!row) return null;
	return {
		authority: "canonical",
		assignment: {
			workflowId: row.workflowId,
			stageId: row.stageId,
			approverEmployeeId: row.approverEmployeeId,
			status: row.assignmentStatus,
		},
		workflow: {
			workflowType: row.workflowType,
			sourceId: row.sourceId,
			status: row.workflowStatus,
		},
	};
}

/**
 * Whether a time approval (a legacy request id or a canonical assignment id)
 * is about the given work period, within the organization. For callers that
 * show one work period and decide its approval by id (#1678).
 */
export async function isTimeApprovalAboutWorkPeriod(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string; workPeriodId: string },
): Promise<boolean> {
	const target = await findTimeApprovalTarget(database, input);
	if (!target) return false;
	return target.authority === "legacy"
		? target.request.entityId === input.workPeriodId
		: target.workflow.sourceId === input.workPeriodId;
}
