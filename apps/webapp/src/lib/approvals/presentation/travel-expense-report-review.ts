import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { travelExpenseReport } from "@/db/schema";
import { instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { type LegacyDecisionEvidenceRecord, listLegacyDecisionEvidence } from "../evidence/store";
import type { TravelExpenseReportRevisionComparison } from "../evidence/travel-expense-report-facts";
import {
	loadTravelExpenseReportSubmittedRevision,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "../evidence/travel-expense-report-store";
import { compareTravelExpenseReportWithSubmittedRevision } from "../evidence/travel-expense-report-submission";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";
import type { ApprovalDatabase } from "../server/types";
import { adjustmentReviewSections } from "./travel-expense-report-adjustment-review";
import { conversionReviewRows } from "./travel-expense-report-conversion-review";
import { travelExpenseReportProjectRows } from "./travel-expense-report-project";
import { mileageReviewRows } from "./travel-expense-report-mileage";
import { perDiemReviewRows } from "./travel-expense-report-per-diem";
import {
	receiptExceptionAcceptanceSections,
	receiptExceptionRows,
} from "./travel-expense-report-receipt-exceptions";

export type TravelExpenseReportReviewEvidence =
	| { status: "not_captured" }
	| {
			status: "evidenced";
			revision: TravelExpenseReportSubmittedRevisionRecord;
			comparison: TravelExpenseReportRevisionComparison;
			decisions: LegacyDecisionEvidenceRecord[];
	  };

/**
 * The frozen submission of the report's current cycle (#602), whether its live
 * rows still match, and the committed decisions. Mirrors the decision owner's
 * holds exactly.
 */
export async function prepareTravelExpenseReportReviewEvidence(
	input: { organizationId: string; reportId: string },
	database: ApprovalDatabase = db,
): Promise<TravelExpenseReportReviewEvidence> {
	const [report] = await database
		.select({ submissionCount: travelExpenseReport.submissionCount })
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const revision = report
		? await loadTravelExpenseReportSubmittedRevision(database, {
				...input,
				submissionCycle: report.submissionCount,
			})
		: null;
	if (!revision) return { status: "not_captured" };
	const [comparison, decisions] = await Promise.all([
		compareTravelExpenseReportWithSubmittedRevision(database, revision),
		listLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
		}),
	]);
	return { status: "evidenced", revision, comparison, decisions };
}

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

const CATEGORIES: Record<string, ApprovalInboxLocalizedText> = {
	transport: text("categoryTransport", "Transport"),
	accommodation: text("categoryAccommodation", "Accommodation"),
	meals: text("categoryMeals", "Meals"),
	parking: text("categoryParking", "Parking"),
	other: text("categoryOther", "Other"),
};

function decisionLabel(decision: LegacyDecisionEvidenceRecord): string {
	if (decision.requestOutcome === "approved") return "Report approved";
	if (decision.requestOutcome === "rejected") return "Report rejected";
	if (decision.assignmentOutcome === "approved")
		return "Approval recorded — awaiting further approval";
	return "Decision recorded";
}

/**
 * Renders a report's frozen submission into authenticated review sections:
 * the shared trip facts as entered, the server-calculated totals and every
 * expense with its receipts. Nothing is recalculated or read from live rows.
 */
export function buildTravelExpenseReportReviewSections(
	evidence: TravelExpenseReportReviewEvidence,
): { sections: ApprovalInboxDetailSection[]; decisionsBlocked: boolean } {
	if (evidence.status === "not_captured") {
		return {
			sections: [
				{
					type: "callout",
					title: "Submitted report unavailable",
					body: "The facts submitted for this report were not found, so a decision cannot be bound to them. The report is held for review.",
					tone: "warning",
				},
			],
			decisionsBlocked: true,
		};
	}
	const { revision, comparison, decisions } = evidence;
	const { facts, labels } = revision;
	const rows: Row[] = [
		{
			label: { key: "approvals:approvals.employee", fallback: "Employee" },
			value: labels.subjectName ?? text("unavailable", "Unavailable"),
		},
		{
			label: text("reportKind", "Report"),
			value: facts.trip
				? text("reportKindTrip", "Trip")
				: text("reportKindStandalone", "Standalone expense"),
		},
	];
	if (facts.trip) {
		const { purpose, startDate, endDate, timeZone, destinations } = facts.trip;
		rows.push(
			{ label: text("tripPurpose", "Purpose"), value: purpose },
			{
				label: text("tripDates", "Trip dates"),
				// Calendar days as entered; they never shift with the viewer's zone.
				value: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
			},
			{ label: text("tripDatesZone", "Dates entered in"), value: timeZone },
			{
				label: text("destination", "Destination"),
				value: destinations
					.map((destination) =>
						[destination.place, destination.countryCode].filter(Boolean).join(", "),
					)
					.join("; "),
			},
		);
	}
	rows.push(
		{
			label: text("reimbursableTotal", "Reimbursable to employee"),
			value: `${facts.totals.reimbursable} ${facts.totals.currency}`,
		},
		{
			label: text("companyPaidTotal", "Paid by company"),
			value: `${facts.totals.companyPaid} ${facts.totals.currency}`,
		},
	);

	const sections: ApprovalInboxDetailSection[] = [
		...adjustmentReviewSections(facts),
		{ type: "key_value", title: text("submittedReportTitle", "Submitted report"), rows },
		...receiptExceptionAcceptanceSections(facts),
		...facts.items.map((item, index): ApprovalInboxDetailSection => {
			const names = item.receipts.map(
				(receipt) => labels.receiptFileNames[receipt.receiptId] ?? receipt.receiptId,
			);
			const itemRows: Row[] = [
				{ label: text("expenseDate", "Date"), value: item.expenseDate },
				{ label: text("category", "Category"), value: CATEGORIES[item.category] ?? item.category },
				{
					label: text("amount", "Amount"),
					value: `${item.original.amount} ${item.original.currency}`,
				},
				...conversionReviewRows(item, labels.receiptFileNames),
				{
					label: text("paidBy", "Paid by"),
					value:
						item.paidBy === "company"
							? text("paidByCompany", "Company")
							: text("paidByEmployee", "Employee"),
				},
			];
			if (item.accountingReference) {
				itemRows.push({
					label: text("accountingReference", "Accounting reference"),
					value: item.accountingReference,
				});
			}
			itemRows.push(...travelExpenseReportProjectRows(item));
			itemRows.push(...mileageReviewRows(item));
			itemRows.push(...perDiemReviewRows(item));
			itemRows.push(
				...(item.receiptException
					? receiptExceptionRows(item.receiptException)
					: [
							{
								label: text("receipts", "Receipts"),
								value: `${names.length}: ${names.join(", ")}`,
							},
						]),
			);
			return { type: "key_value", title: `${index + 1}. ${item.description}`, rows: itemRows };
		}),
	];
	if (comparison.kind === "material_change") {
		sections.push({
			type: "callout",
			title: "Report changed after submission",
			body: `The live report no longer matches what was submitted for approval (changed: ${comparison.changedFields.join(", ")}). A decision cannot be recorded.`,
			tone: "danger",
		});
	}
	sections.push({
		type: "timeline",
		title: "Evidence history",
		events: [
			{
				id: `evidence-submitted-${revision.id}`,
				label: "Submitted",
				at: instantToCanonicalString(revision.submittedAt),
				actorName: labels.submitterName,
			},
			...decisions.map((decision) => ({
				id: `evidence-decision-${decision.id}`,
				label: decisionLabel(decision),
				at: instantToCanonicalString(decision.decidedAt),
				actorName: decision.labels.actorName,
			})),
		],
	});
	return { sections, decisionsBlocked: comparison.kind === "material_change" };
}
