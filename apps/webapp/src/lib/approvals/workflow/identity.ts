import { createHash } from "node:crypto";

const ALLOCATION_NAMESPACE = "z8:approval-workflow-allocation:v1";
const OBSERVATION_NAMESPACE = "z8:approval-workflow-observation:v1";
const TIME_CORRECTION_ROW_NAMESPACE = "z8:time-correction-row:v1";

interface WorkflowScopedIdentityInput {
	organizationId: string;
	workflowId: string;
	allocationKey: string;
}

export interface ApprovalChildIdentityInput
	extends WorkflowScopedIdentityInput {
	entityKind: "stage" | "assignment" | "event";
}

export interface TimeCorrectionRowIdentityInput {
	submissionKey: string;
	endpointType: "clock_in" | "clock_out";
}

interface SourceScopedIdentityInput {
	organizationId: string;
	workflowType: string;
	sourceType: string;
	sourceId: string;
	allocationKey: string;
}

function uuidFromDigest(value: string): string {
	const bytes = new Uint8Array(
		createHash("sha1").update(value).digest().subarray(0, 16),
	);
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveApprovalChildId(
	input: ApprovalChildIdentityInput,
): string {
	const namespace =
		input.entityKind === "stage" ? OBSERVATION_NAMESPACE : ALLOCATION_NAMESPACE;
	return uuidFromDigest(
		`${namespace}\0${input.organizationId}\0${input.workflowId}\0${input.entityKind}\0${input.allocationKey}`,
	);
}

export function deriveApprovalWorkflowId(
	input: SourceScopedIdentityInput,
): string {
	return uuidFromDigest(
		[
			OBSERVATION_NAMESPACE,
			input.organizationId,
			input.workflowType,
			input.sourceType,
			input.sourceId,
			"workflow",
			input.allocationKey,
		].join("\0"),
	);
}

export function deriveApprovalStageId(
	input: WorkflowScopedIdentityInput,
): string {
	return deriveApprovalChildId({ ...input, entityKind: "stage" });
}

export function deriveApprovalAssignmentId(
	input: WorkflowScopedIdentityInput,
): string {
	return deriveApprovalChildId({ ...input, entityKind: "assignment" });
}

export function deriveApprovalEventId(
	input: WorkflowScopedIdentityInput,
): string {
	return deriveApprovalChildId({ ...input, entityKind: "event" });
}

export function deriveTimeCorrectionRowId(
	input: TimeCorrectionRowIdentityInput,
): string {
	return uuidFromDigest(
		`${TIME_CORRECTION_ROW_NAMESPACE}\0${input.submissionKey}\0${input.endpointType}`,
	);
}
