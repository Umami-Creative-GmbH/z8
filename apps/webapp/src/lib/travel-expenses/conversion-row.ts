import type { travelExpenseReportItemConversion } from "@/db/schema";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { type ItemConversion, normalizeRate } from "./currency-conversion";

/** A stored conversion row of a report item (#607). */
export type ItemConversionRow = typeof travelExpenseReportItemConversion.$inferSelect;

/**
 * Maps a stored row to the conversion it records; null for a row the CHECK
 * constraints should have made impossible, which then counts as missing.
 */
export function conversionFromRow(row: ItemConversionRow): ItemConversion | null {
	const pair = { sourceCurrency: row.sourceCurrency, targetCurrency: row.targetCurrency };
	if (row.basis === "card_charge") {
		if (!row.chargedAmount) return null;
		return {
			basis: "card_charge",
			...pair,
			chargedAmount: row.chargedAmount,
			evidenceReceiptId: row.evidenceReceiptId,
		};
	}
	if (row.basis === "manual_rate") {
		const value = row.rate ? normalizeRate(row.rate) : null;
		if (
			!value ||
			!row.rateBaseCurrency ||
			!row.rateQuoteCurrency ||
			!row.rateDate ||
			!row.reason ||
			!row.rateEvidence ||
			!row.authorizedByEmployeeId ||
			!row.authorizedByName ||
			!row.authorizedAt
		) {
			return null;
		}
		return {
			basis: "manual_rate",
			...pair,
			rate: { base: row.rateBaseCurrency, quote: row.rateQuoteCurrency, value },
			rateDate: row.rateDate,
			reason: row.reason,
			evidence: row.rateEvidence,
			authorizedBy: { employeeId: row.authorizedByEmployeeId, name: row.authorizedByName },
			authorizedAt: instantToCanonicalString(instantFromDate(row.authorizedAt)),
		};
	}
	if (row.basis === "reference_rate") {
		// #608: only a submission stores one, with the publication it froze.
		const value = row.rate ? normalizeRate(row.rate) : null;
		if (
			!value ||
			!row.rateBaseCurrency ||
			!row.rateQuoteCurrency ||
			!row.rateDate ||
			!row.referenceExpenseDate ||
			!row.referenceSource
		) {
			return null;
		}
		return {
			basis: "reference_rate",
			...pair,
			rate: { base: row.rateBaseCurrency, quote: row.rateQuoteCurrency, value },
			rateDate: row.rateDate,
			expenseDate: row.referenceExpenseDate,
			source: { ...row.referenceSource },
		};
	}
	return null;
}
