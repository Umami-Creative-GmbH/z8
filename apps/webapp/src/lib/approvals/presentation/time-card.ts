import { and, eq, inArray } from "drizzle-orm";
import {
	type ApprovalPresentationProvider,
	approvalWorkflow,
	approvalWorkflowRollout,
	workCategory,
} from "@/db/schema";
import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatCapturedOffsetInstant,
	formatInstant,
	formatUtcOffset,
} from "@/lib/datetime/temporal-format";
import { readApprovalPresentationMode } from "../evidence/invocation";
import {
	issueReviewBinding,
	loadCanonicalTimeCorrectionSubmittedRevision,
	loadCanonicalWorkPeriodSubmittedRevision,
	readApprovalEvidenceMode,
	type TimeCorrectionSubmittedRevisionRecord,
	type WorkPeriodSubmittedRevisionRecord,
} from "../evidence/store";
import { compareTimeCorrectionWithSubmittedRevision } from "../evidence/time-correction-evidence";
import { compareWorkPeriodWithSubmittedRevision } from "../evidence/work-period-evidence";
import type { WorkPeriodEndpointFacts } from "../evidence/work-period-facts";
import type { ApprovalDatabase } from "../server/types";
import { isTimeApprovalWorkflowType, type TimeApprovalWorkflowType } from "../time-approval-kinds";
import type {
	ApprovalActionableCard,
	ApprovalCardDraft,
	ApprovalCardFact,
	ApprovalCardTarget,
	ApprovalReviewSummary,
} from "./bound-card";
import { approvalReviewUrl } from "./review-navigation";

/**
 * An endpoint's full local date and time in the offset captured with that
 * event, labelled with it. The recipient's zone never reinterprets it; only
 * locale and hour cycle are the recipient's.
 */
function endpointText(endpoint: WorkPeriodEndpointFacts, display: DisplayContext): string {
	const local = formatCapturedOffsetInstant(parseInstant(endpoint.at), {
		locale: display.locale,
		timeFormat: display.timeFormat,
		offsetMinutes: endpoint.utcOffsetMinutes,
	});
	return `${local} (${formatUtcOffset(endpoint.utcOffsetMinutes)})`;
}

/** Stored minutes as persisted; never recomputed from the endpoints. */
function minutesText(minutes: number, t: BotTranslateFn): string {
	return t("bot.approval.card.durationMinutes", "{hours} h {minutes} min", {
		hours: Math.floor(minutes / 60),
		minutes: minutes % 60,
	});
}

/** UTC elapsed time between the endpoints, kept apart from stored minutes. */
function elapsedText(seconds: number, t: BotTranslateFn): string {
	const whole = Math.floor(seconds);
	const params = {
		hours: Math.floor(whole / 3600),
		minutes: Math.floor((whole % 3600) / 60),
		seconds: whole % 60,
	};
	return params.seconds === 0
		? t("bot.approval.card.durationMinutes", "{hours} h {minutes} min", params)
		: t("bot.approval.card.durationSeconds", "{hours} h {minutes} min {seconds} s", params);
}

function submittedAtText(
	instant: WorkPeriodSubmittedRevisionRecord["submittedAt"],
	display: DisplayContext,
) {
	return `${formatInstant(instant, display, "dateTimeMedium")} (${display.timezone})`;
}

type TimeRevision = Pick<
	WorkPeriodSubmittedRevisionRecord,
	"labels" | "submitter" | "requesterEmployeeId" | "subjectEmployeeId"
>;

/**
 * Employee ownership, then the requester and the separately evidenced
 * submitting human where they differ. Null without the employee label.
 */
function roleFacts(revision: TimeRevision, t: BotTranslateFn): ApprovalCardFact[] | null {
	const { labels } = revision;
	if (!labels.subjectName) return null;
	const unavailable = t("bot.approval.card.unavailable", "Unavailable");
	const facts: ApprovalCardFact[] = [
		{ label: t("bot.approval.card.employee", "Employee"), value: labels.subjectName },
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
	return facts;
}

/**
 * Card facts of a manual time submission or policy clock-out from its
 * submitted revision only (#253 §3). There is no before state. Returns null
 * when an essential fact is missing, so the card becomes review-only.
 */
export function buildWorkPeriodCardFacts(
	revision: WorkPeriodSubmittedRevisionRecord,
	display: DisplayContext,
	t: BotTranslateFn,
): ApprovalCardFact[] | null {
	const roles = roleFacts(revision, t);
	if (!roles) return null;
	const { interval } = revision.facts;
	const { facts } = revision;
	// A break snapshot only discloses a possible adjustment; the numerical
	// deduction exists only as committed result evidence.
	const breakAdjustment: ApprovalCardFact[] =
		facts.policy.kind === "policy_clock_out" && facts.policy.breakAdjustment === "may_apply"
			? [
					{
						label: t("bot.approval.card.breakAdjustment", "Break adjustment"),
						value: t(
							"bot.approval.card.breakAdjustmentMayApply",
							"May apply when approved; the result is recorded separately",
						),
					},
				]
			: [];
	return [
		...roles,
		{
			label: t("bot.approval.card.clockIn", "Clock in"),
			value: endpointText(interval.clockIn, display),
		},
		{
			label: t("bot.approval.card.clockOut", "Clock out"),
			value: endpointText(interval.clockOut, display),
		},
		{
			label: t("bot.approval.card.submittedDuration", "Submitted duration"),
			value: minutesText(interval.storedDurationMinutes, t),
		},
		{
			label: t("bot.approval.card.elapsedTime", "Elapsed time"),
			value: elapsedText(interval.elapsedSeconds, t),
		},
		...breakAdjustment,
		{
			label: t("bot.approval.card.submittedAt", "Submitted"),
			value: submittedAtText(revision.submittedAt, display),
		},
	];
}

const REQUEST_TEXT = {
	edit: { key: "bot.approval.card.correctionEdit", fallback: "Change times" },
	metadata_only: { key: "bot.approval.card.correctionMetadata", fallback: "Change work details" },
	delete: { key: "bot.approval.card.correctionDelete", fallback: "Delete this entry" },
} as const;

/**
 * Card facts of a time correction from its submitted revision only (#253 §3):
 * the affected entry as it stood, the requested change of each changed
 * endpoint or detail (before → requested), or an explicit deletion request.
 * Deletion markers are never shown as proposed working times. Returns null
 * when the proposal would not be intelligible, so the card is review-only.
 */
export function buildTimeCorrectionCardFacts(
	revision: TimeCorrectionSubmittedRevisionRecord,
	/** Current names of the categories the proposal names; null = unavailable. */
	categoryNames: Readonly<Record<string, string | null>>,
	display: DisplayContext,
	t: BotTranslateFn,
): ApprovalCardFact[] | null {
	const roles = roleFacts(revision, t);
	if (!roles) return null;
	const { baseline, requested, changeMask, intent } = revision.facts;
	// A change the mask names but the proposal does not carry is contradictory
	// essential evidence (#253 §5.3): no actionable card.
	if (
		(changeMask.clockIn && !requested.clockIn) ||
		(changeMask.clockOut && !requested.clockOut) ||
		(changeMask.workLocation && requested.workLocationType.kind !== "set") ||
		(changeMask.workCategory && requested.workCategoryId.kind !== "set")
	) {
		return null;
	}
	const request = REQUEST_TEXT[intent];
	const entryEnd = baseline.clockOut
		? endpointText(baseline.clockOut, display)
		: t("bot.approval.card.stillRunning", "still running");
	const facts: ApprovalCardFact[] = [
		...roles,
		{ label: t("bot.approval.card.request", "Request"), value: t(request.key, request.fallback) },
		{
			label: t("bot.approval.card.entry", "Entry"),
			value: `${endpointText(baseline.clockIn, display)} – ${entryEnd}`,
		},
	];
	if (baseline.storedDurationMinutes !== null) {
		facts.push({
			label: t("bot.approval.card.durationBefore", "Duration before"),
			value: minutesText(baseline.storedDurationMinutes, t),
		});
	}
	if (intent === "edit") {
		const change = (before: WorkPeriodEndpointFacts | null, after: WorkPeriodEndpointFacts) =>
			`${before ? endpointText(before, display) : t("bot.approval.card.none", "None")} → ${endpointText(after, display)}`;
		if (changeMask.clockIn && requested.clockIn) {
			facts.push({
				label: t("bot.approval.card.clockIn", "Clock in"),
				value: change(baseline.clockIn, {
					...requested.clockIn,
					entryId: requested.clockIn.correctionEntryId,
				}),
			});
		}
		if (changeMask.clockOut && requested.clockOut) {
			facts.push({
				label: t("bot.approval.card.clockOut", "Clock out"),
				value: change(baseline.clockOut, {
					...requested.clockOut,
					entryId: requested.clockOut.correctionEntryId,
				}),
			});
		}
	}
	if (intent !== "delete") {
		if (changeMask.workLocation && requested.workLocationType.kind === "set") {
			facts.push({
				label: t("bot.approval.card.workLocation", "Work location"),
				value: `${workLocationText(baseline.attribution.workLocationType, t)} → ${workLocationText(requested.workLocationType.value, t)}`,
			});
		}
		if (changeMask.workCategory && requested.workCategoryId.kind === "set") {
			const before = categoryText(baseline.attribution.workCategoryId, categoryNames, t);
			const after = categoryText(requested.workCategoryId.value, categoryNames, t);
			// No stored request-time name exists; an unnamed category is unintelligible.
			if (before === null || after === null) return null;
			facts.push({
				label: t("bot.approval.card.categoryCurrentNames", "Category (current names)"),
				value: `${before} → ${after}`,
			});
		}
	}
	facts.push({
		label: t("bot.approval.card.submittedAt", "Submitted"),
		value: submittedAtText(revision.submittedAt, display),
	});
	return facts;
}

const WORK_LOCATIONS: Readonly<Record<string, { key: string; fallback: string }>> = {
	office: { key: "bot.approval.card.workLocationOffice", fallback: "Office" },
	home: { key: "bot.approval.card.workLocationHome", fallback: "Home" },
	remote: { key: "bot.approval.card.workLocationRemote", fallback: "Remote" },
	other: { key: "bot.approval.card.workLocationOther", fallback: "Other" },
};

function workLocationText(value: string | null, t: BotTranslateFn): string {
	const label = value ? WORK_LOCATIONS[value] : undefined;
	if (label) return t(label.key, label.fallback);
	return value ?? t("bot.approval.card.notSet", "Not set");
}

/** An explicit null is "no category"; a named category without a name is unintelligible. */
function categoryText(
	id: string | null,
	names: Readonly<Record<string, string | null>>,
	t: BotTranslateFn,
): string | null {
	if (id === null) return t("bot.approval.card.noCategory", "No category");
	return names[id] ?? null;
}

const TITLES: Readonly<Record<TimeApprovalWorkflowType, { key: string; fallback: string }>> = {
	manual_time_submission: {
		key: "bot.approval.card.manualTimeTitle",
		fallback: "Manual time approval request",
	},
	policy_clock_out: {
		key: "bot.approval.card.clockOutTitle",
		fallback: "Clock-out approval request",
	},
	time_correction: {
		key: "bot.approval.card.timeCorrectionTitle",
		fallback: "Time correction approval request",
	},
};

/** Current names of the categories a correction names, scoped to the organization. */
export async function loadTimeCorrectionCategoryNames(
	database: ApprovalDatabase,
	organizationId: string,
	revision: TimeCorrectionSubmittedRevisionRecord,
): Promise<Record<string, string | null>> {
	const { baseline, requested } = revision.facts;
	const ids = [
		baseline.attribution.workCategoryId,
		requested.workCategoryId.kind === "set" ? requested.workCategoryId.value : null,
	].filter((id): id is string => id !== null);
	if (ids.length === 0) return {};
	const rows = await database
		.select({ id: workCategory.id, name: workCategory.name })
		.from(workCategory)
		.where(and(eq(workCategory.organizationId, organizationId), inArray(workCategory.id, ids)));
	return Object.fromEntries(ids.map((id) => [id, rows.find((row) => row.id === id)?.name ?? null]));
}

/**
 * Facts from the immutable submitted revision for one recipient's exact
 * pending canonical assignment, or null so the caller shows a review-only
 * notice. Every gate must hold: a pending time workflow with canonical
 * authority, evidence capture, a submitted revision that still matches the
 * live work graph, and intelligible facts. Infrastructure errors propagate.
 */
async function loadTimeCardFacts(
	database: ApprovalDatabase,
	input: { target: ApprovalCardTarget; display: DisplayContext; t: BotTranslateFn },
): Promise<{
	facts: ApprovalCardFact[];
	submittedRevisionId: string;
	workflowType: TimeApprovalWorkflowType;
} | null> {
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
		!workflow ||
		!isTimeApprovalWorkflowType(workflow.workflowType) ||
		workflow.sourceType !== "time_entry" ||
		workflow.status !== "pending"
	) {
		return null;
	}
	const workflowType = workflow.workflowType;
	const [rollout] = await database
		.select({ mode: approvalWorkflowRollout.lifecycleMode })
		.from(approvalWorkflowRollout)
		.where(
			and(
				eq(approvalWorkflowRollout.organizationId, target.organizationId),
				eq(approvalWorkflowRollout.workflowType, workflowType),
			),
		)
		.limit(1);
	if (rollout?.mode !== "canonical" && rollout?.mode !== "complete") return null;
	const evidenceMode = await readApprovalEvidenceMode(database, {
		organizationId: target.organizationId,
		workflowType,
	});
	if (evidenceMode !== "capture") return null;
	const scope = { organizationId: target.organizationId, workflowId: target.workflowId };
	if (workflowType === "time_correction") {
		const revision = await loadCanonicalTimeCorrectionSubmittedRevision(database, scope);
		if (!revision || revision.workPeriodId !== workflow.sourceId) return null;
		const comparison = await compareTimeCorrectionWithSubmittedRevision(database, revision);
		if (comparison.kind !== "current") return null;
		const names = await loadTimeCorrectionCategoryNames(database, target.organizationId, revision);
		const facts = buildTimeCorrectionCardFacts(revision, names, input.display, input.t);
		return facts ? { facts, submittedRevisionId: revision.id, workflowType } : null;
	}
	const revision = await loadCanonicalWorkPeriodSubmittedRevision(database, scope);
	if (
		!revision ||
		revision.workflowType !== workflowType ||
		revision.workPeriodId !== workflow.sourceId
	) {
		return null;
	}
	const comparison = await compareWorkPeriodWithSubmittedRevision(database, revision);
	if (comparison.kind !== "current") return null;
	const facts = buildWorkPeriodCardFacts(revision, input.display, input.t);
	return facts ? { facts, submittedRevisionId: revision.id, workflowType } : null;
}

/**
 * Prepares an actionable time approval card (manual submission, policy
 * clock-out or correction) for one recipient's exact pending canonical
 * assignment, or returns null so the caller shows a review-only notice (#325).
 * The provider must be admitted for the kind and the card must fit its limits;
 * a binding is issued only for a card that will be sent.
 */
export async function prepareBoundTimeCard(
	database: ApprovalDatabase,
	input: {
		target: ApprovalCardTarget;
		provider: ApprovalPresentationProvider;
		/** Compatibility request of this stage; the review link's target. */
		approvalRequestId: string;
		recipientUserId: string;
		display: DisplayContext;
		t: BotTranslateFn;
		fits?: (draft: ApprovalCardDraft) => boolean;
	},
): Promise<ApprovalActionableCard | null> {
	const loaded = await loadTimeCardFacts(database, input);
	if (!loaded) return null;
	const presentationMode = await readApprovalPresentationMode(database, {
		organizationId: input.target.organizationId,
		workflowType: loaded.workflowType,
		provider: input.provider,
	});
	if (presentationMode !== "actionable") return null;
	const { t } = input;
	const title = TITLES[loaded.workflowType];
	const draft: ApprovalCardDraft = {
		status: "actionable",
		recipientUserId: input.recipientUserId,
		title: t(title.key, title.fallback),
		facts: loaded.facts,
		text: t(
			"bot.approval.card.boundHint",
			"Approve or reject decides exactly the request shown above. If it changed or was reassigned, nothing is decided and you are asked to review it in Z8.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl: await approvalReviewUrl({
			organizationId: input.target.organizationId,
			reference: { kind: "compatibility", approvalRequestId: input.approvalRequestId },
		}),
		approveLabel: t("bot.approval.card.approve", "Approve"),
		rejectLabel: t("bot.approval.card.reject", "Reject"),
	};
	if (input.fits && !input.fits(draft)) return null;
	const bindingId = await issueReviewBinding(database, {
		...input.target,
		submittedRevisionId: loaded.submittedRevisionId,
	});
	return { ...draft, bindingId };
}

/**
 * The submitted facts without controls, for a provider that cannot decide
 * (Slack). The same fact gates as an actionable card apply; nothing is bound.
 */
export async function prepareTimeReviewSummary(
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
	const loaded = await loadTimeCardFacts(database, input);
	if (!loaded) return null;
	const { t } = input;
	const title = TITLES[loaded.workflowType];
	const summary: ApprovalReviewSummary = {
		status: "review_summary",
		recipientUserId: input.recipientUserId,
		title: t(title.key, title.fallback),
		facts: loaded.facts,
		text: t(
			"bot.approval.card.reviewOnlyHint",
			"Approve or reject this request in Z8. It cannot be decided from this message.",
		),
		reviewLabel: t("bot.approval.reviewInZ8", "Review in Z8"),
		reviewUrl: await approvalReviewUrl({
			organizationId: input.target.organizationId,
			reference: { kind: "compatibility", approvalRequestId: input.approvalRequestId },
		}),
	};
	return input.fits && !input.fits(summary) ? null : summary;
}
