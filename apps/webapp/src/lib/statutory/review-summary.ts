/**
 * The per-domain counts of the unified statutory review inbox (#1994), pure: no server imports, so
 * the Compliance Command Center's tests build realistic summaries from items.
 */
import type { StatutoryReviewDomain } from "./review-domains";
import type { StatutoryReviewDomainSummary, StatutoryReviewInboxItem } from "./review-inbox";

/** Whether an item still needs an org admin: not documented by an acknowledgement. */
export function isOpenStatutoryReviewItem(item: StatutoryReviewInboxItem): boolean {
	return item.severity !== "info" && item.acknowledgementStatus !== "current";
}

/**
 * A domain's open findings by severity, and among them the pending and stale acknowledgements:
 * every pending or stale acknowledgement belongs to an open critical or warning finding, so they
 * never outnumber the findings.
 */
export function summarizeStatutoryReviewDomain(
	domain: StatutoryReviewDomain,
	items: readonly StatutoryReviewInboxItem[],
): StatutoryReviewDomainSummary {
	const open = items.filter(
		(item) => item.reviewDomain === domain && isOpenStatutoryReviewItem(item),
	);
	return {
		domain,
		status: "loaded",
		critical: open.filter((item) => item.severity === "critical").length,
		warning: open.filter((item) => item.severity === "warning").length,
		pendingAcknowledgements: open.filter(
			(item) => item.acknowledgeable && item.acknowledgementStatus === "none",
		).length,
		staleAcknowledgements: open.filter((item) => item.acknowledgementStatus === "stale").length,
	};
}
