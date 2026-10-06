import type { ReceiptItemRequirement } from "./receipt-report";

/**
 * Missing-receipt exceptions (#604). An organization may allow an employee to
 * submit a receipt expense without its receipt when they explain why it is
 * missing. The exception is a separate, explained fact of the expense: it is
 * never stored or shown as an uploaded receipt, it only counts while the
 * organization allows exceptions, and a reviewer must explicitly accept each
 * one to approve the report.
 */

export const MAX_RECEIPT_EXCEPTION_REASON_LENGTH = 1000;

/** The exception state of one expense, as far as its requirements are concerned. */
export interface ReceiptExceptionContext {
	/** Whether the organization allows missing-receipt exceptions. */
	allowed: boolean;
	/** Whether the employee requested an exception for this expense. */
	requested: boolean;
	reason: string | null;
}

/** A stored explanation is the request; without one nothing was requested. */
export function receiptExceptionContext(
	reason: string | null,
	allowed: boolean,
): ReceiptExceptionContext {
	return { allowed, requested: reason !== null, reason };
}

export type ParseReceiptExceptionDraftResult =
	| { ok: true; reason: string | null }
	| { ok: false; error: "reason_required" | "too_long" };

/**
 * An exception that is not requested is withdrawn (null). A requested one
 * needs an explanation; an unexplained exception is never stored.
 */
export function parseReceiptExceptionDraft(input: {
	requested: boolean;
	reason: string | null;
}): ParseReceiptExceptionDraftResult {
	if (!input.requested) return { ok: true, reason: null };
	const reason = input.reason?.trim() ?? "";
	if (!reason) return { ok: false, error: "reason_required" };
	if (reason.length > MAX_RECEIPT_EXCEPTION_REASON_LENGTH) return { ok: false, error: "too_long" };
	return { ok: true, reason };
}

/** What an expense without any receipt still needs, given its exception. */
export function missingReceiptRequirements(
	exception: ReceiptExceptionContext | undefined,
): ReceiptItemRequirement[] {
	if (!exception?.requested) return ["receipt"];
	if (!exception.allowed) return ["receipt_exception_not_allowed"];
	if (!exception.reason?.trim()) return ["receipt_exception_reason"];
	return [];
}

/** The frozen exception fact of an expense; only an expense without receipts has one. */
export function frozenReceiptException(
	reason: string | null | undefined,
	receiptCount: number,
): { reason: string } | null {
	return reason && receiptCount === 0 ? { reason } : null;
}

export type ReceiptExceptionAcceptanceCheck =
	| { ok: true; accepted: string[] }
	| { ok: false; reason: "not_accepted" | "unknown_item"; itemIds: string[] };

/**
 * Approval must accept exactly the exceptions of the decided revision: every
 * one of them, and nothing else. Other decisions need no acceptance and
 * record none.
 */
export function checkReceiptExceptionAcceptance(
	items: readonly { itemId: string; receiptException?: { reason: string } | null }[],
	action: string,
	acceptedItemIds: readonly string[] | undefined,
): ReceiptExceptionAcceptanceCheck {
	if (action !== "approve") return { ok: true, accepted: [] };
	const exceptions = new Set(
		items.flatMap((item) => (item.receiptException ? [item.itemId] : [])),
	);
	const accepted = [...new Set(acceptedItemIds ?? [])].toSorted();
	const unknown = accepted.filter((itemId) => !exceptions.has(itemId));
	if (unknown.length > 0) return { ok: false, reason: "unknown_item", itemIds: unknown };
	const notAccepted = [...exceptions].filter((itemId) => !accepted.includes(itemId)).toSorted();
	if (notAccepted.length > 0) return { ok: false, reason: "not_accepted", itemIds: notAccepted };
	return { ok: true, accepted };
}
