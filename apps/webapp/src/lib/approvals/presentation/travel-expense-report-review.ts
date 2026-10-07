import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	travelExpenseReport,
	travelExpenseReportCycleClosure,
	travelExpenseReportReviewNote,
} from "@/db/schema";
import {
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { isOwnerSelfApprovalDecision } from "@/lib/travel-expenses/owner-self-approval";
import { type LegacyDecisionEvidenceRecord, listLegacyDecisionEvidence } from "../evidence/store";
import type { TravelExpenseReportRevisionComparison } from "../evidence/travel-expense-report-facts";
import {
	loadTravelExpenseReportRevisionsByRequest,
	loadTravelExpenseReportSubmittedRevision,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "../evidence/travel-expense-report-store";
import { compareTravelExpenseReportWithSubmittedRevision } from "../evidence/travel-expense-report-submission";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";
import type { ApprovalDatabase } from "../server/types";
import { adjustmentReviewSections } from "./travel-expense-report-adjustment-review";
import {
	allowanceOverrideReviewRows,
	allowanceOverrideReviewSections,
} from "./travel-expense-report-allowance-override";
import { conversionReviewRows } from "./travel-expense-report-conversion-review";
import { travelExpenseReportProjectRows } from "./travel-expense-report-project";
import { mileageReviewRows } from "./travel-expense-report-mileage";
import { perDiemReviewRows } from "./travel-expense-report-per-diem";
import {
	receiptExceptionAcceptanceSections,
	receiptExceptionRows,
} from "./travel-expense-report-receipt-exceptions";

/** An earlier cycle of the report that closed without a final decision (#603/#614). */
export interface TravelExpenseReportEarlierCycle {
	submissionCycle: number;
	kind: "returned" | "withdrawn" | "reopened";
	note: string | null;
	actorName: string | null;
	closedAt: Instant;
	itemComments: Array<{ itemId: string; itemLabel: string | null; body: string }>;
}

export type TravelExpenseReportReviewEvidence =
	| { status: "not_captured" }
	| {
			status: "evidenced";
			revision: TravelExpenseReportSubmittedRevisionRecord;
			comparison: TravelExpenseReportRevisionComparison;
			decisions: LegacyDecisionEvidenceRecord[];
			/** False when the shown cycle was superseded by a later submission. */
			latestCycle?: boolean;
			earlierCycles?: TravelExpenseReportEarlierCycle[];
	  };

/** Closed cycles before `beforeCycle`, with their notes and item comments. */
async function loadEarlierCycles(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string; beforeCycle: number },
): Promise<TravelExpenseReportEarlierCycle[]> {
	if (input.beforeCycle <= 1) return [];
	const closures = await database
		.select({
			id: travelExpenseReportCycleClosure.id,
			submissionCycle: travelExpenseReportCycleClosure.submissionCycle,
			kind: travelExpenseReportCycleClosure.kind,
			note: travelExpenseReportCycleClosure.note,
			createdAt: travelExpenseReportCycleClosure.createdAt,
			actorName: user.name,
		})
		.from(travelExpenseReportCycleClosure)
		.leftJoin(user, eq(user.id, travelExpenseReportCycleClosure.actorUserId))
		.where(
			and(
				eq(travelExpenseReportCycleClosure.organizationId, input.organizationId),
				eq(travelExpenseReportCycleClosure.reportId, input.reportId),
				lt(travelExpenseReportCycleClosure.submissionCycle, input.beforeCycle),
			),
		)
		.orderBy(asc(travelExpenseReportCycleClosure.submissionCycle));
	if (closures.length === 0) return [];
	const [notes, revisions] = await Promise.all([
		database
			.select({
				closureId: travelExpenseReportReviewNote.closureId,
				itemId: travelExpenseReportReviewNote.itemId,
				body: travelExpenseReportReviewNote.body,
			})
			.from(travelExpenseReportReviewNote)
			.where(
				and(
					eq(travelExpenseReportReviewNote.organizationId, input.organizationId),
					inArray(
						travelExpenseReportReviewNote.closureId,
						closures.map((closure) => closure.id),
					),
				),
			),
		Promise.all(
			closures.map((closure) =>
				loadTravelExpenseReportSubmittedRevision(database, {
					organizationId: input.organizationId,
					reportId: input.reportId,
					submissionCycle: closure.submissionCycle,
				}),
			),
		),
	]);
	return closures.map((closure, index) => {
		const items = revisions[index]?.facts.items ?? [];
		return {
			submissionCycle: closure.submissionCycle,
			kind: closure.kind,
			note: closure.note,
			actorName: closure.actorName ?? null,
			closedAt: instantFromDate(closure.createdAt),
			itemComments: notes
				.filter((note) => note.closureId === closure.id)
				.map((note) => ({
					itemId: note.itemId,
					itemLabel: items.find((item) => item.itemId === note.itemId)?.description ?? null,
					body: note.body,
				})),
		};
	});
}

/**
 * The frozen submission the inbox shows (#602): the named approval request's
 * own cycle, else the report's current cycle; whether its live rows still
 * match, the committed decisions, and earlier cycles' return notes. Mirrors
 * the decision owner's holds exactly for the current cycle.
 */
export async function prepareTravelExpenseReportReviewEvidence(
	input: { organizationId: string; reportId: string; approvalRequestId?: string },
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
	if (!report) return { status: "not_captured" };
	const requestRevision = input.approvalRequestId
		? (
				await loadTravelExpenseReportRevisionsByRequest(database, {
					organizationId: input.organizationId,
					approvalRequestIds: [input.approvalRequestId],
				})
			).get(input.approvalRequestId)
		: undefined;
	const revision =
		requestRevision && requestRevision.reportId === input.reportId
			? requestRevision
			: await loadTravelExpenseReportSubmittedRevision(database, {
					organizationId: input.organizationId,
					reportId: input.reportId,
					submissionCycle: report.submissionCount,
				});
	if (!revision) return { status: "not_captured" };
	const latestCycle = revision.submissionCycle === report.submissionCount;
	const [comparison, decisions, earlierCycles] = await Promise.all([
		// Only the current cycle can still be decided; an earlier one is history.
		latestCycle
			? compareTravelExpenseReportWithSubmittedRevision(database, revision)
			: Promise.resolve<TravelExpenseReportRevisionComparison>({ kind: "current" }),
		listLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
		}),
		loadEarlierCycles(database, {
			organizationId: input.organizationId,
			reportId: input.reportId,
			beforeCycle: revision.submissionCycle,
		}),
	]);
	return { status: "evidenced", revision, comparison, decisions, latestCycle, earlierCycles };
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

/**
 * A return is recorded as a non-approving legacy operation (#603) whose result
 * names the returned report; it is never labelled as a rejection.
 */
export function travelExpenseReportDecisionLabel(
	decision: Pick<
		LegacyDecisionEvidenceRecord,
		"operationKind" | "requestOutcome" | "assignmentOutcome" | "result"
	>,
): ApprovalInboxLocalizedText {
	if (decision.result?.disposition === "returned" || decision.result?.reportStatus === "returned")
		return text("reportReturnedForChanges", "Report returned for changes");
	// #679: no reviewer decided; the owner's report approved itself on submit.
	if (isOwnerSelfApprovalDecision(decision))
		return text("reportSelfApproved", "Approved automatically: no other reviewer");
	if (decision.requestOutcome === "approved") return text("reportApproved", "Report approved");
	if (decision.requestOutcome === "rejected") return text("reportRejected", "Report rejected");
	if (decision.assignmentOutcome === "approved")
		return text("reportApprovalRecorded", "Approval recorded — awaiting further approval");
	return text("reportDecisionRecorded", "Decision recorded");
}

const EARLIER_CYCLE_LABELS: Record<TravelExpenseReportEarlierCycle["kind"], ApprovalInboxLocalizedText> =
	{
		returned: text("reportCycleReturned", "Submission {cycle} returned for changes"),
		withdrawn: text("reportCycleWithdrawn", "Submission {cycle} withdrawn by the employee"),
		reopened: text("reportCycleReopened", "Submission {cycle} reopened for correction"),
	};

/** Earlier cycles' return notes and item comments, so a resubmission can be checked against them. */
function earlierCycleSections(cycles: TravelExpenseReportEarlierCycle[]): ApprovalInboxDetailSection[] {
	return cycles.map((cycle) => {
		const label = EARLIER_CYCLE_LABELS[cycle.kind];
		const rows: Row[] = [
			{
				label: text("reportCycleClosedBy", "By"),
				value: cycle.actorName ?? text("unavailable", "Unavailable"),
			},
			{ label: text("reportCycleClosedAt", "When"), value: instantToCanonicalString(cycle.closedAt) },
		];
		if (cycle.note) rows.push({ label: text("reportCycleNote", "Note"), value: cycle.note });
		for (const comment of cycle.itemComments) {
			rows.push({
				label: comment.itemLabel
					? {
							...text("reportCycleItemComment", "Comment on {item}"),
							params: { item: comment.itemLabel },
						}
					: text("reportCycleRemovedItemComment", "Comment on a removed expense"),
				value: comment.body,
			});
		}
		return {
			type: "key_value",
			title: { ...label, params: { cycle: cycle.submissionCycle } },
			rows,
		};
	});
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
					title: text("reportUnavailableTitle", "Submitted report unavailable"),
					body: text(
						"reportUnavailableBody",
						"The facts submitted for this report were not found, so a decision cannot be bound to them. The report is held for review.",
					),
					tone: "warning",
				},
			],
			decisionsBlocked: true,
		};
	}
	const { revision, comparison, decisions, latestCycle = true, earlierCycles = [] } = evidence;
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
		...allowanceOverrideReviewSections(facts),
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
			itemRows.push(...allowanceOverrideReviewRows(item));
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
	if (!latestCycle) {
		sections.unshift({
			type: "callout",
			title: {
				...text("reportEarlierCycleTitle", "Submission {cycle} of this report"),
				params: { cycle: facts.submissionCycle },
			},
			body: text(
				"reportEarlierCycleBody",
				"The report was resubmitted after this cycle closed. These are the facts reviewed in this cycle.",
			),
			tone: "info",
		});
	}
	if (comparison.kind === "material_change") {
		sections.push({
			type: "callout",
			title: text("reportChangedTitle", "Report changed after submission"),
			body: {
				...text(
					"reportChangedBody",
					"The live report no longer matches what was submitted for approval (changed: {fields}). A decision cannot be recorded.",
				),
				params: { fields: comparison.changedFields.join(", ") },
			},
			tone: "danger",
		});
	}
	sections.push(...earlierCycleSections(earlierCycles));
	sections.push({
		type: "timeline",
		title: text("evidenceHistory", "Evidence history"),
		events: [
			{
				id: `evidence-submitted-${revision.id}`,
				label: text("submitted", "Submitted"),
				at: instantToCanonicalString(revision.submittedAt),
				actorName: labels.submitterName,
			},
			...decisions.map((decision) => ({
				id: `evidence-decision-${decision.id}`,
				label: travelExpenseReportDecisionLabel(decision),
				at: instantToCanonicalString(decision.decidedAt),
				actorName: decision.labels.actorName,
			})),
		],
	});
	return { sections, decisionsBlocked: comparison.kind === "material_change" };
}
