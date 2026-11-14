import { isEligibleManagerForApprovalRequest } from "./manager-eligibility-db";

/**
 * The eligible-manager decision right (Approvals ADR 0003), as both approval
 * authorities verify it: the manager is eligible for the request's requester,
 * and escalation has not replaced the approver (#255 §4). Each authority
 * supplies its own record of a replacement: the legacy request's transfer, or
 * the canonical stage's lineage.
 */
export async function eligibleManagerRight(input: {
	db: Parameters<typeof isEligibleManagerForApprovalRequest>[0]["db"];
	organizationId: string;
	approvalRequestId: string;
	managerEmployeeId: string;
	replacedByEscalation: () => boolean | Promise<boolean>;
}): Promise<"held" | "not_held" | "reassigned"> {
	const eligible = await isEligibleManagerForApprovalRequest({
		db: input.db,
		approvalRequestId: input.approvalRequestId,
		managerEmployeeId: input.managerEmployeeId,
		organizationId: input.organizationId,
	});
	if (!eligible) return "not_held";
	return (await input.replacedByEscalation()) ? "reassigned" : "held";
}
