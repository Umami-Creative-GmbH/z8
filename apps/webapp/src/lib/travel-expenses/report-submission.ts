import type { TravelExpenseReportKind } from "@/db/schema";
import type { ItemConversion } from "./currency-conversion";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";
import {
	type ReceiptItemDraft,
	receiptItemMissingRequirements,
	receiptReportTotals,
} from "./receipt-report";
import {
	type TripDetailsDraft,
	type TripReportMissingRequirements,
	type TripRequirement,
	tripReportMissingRequirements,
} from "./trip-report";

/**
 * Whether a saved report may be submitted for review (#602). Only saved facts
 * count: the server runs this under the report lock on the rows it is about to
 * freeze, against the versions the employee reviewed, and calculates the
 * authoritative totals itself. Client-side totals are never trusted.
 */

export interface SubmissionReportFacts {
	kind: TravelExpenseReportKind;
	reimbursementCurrency: string;
	detailsVersion: number;
	/** Null for standalone reports. */
	details: TripDetailsDraft | null;
	items: readonly {
		id: string;
		version: number;
		draft: ReceiptItemDraft;
		/** The receipts attached to the expense right now. */
		receiptIds: readonly string[];
		/** Its saved currency conversion (#607), if any. */
		conversion?: ItemConversion | null;
	}[];
}

/** The versions and receipts shown in the employee's submission review step. */
export interface ReviewedReportVersions {
	/** Null for standalone reports, which have no trip details. */
	detailsVersion: number | null;
	items: readonly { id: string; version: number; receiptIds: readonly string[] }[];
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const seen = new Set(left);
	return right.every((id) => seen.has(id));
}

export interface ReportSubmissionTotals {
	currency: string;
	/** Employee-paid costs: the reimbursement entitlement, possibly zero. */
	reimbursable: string;
	/** Company-paid costs: reviewed, never owed to the employee. */
	companyPaid: string;
	/** Everything the reviewer approves; what approval amount thresholds measure. */
	total: string;
}

/** Adds two normalized stored-scale amounts exactly. */
function addAmounts(left: string, right: string): string {
	const units = (value: string) => {
		const parsed = parseUnits(value, STORED_AMOUNT_SCALE);
		if (parsed === null) throw new Error(`Malformed report total: ${value}`);
		return parsed;
	};
	return formatUnits(sumUnits([units(left), units(right)]), STORED_AMOUNT_SCALE);
}

export type ReportSubmissionCheck =
	| { ok: true; totals: ReportSubmissionTotals }
	| { ok: false; reason: "changed_since_review" }
	| { ok: false; reason: "incomplete"; missing: TripReportMissingRequirements };

function matchesReview(report: SubmissionReportFacts, reviewed: ReviewedReportVersions): boolean {
	const expectedDetails = report.kind === "trip" ? report.detailsVersion : null;
	if (reviewed.detailsVersion !== expectedDetails) return false;
	if (reviewed.items.length !== report.items.length) return false;
	return report.items.every((item, index) => {
		const seen = reviewed.items[index];
		// A receipt attached or removed after the review is not what was reviewed.
		return (
			seen?.id === item.id &&
			seen.version === item.version &&
			sameIds(seen.receiptIds, item.receiptIds)
		);
	});
}

function missingRequirements(report: SubmissionReportFacts): TripReportMissingRequirements {
	if (report.kind === "trip" && report.details) {
		return tripReportMissingRequirements({
			details: report.details,
			items: report.items.map((item) => ({
				id: item.id,
				draft: item.draft,
				receiptCount: item.receiptIds.length,
				conversion: item.conversion,
			})),
			reimbursementCurrency: report.reimbursementCurrency,
		});
	}
	const trip: TripRequirement[] = report.items.length === 1 ? [] : ["expense_item"];
	const items = report.items
		.map((item) => ({
			id: item.id,
			missing: receiptItemMissingRequirements(item.draft, {
				receiptCount: item.receiptIds.length,
				reimbursementCurrency: report.reimbursementCurrency,
				conversion: item.conversion,
			}),
		}))
		.filter((item) => item.missing.length > 0);
	return { trip, items };
}

export function checkReportSubmission(
	report: SubmissionReportFacts,
	reviewed: ReviewedReportVersions,
): ReportSubmissionCheck {
	if (!matchesReview(report, reviewed)) return { ok: false, reason: "changed_since_review" };
	const missing = missingRequirements(report);
	if (missing.trip.length > 0 || missing.items.length > 0) {
		return { ok: false, reason: "incomplete", missing };
	}
	const totals = receiptReportTotals(
		report.items.map((item) => ({ ...item.draft, conversion: item.conversion })),
		report.reimbursementCurrency,
	);
	if (totals.excludedItemCount > 0) {
		// Unreachable for complete items; never submit an uncounted expense.
		throw new Error("A complete expense was excluded from the report totals");
	}
	return {
		ok: true,
		totals: {
			currency: totals.currency,
			reimbursable: totals.reimbursable,
			companyPaid: totals.companyPaid,
			total: addAmounts(totals.reimbursable, totals.companyPaid),
		},
	};
}
