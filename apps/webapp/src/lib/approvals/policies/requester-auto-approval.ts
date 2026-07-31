export type LegacyStageDisposition =
	| { kind: "human"; approverEmployeeId: string }
	| { kind: "auto_approve"; reason: "requester_is_approver" };

export function classifyLegacyStage(input: {
	requesterEmployeeId: string;
	approverEmployeeId: string;
}): LegacyStageDisposition {
	return input.requesterEmployeeId === input.approverEmployeeId
		? { kind: "auto_approve", reason: "requester_is_approver" }
		: { kind: "human", approverEmployeeId: input.approverEmployeeId };
}
