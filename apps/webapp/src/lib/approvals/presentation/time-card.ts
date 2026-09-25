import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatCapturedOffsetInstant,
	formatInstant,
	formatUtcOffset,
} from "@/lib/datetime/temporal-format";
import type {
	TimeCorrectionSubmittedRevisionRecord,
	WorkPeriodSubmittedRevisionRecord,
} from "../evidence/store";
import type { WorkPeriodEndpointFacts } from "../evidence/work-period-facts";
import type { ApprovalCardFact } from "./bound-card";

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

function submittedAtText(instant: WorkPeriodSubmittedRevisionRecord["submittedAt"], display: DisplayContext) {
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
		{ label: t("bot.approval.card.clockIn", "Clock in"), value: endpointText(interval.clockIn, display) },
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
				value: change(baseline.clockIn, { ...requested.clockIn, entryId: requested.clockIn.correctionEntryId }),
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
