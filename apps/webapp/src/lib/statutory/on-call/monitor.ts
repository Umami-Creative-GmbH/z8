/**
 * § 12 TzBfG on-call monitor (#1992). For employees whose effective terms say `schedule_source =
 * 'on_call'` it judges, in the organization's calendar:
 *
 * - **Call-in notice** (§ 12 Abs. 3): four full calendar days between the notification day and
 *   the shift day. A shorter notice is only fine with the employee's voluntary agreement, which
 *   an org admin documents as an `on_call_short_notice_agreement` acknowledgement.
 * - **Minimum call** (§ 12 Abs. 1 Satz 4): each call lasts at least the agreed daily minutes, or
 *   the statutory minimum (three hours) when none is agreed — for each planned call and each
 *   finished worked call (touching shifts or work periods, or work within one planned shift).
 * - **Weekly call-off band** (§ 12 Abs. 2): per compliance week (Monday–Sunday) the planned and
 *   worked minutes stay inside the band of the agreed weekly minutes: `minimum` from the agreement
 *   up to +25 %, `maximum` from −20 % up to the agreement, `exact` exactly the agreement,
 *   `unspecified` exactly the statutory default (20 h, § 12 Abs. 1 Satz 3). A running clock-in
 *   counts up to now. Days of approved absence and public holidays that were not worked are paid
 *   by § 12 Abs. 4–5 instead of called: the band is prorated to the remaining days.
 *
 * Every limit comes from `statutory_threshold` for the day judged. Findings carry minutes and
 * days only, never wages. Read-only; it never blocks anything.
 */
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { isNewShiftCallIn } from "@/lib/scheduling/shift-assignment-change";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutorySeverity,
	type StatutoryUsageTier,
	statutoryFindingId,
} from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import { DEFAULT_STATUTORY_PREFERENCES, type StatutoryPreferences } from "../preferences";
import type { StatutoryProposedShift } from "../scheduling/contributor";
import {
	daysOf,
	loadOnCallFacts,
	type OnCallFacts,
	type OnCallReader,
	type OnCallShift,
	type OnCallWorkCall,
	type OnCallWorkPiece,
	overlapMinutes,
	shiftMinutes,
} from "./facts";
import { fullNoticeDays, notificationDay, shiftNotificationInstant } from "./notice";

export const onCallFindingKinds = [
	"on_call_short_notice",
	"on_call_short_call",
	"on_call_short_work_call",
	"on_call_weekly_over_band",
	"on_call_weekly_under_band",
] as const;
export type OnCallFindingKind = (typeof onCallFindingKinds)[number];
export type OnCallFinding = StatutoryFinding<OnCallFindingKind>;

export function isOnCallFindingKind(kind: string): kind is OnCallFindingKind {
	return (onCallFindingKinds as readonly string[]).includes(kind);
}

export interface OnCallEvaluationRequest {
	readonly organizationId: string;
	/** Organization calendar timezone. */
	readonly timezone: string;
	/** Organization-local days judged, `[start, endExclusive)`; whole weeks are summed for bands. */
	readonly window: { readonly start: string; readonly endExclusive: string };
	/** Null or left out: every on-call employee of the organization. */
	readonly employeeIds?: readonly string[] | null;
	readonly proposedShifts?: readonly StatutoryProposedShift[];
	readonly replacesShiftId?: string | null;
	/**
	 * Judge published shifts only, for readers who never see drafts (the employee's own status).
	 * Left out: drafts count too, as planners see them.
	 */
	readonly publishedShiftsOnly?: boolean;
	readonly preferences?: StatutoryPreferences;
	/** Notification instant of unpublished shifts and "today" for completed weeks and days. */
	readonly now: Instant;
}

const NOTICE_REFERENCE = "§ 12 Abs. 3 TzBfG";
const MINIMUM_CALL_REFERENCE = "§ 12 Abs. 1 Satz 4 TzBfG";
const BAND_REFERENCE = "§ 12 Abs. 2 TzBfG";
const DEFAULT_WEEK_REFERENCE = "§ 12 Abs. 1 Satz 3 TzBfG";

function mondayOf(day: PlainDate): PlainDate {
	return day.subtract({ days: day.dayOfWeek - 1 });
}

/** ISO week key, e.g. `2026-W10`. */
export function isoWeekKey(monday: PlainDate): string {
	return `${monday.yearOfWeek}-W${String(monday.weekOfYear).padStart(2, "0")}`;
}

function inWindow(day: PlainDate, start: PlainDate, endExclusive: PlainDate): boolean {
	return comparePlainDates(day, start) >= 0 && comparePlainDates(day, endExclusive) < 0;
}

interface Base {
	readonly organizationId: string;
	readonly employeeId: string;
}

function finding(
	base: Base,
	input: Omit<OnCallFinding, "id" | "organizationId" | "employeeId" | "domain" | "adminDetail">,
): OnCallFinding {
	return {
		id: statutoryFindingId(input.kind, base.employeeId, input.subjectKey),
		organizationId: base.organizationId,
		employeeId: base.employeeId,
		domain: "on_call",
		adminDetail: null,
		...input,
	};
}

function shiftSubject(shift: OnCallShift): string {
	return shift.id ? `shift:${shift.id}` : `proposed:${shift.date}T${shift.startTime}`;
}

function noticeFinding(
	base: Base,
	shift: OnCallShift,
	facts: OnCallFacts,
	timezone: string,
	now: Instant,
): OnCallFinding | null {
	const required = facts.thresholds.valueOn("de_on_call_notice_full_days", shift.date.toString());
	if (required === null) return null;
	const notifiedAt = shiftNotificationInstant(
		{
			status: shift.status,
			publishedAt: shift.publishedAt,
			assignmentChangedAt: shift.assignmentChangedAt ?? now,
		},
		now,
	);
	// Work recorded or planned after the fact is not a call-in: a shift assigned once it has ended
	// (a correction of who worked it) calls nobody in, whether on its own day or later. One assigned
	// while it runs still is.
	if (compareInstants(notifiedAt, shiftInterval(shift, timezone).end) >= 0) return null;
	const notifiedOn = notificationDay(notifiedAt, timezone);
	const fullDays = Math.max(0, fullNoticeDays(notifiedOn, shift.date));
	if (fullDays >= required) return null;
	const subjectKey = shiftSubject(shift);
	return finding(base, {
		kind: "on_call_short_notice",
		severity: "warning",
		subjectKey,
		periodStart: shift.date.toString(),
		periodEnd: shift.date.add({ days: 1 }).toString(),
		legalReference: NOTICE_REFERENCE,
		summary: {
			used: { unit: "days", value: fullDays },
			limit: { unit: "days", value: required },
			limitDirection: "floor",
		},
		// What the notice depends on: assignee, shift day, notification day and the last material
		// change that announced the call. Not the shift's times: correcting a started shift's end
		// announces nothing (its change stamp stays), so an agreement documented for it stays
		// current. Moving it to another day, reassigning it or re-announcing it before it starts
		// (which stamps a new change) makes the agreement stale.
		inputFingerprint: statutoryInputFingerprint({
			kind: "on_call_short_notice",
			employeeId: base.employeeId,
			subjectKey,
			date: shift.date.toString(),
			notifiedOn: notifiedOn.toString(),
			announcedBy: shift.assignmentChangedAt?.toString() ?? null,
			requiredFullDays: required,
		}),
		// The employee can only agree to a call they were told of: a draft (or a proposal) announces
		// nothing yet, and its notice would run from whenever it is published. It warns the planner
		// but takes no agreement, so none goes stale as the days pass before publication.
		acknowledgementKind: shift.status === "published" ? "on_call_short_notice_agreement" : null,
	});
}

function minimumCallMinutes(
	facts: OnCallFacts,
	terms: { readonly dailyMinutes: number | null },
	day: PlainDate,
): number | null {
	return (
		terms.dailyMinutes ?? facts.thresholds.valueOn("de_on_call_min_call_minutes", day.toString())
	);
}

/**
 * Planned shifts joined into calls (§ 12 Abs. 1 Satz 4 TzBfG), in start order. A call is at least
 * three *consecutive* hours, so only shifts that touch or overlap are one call; shifts with time
 * off between them are separate calls, however short the gap.
 */
function plannedCalls(shifts: readonly OnCallShift[], timezone: string): PlannedCall[] {
	const timed = shifts
		.map((shift) => ({ shift, interval: shiftInterval(shift, timezone) }))
		.toSorted((a, b) => compareInstants(a.interval.start, b.interval.start));
	const calls: PlannedCall[] = [];
	let current: { shifts: OnCallShift[]; minutes: number; end: Instant } | null = null;
	for (const { shift, interval } of timed) {
		if (current && compareInstants(interval.start, current.end) <= 0) {
			current.shifts.push(shift);
			// Overlapping shifts count their shared time once.
			if (compareInstants(interval.end, current.end) > 0) {
				current.minutes += Math.round(current.end.until(interval.end).total("minutes"));
				current.end = interval.end;
			}
			continue;
		}
		if (current) calls.push(current);
		current = { shifts: [shift], minutes: shift.minutes, end: interval.end };
	}
	if (current) calls.push(current);
	return calls;
}

interface PlannedCall {
	/** In start order; at least one. */
	readonly shifts: readonly OnCallShift[];
	/** Planned minutes of the call, time shared by overlapping shifts counted once. */
	readonly minutes: number;
}

/** A planned call shorter than the minimum, reported on its first shift. */
function shortCallFinding(base: Base, call: PlannedCall, minimum: number): OnCallFinding | null {
	const [first] = call.shifts;
	const { minutes } = call;
	if (!first || minutes >= minimum) return null;
	const subjectKey = shiftSubject(first);
	return finding(base, {
		kind: "on_call_short_call",
		severity: "warning",
		subjectKey,
		periodStart: first.date.toString(),
		periodEnd: first.date.add({ days: 1 }).toString(),
		legalReference: MINIMUM_CALL_REFERENCE,
		summary: {
			used: { unit: "minutes", value: minutes },
			limit: { unit: "minutes", value: minimum },
			limitDirection: "floor",
		},
		inputFingerprint: statutoryInputFingerprint({
			kind: "on_call_short_call",
			employeeId: base.employeeId,
			subjectKey,
			shifts: call.shifts.map((shift) => [
				shiftSubject(shift),
				shift.date.toString(),
				shift.startTime,
				shift.endTime,
			]),
			minimumMinutes: minimum,
		}),
		acknowledgementKind: null,
	});
}

function shortWorkCallFinding(
	base: Base,
	call: OnCallWorkCall,
	minimum: number,
): OnCallFinding | null {
	if (call.minutes <= 0 || call.minutes >= minimum) return null;
	const subjectKey = `work:${call.day}T${call.startTime}`;
	return finding(base, {
		kind: "on_call_short_work_call",
		severity: "warning",
		subjectKey,
		periodStart: call.day.toString(),
		periodEnd: call.day.add({ days: 1 }).toString(),
		legalReference: MINIMUM_CALL_REFERENCE,
		summary: {
			used: { unit: "minutes", value: call.minutes },
			limit: { unit: "minutes", value: minimum },
			limitDirection: "floor",
		},
		inputFingerprint: statutoryInputFingerprint({
			kind: "on_call_short_work_call",
			employeeId: base.employeeId,
			subjectKey,
			workedMinutes: call.minutes,
			minimumMinutes: minimum,
		}),
		acknowledgementKind: null,
	});
}

/** The weekly band of one week, prorated to the days the employee is on call in it. */
export interface OnCallWeeklyBand {
	readonly hoursKind: "exact" | "minimum" | "maximum" | "unspecified";
	/** Agreed (or statutory default) weekly minutes for a full week. */
	readonly agreedWeeklyMinutes: number;
	/** Fewest minutes the week may be called. */
	readonly lowerMinutes: number;
	/** Most minutes the week may be called. */
	readonly upperMinutes: number;
}

interface OnCallBandTerms {
	readonly hoursKind: OnCallWeeklyBand["hoursKind"];
	readonly weeklyMinutes: number | null;
}

/**
 * The § 12 Abs. 2 TzBfG band of a week judged on `days` (callable days; fewer than seven when the
 * employee joined, left or was released mid-week): each day contributes a seventh of the band of
 * its own terms, so a mid-week change of terms is judged with each part's terms. The kind and
 * agreed minutes reported are those of the last day. Null when there is no day, or a baseline a
 * day's band needs is missing.
 */
export function onCallWeeklyBand(
	facts: Pick<OnCallFacts, "thresholds">,
	termsOn: (day: PlainDate) => OnCallBandTerms | undefined,
	days: readonly PlainDate[],
): OnCallWeeklyBand | null {
	let lower = 0;
	let upper = 0;
	let last: OnCallWeeklyBand | null = null;
	for (const day of days) {
		const terms = termsOn(day);
		const band = terms ? fullWeekBand(facts, terms, day) : null;
		if (!band) return null;
		lower += band.lowerMinutes / 7;
		upper += band.upperMinutes / 7;
		last = band;
	}
	if (!last) return null;
	return { ...last, lowerMinutes: Math.round(lower), upperMinutes: Math.round(upper) };
}

/** The band of a full week of `terms` as of `day`, unrounded. */
function fullWeekBand(
	facts: Pick<OnCallFacts, "thresholds">,
	terms: OnCallBandTerms,
	day: PlainDate,
): OnCallWeeklyBand | null {
	const date = day.toString();
	switch (terms.hoursKind) {
		case "unspecified": {
			const deemed = facts.thresholds.valueOn("de_on_call_default_weekly_minutes", date);
			if (deemed === null) return null;
			return {
				hoursKind: "unspecified",
				agreedWeeklyMinutes: deemed,
				lowerMinutes: deemed,
				upperMinutes: deemed,
			};
		}
		case "exact": {
			if (terms.weeklyMinutes === null) return null;
			return {
				hoursKind: "exact",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: terms.weeklyMinutes,
				upperMinutes: terms.weeklyMinutes,
			};
		}
		case "minimum": {
			// The agreed minimum is owed; at most +25 % more may be called.
			const plus = facts.thresholds.valueOn("de_on_call_min_band_plus_pct", date);
			if (terms.weeklyMinutes === null || plus === null) return null;
			return {
				hoursKind: "minimum",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: terms.weeklyMinutes,
				upperMinutes: (terms.weeklyMinutes * (100 + plus)) / 100,
			};
		}
		case "maximum": {
			// The agreed maximum is the ceiling; at least −20 % of it must be called.
			const minus = facts.thresholds.valueOn("de_on_call_max_band_minus_pct", date);
			if (terms.weeklyMinutes === null || minus === null) return null;
			return {
				hoursKind: "maximum",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: (terms.weeklyMinutes * (100 - minus)) / 100,
				upperMinutes: terms.weeklyMinutes,
			};
		}
	}
}

/**
 * Where running clock-ins count, by organization-local day (`YYYY-MM-DD`). Their minutes inside a
 * planned shift count on that shift's day, as its still-planned rest does: worked plus still
 * planned is the shift, on its own day and week, whichever day the clock-in started (a Sunday
 * clock-in running into Monday's shift). Their minutes outside every shift (clocked in early,
 * between shifts, past the end) count on the clock-in's start day, as completed work does, and
 * grow: every further minute adds one, whether or not the clock has reached a shift yet, so the
 * figure does not jump when it does. The planner's publish acknowledgement counts each week
 * without the growing minutes (`stableDepth`), so it holds while the clock runs.
 */
function runningAttribution(
	running: readonly OnCallWorkPiece[],
	shifts: readonly OnCallShift[],
	timezone: string,
): {
	/** Minutes to move per day: off each clock-in's start day, onto the day of the shift they fill. */
	readonly shiftedByDay: ReadonlyMap<string, number>;
	/** Minutes outside every shift, per clock-in start day. */
	readonly growingByDay: ReadonlyMap<string, number>;
} {
	// Planned time as disjoint segments: overlapping shifts count their shared time once, on the day
	// of the shift that starts first, as the still-planned rest does.
	const segments: { day: string; start: Instant; end: Instant }[] = [];
	let plannedUntil: Instant | null = null;
	for (const { shift, interval } of shifts
		.map((shift) => ({ shift, interval: shiftInterval(shift, timezone) }))
		.toSorted((a, b) => compareInstants(a.interval.start, b.interval.start))) {
		const start: Instant =
			plannedUntil && compareInstants(plannedUntil, interval.start) > 0
				? plannedUntil
				: interval.start;
		if (compareInstants(start, interval.end) >= 0) continue;
		plannedUntil = interval.end;
		segments.push({ day: shift.date.toString(), start, end: interval.end });
	}
	const shiftedByDay = new Map<string, number>();
	const growingByDay = new Map<string, number>();
	const add = (map: Map<string, number>, day: string, minutes: number) =>
		map.set(day, (map.get(day) ?? 0) + minutes);
	for (const piece of running) {
		const startDay = plainDateAt(piece.start, timezone).toString();
		let inShifts = 0;
		for (const segment of segments) {
			const minutes = overlapMinutes([piece], segment);
			if (minutes <= 0) continue;
			inShifts += minutes;
			add(shiftedByDay, segment.day, minutes);
		}
		add(shiftedByDay, startDay, -inShifts);
		add(growingByDay, startDay, Math.max(0, piece.minutes - inShifts));
	}
	return { shiftedByDay, growingByDay };
}

function bandFindings(
	base: Base,
	input: {
		readonly monday: PlainDate;
		readonly facts: OnCallFacts;
		readonly shifts: readonly OnCallShift[];
		readonly today: PlainDate;
		readonly now: Instant;
		readonly timezone: string;
		readonly preferences: StatutoryPreferences;
	},
): OnCallFinding[] {
	const terms = input.facts.termsByEmployee.get(base.employeeId);
	if (!terms) return [];
	const week = daysOf(input.monday, input.monday.add({ days: 7 }));
	const onCallDays = week.filter((day) => terms.has(day.toString()));
	const work = input.facts.workMinutesByEmployee.get(base.employeeId);
	const pieces = input.facts.workPiecesByEmployee.get(base.employeeId) ?? [];
	const released = input.facts.releasedDaysByEmployee.get(base.employeeId);
	const running = pieces.filter((piece) => piece.running);
	// Each day counts what was worked plus what is still planned: the part of each of its shifts
	// not yet worked (an unplanned call adds to a later shift; a call running on its shift counts
	// once, on the shift's day: `runningAttribution`). A shift that has ended adds nothing; one still running adds its rest whatever day it
	// started, such as last night's shift past midnight. A running clock-in on the shift ends on its
	// whole-minute grid, so the rest of the shift is measured from there and the total stays
	// constant within the minute; its unworked past part (a late start, a break before it) is not
	// planned any more. While nobody is clocked in the rest counts from the end of the shift's last
	// recorded work, or from its start: a break, a late start or a missed shift holds the week
	// steady until the shift ends or the clock-in that resumes it, not shrinking by the minute.
	const stillPlannedRest = (shift: OnCallShift) => {
		const interval = shiftInterval(shift, input.timezone);
		const runningOnShift = running.filter(
			(piece) => compareInstants(piece.start, interval.end) < 0,
		);
		const latest = (ends: Instant[]) =>
			ends.reduce((a, b) => (compareInstants(a, b) >= 0 ? a : b), interval.start);
		let cut: Instant;
		if (runningOnShift.length) {
			cut = latest(runningOnShift.map((piece) => piece.end));
		} else {
			if (compareInstants(input.now, interval.end) >= 0) return null;
			cut = latest(
				pieces
					.filter(
						(piece) =>
							compareInstants(piece.start, interval.end) < 0 &&
							compareInstants(piece.end, interval.start) > 0,
					)
					.map((piece) => piece.end),
			);
		}
		if (compareInstants(cut, interval.end) >= 0) return null;
		return { shift, start: cut, end: interval.end };
	};
	// Overlapping shifts count their shared time once, as in `plannedCalls`: in start order, each
	// shift adds only the part of its rest after the rests before it, to its own day.
	const stillPlannedByDay = new Map<string, number>();
	let plannedUntil: Instant | null = null;
	for (const rest of input.shifts
		.map(stillPlannedRest)
		.filter((rest) => rest !== null)
		.toSorted((a, b) => compareInstants(a.start, b.start))) {
		const start: Instant =
			plannedUntil && compareInstants(plannedUntil, rest.start) > 0 ? plannedUntil : rest.start;
		if (compareInstants(start, rest.end) >= 0) continue;
		plannedUntil = rest.end;
		const minutes = Math.max(
			0,
			Math.round(start.until(rest.end).total("minutes")) -
				overlapMinutes(pieces, { start, end: rest.end }),
		);
		const day = rest.shift.date.toString();
		stillPlannedByDay.set(day, (stillPlannedByDay.get(day) ?? 0) + minutes);
	}
	const { shiftedByDay, growingByDay } = runningAttribution(running, input.shifts, input.timezone);
	const minutesOn = (day: PlainDate) =>
		(work?.get(day.toString()) ?? 0) +
		(shiftedByDay.get(day.toString()) ?? 0) +
		(stillPlannedByDay.get(day.toString()) ?? 0);
	// § 12 Abs. 4–5 TzBfG: approved absence and public holidays are paid by the reference period,
	// not called. Unless worked anyway or still planned (a call scheduled on it counts like any
	// other), such a day leaves the band, which is prorated to the days that could be called, as for
	// days outside the on-call terms.
	const isReleased = (day: PlainDate) =>
		released?.has(day.toString()) === true && minutesOn(day) === 0;
	const releasedDays = onCallDays.filter(isReleased).map((day) => day.toString());
	const callableDays = onCallDays.filter((day) => !isReleased(day));
	const band = onCallWeeklyBand(input.facts, (day) => terms.get(day.toString()), callableDays);
	if (!band) return [];
	const minutesByDay = callableDays.map((day) => [day.toString(), minutesOn(day)] as const);
	const used = minutesByDay.reduce((sum, [, minutes]) => sum + minutes, 0);
	const growing = callableDays.reduce(
		(sum, day) => sum + (growingByDay.get(day.toString()) ?? 0),
		0,
	);
	const subjectKey = isoWeekKey(input.monday);
	const weekEnded = comparePlainDates(input.monday.add({ days: 7 }), input.today) <= 0;
	const legalReference = band.hoursKind === "unspecified" ? DEFAULT_WEEK_REFERENCE : BAND_REFERENCE;
	const fingerprint = (kind: OnCallFindingKind) =>
		statutoryInputFingerprint({
			kind,
			employeeId: base.employeeId,
			subjectKey,
			hoursKind: band.hoursKind,
			agreedWeeklyMinutes: band.agreedWeeklyMinutes,
			lowerMinutes: band.lowerMinutes,
			upperMinutes: band.upperMinutes,
			minutesByDay: minutesByDay.map(([day, minutes]) => [day, minutes]),
			releasedDays,
		});
	const period = {
		periodStart: input.monday.toString(),
		periodEnd: input.monday.add({ days: 7 }).toString(),
	};

	// The organization's tiers apply to the headroom a minimum agreement leaves above the agreed
	// minutes: calling exactly the agreement is fine, and reaching the +25 % ceiling only warns.
	// Every other band has no headroom; only a week above its ceiling is reported.
	const headroom = band.upperMinutes - band.lowerMinutes;
	const tier: StatutoryUsageTier =
		used > band.upperMinutes
			? "exceeded"
			: band.hoursKind === "minimum" && headroom > 0 && used > band.lowerMinutes
				? classifyStatutoryUsage(
						{ used: used - band.lowerMinutes, limit: headroom },
						input.preferences,
					).tier
				: "ok";
	if (tier !== "ok") {
		const severity: StatutorySeverity =
			tier === "exceeded" ? (band.hoursKind === "minimum" ? "critical" : "warning") : "warning";
		return [
			finding(base, {
				kind: "on_call_weekly_over_band",
				severity,
				subjectKey,
				...period,
				legalReference,
				summary: {
					tier,
					usedPercent: classifyStatutoryUsage({ used, limit: band.upperMinutes }, input.preferences)
						.usedPercent,
					used: { unit: "minutes", value: used },
					limit: { unit: "minutes", value: band.upperMinutes },
					remaining: { unit: "minutes", value: Math.max(0, band.upperMinutes - used) },
				},
				inputFingerprint: fingerprint("on_call_weekly_over_band"),
				acknowledgementKind: null,
				...(growing > 0 ? { stableDepth: { used: used - growing } } : {}),
			}),
		];
	}
	if (used < band.lowerMinutes) {
		return [
			finding(base, {
				kind: "on_call_weekly_under_band",
				// A week still running may yet be called up: only a finished week is under-called.
				severity: weekEnded ? "warning" : "info",
				subjectKey,
				...period,
				legalReference,
				summary: {
					used: { unit: "minutes", value: used },
					limit: { unit: "minutes", value: band.lowerMinutes },
					limitDirection: "floor",
					remaining: { unit: "minutes", value: band.lowerMinutes - used },
				},
				inputFingerprint: fingerprint("on_call_weekly_under_band"),
				acknowledgementKind: null,
				// A floor: a running clock-in eases it by the minute, which is no change of the plan.
				...(growing > 0 ? { stableDepth: { used: used - growing } } : {}),
			}),
		];
	}
	return [];
}

/**
 * A proposal for the persisted shift it replaces, offered to that shift's own assignee: keeping
 * them is that shift, already announced. It keeps its status and publication, and its last
 * announcement unless the proposal is a new call-in (moved before it starts), as saving it would.
 * Any other employee is assigned the shift now, as a new call-in.
 */
function keptByAssignee(
	replaced: OnCallShift | null,
	proposal: OnCallShift,
	timezone: string,
	now: Instant,
): OnCallShift {
	if (!replaced || replaced.employeeId !== proposal.employeeId) return proposal;
	const assignment = (shift: OnCallShift) => ({
		employeeId: shift.employeeId,
		date: shiftStoredDate(shift.date.toString(), timezone),
		startTime: shift.startTime,
		endTime: shift.endTime,
	});
	const newCallIn = isNewShiftCallIn(assignment(replaced), assignment(proposal), {
		timezone,
		now,
	});
	return {
		...proposal,
		id: replaced.id,
		status: replaced.status,
		publishedAt: replaced.publishedAt,
		assignmentChangedAt: newCallIn ? null : replaced.assignmentChangedAt,
	};
}

/**
 * The on-call findings of the window: notice and minimum-call findings for shifts and work on
 * its days, band findings for every compliance week touching it.
 */
export async function evaluateOnCallFindings(
	db: OnCallReader,
	request: OnCallEvaluationRequest,
): Promise<OnCallFinding[]> {
	const windowStart = parsePlainDate(request.window.start);
	const windowEnd = parsePlainDate(request.window.endExclusive);
	if (comparePlainDates(windowStart, windowEnd) >= 0) return [];
	const firstMonday = mondayOf(windowStart);
	const weeksEnd = mondayOf(windowEnd.subtract({ days: 1 })).add({ days: 7 });

	const facts = await loadOnCallFacts(db, {
		organizationId: request.organizationId,
		timezone: request.timezone,
		from: firstMonday,
		untilExclusive: weeksEnd,
		employeeIds: request.employeeIds ?? null,
		replacesShiftId: request.replacesShiftId ?? null,
		publishedShiftsOnly: request.publishedShiftsOnly ?? false,
		now: request.now,
	});
	const preferences = request.preferences ?? DEFAULT_STATUTORY_PREFERENCES;
	const today = plainDateAt(request.now, request.timezone);
	const findings: OnCallFinding[] = [];

	for (const [employeeId, terms] of facts.termsByEmployee) {
		const base = { organizationId: request.organizationId, employeeId };
		const proposed = (request.proposedShifts ?? [])
			.filter((s) => s.employeeId === employeeId)
			.map((s): OnCallShift => {
				const date = parsePlainDate(s.date);
				const shift: OnCallShift = {
					id: null,
					employeeId,
					date,
					startTime: s.startTime,
					endTime: s.endTime,
					minutes: shiftMinutes(
						{ date, startTime: s.startTime, endTime: s.endTime },
						request.timezone,
					),
					status: "draft",
					publishedAt: null,
					assignmentChangedAt: null,
				};
				return keptByAssignee(facts.replacedShift, shift, request.timezone, request.now);
			});
		const shifts = [...(facts.shiftsByEmployee.get(employeeId) ?? []), ...proposed];

		for (const shift of shifts) {
			if (!inWindow(shift.date, windowStart, windowEnd)) continue;
			if (!terms.has(shift.date.toString())) continue;
			const notice = noticeFinding(base, shift, facts, request.timezone, request.now);
			if (notice) findings.push(notice);
		}

		for (const call of plannedCalls(shifts, request.timezone)) {
			const [first] = call.shifts;
			if (!first || !inWindow(first.date, windowStart, windowEnd)) continue;
			const dayTerms = terms.get(first.date.toString());
			if (!dayTerms) continue;
			const minimum = minimumCallMinutes(facts, dayTerms, first.date);
			const short = minimum === null ? null : shortCallFinding(base, call, minimum);
			if (short) findings.push(short);
		}

		for (const call of facts.workCallsByEmployee.get(employeeId) ?? []) {
			// Only a finished call is judged: none still clocked in, none that may yet resume today.
			if (call.inProgress || !inWindow(call.day, windowStart, windowEnd)) continue;
			if (comparePlainDates(call.day, today) >= 0) continue;
			const dayTerms = terms.get(call.day.toString());
			if (!dayTerms) continue;
			const minimum = minimumCallMinutes(facts, dayTerms, call.day);
			const short = minimum === null ? null : shortWorkCallFinding(base, call, minimum);
			if (short) findings.push(short);
		}

		for (
			let monday = firstMonday;
			comparePlainDates(monday, weeksEnd) < 0;
			monday = monday.add({ days: 7 })
		) {
			findings.push(
				...bandFindings(base, {
					monday,
					facts,
					shifts,
					today,
					now: request.now,
					timezone: request.timezone,
					preferences,
				}),
			);
		}
	}
	return findings;
}
