import { Effect } from "effect";
import { ValidationError } from "@/lib/effect/errors";
import { checkReceiptExceptionAcceptance } from "@/lib/travel-expenses/receipt-exception";
import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";

/**
 * Reviewer acceptance of missing-receipt exceptions (#604). Approving a report
 * must explicitly accept every exception frozen in the decided revision, and
 * nothing else; other decisions need none. The accepted expenses enter the
 * command fingerprint and the decision evidence, so a retry that accepts
 * something else is never replayed as the original approval.
 */

const FIELD = "acceptedReceiptExceptionItemIds";

/** The accepted expenses a command carries: sorted and unique, and only when approving. */
export function acceptedReceiptExceptionsForCommand(input: {
	action: string;
	acceptedReceiptExceptionItemIds?: readonly string[];
}): string[] {
	if (input.action !== "approve") return [];
	return [...new Set(input.acceptedReceiptExceptionItemIds ?? [])].toSorted();
}

/** Decision evidence `result` fields: present only when exceptions were accepted. */
export function receiptExceptionAcceptanceResult(input: {
	action: string;
	acceptedReceiptExceptionItemIds?: readonly string[];
}): { acceptedReceiptExceptionItemIds?: string[] } {
	const accepted = acceptedReceiptExceptionsForCommand(input);
	return accepted.length > 0 ? { acceptedReceiptExceptionItemIds: accepted } : {};
}

/** Refuses an approval that does not accept exactly the revision's exceptions. */
export function requireReceiptExceptionAcceptance(
	facts: Pick<TravelExpenseReportSubmittedFacts, "items">,
	action: string,
	acceptedItemIds: readonly string[] | undefined,
): Effect.Effect<void, ValidationError> {
	const check = checkReceiptExceptionAcceptance(facts.items, action, acceptedItemIds);
	if (check.ok) return Effect.void;
	return Effect.fail(
		new ValidationError({
			message:
				check.reason === "not_accepted"
					? "Accept every missing-receipt exception of this report before approving it"
					: "Only missing-receipt exceptions of this report can be accepted",
			field: FIELD,
			value: check.itemIds,
		}),
	);
}
