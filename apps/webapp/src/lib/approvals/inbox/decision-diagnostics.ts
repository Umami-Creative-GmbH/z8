import type { PersistedApprovalRequestForDecision } from "./decision-service";

export type ApprovalDecisionDiagnosticStage =
	| "route"
	| "authentication"
	| "authorization"
	| "actor_lookup"
	| "target_lookup"
	| "target_authorization"
	| "decision";

type ApprovalDecisionDiagnosticTarget = Pick<
	PersistedApprovalRequestForDecision,
	"entityType" | "status" | "targetType" | "workflowKind"
>;

function errorProperty(error: unknown, property: "_tag" | "code") {
	if (!error || typeof error !== "object" || !(property in error)) return null;
	const value = (error as Record<string, unknown>)[property];
	return typeof value === "string" ? value : null;
}

function normalizedError(error: unknown): Error {
	if (error instanceof Error) return error;
	if (
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return new Error(error.message, { cause: error });
	}
	return new Error("Unknown approval decision failure", { cause: error });
}

export function buildApprovalDecisionFailureLog(input: {
	error: unknown;
	action: "approve" | "reject";
	approvalId: string | null;
	decisionStage: ApprovalDecisionDiagnosticStage;
	target: ApprovalDecisionDiagnosticTarget | null;
}) {
	const errorTag = errorProperty(input.error, "_tag");
	const errorCode = errorProperty(input.error, "code");
	return {
		err: normalizedError(input.error),
		action: input.action,
		...(input.approvalId ? { approvalId: input.approvalId } : {}),
		decisionStage: input.decisionStage,
		...(input.target
			? {
					entityType: input.target.entityType,
					targetType: input.target.targetType,
					requestStatus: input.target.status,
					...(input.target.workflowKind
						? { workflowKind: input.target.workflowKind }
						: {}),
				}
			: {}),
		...(errorTag ? { errorTag } : {}),
		...(errorCode ? { errorCode } : {}),
	};
}
