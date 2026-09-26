import { and, eq } from "drizzle-orm";
import {
	type ApprovalPresentationProvider,
	absenceCategory,
	absenceEntry,
	approvalRequest,
	approvalWorkflow,
	approvalWorkflowRollout,
} from "@/db/schema";
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
	formatPlainDate,
} from "@/lib/datetime/temporal-format";
import {
	type AbsenceRevisionComparison,
	type AbsenceSubmittedCoverage,
	compareLiveAbsenceWithRevision,
} from "../evidence/absence-facts";
import { readApprovalPresentationMode } from "../evidence/invocation";
import {
	hasLegacyAbsenceAuthority,
	LEGACY_ABSENCE_ACTIONABLE_PROVIDERS,
} from "../evidence/legacy-absence";
import {
	type AbsenceSubmittedRevisionRecord,
	isLegacyRequestInRevisionLifecycle,
	issueLegacyReviewBinding,
	issueReviewBinding,
	type ReviewBindingTarget,
	loadCurrentAbsenceSubmittedRevision,
	loadLegacyAbsenceSubmittedRevision,
	readApprovalEvidenceMode,
} from "../evidence/store";
import type { ApprovalDatabase } from "../server/types";
import { approvalReviewUrl } from "./review-navigation";

export interface ApprovalCardFact {
	label: string;
	value: string;
}

/**
 * A card whose controls are bound to exactly the facts it shows. The binding is
 * a handle, not authority: the decision transaction revalidates organization,
 * recipient, cycle, subject, assignment and submitted revision at commit.
 */
export interface ApprovalActionableCard {
	status: "actionable";
	recipientUserId: string;
	title: string;
	facts: ApprovalCardFact[];
	text: string;
	reviewLabel: string;
	reviewUrl: string;
	bindingId: string;
	approveLabel: string;
	rejectLabel: string;
}

/**
 * Submitted facts for a provider that cannot decide (#294): no binding and no
 * controls, only the exact item's review link.
 */
export interface ApprovalReviewSummary {
	status: "review_summary";
	recipientUserId: string;
	title: string;
	facts: ApprovalCardFact[];
	text: string;
	reviewLabel: string;
	reviewUrl: string;
}

/** Everything a provider renders, before a binding is issued for it. */
export type ApprovalCardDraft = Omit<ApprovalActionableCard, "bindingId">;

/** The exact pending assignment a card is prepared for. */
export type ApprovalCardTarget = Omit<
	ReviewBindingTarget,
	"submittedRevisionId"
>;

function dateRange(start: string, end: string, locale: string): string {
	const first = formatPlainDate(parsePlainDate(start), locale, "dateMedium");
	if (start === end) return first;
	return `${first} – ${formatPlainDate(parsePlainDate(end), locale, "dateMedium")}`;
}

function coverageText(
	coverage: AbsenceSubmittedCoverage,
	t: BotTranslateFn,
): string {
	switch (coverage.kind) {
		case "full_day":
			return t("bot.approval.card.fullDays", "Full days");
		case "half_day_periods": {
			const period = (value: "full_day" | "am" | "pm") =>
				value === "am"
					? t("bot.approval.card.morning", "morning")
					: value === "pm"
						? t("bot.approval.card.afternoon", "afternoon")
						: t("bot.approval.card.fullDay", "full day");
			return t(
				"bot.approval.card.halfDayPeriods",
				"Starts {start}, ends {end}",
				{
					start: period(coverage.startPeriod),
					end: period(coverage.endPeriod),
				},
			);
		}
		case "explicit_partial":
			// Entered wall-clock values; no zone was captured, so none is shown.
			return coverage.overnight
				? t(
						"bot.approval.card.explicitTimesOvernight",
						"{start} – {end} next day (local time, zone not recorded)",
						{ start: coverage.startTime, end: coverage.endTime },
					)
				: t(
						"bot.approval.card.explicitTimes",
						"{start} – {end} (local time, zone not recorded)",
						{ start: coverage.startTime, end: coverage.endTime },
					);
	}
}

/**
 * Card facts from the immutable submitted revision only. Returns null when the
 * card would not be intelligible or no longer matches the live request, so the
 * caller falls back to a review-only notice. Logical dates never shift with the
 * recipient; the submission instant is shown in the recipient's zone and hour
 * cycle, labelled with that zone.
 */
export function buildAbsenceCardFacts(
	// Either authority's revision: the facts never depend on who decides.
	revision: Omit<AbsenceSubmittedRevisionRecord, "workflowId">,
	comparison: AbsenceRevisionComparison,
	display: DisplayContext,
	t: BotTranslateFn,
): ApprovalCardFact[] | null {
	if (comparison.kind !== "current") return null;
	const { labels } = revision;
	if (!labels.subjectName || !labels.categoryName) return null;
	const unavailable = t("bot.approval.card.unavailable", "Unavailable");
	const facts: ApprovalCardFact[] = [
		{
			label: t("bot.approval.card.employee", "Employee"),
			value: labels.subjectName,
		},
	];
	if (revision.requesterEmployeeId !== revision.subjectEmployeeId) {
		facts.push({
			label: t("bot.approval.card.requestedBy", "Requested by"),
			value: labels.requesterName ?? unavailable,
		});
	}
	if (
		revision.submitter.kind !== "employee" ||
		revision.submitter.employeeId !== revision.requesterEmployeeId
	) {
		facts.push({
			label: t("bot.approval.card.submittedBy", "Submitted by"),
			value: labels.submitterName ?? unavailable,
		});
	}
	facts.push({
		label: t("bot.approval.card.category", "Category"),
		value: labels.categoryName,
	});
	for (const change of comparison.labelChanges) {
		facts.push({
			label: t(
				"bot.approval.card.currentCategoryName",
				"Current category name",
			),
			value: change.current ?? unavailable,
		});
	}
	const { coverage } = revision.facts;
	facts.push(
		{
			label: t("bot.approval.card.dates", "Dates"),
			value: dateRange(coverage.startDate, coverage.endDate, display.locale),
		},
		{
			label: t("bot.approval.card.coverage", "Coverage"),
			value: coverageText(coverage, t),
		},
		{
			label: t("bot.approval.card.submittedAt", "Submitted"),
			value: `${formatInstant(revision.submittedAt, display, "dateTimeMedium")} (${display.timezone})`,
		},
	);
	return facts;
}

/**
 * Facts from the immutable submitted revision for one recipient's exact
 * pending assignment, or null so the caller shows a review-only notice. Every
 * gate must hold: canonical absence authority, evidence capture, a current
 * submitted revision that still matches the live request, and intelligible
 * facts. Infrastructure errors propagate.
 */
async function loadAbsenceCardFacts(
	database: ApprovalDatabase,
	input: { target: ApprovalCardTarget; display: DisplayContext; t: BotTranslateFn },
): Promise<{ facts: ApprovalCardFact[]; submittedRevisionId: string } | null> {
	const { target } = input;
	const [workflow] = await database
		.select({
			workflowType: approvalWorkflow.workflowType,
			sourceType: approvalWorkflow.sourceType,
			sourceId: approvalWorkflow.sourceId,
			status: approvalWorkflow.status,
		})
		.from(approvalWorkflow)
		.where(
			and(
				eq(approvalWorkflow.organizationId, target.organizationId),
				eq(approvalWorkflow.id, target.workflowId),
			),
		)
		.limit(1);
	if (
		workflow?.workflowType !== "absence" ||
		workflow.sourceType !== "absence_entry" ||
		workflow.status !== "pending"
	) {
		return null;
	}
	const [rollout] = await database
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, target.organizationId),
				eq(approvalWorkflowRollout.workflowType, "absence"),
			),
		)
		.limit(1);
	if (rollout?.mode !== "canonical" && rollout?.mode !== "complete")
		return null;
	const evidenceMode = await readApprovalEvidenceMode(database, {
		organizationId: target.organizationId,
		workflowType: "absence",
	});
	if (evidenceMode !== "capture") return null;
	const revision = await loadCurrentAbsenceSubmittedRevision(database, {
		organizationId: target.organizationId,
		workflowId: target.workflowId,
	});
	if (!revision || revision.sourceId !== workflow.sourceId) return null;
	const live = await compareLiveAbsence(database, {
		organizationId: target.organizationId,
		absenceId: workflow.sourceId,
		revision,
	});
	if (!live) return null;
	const facts = buildAbsenceCardFacts(revision, live.comparison, input.display, input.t);
	return facts ? { facts, submittedRevisionId: revision.id } : null;
}

/**
 * The live absence compared with a submitted revision of either authority,
 * with the absence's status. Null when the source is missing or uncategorized.
 */
async function compareLiveAbsence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		absenceId: string;
		revision: Pick<AbsenceSubmittedRevisionRecord, "facts" | "labels">;
	},
): Promise<{ comparison: AbsenceRevisionComparison; status: string } | null> {
	const [live] = await database
		.select({
			id: absenceEntry.id,
			organizationId: absenceEntry.organizationId,
			employeeId: absenceEntry.employeeId,
			categoryId: absenceEntry.categoryId,
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
			status: absenceEntry.status,
			categoryName: absenceCategory.name,
		})
		.from(absenceEntry)
		.leftJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.id, input.absenceId),
			),
		)
		.limit(1);
	if (
		!live ||
		live.organizationId !== input.organizationId ||
		live.categoryId === null
	) {
		return null;
	}
	const comparison = compareLiveAbsenceWithRevision(
		input.revision.facts,
		input.revision.labels,
		{
			organizationId: input.organizationId,
			absenceId: live.id,
			employeeId: live.employeeId,
			categoryId: live.categoryId,
			startDate: live.startDate,
			startPeriod: live.startPeriod,
			endDate: live.endDate,
			endPeriod: live.endPeriod,
			categoryName: live.categoryName ?? null,
		},
	);
	return { comparison, status: live.status };
}

// Exact item; it stays reviewable as history after a decision, and arrival
// rechecks membership and entitlement.
function cardReviewUrl(target: ApprovalCardTarget, approvalRequestId: string) {
	return approvalReviewUrl({
		organizationId: target.organizationId,
		reference: { kind: "compatibility", approvalRequestId },
	});
}

/**
 * Prepares an actionable absence card for one recipient's exact pending
 * assignment, or returns null so the caller shows a review-only notice. Every
 * fact gate must hold, the provider must be admitted, and the card must fit
 * the provider's own limits (`fits`). A binding is issued only for a card
 * that will be sent. Infrastructure errors propagate.
 */
export async function prepareBoundAbsenceCard(
	database: ApprovalDatabase,
	input: {
		target: ApprovalCardTarget;
		provider: ApprovalPresentationProvider;
		/** Compatibility request of this stage; the review link's target. */
		approvalRequestId: string;
		recipientUserId: string;
		display: DisplayContext;
		t: BotTranslateFn;
		/** Provider limits; essential content never gets truncated controls. */
		fits?: (draft: ApprovalCardDraft) => boolean;
	},
): Promise<ApprovalActionableCard | null> {
	const { target, t } = input;
	const presentationMode = await readApprovalPresentationMode(database, {
		organizationId: target.organizationId,
		workflowType: "absence",
		provider: input.provider,
	});
	if (presentationMode !== "actionable") return null;
	const loaded = await loadAbsenceCardFacts(database, input);
	if (!loaded) return null;
	const draft = absenceCardDraft({
		recipientUserId: input.recipientUserId,
		facts: loaded.facts,
		reviewUrl: await cardReviewUrl(target, input.approvalRequestId),
		t,
	});
	if (input.fits && !input.fits(draft)) return null;
	const bindingId = await issueReviewBinding(database, {
		...target,
		submittedRevisionId: loaded.submittedRevisionId,
	});
	return { ...draft, bindingId };
}

function absenceCardDraft(input: {
	recipientUserId: string;
	facts: ApprovalCardFact[];
	reviewUrl: string;
	t: BotTranslateFn;
}): ApprovalCardDraft {
	const { t } = input;
	return {
		status: "actionable",
		recipientUserId: input.recipientUserId,
		title: t("bot.approval.card.absenceTitle", "Absence approval request"),
		facts: input.facts,
		text: t(
			"bot.approval.card.boundHint",
			"Approve or reject decides exactly the request shown above. If it changed or was reassigned, nothing is decided and you are asked to review it in Z8.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl: input.reviewUrl,
		approveLabel: t("bot.approval.card.approve", "Approve"),
		rejectLabel: t("bot.approval.card.reject", "Reject"),
	};
}

/**
 * Prepares an actionable card for one recipient's exact pending legacy absence
 * request (the stage's request for chains), bound to that request and the
 * legacy submitted revision of its submission cycle (#384), or returns null so
 * the caller shows a review-only notice. Every gate must hold: legacy absence
 * authority, evidence capture, an admitted provider, a pending absence whose
 * cycle revision still matches it, intelligible facts and the provider's own
 * limits. A shadow/ready observation is never consulted. A binding is issued
 * only for a card that will be sent. Infrastructure errors propagate.
 */
export async function prepareBoundLegacyAbsenceCard(
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
	if (!LEGACY_ABSENCE_ACTIONABLE_PROVIDERS.includes(input.provider)) return null;
	const [request] = await database
		.select({ absenceId: approvalRequest.entityId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.approvalRequestId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "absence_entry"),
				eq(approvalRequest.approverId, input.recipientEmployeeId),
				eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1);
	if (!request) return null;
	if (!(await hasLegacyAbsenceAuthority(database, organizationId))) return null;
	const [evidenceMode, presentationMode] = await Promise.all([
		readApprovalEvidenceMode(database, { organizationId, workflowType: "absence" }),
		readApprovalPresentationMode(database, {
			organizationId,
			workflowType: "absence",
			provider: input.provider,
		}),
	]);
	if (evidenceMode !== "capture" || presentationMode !== "actionable") return null;
	const revision = await loadLegacyAbsenceSubmittedRevision(database, {
		organizationId,
		absenceId: request.absenceId,
	});
	if (!revision) return null;
	const cycle = {
		sourceType: "absence_entry",
		sourceId: request.absenceId,
		legacy: revision.legacy,
	};
	if (
		!(await isLegacyRequestInRevisionLifecycle(database, {
			organizationId,
			approvalRequestId: input.approvalRequestId,
			revision: cycle,
		}))
	) {
		return null;
	}
	const live = await compareLiveAbsence(database, {
		organizationId,
		absenceId: request.absenceId,
		revision,
	});
	if (live?.status !== "pending") return null;
	const facts = buildAbsenceCardFacts(revision, live.comparison, input.display, input.t);
	if (!facts) return null;
	const draft = absenceCardDraft({
		recipientUserId: input.recipientUserId,
		facts,
		reviewUrl: await approvalReviewUrl({
			organizationId,
			reference: { kind: "compatibility", approvalRequestId: input.approvalRequestId },
		}),
		t: input.t,
	});
	if (input.fits && !input.fits(draft)) return null;
	const bindingId = await issueLegacyReviewBinding(database, {
		organizationId,
		recipientEmployeeId: input.recipientEmployeeId,
		legacyApprovalRequestId: input.approvalRequestId,
		submittedRevisionId: revision.id,
		revision: cycle,
	});
	return { ...draft, bindingId };
}

/**
 * The submitted facts without controls, for a provider that cannot decide
 * (Slack, #294). The same fact gates as an actionable card apply; nothing is
 * bound, and a summary that does not fit the provider's limits is not sent.
 */
export async function prepareAbsenceReviewSummary(
	database: ApprovalDatabase,
	input: {
		target: ApprovalCardTarget;
		approvalRequestId: string;
		recipientUserId: string;
		display: DisplayContext;
		t: BotTranslateFn;
		fits?: (summary: ApprovalReviewSummary) => boolean;
	},
): Promise<ApprovalReviewSummary | null> {
	const loaded = await loadAbsenceCardFacts(database, input);
	if (!loaded) return null;
	const { t } = input;
	const summary: ApprovalReviewSummary = {
		status: "review_summary",
		recipientUserId: input.recipientUserId,
		title: t("bot.approval.card.absenceTitle", "Absence approval request"),
		facts: loaded.facts,
		text: t(
			"bot.approval.card.reviewOnlyHint",
			"Approve or reject this request in Z8. It cannot be decided from this message.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl: await cardReviewUrl(input.target, input.approvalRequestId),
	};
	return input.fits && !input.fits(summary) ? null : summary;
}
