import { convertToReimbursement, type ItemConversion } from "./currency-conversion";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE } from "./money";
import type { ExpensePayer } from "./receipt-report";

/**
 * The single place that derives how much an expense item counts toward a
 * report in its reimbursement currency (#598). Report totals
 * (`receiptReportTotals`), and through them the frozen submission facts, the
 * submission check and the editor's live totals, all count items here, so a
 * new way of pricing an item is added once:
 * - mileage (#606) derives the amount from distance × the policy rate,
 * - currency conversion (#607) derives it from a card charge or a rate.
 * Each adds optional input fields and a branch in `reimbursementSource`;
 * receipts in the reimbursement currency keep counting at their original
 * amount. Nothing is guessed: an item that cannot be priced is not counted.
 */

export interface ReimbursementItemInput {
	/** Original amount as a decimal string at the stored scale ("89.90"). */
	amount: string | null;
	/** Original currency (ISO 4217). */
	currency: string | null;
	paidBy: ExpensePayer | null;
	/** How a foreign-currency item converts into the reimbursement currency (#607). */
	conversion?: ItemConversion | null;
	/** Item type; receipts when absent. */
	type?: string;
	/** Mileage (#606): the server-calculated amount; entered amounts never count. */
	mileage?: { amount: string | null; currency: string | null } | null;
	/** Per diem (#609): the server-calculated allowance; zero after meal deductions counts. */
	perDiem?: { amount: string | null; currency: string | null } | null;
}

/** Why an item is not counted (yet). */
export type ItemNotCountedReason =
	/** No valid positive amount (or no currency) to count. */
	| "amount"
	/** Nobody is recorded as having paid it. */
	| "payer"
	/** It is in another currency and no conversion exists. */
	| "currency";

export type ItemReimbursementAmount =
	| {
			counted: true;
			/** Employee-paid counts toward the entitlement; company-paid never does. */
			paidBy: ExpensePayer;
			/** Always the report's reimbursement currency. */
			currency: string;
			/** Units at `STORED_AMOUNT_SCALE`; positive, or zero for a per diem (#609). */
			units: bigint;
			/** The same amount as a stored-scale decimal string. */
			amount: string;
	  }
	| { counted: false; reason: ItemNotCountedReason };

/** Largest amount of the stored `decimal(12, 2)` columns, in units. */
const MAX_AMOUNT_UNITS = BigInt(99_999_999_999);

function reimbursementSource(
	item: ReimbursementItemInput,
	reimbursementCurrency: string,
): { amount: string; zeroAllowed?: true } | { reason: ItemNotCountedReason } {
	if (item.type === "per_diem") {
		// Calculated from the itinerary and meals (`per-diem.ts`); a zero allowance is legitimate.
		const { amount = null, currency = null } = item.perDiem ?? {};
		if (!amount || !currency) return { reason: "amount" };
		if (currency !== reimbursementCurrency) return { reason: "currency" };
		return { amount, zeroAllowed: true };
	}
	if (item.type === "mileage") {
		// Priced by the organization's dated mileage policy (`mileage.ts`), never converted.
		const { amount = null, currency = null } = item.mileage ?? {};
		if (!amount || !currency) return { reason: "amount" };
		if (currency !== reimbursementCurrency) return { reason: "currency" };
		return { amount };
	}
	if (!item.amount || !item.currency) return { reason: "amount" };
	if (item.currency === reimbursementCurrency) return { amount: item.amount };
	const converted = convertToReimbursement(
		{ amount: item.amount, currency: item.currency },
		reimbursementCurrency,
		item.conversion,
	);
	return converted.kind === "converted"
		? { amount: converted.reimbursement.amount }
		: { reason: "currency" };
}

export function itemReimbursementAmount(
	item: ReimbursementItemInput,
	reimbursementCurrency: string,
): ItemReimbursementAmount {
	const source = reimbursementSource(item, reimbursementCurrency);
	if ("reason" in source) return { counted: false, reason: source.reason };
	const units = parseUnits(source.amount, STORED_AMOUNT_SCALE);
	const minimum = source.zeroAllowed ? BigInt(0) : BigInt(1);
	if (units === null || units < minimum || units > MAX_AMOUNT_UNITS) {
		return { counted: false, reason: "amount" };
	}
	if (!item.paidBy) return { counted: false, reason: "payer" };
	return {
		counted: true,
		paidBy: item.paidBy,
		currency: reimbursementCurrency,
		units,
		amount: formatUnits(units, STORED_AMOUNT_SCALE),
	};
}
