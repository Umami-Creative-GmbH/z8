/**
 * Owner self-approval of expense reports (#679). An organization owner whom
 * nobody else can review has their report approved on submit, recorded as a
 * system activation of the submission whose `result.reason` names this basis.
 * History, review evidence and exports label it from that one record.
 */

/** `result.reason` of the activation evidence; also the export's approval basis. */
export const OWNER_SELF_APPROVAL_REASON = "owner_no_other_reviewer";

/** What would need another reviewer's explicit acceptance. */
export type OwnerSelfApprovalBlocker = "receipt_exception" | "allowance_override";

/**
 * Missing-receipt exceptions (#604) and allowance overrides (#610) of the
 * frozen items: a reviewer accepts them explicitly, so a self-approval never
 * does; such a report stays refused until someone else can review it.
 */
export function ownerSelfApprovalBlockers(
	items: ReadonlyArray<{ receiptException?: unknown; allowanceOverride?: unknown }>,
): OwnerSelfApprovalBlocker[] {
	const blockers: OwnerSelfApprovalBlocker[] = [];
	if (items.some((item) => item.receiptException)) blockers.push("receipt_exception");
	if (items.some((item) => item.allowanceOverride)) blockers.push("allowance_override");
	return blockers;
}

/** Whether committed decision evidence is an owner's self-approval. */
export function isOwnerSelfApprovalDecision(decision: {
	operationKind: string;
	requestOutcome: string;
	result: Record<string, unknown> | null | undefined;
}): boolean {
	return (
		decision.operationKind === "submission_activation" &&
		decision.requestOutcome === "approved" &&
		decision.result?.reason === OWNER_SELF_APPROVAL_REASON
	);
}
