/**
 * § 12 TzBfG on-call monitor (#1992). For employees whose effective terms say `schedule_source =
 * 'on_call'` it judges, in the organization's calendar:
 *
 * - **Call-in notice** (§ 12 Abs. 3): four full calendar days between the notification day and
 *   the shift day. A shorter notice is only fine with the employee's voluntary agreement, which
 *   an org admin documents as an `on_call_short_notice_agreement` acknowledgement.
 * - **Minimum call** (§ 12 Abs. 1 Satz 4): each call lasts at least the agreed daily minutes, or
 *   the statutory minimum (three hours) when none is agreed — for each planned call and each
 *   finished worked call (shifts or work periods joined only by breaks).
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
	ON_CALL_MAX_BREAK_MINUTES,
	type OnCallFacts,
	type OnCallReader,
	type OnCallShift,
	type OnCallWorkCall,
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
	const notifiedOn = notificationDay(notifiedAt, timezone);
	// Work recorded or planned after the fact is not a call-in.
	if (comparePlainDates(notifiedOn, shift.date) > 0) return null;
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
		acknowledgementKind: "on_call_short_notice_agreement",
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
 * Planned shifts joined into calls (§ 12 Abs. 1 Satz 4 TzBfG), in start order: shifts that touch
 * or are at most a break ({@link ON_CALL_MAX_BREAK_MINUTES}) apart are one call, as worked calls.
 */
function plannedCalls(shifts: readonly OnCallShift[], timezone: string): PlannedCall[] {
	const timed = shifts
		.map((shift) => ({ shift, interval: shiftInterval(shift, timezone) }))
		.toSorted((a, b) => compareInstants(a.interval.start, b.interval.start));
	const calls: PlannedCall[] = [];
	let current: { shifts: OnCallShift[]; minutes: number; end: Instant } | null = null;
	for (const { shift, interval } of timed) {
		if (
			current &&
			current.end.until(interval.start).total("minutes") <= ON_CALL_MAX_BREAK_MINUTES
		) {
			current.shifts.push(shift);
			// Overlapping shifts count their shared time once.
			if (compareInstants(interval.end, current.end) > 0) {
				const from =
					compareInstants(interval.start, current.end) > 0 ? interval.start : current.end;
				current.minutes += Math.round(from.until(interval.end).total("minutes"));
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
	/** Planned minutes of the call, breaks between its shifts left out. */
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

/**
 * The § 12 Abs. 2 TzBfG band for `terms` on `day`, scaled by `onCallDays / 7` for weeks the
 * employee is on call only partly (joined, left or changed terms mid-week). Null when a baseline
 * the band needs is missing.
 */
export function onCallWeeklyBand(
	facts: Pick<OnCallFacts, "thresholds">,
	terms: {
		readonly hoursKind: OnCallWeeklyBand["hoursKind"];
		readonly weeklyMinutes: number | null;
	},
	day: PlainDate,
	onCallDays = 7,
): OnCallWeeklyBand | null {
	const date = day.toString();
	const scale = (minutes: number) => Math.round((minutes * onCallDays) / 7);
	switch (terms.hoursKind) {
		case "unspecified": {
			const deemed = facts.thresholds.valueOn("de_on_call_default_weekly_minutes", date);
			if (deemed === null) return null;
			return {
				hoursKind: "unspecified",
				agreedWeeklyMinutes: deemed,
				lowerMinutes: scale(deemed),
				upperMinutes: scale(deemed),
			};
		}
		case "exact": {
			if (terms.weeklyMinutes === null) return null;
			const agreed = scale(terms.weeklyMinutes);
			return {
				hoursKind: "exact",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: agreed,
				upperMinutes: agreed,
			};
		}
		case "minimum": {
			// The agreed minimum is owed; at most +25 % more may be called.
			const plus = facts.thresholds.valueOn("de_on_call_min_band_plus_pct", date);
			if (terms.weeklyMinutes === null || plus === null) return null;
			return {
				hoursKind: "minimum",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: scale(terms.weeklyMinutes),
				upperMinutes: scale((terms.weeklyMinutes * (100 + plus)) / 100),
			};
		}
		case "maximum": {
			// The agreed maximum is the ceiling; at least −20 % of it must be called.
			const minus = facts.thresholds.valueOn("de_on_call_max_band_minus_pct", date);
			if (terms.weeklyMinutes === null || minus === null) return null;
			return {
				hoursKind: "maximum",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: scale((terms.weeklyMinutes * (100 - minus)) / 100),
				upperMinutes: scale(terms.weeklyMinutes),
			};
		}
	}
}

function bandFindings(
	base: Base,
	input: {
		readonly monday: PlainDate;
		readonly facts: OnCallFacts;
		readonly shifts: readonly OnCallShift[];
		readonly today: PlainDate;
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
	// Past days count what was worked. Today and later add what is still planned: each shift's
	// minutes not yet worked inside it (an unplanned call adds to a later shift; a call running on
	// its shift counts once).
	const minutesOn = (day: PlainDate) => {
		const worked = work?.get(day.toString()) ?? 0;
		if (comparePlainDates(day, input.today) < 0) return worked;
		const stillPlanned = input.shifts
			.filter((shift) => shift.date.equals(day))
			.reduce(
				(sum, shift) =>
					sum +
					Math.max(0, shift.minutes - overlapMinutes(pieces, shiftInterval(shift, input.timezone))),
				0,
			);
		return worked + stillPlanned;
	};
	// § 12 Abs. 4–5 TzBfG: approved absence and public holidays are paid by the reference period,
	// not called. Unless worked anyway, such a day leaves the band, which is prorated to the days
	// that could be called, as for days outside the on-call terms.
	const isReleased = (day: PlainDate) =>
		released?.has(day.toString()) === true && (work?.get(day.toString()) ?? 0) === 0;
	const releasedDays = onCallDays.filter(isReleased).map((day) => day.toString());
	const callableDays = onCallDays.filter((day) => !isReleased(day));
	const lastCallableDay = callableDays.at(-1);
	if (!lastCallableDay) return [];
	const lastTerms = terms.get(lastCallableDay.toString());
	if (!lastTerms) return [];
	const band = onCallWeeklyBand(input.facts, lastTerms, lastCallableDay, callableDays.length);
	if (!band) return [];
	const minutesByDay = callableDays.map((day) => [day.toString(), minutesOn(day)] as const);
	const used = minutesByDay.reduce((sum, [, minutes]) => sum + minutes, 0);
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
					remaining: { unit: "minutes", value: band.lowerMinutes - used },
				},
				inputFingerprint: fingerprint("on_call_weekly_under_band"),
				acknowledgementKind: null,
			}),
		];
	}
	return [];
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
				return {
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
					timezone: request.timezone,
					preferences,
				}),
			);
		}
	}
	return findings;
}
