/**
 * The hand-off page's changed-work list (#1502): marked items grouped by
 * customer, then by invoice draft, oldest change first at every level. Each
 * draft subtotals the open amount differences it can price, in its currency,
 * and counts the unknown ones apart: an unknown difference is never added as
 * zero. Pure and client-safe.
 */

import { formatUnits, parseUnits, sumUnits } from "@/lib/money/exact-decimal";
import { RATE_SCALE } from "../money";
import { openAmountDifference } from "./amount-difference";
import type { MarkedWorkDraftView, MarkedWorkItemView } from "./views";

export interface ChangedWorkDraftGroup {
	draftId: string;
	draft: MarkedWorkDraftView;
	currency: string;
	/** Oldest change first. */
	items: MarkedWorkItemView[];
	/** The known and estimated open differences added up (two decimals); null when there are none. */
	subtotal: string | null;
	/** The subtotal includes estimated differences. */
	subtotalEstimated: boolean;
	/** Items in the subtotal. */
	knownCount: number;
	/** Items whose open difference is unknown: not in the subtotal. */
	unknownCount: number;
}

export interface ChangedWorkCustomerGroup {
	customerId: string;
	customerName: string;
	drafts: ChangedWorkDraftGroup[];
}

/** ISO instants of one format: the smaller string is the earlier change. */
function byOldestChange(a: MarkedWorkItemView, b: MarkedWorkItemView): number {
	const at = (item: MarkedWorkItemView) => item.changedAfterInvoicingAt ?? "";
	if (at(a) !== at(b)) return at(a) < at(b) ? -1 : 1;
	return a.invoicedWorkId < b.invoicedWorkId ? -1 : a.invoicedWorkId > b.invoicedWorkId ? 1 : 0;
}

function amountUnits(amount: string): bigint {
	const units = parseUnits(amount, RATE_SCALE);
	if (units === null) throw new RangeError(`Not an amount difference: ${amount}`);
	return units;
}

function draftGroup(items: MarkedWorkItemView[]): ChangedWorkDraftGroup {
	const [first] = items;
	const open = items.map((item) => openAmountDifference(item.comparison.amountDifference));
	const priced = open.flatMap((difference) => (difference.kind === "unknown" ? [] : [difference]));
	return {
		draftId: first.invoiceDraftId,
		draft: first.draft,
		currency: first.draft.currency,
		items,
		subtotal:
			priced.length === 0
				? null
				: formatUnits(
						sumUnits(priced.map((difference) => amountUnits(difference.amount))),
						RATE_SCALE,
					),
		subtotalEstimated: priced.some((difference) => difference.kind === "estimated"),
		knownCount: priced.length,
		unknownCount: open.length - priced.length,
	};
}

/** Groups marked items by customer and invoice draft (each draft has one customer). */
export function groupChangedWork(items: readonly MarkedWorkItemView[]): ChangedWorkCustomerGroup[] {
	const sorted = [...items].sort(byOldestChange);
	const byDraft = new Map<string, MarkedWorkItemView[]>();
	for (const item of sorted) {
		const list = byDraft.get(item.invoiceDraftId) ?? [];
		list.push(item);
		byDraft.set(item.invoiceDraftId, list);
	}
	// Map order is insertion order: drafts and customers come in the order of their oldest change.
	const byCustomer = new Map<string, ChangedWorkCustomerGroup>();
	for (const draftItems of byDraft.values()) {
		const group = draftGroup(draftItems);
		const customer = byCustomer.get(group.draft.customerId) ?? {
			customerId: group.draft.customerId,
			customerName: group.draft.customerName,
			drafts: [],
		};
		customer.drafts.push(group);
		byCustomer.set(customer.customerId, customer);
	}
	return [...byCustomer.values()];
}
