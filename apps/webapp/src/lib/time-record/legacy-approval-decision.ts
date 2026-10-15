/**
 * The decision a legacy approval request becomes on a canonical record: shared
 * by the absence backfill and work records' attach (#1224), so the same request
 * always maps to the same decision. Pure, no I/O.
 */
export type LegacyApprovalRequestFacts = {
	status: "pending" | "approved" | "rejected";
	requestedBy: string;
	approverId: string;
	reason: string | null;
	rejectionReason: string | null;
	approvedAt: Date | null;
	createdAt: Date;
};

export type LegacyApprovalDecision = {
	actorEmployeeId: string;
	action: "submitted" | "approved" | "rejected";
	reason: string | null;
	createdAt: Date;
};

export function legacyApprovalDecision(
	request: LegacyApprovalRequestFacts,
): LegacyApprovalDecision {
	return {
		actorEmployeeId: request.status === "pending" ? request.requestedBy : request.approverId,
		action: request.status === "pending" ? "submitted" : request.status,
		reason: request.rejectionReason ?? request.reason,
		createdAt: request.approvedAt ?? request.createdAt,
	};
}
