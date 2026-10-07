import type {
	TravelExpenseReportItemType,
	TravelExpenseReportKind,
	TravelExpenseReportStatus,
} from "@/db/schema/travel-expense";
import type { ReceiptReportTotals } from "./receipt-report";
import { isDeletableDraftReport } from "./report-deletion";
import type { DraftReportSummary } from "./report-store";
import type { SettlementSummary } from "./settlement";

/**
 * The employee's unified expense history (#617): new reports and earlier
 * (legacy) claims as one list, each keeping its own identity, status, logical
 * dates and authority. Pure; `expense-history-store.ts` loads the inputs.
 */

export const EXPENSE_HISTORY_FILTERS = [
	"all",
	"needs_action",
	"in_review",
	"approved",
	"rejected",
] as const;
export type ExpenseHistoryFilter = (typeof EXPENSE_HISTORY_FILTERS)[number];
export type ExpenseHistoryStage = Exclude<ExpenseHistoryFilter, "all">;

export type LegacyClaimStatus = "draft" | "submitted" | "approved" | "rejected";
export type LegacyClaimType = "receipt" | "mileage" | "per_diem";

/** The legacy claim columns the history shows. */
export interface LegacyClaimHistoryInput {
	id: string;
	type: LegacyClaimType;
	status: LegacyClaimStatus;
	calculatedAmount: string;
	calculatedCurrency: string;
	tripStartDate: string | null;
	tripEndDate: string | null;
	destinationCity: string | null;
	updatedAt: string;
}

export interface ExpenseHistoryInput {
	reports: readonly DraftReportSummary[];
	/** Adjustment report id → the report it corrects (#615). */
	adjustmentOriginals: ReadonlyMap<string, string>;
	claims: readonly LegacyClaimHistoryInput[];
	/** Legacy claim id → the report it was continued as (#616). */
	conversions: ReadonlyMap<string, string>;
	/** Settlement balances of approved expenses, keyed `report:id` / `legacy_claim:id` (#612). */
	balances: ReadonlyMap<string, SettlementSummary>;
}

interface HistoryRowBase {
	id: string;
	href: string;
	stage: ExpenseHistoryStage;
	/** Last change, for ordering only (an instant, never a travel date). */
	activityAt: string;
	/** The settlement balance of an approved expense; null otherwise. */
	balance: SettlementSummary | null;
	/** Logical dates exactly as entered; a single expense has start = end. */
	dates: { start: string | null; end: string | null };
}

export interface ReportHistoryRow extends HistoryRowBase {
	source: "report";
	kind: TravelExpenseReportKind;
	status: TravelExpenseReportStatus;
	/** A standalone report's (only) expense type. */
	itemType: TravelExpenseReportItemType | null;
	/** Trip purpose or the standalone expense's description/route; null when not entered yet. */
	title: string | null;
	itemCount: number;
	receiptCount: number;
	totals: ReceiptReportTotals;
	/** Set on an adjustment report (#615); its balance lives on the original. */
	adjustmentOf: { reportId: string; title: string | null; kind: TravelExpenseReportKind } | null;
	/** The legacy draft this report continues (#616). */
	continuedFromClaimId: string | null;
	/** A draft that was never submitted, which the employee may delete (#684). */
	deletable: boolean;
}

export interface LegacyClaimHistoryRow extends HistoryRowBase {
	source: "legacy_claim";
	claimType: LegacyClaimType;
	status: LegacyClaimStatus;
	amount: { amount: string; currency: string };
	destination: string | null;
	/** A legacy draft not continued yet can be continued as a report (#616). */
	canContinue: boolean;
}

export type ExpenseHistoryRow = ReportHistoryRow | LegacyClaimHistoryRow;

function stageOf(status: TravelExpenseReportStatus | LegacyClaimStatus): ExpenseHistoryStage {
	switch (status) {
		case "draft":
		case "returned":
			return "needs_action";
		case "submitted":
			return "in_review";
		case "approved":
			return "approved";
		case "rejected":
			return "rejected";
	}
}

function reportTitle(report: DraftReportSummary): string | null {
	return report.trip ? report.trip.purpose : report.description;
}

export function buildExpenseHistory(input: ExpenseHistoryInput): ExpenseHistoryRow[] {
	const reportsById = new Map(input.reports.map((report) => [report.id, report]));
	const continuedFrom = new Map(
		[...input.conversions].map(([claimId, reportId]) => [reportId, claimId]),
	);
	const reports = input.reports.map((report): ReportHistoryRow => {
		const originalId = input.adjustmentOriginals.get(report.id) ?? null;
		const original = originalId ? reportsById.get(originalId) : undefined;
		return {
			source: "report",
			id: report.id,
			href: `/travel-expenses/reports/${report.id}`,
			stage: stageOf(report.status),
			activityAt: report.updatedAt,
			balance:
				report.status === "approved" && !originalId
					? (input.balances.get(`report:${report.id}`) ?? null)
					: null,
			dates: report.trip
				? { start: report.trip.startDate, end: report.trip.endDate }
				: { start: report.expenseDate, end: report.expenseDate },
			kind: report.kind,
			status: report.status,
			itemType: report.kind === "standalone" ? report.itemType : null,
			title: reportTitle(report),
			itemCount: report.itemCount,
			receiptCount: report.receiptCount,
			totals: report.totals,
			adjustmentOf: originalId
				? {
						reportId: originalId,
						title: original ? reportTitle(original) : null,
						kind: original?.kind ?? report.kind,
					}
				: null,
			continuedFromClaimId: continuedFrom.get(report.id) ?? null,
			deletable: isDeletableDraftReport(report),
		};
	});
	const claims = input.claims
		// A continued draft is shown as its report, which links back to it.
		.filter((claim) => !input.conversions.has(claim.id))
		.map(
			(claim): LegacyClaimHistoryRow => ({
				source: "legacy_claim",
				id: claim.id,
				href: `/travel-expenses/${claim.id}`,
				stage: stageOf(claim.status),
				activityAt: claim.updatedAt,
				balance:
					claim.status === "approved"
						? (input.balances.get(`legacy_claim:${claim.id}`) ?? null)
						: null,
				dates: { start: claim.tripStartDate, end: claim.tripEndDate },
				claimType: claim.type,
				status: claim.status,
				amount: { amount: claim.calculatedAmount, currency: claim.calculatedCurrency },
				destination: claim.destinationCity,
				canContinue: claim.status === "draft",
			}),
		);
	return [...reports, ...claims].sort(
		(left, right) =>
			right.activityAt.localeCompare(left.activityAt) ||
			left.source.localeCompare(right.source) ||
			left.id.localeCompare(right.id),
	);
}

export function filterExpenseHistory(
	rows: readonly ExpenseHistoryRow[],
	filter: ExpenseHistoryFilter,
): ExpenseHistoryRow[] {
	return filter === "all" ? [...rows] : rows.filter((row) => row.stage === filter);
}

export function countExpenseHistory(
	rows: readonly ExpenseHistoryRow[],
): Record<ExpenseHistoryFilter, number> {
	const counts: Record<ExpenseHistoryFilter, number> = {
		all: rows.length,
		needs_action: 0,
		in_review: 0,
		approved: 0,
		rejected: 0,
	};
	for (const row of rows) counts[row.stage] += 1;
	return counts;
}

export function isExpenseHistoryFilter(value: string): value is ExpenseHistoryFilter {
	return (EXPENSE_HISTORY_FILTERS as readonly string[]).includes(value);
}
