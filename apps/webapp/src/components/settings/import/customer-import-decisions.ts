import type {
	CustomerDecision,
	CustomerDecisionOption,
	CustomerImportReviewRow,
	CustomerLinkTarget,
} from "./customer-import-review-table";

/** The row's current decision, or null while it is undecided. */
export function currentCustomerDecision(row: CustomerImportReviewRow): CustomerDecision | null {
	if (row.rowStatus === "rejected") return "skip";
	if (row.commitChoice?.kind === "link") return `link:${row.commitChoice.targetId}`;
	if (row.rowStatus === "accepted" || row.rowStatus === "blocked") return "create";
	if (row.rowStatus === "committed" || row.rowStatus === "committing") return "create";
	return null;
}

/**
 * The choices for one row: create new (unavailable while a customer has the
 * same name), link to the suggested customer, link to any other customer not
 * linked yet, or skip.
 */
export function customerDecisionOptions(
	row: CustomerImportReviewRow,
	linkTargets: readonly CustomerLinkTarget[],
): CustomerDecisionOption[] {
	const { suggestion, nameTakenBy } = row.customer;
	const options: CustomerDecisionOption[] = [
		{ value: "create", kind: "create", disabled: nameTakenBy !== null },
	];
	if (suggestion) {
		options.push({
			value: `link:${suggestion.customerId}`,
			kind: "suggested_link",
			customerName: suggestion.customerName,
			disabled: false,
		});
	}
	const current = row.commitChoice?.targetId;
	for (const target of linkTargets) {
		if (target.customerId === suggestion?.customerId) continue;
		options.push({
			value: `link:${target.customerId}`,
			kind: "link",
			customerName: target.name,
			disabled: false,
		});
	}
	if (current && !options.some((option) => option.value === `link:${current}`)) {
		options.push({ value: `link:${current}`, kind: "link", disabled: false });
	}
	options.push({ value: "skip", kind: "skip", disabled: false });
	return options;
}
