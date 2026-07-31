import type { Instant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalWorkflowStatus,
	ApprovalWorkflowType,
	JsonObject,
} from "../workflow/ports";

export interface ApprovalActiveInboxStageProjection {
	stageId: string;
	stageOrder: number;
}

export interface ApprovalProjectionWriteInput {
	organizationId: string;
	workflowId: string;
	workflowType: ApprovalWorkflowType;
	sourceType: string;
	sourceId: string;
	status: ApprovalWorkflowStatus;
	currentStageOrder: number | null;
	requesterEmployeeId: string | null;
	displayPayload: JsonObject;
	searchText: string;
	activeInboxStage: ApprovalActiveInboxStageProjection | null;
	updatedAt: Instant;
}
