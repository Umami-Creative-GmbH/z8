/**
 * § 12 TzBfG on-call monitor (#1992). For employees whose effective terms say `schedule_source =
 * 'on_call'` it judges, in the organization's calendar:
 *
 * - **Call-in notice** (§ 12 Abs. 3): four full calendar days between the notification day and
 *   the shift day. A shorter notice is only fine with the employee's voluntary agreement, which
 *   an org admin documents as an `on_call_short_notice_agreement` acknowledgement.
 * - **Minimum call** (§ 12 Abs. 1 Satz 4): each call lasts at least the agreed daily minutes, or
 *   the statutory minimum (three hours) when none is agreed — for shifts and for completed work.
 * - **Weekly call-off band** (§ 12 Abs. 2): per compliance week (Monday–Sunday) the planned and
 *   worked minutes stay inside the band of the agreed weekly minutes: `minimum` at most +25 %,
 *   `maximum` at least −20 %, `exact` exactly the agreement, `unspecified` exactly the statutory
 *   default (20 h, § 12 Abs. 1 Satz 3).
 *
 * Every limit comes from `statutory_threshold` for the day judged. Findings carry minutes and
 * days only, never wages. Read-only; it never blocks anything.
 */
import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutorySeverity,
	severityOfUsageTier,
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
		// The notification day, not the instant: an agreement documented today stays current until
		// the shift is moved, reassigned or announced on another day.
		inputFingerprint: statutoryInputFingerprint({
			kind: "on_call_short_notice",
			employeeId: base.employeeId,
			subjectKey,
			date: shift.date.toString(),
			startTime: shift.startTime,
			endTime: shift.endTime,
			notifiedOn: notifiedOn.toString(),
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

function shortCallFinding(
	base: Base,
	shift: OnCallShift,
	minimum: number,
): OnCallFinding | null {
	if (shift.minutes >= minimum) return null;
	const subjectKey = shiftSubject(shift);
	return finding(base, {
		kind: "on_call_short_call",
		severity: "warning",
		subjectKey,
		periodStart: shift.date.toString(),
		periodEnd: shift.date.add({ days: 1 }).toString(),
		legalReference: MINIMUM_CALL_REFERENCE,
		summary: {
			used: { unit: "minutes", value: shift.minutes },
			limit: { unit: "minutes", value: minimum },
		},
		inputFingerprint: statutoryInputFingerprint({
			kind: "on_call_short_call",
			employeeId: base.employeeId,
			subjectKey,
			date: shift.date.toString(),
			startTime: shift.startTime,
			endTime: shift.endTime,
			minimumMinutes: minimum,
		}),
		acknowledgementKind: null,
	});
}

function shortWorkCallFinding(
	base: Base,
	day: PlainDate,
	minutes: number,
	minimum: number,
): OnCallFinding | null {
	if (minutes <= 0 || minutes >= minimum) return null;
	const subjectKey = `work:${day}`;
	return finding(base, {
		kind: "on_call_short_work_call",
		severity: "warning",
		subjectKey,
		periodStart: day.toString(),
		periodEnd: day.add({ days: 1 }).toString(),
		legalReference: MINIMUM_CALL_REFERENCE,
		summary: {
			used: { unit: "minutes", value: minutes },
			limit: { unit: "minutes", value: minimum },
		},
		inputFingerprint: statutoryInputFingerprint({
			kind: "on_call_short_work_call",
			employeeId: base.employeeId,
			subjectKey,
			workedMinutes: minutes,
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
	/** Fewest minutes the week may be called; null when the agreement sets no floor. */
	readonly lowerMinutes: number | null;
	/** Most minutes the week may be called; null when the agreement sets no ceiling. */
	readonly upperMinutes: number | null;
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
			const plus = facts.thresholds.valueOn("de_on_call_min_band_plus_pct", date);
			if (terms.weeklyMinutes === null || plus === null) return null;
			return {
				hoursKind: "minimum",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: null,
				upperMinutes: scale((terms.weeklyMinutes * (100 + plus)) / 100),
			};
		}
		case "maximum": {
			const minus = facts.thresholds.valueOn("de_on_call_max_band_minus_pct", date);
			if (terms.weeklyMinutes === null || minus === null) return null;
			return {
				hoursKind: "maximum",
				agreedWeeklyMinutes: terms.weeklyMinutes,
				lowerMinutes: scale((terms.weeklyMinutes * (100 - minus)) / 100),
				upperMinutes: null,
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
		readonly preferences: StatutoryPreferences;
	},
): OnCallFinding[] {
	const terms = input.facts.termsByEmployee.get(base.employeeId);
	if (!terms) return [];
	const week = daysOf(input.monday, input.monday.add({ days: 7 }));
	const onCallDays = week.filter((day) => terms.has(day.toString()));
	const lastOnCallDay = onCallDays.at(-1);
	if (!lastOnCallDay) return [];
	const lastTerms = terms.get(lastOnCallDay.toString());
	if (!lastTerms) return [];
	const band = onCallWeeklyBand(input.facts, lastTerms, lastOnCallDay, onCallDays.length);
	if (!band) return [];

	const work = input.facts.workMinutesByEmployee.get(base.employeeId);
	// Past days count what was worked; today and later count the plan, or the work if more.
	const minutesByDay = onCallDays.map((day) => {
		const worked = work?.get(day.toString()) ?? 0;
		const planned = input.shifts
			.filter((shift) => shift.date.equals(day))
			.reduce((sum, shift) => sum + shift.minutes, 0);
		const minutes =
			comparePlainDates(day, input.today) < 0 ? worked : Math.max(worked, planned);
		return [day.toString(), minutes] as const;
	});
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
		});
	const period = {
		periodStart: input.monday.toString(),
		periodEnd: input.monday.add({ days: 7 }).toString(),
	};

	if (band.upperMinutes !== null) {
		// A minimum agreement may be called up to +25 %: warn as the week approaches it.
		const approaching = band.hoursKind === "minimum";
		const usage = classifyStatutoryUsage({ used, limit: band.upperMinutes }, input.preferences);
		const tier = approaching ? usage.tier : used > band.upperMinutes ? "exceeded" : "ok";
		const severity: StatutorySeverity | null =
			tier === "exceeded"
				? band.hoursKind === "minimum"
					? "critical"
					: "warning"
				: severityOfUsageTier(tier);
		if (severity) {
			return [
				finding(base, {
					kind: "on_call_weekly_over_band",
					severity,
					subjectKey,
					...period,
					legalReference,
					summary: {
						tier,
						usedPercent: usage.usedPercent,
						used: { unit: "minutes", value: used },
						limit: { unit: "minutes", value: band.upperMinutes },
						remaining: { unit: "minutes", value: Math.max(0, band.upperMinutes - used) },
					},
					inputFingerprint: fingerprint("on_call_weekly_over_band"),
					acknowledgementKind: null,
				}),
			];
		}
	}
	if (band.lowerMinutes !== null && used < band.lowerMinutes) {
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
					minutes: shiftMinutes({ date, startTime: s.startTime, endTime: s.endTime }, request.timezone),
					status: "draft",
					publishedAt: null,
					assignmentChangedAt: null,
				};
			});
		const shifts = [...(facts.shiftsByEmployee.get(employeeId) ?? []), ...proposed];

		for (const shift of shifts) {
			if (!inWindow(shift.date, windowStart, windowEnd)) continue;
			const dayTerms = terms.get(shift.date.toString());
			if (!dayTerms) continue;
			const notice = noticeFinding(base, shift, facts, request.timezone, request.now);
			if (notice) findings.push(notice);
			const minimum = minimumCallMinutes(facts, dayTerms, shift.date);
			const short = minimum === null ? null : shortCallFinding(base, shift, minimum);
			if (short) findings.push(short);
		}

		const work = facts.workMinutesByEmployee.get(employeeId);
		for (const day of daysOf(windowStart, windowEnd)) {
			// Only a finished day's work is a complete call.
			if (comparePlainDates(day, today) >= 0) break;
			const dayTerms = terms.get(day.toString());
			const minutes = work?.get(day.toString()) ?? 0;
			if (!dayTerms || minutes === 0) continue;
			const minimum = minimumCallMinutes(facts, dayTerms, day);
			const short = minimum === null ? null : shortWorkCallFinding(base, day, minutes, minimum);
			if (short) findings.push(short);
		}

		for (
			let monday = firstMonday;
			comparePlainDates(monday, weeksEnd) < 0;
			monday = monday.add({ days: 7 })
		) {
			findings.push(...bandFindings(base, { monday, facts, shifts, today, preferences }));
		}
	}
	return findings;
}
