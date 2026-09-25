import { and, eq } from "drizzle-orm";
import {
	type ApprovalPresentationProvider,
	approvalRequest,
	approvalWorkflowRollout,
	travelExpenseClaim,
} from "@/db/schema";
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
	formatPlainDate,
} from "@/lib/datetime/temporal-format";
import { readApprovalPresentationMode } from "../evidence/invocation";
import {
	isLegacyRequestInRevisionLifecycle,
	issueLegacyReviewBinding,
	type LegacyTravelExpenseSubmittedRevisionRecord,
	loadLegacyTravelExpenseSubmittedRevision,
	readApprovalEvidenceMode,
} from "../evidence/store";
import type { TravelExpenseMoney } from "../evidence/travel-expense-facts";
import { compareTravelExpenseWithSubmittedRevision } from "../evidence/travel-expense-submission";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalActionableCard, ApprovalCardDraft, ApprovalCardFact } from "./bound-card";
import { approvalReviewUrl } from "./review-navigation";

const MONEY_AMOUNT = /^\d{1,10}\.\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function money(value: TravelExpenseMoney | undefined): TravelExpenseMoney | null {
	return value && MONEY_AMOUNT.test(value.amount) && CURRENCY.test(value.currency)
		? value
		: null;
}

/**
 * The persisted decimal text in the recipient's number format. Two fraction
 * digits are kept exactly as stored: nothing is converted, rounded to a
 * currency's minor unit, or recalculated.
 */
function formatMoney(value: TravelExpenseMoney, locale: string): string {
	const amount = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Number(value.amount));
	return `${amount} ${value.currency}`;
}

function tripDateRange(
	dates: LegacyTravelExpenseSubmittedRevisionRecord["facts"]["tripDates"] | undefined,
	locale: string,
): string | null {
	if (!dates) return null;
	try {
		const first = formatPlainDate(parsePlainDate(dates.startDate), locale, "dateMedium");
		if (dates.startDate === dates.endDate) return first;
		return `${first} – ${formatPlainDate(parsePlainDate(dates.endDate), locale, "dateMedium")}`;
	} catch {
		return null;
	}
}

function claimTypeText(
	type: LegacyTravelExpenseSubmittedRevisionRecord["facts"]["claimType"],
	t: BotTranslateFn,
): string | null {
	switch (type) {
		case "receipt":
			return t("bot.approval.card.claimTypeReceipt", "Receipt");
		case "mileage":
			return t("bot.approval.card.claimTypeMileage", "Mileage");
		case "per_diem":
			return t("bot.approval.card.claimTypePerDiem", "Per diem");
		default:
			return null;
	}
}

/**
 * Platform-neutral card facts of an expense claim, from its frozen submission
 * only (#253 §3). Returns null when an essential fact is missing or
 * unintelligible: the employee, claim type, a reliably interpreted trip date
 * range, the persisted claim amount with its currency, and, for receipt claims,
 * the frozen receipt manifest. Logical dates never shift with the recipient;
 * the submission instant is shown in the recipient's zone and hour cycle.
 * Notes, receipt contents and file names stay in authenticated review, and no
 * reimbursement, exchange-rate, tax or policy figure is shown or derived.
 */
export function buildTravelExpenseCardFacts(
	revision: LegacyTravelExpenseSubmittedRevisionRecord,
	display: DisplayContext,
	t: BotTranslateFn,
): ApprovalCardFact[] | null {
	const { facts, labels } = revision;
	const claimType = claimTypeText(facts.claimType, t);
	const dates = tripDateRange(facts.tripDates, display.locale);
	const calculated = money(facts.money?.calculated);
	const original = money(facts.money?.original);
	const manifest = Array.isArray(facts.receipts?.manifest) ? facts.receipts.manifest : null;
	if (
		!labels.subjectName ||
		!claimType ||
		!dates ||
		!calculated ||
		!original ||
		!manifest ||
		(facts.receipts.required && manifest.length === 0)
	) {
		return null;
	}
	const unavailable = t("bot.approval.card.unavailable", "Unavailable");
	const result: ApprovalCardFact[] = [
		{ label: t("bot.approval.card.employee", "Employee"), value: labels.subjectName },
	];
	if (
		revision.submitter.kind !== "employee" ||
		revision.submitter.employeeId !== revision.requesterEmployeeId
	) {
		result.push({
			label: t("bot.approval.card.submittedBy", "Submitted by"),
			value: labels.submitterName ?? unavailable,
		});
	}
	result.push(
		{ label: t("bot.approval.card.claimType", "Claim type"), value: claimType },
		{ label: t("bot.approval.card.tripDates", "Trip dates"), value: dates },
		{
			// The persisted value, not proof of an independently calculated reimbursement.
			label: t("bot.approval.card.claimAmount", "Claim amount"),
			value: formatMoney(calculated, display.locale),
		},
	);
	if (original.amount !== calculated.amount || original.currency !== calculated.currency) {
		result.push({
			label: t("bot.approval.card.originalAmount", "Original amount"),
			value: formatMoney(original, display.locale),
		});
	}
	const destination = [facts.destination?.city, facts.destination?.country]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join(", ");
	if (destination) {
		result.push({
			label: t("bot.approval.card.destination", "Destination"),
			value: destination,
		});
	}
	if (facts.projectId && labels.projectName) {
		result.push({ label: t("bot.approval.card.project", "Project"), value: labels.projectName });
	}
	if (facts.receipts.required) {
		result.push({
			label: t("bot.approval.card.receipts", "Receipts"),
			value: t("bot.approval.card.receiptCount", "{count} attached", {
				count: manifest.length,
			}),
		});
	}
	result.push({
		label: t("bot.approval.card.submittedAt", "Submitted"),
		value: `${formatInstant(revision.submittedAt, display, "dateTimeMedium")} (${display.timezone})`,
	});
	return result;
}

/**
 * Prepares an actionable expense card for one recipient's exact pending legacy
 * request, or returns null so the caller shows a review-only notice. Every gate
 * must hold: legacy expense authority, evidence capture, an admitted provider,
 * a submitted claim whose frozen submission still matches the live claim, a
 * request that belongs to that submission's lifecycle, intelligible essential
 * facts and the provider's own limits. A binding is issued only for a card
 * that will be sent. Infrastructure errors propagate.
 */
export async function prepareBoundTravelExpenseCard(
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
	const [request] = await database
		.select({ claimId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.approvalRequestId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "travel_expense_claim"),
				eq(approvalRequest.approverId, input.recipientEmployeeId),
				eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1);
	if (!request) return null;
	const [rollout] = await database
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, organizationId),
				eq(approvalWorkflowRollout.workflowType, "travel_expense"),
			),
		)
		.limit(1);
	// Expense claims have legacy authority only; never bind under another.
	if (rollout?.mode === "canonical" || rollout?.mode === "complete") return null;
	const [evidenceMode, presentationMode] = await Promise.all([
		readApprovalEvidenceMode(database, { organizationId, workflowType: "travel_expense" }),
		readApprovalPresentationMode(database, {
			organizationId,
			workflowType: "travel_expense",
			provider: input.provider,
		}),
	]);
	if (evidenceMode !== "capture" || presentationMode !== "actionable") return null;
	const [claim] = await database
		.select({ status: travelExpenseClaim.status })
		.from(travelExpenseClaim)
		.where(
			and(
				eq(travelExpenseClaim.id, request.claimId),
				eq(travelExpenseClaim.organizationId, organizationId),
			),
		)
		.limit(1);
	if (claim?.status !== "submitted") return null;
	const revision = await loadLegacyTravelExpenseSubmittedRevision(database, {
		organizationId,
		claimId: request.claimId,
	});
	if (!revision) return null;
	const lifecycle = {
		sourceType: "travel_expense_claim",
		sourceId: revision.claimId,
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
	const comparison = await compareTravelExpenseWithSubmittedRevision(database, revision);
	if (comparison.kind !== "current") return null;
	const facts = buildTravelExpenseCardFacts(revision, input.display, input.t);
	if (!facts) return null;
	const { t } = input;
	const draft: ApprovalCardDraft = {
		status: "actionable",
		recipientUserId: input.recipientUserId,
		title: t("bot.approval.card.travelExpenseTitle", "Travel expense approval request"),
		facts,
		text: t(
			"bot.approval.card.boundHint",
			"Approve or reject decides exactly the request shown above. If it changed or was reassigned, nothing is decided and you are asked to review it in Z8.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		// Exact item; it stays reviewable as history after a decision, and
		// arrival rechecks membership and entitlement.
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
