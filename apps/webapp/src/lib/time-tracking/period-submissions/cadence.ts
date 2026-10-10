import {
	compareInstants,
	comparePlainDates,
	type Instant,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/** The days a weekly submission cadence can start its weeks on, in ISO order (Monday = 1). */
export const SUBMISSION_WEEKDAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;
export type SubmissionWeekday = (typeof SUBMISSION_WEEKDAYS)[number];

export const SUBMISSION_CADENCE_KINDS = ["off", "weekly", "monthly"] as const;
export type SubmissionCadenceKind = (typeof SUBMISSION_CADENCE_KINDS)[number];

/** A submission cadence that collects period submissions. */
export type ActiveSubmissionCadence =
	| { kind: "weekly"; weekStartDay: SubmissionWeekday }
	| { kind: "monthly" };

/**
 * An organization's submission cadence. A weekly cadence carries its own week start: a personal
 * week-start preference cannot define a period someone else approves.
 */
export type SubmissionCadence = { kind: "off" } | ActiveSubmissionCadence;

export const SUBMISSION_CADENCE_OFF: Readonly<SubmissionCadence> = Object.freeze({ kind: "off" });
export const DEFAULT_SUBMISSION_WEEK_START_DAY: SubmissionWeekday = "monday";

/** One saved cadence setting and the instant it was saved. The history is append-only. */
export interface SubmissionCadenceChange {
	cadence: SubmissionCadence;
	changedAt: Instant;
}

/**
 * The cadence in effect from `fromDate` (a local date in the timezone the timeline was built for)
 * until the next segment's `fromDate`.
 */
export interface SubmissionCadenceSegment {
	cadence: SubmissionCadence;
	fromDate: PlainDate;
}

/** A whole week or calendar month of an active cadence, both days inclusive. */
export interface CadencePeriodRange {
	startDate: PlainDate;
	endDate: PlainDate;
}

export function sameSubmissionCadence(left: SubmissionCadence, right: SubmissionCadence): boolean {
	if (left.kind === "weekly" && right.kind === "weekly") {
		return left.weekStartDay === right.weekStartDay;
	}
	return left.kind === right.kind;
}

function isoWeekday(day: SubmissionWeekday): number {
	return SUBMISSION_WEEKDAYS.indexOf(day) + 1;
}

/** The week or calendar month of `cadence` that contains `date`. */
export function cadencePeriodContaining(
	cadence: ActiveSubmissionCadence,
	date: PlainDate,
): CadencePeriodRange {
	if (cadence.kind === "weekly") {
		const startDate = date.subtract({
			days: (date.dayOfWeek - isoWeekday(cadence.weekStartDay) + 7) % 7,
		});
		return { startDate, endDate: startDate.add({ days: 6 }) };
	}
	const startDate = date.with({ day: 1 });
	return { startDate, endDate: startDate.add({ months: 1 }).subtract({ days: 1 }) };
}

/** Whether a period of `cadence` starts on `date`. Every day is a boundary of the off cadence. */
export function isSubmissionPeriodStart(cadence: SubmissionCadence, date: PlainDate): boolean {
	if (cadence.kind === "off") return true;
	return cadencePeriodContaining(cadence, date).startDate.equals(date);
}

function nextPeriodStartOnOrAfter(cadence: ActiveSubmissionCadence, date: PlainDate): PlainDate {
	const period = cadencePeriodContaining(cadence, date);
	return period.startDate.equals(date) ? date : period.endDate.add({ days: 1 });
}

/** Month starts repeat every weekday within 14 months; ten years is a generous bound. */
const SHARED_BOUNDARY_SEARCH_MONTHS = 120;

/**
 * The first date on or after `earliest` on which periods of both cadences start, or null when the
 * two never share a boundary (weekly cadences with different week starts).
 */
function firstSharedBoundary(
	previous: ActiveSubmissionCadence,
	next: ActiveSubmissionCadence,
	earliest: PlainDate,
): PlainDate | null {
	if (previous.kind === "weekly" && next.kind === "weekly") {
		return previous.weekStartDay === next.weekStartDay
			? nextPeriodStartOnOrAfter(next, earliest)
			: null;
	}
	const weekly = previous.kind === "weekly" ? previous : next.kind === "weekly" ? next : null;
	let monthStart = nextPeriodStartOnOrAfter({ kind: "monthly" }, earliest);
	if (!weekly) return monthStart;
	for (let month = 0; month < SHARED_BOUNDARY_SEARCH_MONTHS; month += 1) {
		if (isSubmissionPeriodStart(weekly, monthStart)) return monthStart;
		monthStart = monthStart.add({ months: 1 });
	}
	return null;
}

/**
 * The local date from which `next` replaces `previous`, for a change whose first possible day is
 * `earliest`: the next period boundary the two cadences share. Switching on therefore starts with
 * the first full period, and switching off ends at the end of the current period. Two weekly
 * cadences with different week starts never share a boundary; the new one then starts at the end
 * of the current week, and its first week is clipped to start there.
 */
function effectiveFromDate(
	previous: SubmissionCadence,
	next: SubmissionCadence,
	earliest: PlainDate,
): PlainDate {
	if (previous.kind === "off") {
		return next.kind === "off" ? earliest : nextPeriodStartOnOrAfter(next, earliest);
	}
	if (next.kind === "off") return nextPeriodStartOnOrAfter(previous, earliest);
	return (
		firstSharedBoundary(previous, next, earliest) ?? nextPeriodStartOnOrAfter(previous, earliest)
	);
}

function startOfDay(date: PlainDate, timezone: string): Instant {
	return date.toZonedDateTime(timezone).toInstant();
}

/** The first local date in `timezone` that starts at or after `instant`. */
function firstDayStartingAtOrAfter(instant: Instant, timezone: string): PlainDate {
	const day = plainDateAt(instant, timezone);
	return compareInstants(startOfDay(day, timezone), instant) === 0 ? day : day.add({ days: 1 });
}

/**
 * When each cadence of an organization's history is in effect, in `timezone`. Before the first
 * segment the cadence is off. A change replaces the cadence in effect at the instant it was saved,
 * from the next boundary the two share; a saved change that had not taken effect yet is superseded.
 * Saving the cadence already in effect changes nothing.
 */
export function submissionCadenceTimeline(
	history: readonly SubmissionCadenceChange[],
	timezone: string,
): SubmissionCadenceSegment[] {
	const changes = [...history].sort((left, right) =>
		compareInstants(left.changedAt, right.changedAt),
	);
	let segments: SubmissionCadenceSegment[] = [];
	for (const change of changes) {
		segments = segments.filter(
			(segment) => compareInstants(startOfDay(segment.fromDate, timezone), change.changedAt) < 0,
		);
		const current = segments.at(-1)?.cadence ?? SUBMISSION_CADENCE_OFF;
		if (sameSubmissionCadence(current, change.cadence)) continue;
		const earliest = firstDayStartingAtOrAfter(change.changedAt, timezone);
		segments.push({
			cadence: change.cadence,
			fromDate: effectiveFromDate(current, change.cadence, earliest),
		});
	}
	return segments;
}

/** The cadence in effect on `date` according to a timeline. */
export function submissionCadenceOn(
	timeline: readonly SubmissionCadenceSegment[],
	date: PlainDate,
): SubmissionCadence {
	let cadence: SubmissionCadence = SUBMISSION_CADENCE_OFF;
	for (const segment of timeline) {
		if (comparePlainDates(segment.fromDate, date) > 0) break;
		cadence = segment.cadence;
	}
	return cadence;
}

/** The cadence in effect at `now` and, when a saved change has not taken effect yet, that change. */
export interface SubmissionCadenceStatus {
	inEffect: SubmissionCadence;
	upcoming: SubmissionCadenceSegment | null;
}

/** Where the cadence history stands at `now`, in `timezone`. */
export function submissionCadenceStatusAt(
	history: readonly SubmissionCadenceChange[],
	timezone: string,
	now: Instant,
): SubmissionCadenceStatus {
	const timeline = submissionCadenceTimeline(history, timezone);
	const today = plainDateAt(now, timezone);
	return {
		inEffect: submissionCadenceOn(timeline, today),
		upcoming: timeline.find((segment) => comparePlainDates(segment.fromDate, today) > 0) ?? null,
	};
}

/**
 * A submission period as the cadence schedules it, before employment and coverage are applied.
 * `startDate`/`endDate` are clipped to the time its cadence was in effect; `cadenceStartDate` and
 * `cadenceEndDate` are the whole week or month, which identifies the period across employees.
 */
export interface ScheduledSubmissionPeriod {
	cadence: ActiveSubmissionCadence;
	cadenceStartDate: PlainDate;
	cadenceEndDate: PlainDate;
	startDate: PlainDate;
	endDate: PlainDate;
}

const maxDate = (left: PlainDate, right: PlainDate) =>
	comparePlainDates(left, right) >= 0 ? left : right;
const minDate = (left: PlainDate, right: PlainDate) =>
	comparePlainDates(left, right) <= 0 ? left : right;

/**
 * The periods the cadence history schedules in `timezone` that overlap `window` (both days
 * inclusive), in order.
 */
export function scheduledSubmissionPeriods(
	history: readonly SubmissionCadenceChange[],
	timezone: string,
	window: { from: PlainDate; to: PlainDate },
): ScheduledSubmissionPeriod[] {
	const timeline = submissionCadenceTimeline(history, timezone);
	const periods: ScheduledSubmissionPeriod[] = [];
	timeline.forEach((segment, index) => {
		const cadence = segment.cadence;
		if (cadence.kind === "off") return;
		const following = timeline[index + 1];
		const segmentEnd = following ? following.fromDate.subtract({ days: 1 }) : null;
		const last = segmentEnd ? minDate(segmentEnd, window.to) : window.to;
		let cursor = maxDate(segment.fromDate, window.from);
		while (comparePlainDates(cursor, last) <= 0) {
			const whole = cadencePeriodContaining(cadence, cursor);
			const startDate = maxDate(whole.startDate, segment.fromDate);
			const endDate = segmentEnd ? minDate(whole.endDate, segmentEnd) : whole.endDate;
			periods.push({
				cadence,
				cadenceStartDate: whole.startDate,
				cadenceEndDate: whole.endDate,
				startDate,
				endDate,
			});
			cursor = whole.endDate.add({ days: 1 });
		}
	});
	return periods;
}
