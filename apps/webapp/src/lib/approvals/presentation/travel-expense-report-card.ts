import { and, eq } from "drizzle-orm";
import {
	type ApprovalPresentationProvider,
	approvalRequest,
	travelExpenseReport,
} from "@/db/schema";
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
	formatPlainDate,
} from "@/lib/datetime/temporal-format";
import { readApprovalAuthoritySnapshot } from "../authority";
import { readApprovalPresentationMode } from "../evidence/invocation";
import { isLegacyRequestInRevisionLifecycle, issueLegacyReviewBinding } from "../evidence/store";
import { TRAVEL_EXPENSE_REPORT_ACTIONABLE_PROVIDERS } from "../evidence/travel-expense-report-cards";
import {
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "../evidence/travel-expense-report-store";
import { compareTravelExpenseReportWithSubmittedRevision } from "../evidence/travel-expense-report-submission";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalActionableCard, ApprovalCardDraft, ApprovalCardFact } from "./bound-card";
import { approvalReviewUrl } from "./review-navigation";

const MONEY_AMOUNT = /^\d{1,10}\.\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

interface Money {
	amount: string;
	currency: string;
}

function money(amount: unknown, currency: unknown): Money | null {
	return typeof amount === "string" &&
		typeof currency === "string" &&
		MONEY_AMOUNT.test(amount) &&
		CURRENCY.test(currency)
		? { amount, currency }
		: null;
}

/**
 * The frozen decimal text in the recipient's number format. Two fraction
 * digits are kept exactly as frozen: nothing is converted or recalculated.
 */
function formatMoney(value: Money, locale: string): string {
	const amount = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Number(value.amount));
	return `${amount} ${value.currency}`;
}

function plainDateRange(start: string, end: string, locale: string): string | null {
	try {
		const first = formatPlainDate(parsePlainDate(start), locale, "dateMedium");
		if (start === end) return first;
		return `${first} – ${formatPlainDate(parsePlainDate(end), locale, "dateMedium")}`;
	} catch {
		return null;
	}
}

/**
 * Platform-neutral card facts of an expense report, from its frozen
 * submission only (#623). Returns null when an essential fact is missing or
 * unintelligible: the employee, at least one expense, every expense's frozen
 * receipt, the frozen totals and, for a trip, its calendar days. A report the
 * card cannot state stays review-only; the web inbox still decides it.
 * Trip days never shift with the recipient; the submission instant is shown in
 * the recipient's zone. Item descriptions, receipt contents and file names
 * stay in authenticated review, and no amount is derived or converted.
 */
export function buildTravelExpenseReportCardFacts(
	revision: Pick<
		TravelExpenseReportSubmittedRevisionRecord,
		"facts" | "labels" | "submitter" | "requesterEmployeeId" | "submittedAt"
	>,
	display: DisplayContext,
	t: BotTranslateFn,
): ApprovalCardFact[] | null {
	const { facts, labels } = revision;
	const reimbursable = money(facts.totals?.reimbursable, facts.totals?.currency);
	const companyPaid = money(facts.totals?.companyPaid, facts.totals?.currency);
	const items = Array.isArray(facts.items) ? facts.items : [];
	const tripDates = facts.trip
		? plainDateRange(facts.trip.startDate, facts.trip.endDate, display.locale)
		: null;
	if (
		!labels.subjectName ||
		items.length === 0 ||
		// A report without a receipt for every expense (e.g. an accepted
		// exception, #604) needs authenticated review.
		items.some((item) => !Array.isArray(item.receipts) || item.receipts.length === 0) ||
		// An adjustment's signed delta and baseline are reviewed on the web (#615).
		facts.adjustment ||
		!reimbursable ||
		!companyPaid ||
		(facts.trip && !tripDates)
	) {
		return null;
	}
	const result: ApprovalCardFact[] = [
		{ label: t("bot.approval.card.employee", "Employee"), value: labels.subjectName },
	];
	if (
		revision.submitter.kind !== "employee" ||
		revision.submitter.employeeId !== revision.requesterEmployeeId
	) {
		result.push({
			label: t("bot.approval.card.submittedBy", "Submitted by"),
			value: labels.submitterName ?? t("bot.approval.card.unavailable", "Unavailable"),
		});
	}
	result.push({
		label: t("bot.approval.card.report", "Report"),
		value: facts.trip
			? t("bot.approval.card.reportTrip", "Trip")
			: t("bot.approval.card.reportStandalone", "Standalone expense"),
	});
	if (facts.trip && tripDates) {
		const destinations = facts.trip.destinations
			.map((destination) => [destination.place, destination.countryCode].filter(Boolean).join(", "))
			.filter((destination) => destination.length > 0)
			.join("; ");
		result.push(
			{ label: t("bot.approval.card.purpose", "Purpose"), value: facts.trip.purpose },
			{ label: t("bot.approval.card.tripDates", "Trip dates"), value: tripDates },
		);
		if (destinations) {
			result.push({
				label: t("bot.approval.card.destination", "Destination"),
				value: destinations,
			});
		}
	}
	result.push(
		{ label: t("bot.approval.card.expenses", "Expenses"), value: String(items.length) },
		{
			// The frozen server-calculated total, never a converted or derived figure.
			label: t("bot.approval.card.reimbursable", "Reimbursable to employee"),
			value: formatMoney(reimbursable, display.locale),
		},
	);
	if (companyPaid.amount !== "0.00") {
		result.push({
			label: t("bot.approval.card.companyPaid", "Paid by company"),
			value: formatMoney(companyPaid, display.locale),
		});
	}
	result.push(
		{
			label: t("bot.approval.card.receipts", "Receipts"),
			value: t("bot.approval.card.receiptCount", "{count} attached", {
				count: items.reduce((total, item) => total + item.receipts.length, 0),
			}),
		},
		{
			label: t("bot.approval.card.submittedAt", "Submitted"),
			value: `${formatInstant(revision.submittedAt, display, "dateTimeMedium")} (${display.timezone})`,
		},
	);
	return result;
}

/**
 * Prepares an actionable report card for one recipient's exact pending legacy
 * request, or returns null so the caller shows a review-only notice. Every
 * gate must hold: an admitted provider (Telegram first), legacy expense
 * authority, a submitted report whose current cycle's frozen revision still
 * matches its live rows, a request that belongs to that cycle's lifecycle,
 * intelligible essential facts and the provider's own limits. A binding is
 * issued only for a card that will be sent. Reports are always frozen at
 * submission, so the expense capture control is not consulted.
 * Infrastructure errors propagate.
 */
export async function prepareBoundTravelExpenseReportCard(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		approvalRequestId: string;
		recipientEmployeeId: string;
		recipientUserId: string;
		provider: ApprovalPresentationProvider;
		display: DisplayContext;
		t: BotTranslateFn;
		fits?: (draft: ApprovalCardDraft) => boolean;
	},
): Promise<ApprovalActionableCard | null> {
	const { organizationId } = input;
	if (!TRAVEL_EXPENSE_REPORT_ACTIONABLE_PROVIDERS.includes(input.provider)) return null;
	const [request] = await database
		.select({ reportId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.approvalRequestId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, TRAVEL_EXPENSE_REPORT_SOURCE_TYPE),
				eq(approvalRequest.approverId, input.recipientEmployeeId),
				eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1);
	if (!request) return null;
	// Reports have legacy authority only; never bind under another.
	const { authority } = await readApprovalAuthoritySnapshot(database, {
		organizationId,
		workflowType: "travel_expense",
	});
	if (authority !== "legacy") return null;
	const presentationMode = await readApprovalPresentationMode(database, {
		organizationId,
		workflowType: "travel_expense",
		provider: input.provider,
	});
	if (presentationMode !== "actionable") return null;
	const [report] = await database
		.select({
			status: travelExpenseReport.status,
			submissionCount: travelExpenseReport.submissionCount,
		})
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, request.reportId),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		)
		.limit(1);
	if (report?.status !== "submitted") return null;
	// The current cycle's revision: an earlier cycle's request never binds.
	const revision = await loadTravelExpenseReportSubmittedRevision(database, {
		organizationId,
		reportId: request.reportId,
		submissionCycle: report.submissionCount,
	});
	if (!revision) return null;
	const lifecycle = {
		sourceType: TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
		sourceId: revision.reportId,
		legacy: revision.legacy,
	};
	if (
		!(await isLegacyRequestInRevisionLifecycle(database, {
			organizationId,
			approvalRequestId: input.approvalRequestId,
			revision: lifecycle,
		}))
	) {
		return null;
	}
	const comparison = await compareTravelExpenseReportWithSubmittedRevision(database, revision);
	if (comparison.kind !== "current") return null;
	const facts = buildTravelExpenseReportCardFacts(revision, input.display, input.t);
	if (!facts) return null;
	const { t } = input;
	const draft: ApprovalCardDraft = {
		status: "actionable",
		recipientUserId: input.recipientUserId,
		title: t("bot.approval.card.travelExpenseReportTitle", "Expense report approval request"),
		facts,
		text: t(
			"bot.approval.card.boundHint",
			"Approve or reject decides exactly the request shown above. If it changed or was reassigned, nothing is decided and you are asked to review it in Z8.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl: await approvalReviewUrl({
			organizationId,
			reference: { kind: "compatibility", approvalRequestId: input.approvalRequestId },
		}),
		approveLabel: t("bot.approval.card.approve", "Approve"),
		rejectLabel: t("bot.approval.card.reject", "Reject"),
	};
	if (input.fits && !input.fits(draft)) return null;
	const bindingId = await issueLegacyReviewBinding(database, {
		organizationId,
		recipientEmployeeId: input.recipientEmployeeId,
		legacyApprovalRequestId: input.approvalRequestId,
		submittedRevisionId: revision.id,
		revision: lifecycle,
	});
	return { ...draft, bindingId };
}
