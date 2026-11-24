/**
 * Working-student (§ 6 Abs. 1 Nr. 3 SGB V, *Werkstudentenprivileg*) week math (#1991). Pure: the
 * loader (`monitor.ts`) gathers the facts, this module judges them.
 *
 * Compliance weeks run Monday–Sunday in the organization's timezone. Every minute of work on a day
 * the employee is a working student is classified by where it falls in that zone:
 *
 * - **core**: a lecture-period weekday inside the organization's daytime band (default
 *   06:00–18:00), the time studies need;
 * - **lecture-free**: a day inside a recorded `employee_study_period` (semester break);
 * - **evening/weekend**: Saturday, Sunday, or a weekday before or after the daytime band.
 *
 * Minutes on days under another employment profile (regular, short-term, …) are **other-profile**
 * minutes: they never count toward the lecture-week rule, which binds only working-student days.
 *
 * A week is an unexcused lecture-week breach when its core minutes alone exceed the weekly limit
 * (20 h); when the excess falls on lecture-free days, evenings, nights or weekends the week is
 * permitted. The rolling ceiling (26 weeks in the 52 weeks up to and including the judged week)
 * follows the GKV-Spitzenverband reading of § 6 Abs. 1 Nr. 3 SGB V: every week above 20 h in the
 * last 12 months counts, whatever the profile it was worked under at this organization. The legal
 * test is the week's total hours, so a week with a profile change counts when all its minutes
 * together exceed the limit. Recorded prior-employer weeks count too, each aging out of the window
 * on its own. Findings are raised only for weeks in which the employee is a working student on at
 * least one day.
 *
 * The daytime band reads the social-insurance carriers' "evening and night hours" exception
 * (GKV-Spitzenverband circular on employed students); the law names no hour, so it is not a
 * statutory baseline but an organization statutory preference (#2017): each organization sets the
 * band its health insurer accepts. Both limits come from `statutory_threshold`.
 */
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { comparePlainDates, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { MINUTES_PER_DAY } from "../daytime-band";
import {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutorySeverity,
	statutoryFindingId,
} from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type { StatutoryPreferences } from "../preferences";
import type { StatutoryThresholdTable } from "../thresholds";

/** Weekday daytime (minutes after local midnight, `[start, end)`) that counts against the lecture-week limit. */
export interface WorkingStudentDaytimeBand {
	readonly startMinute: number;
	readonly endMinute: number;
}

/** The organization's daytime band, from its statutory preferences. */
export function workingStudentDaytimeBandOf(
	preferences: Pick<
		StatutoryPreferences,
		"workingStudentDaytimeStartMinute" | "workingStudentDaytimeEndMinute"
	>,
): WorkingStudentDaytimeBand {
	return {
		startMinute: preferences.workingStudentDaytimeStartMinute,
		endMinute: preferences.workingStudentDaytimeEndMinute,
	};
}

/** Weeks of the rolling ceiling window, the judged week included. */
export const WORKING_STUDENT_ROLLING_WEEKS = 52;

export const WORKING_STUDENT_LEGAL_REFERENCE = "§ 6 Abs. 1 Nr. 3 SGB V";

export const workingStudentFindingKinds = [
	"working_student_lecture_week",
	"working_student_26_week_ceiling",
] as const;
export type WorkingStudentFindingKind = (typeof workingStudentFindingKinds)[number];
export type WorkingStudentFinding = StatutoryFinding<WorkingStudentFindingKind>;

export const WEEKLY_LIMIT_KEY = "de_working_student_weekly_minutes";
export const CEILING_KEY = "de_working_student_max_over_20h_weeks_per_12m";

/** Work in the evaluation: completed work, a persisted shift, or a shift Staffing proposes. */
export interface WorkingStudentWorkInterval {
	readonly source: "work" | "shift" | "proposed";
	/** Work period or shift id (`proposed` for a hypothetical shift). */
	readonly ref: string;
	readonly start: Instant;
	readonly end: Instant;
	/** Net minutes (breaks deducted); spread evenly over the elapsed interval. */
	readonly netMinutes: number;
	/**
	 * Set on a running clock-in, which is not completed work. `shift_end`: it counts up to the end of
	 * the shift it belongs to, a fixed figure. `now`: it belongs to no shift and grows with the
	 * clock, so the lecture-week fingerprint takes it by identity, not by its minutes.
	 */
	readonly runningUntil?: "shift_end" | "now";
}

export interface WorkingStudentLectureFreePeriod {
	readonly id: string;
	/** First and last lecture-free day, both inclusive. */
	readonly startsOn: string;
	readonly endsOn: string;
}

/** Consecutive prior-employer weeks above 20 h: Mondays in `[from, until)`. */
export interface WorkingStudentPriorWeeks {
	readonly id: string;
	readonly from: string;
	readonly until: string;
}

export interface WorkingStudentEmployeeFacts {
	readonly employeeId: string;
	readonly intervals: readonly WorkingStudentWorkInterval[];
	readonly lectureFreePeriods: readonly WorkingStudentLectureFreePeriod[];
	readonly priorOver20hWeeks: readonly WorkingStudentPriorWeeks[];
	/** Whether the employee's effective contract is employed `working_student` on `date`. */
	readonly isWorkingStudentDay: (date: string) => boolean;
}

export interface WorkingStudentWeek {
	readonly weekStart: string;
	/** ISO week, e.g. `2026-W10`. */
	readonly subjectKey: string;
	/** The employee is a working student on at least one day of the week. */
	readonly isWorkingStudentWeek: boolean;
	/** Weekly limit in force on the Monday, or null when no baseline covers it. */
	readonly limitMinutes: number | null;
	/** Every own minute of the week, under any employment profile. */
	readonly totalMinutes: number;
	/** Working-student days only, as are `lectureFreeMinutes` and `eveningWeekendMinutes`. */
	readonly coreMinutes: number;
	/** Core minutes from completed work only. */
	readonly completedCoreMinutes: number;
	readonly lectureFreeMinutes: number;
	readonly eveningWeekendMinutes: number;
	/** Minutes on days under another employment profile. */
	readonly otherProfileMinutes: number;
	/** Own work above the weekly limit, any profile: the week counts toward the ceiling. */
	readonly overLimit: boolean;
	/** Core minutes alone above the weekly limit: an unexcused lecture-week breach. */
	readonly lectureBreach: boolean;
	/** A recorded prior-employer week above 20 h. */
	readonly priorOver20hWeek: boolean;
	/** Weeks above 20 h (own and prior) in the rolling window ending with this week. */
	readonly rollingOver20hWeeks: number;
	/** Ceiling in force on the Monday, or null when no baseline covers it. */
	readonly ceilingWeeks: number | null;
}

export interface WorkingStudentEvaluation {
	/** Every week from the rolling window's start up to the last judged week, oldest first (ceiling-only weeks included). */
	readonly weeks: readonly WorkingStudentWeek[];
	readonly findings: readonly WorkingStudentFinding[];
}

export function mondayOf(date: PlainDate): PlainDate {
	return date.subtract({ days: date.dayOfWeek - 1 });
}

export function isoWeekKey(monday: PlainDate): string {
	const week = monday.weekOfYear ?? 0;
	return `${monday.yearOfWeek}-W${String(week).padStart(2, "0")}`;
}

type Category = "core" | "lectureFree" | "eveningWeekend" | "otherProfile";

/** Milliseconds per category. */
interface WeekAccumulator {
	core: number;
	completedCore: number;
	/** Core milliseconds of clock-ins that grow with `now` (`runningUntil: "now"`). */
	growingCore: number;
	/** Identities (`ref@start`) of those clock-ins touching the week. */
	growing: Set<string>;
	lectureFree: number;
	eveningWeekend: number;
	otherProfile: number;
}

function isLectureFree(
	periods: readonly WorkingStudentLectureFreePeriod[],
	day: PlainDate,
): boolean {
	return periods.some(
		(period) =>
			comparePlainDates(parsePlainDate(period.startsOn), day) <= 0 &&
			comparePlainDates(day, parsePlainDate(period.endsOn)) <= 0,
	);
}

/** The lecture-free Monday–Friday days of the week starting `monday` (weekends are excused anyway). */
function lectureFreeWeekdaysOf(
	periods: readonly WorkingStudentLectureFreePeriod[],
	monday: PlainDate,
): string[] {
	return [0, 1, 2, 3, 4]
		.map((offset) => monday.add({ days: offset }))
		.filter((day) => isLectureFree(periods, day))
		.map((day) => day.toString());
}

function overlapMilliseconds(start: Instant, end: Instant, from: Instant, until: Instant): number {
	const lo = Math.max(start.epochMilliseconds, from.epochMilliseconds);
	const hi = Math.min(end.epochMilliseconds, until.epochMilliseconds);
	return hi > lo ? hi - lo : 0;
}

/**
 * Adds an interval's net milliseconds, by local day and category, to the weeks they fall in.
 * Intervals without deducted breaks add whole milliseconds (no float drift at x.5 min).
 */
function accumulate(
	weeks: Map<string, WeekAccumulator>,
	interval: WorkingStudentWorkInterval,
	timezone: string,
	band: WorkingStudentDaytimeBand,
	facts: Pick<WorkingStudentEmployeeFacts, "lectureFreePeriods" | "isWorkingStudentDay">,
): void {
	const elapsed = interval.end.epochMilliseconds - interval.start.epochMilliseconds;
	const net = interval.netMinutes * 60_000;
	if (elapsed <= 0 || net <= 0) return;
	const ratio = Math.abs(net - elapsed) < 1 ? 1 : net / elapsed;
	/**
	 * The instant of a wall-clock minute of `day`: 00:00 is the day's start and 24:00 the next day's,
	 * also when a DST change skips or repeats midnight. A time clocks skip is the first instant after
	 * the gap (its first existing minute); a repeated time is its first occurrence.
	 */
	const at = (day: PlainDate, minute: number): Instant => {
		if (minute <= 0) return day.toZonedDateTime(timezone).toInstant();
		if (minute >= MINUTES_PER_DAY)
			return day.add({ days: 1 }).toZonedDateTime(timezone).toInstant();
		const wallTime = day.toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 });
		const zoned = wallTime.toZonedDateTime(timezone, { disambiguation: "compatible" });
		if (zoned.toPlainDateTime().equals(wallTime)) return zoned.toInstant();
		// Skipped: "compatible" moved it forward by the gap; the gap ends at the transition before it.
		// Looked up from just after the moved instant: an edge at the gap's first minute lands exactly
		// on the transition, and "previous" only finds transitions strictly before its start.
		return (zoned.add({ nanoseconds: 1 }).getTimeZoneTransition("previous") ?? zoned).toInstant();
	};

	for (
		let day = plainDateAt(interval.start, timezone);
		day.toZonedDateTime(timezone).toInstant().epochMilliseconds < interval.end.epochMilliseconds;
		day = day.add({ days: 1 })
	) {
		const dayStart = day.toZonedDateTime(timezone).toInstant();
		const nextDay = day.add({ days: 1 }).toZonedDateTime(timezone).toInstant();
		// A well-formed daytime interval inside the day: a band whose edges fall in a DST gap can
		// resolve end before start, and then the day has no daytime. Night is its complement, so no
		// minute counts twice.
		const daytimeStart = at(day, band.startMinute);
		const bandEnd = at(day, band.endMinute);
		const daytimeEnd =
			bandEnd.epochMilliseconds < daytimeStart.epochMilliseconds ? daytimeStart : bandEnd;
		const daytime = overlapMilliseconds(interval.start, interval.end, daytimeStart, daytimeEnd);
		const night = overlapMilliseconds(interval.start, interval.end, dayStart, nextDay) - daytime;
		if (night + daytime === 0) continue;

		const workingStudent = facts.isWorkingStudentDay(day.toString());
		const weekend = day.dayOfWeek >= 6;
		const lectureFree = !weekend && isLectureFree(facts.lectureFreePeriods, day);
		const daytimeCategory: Category = !workingStudent
			? "otherProfile"
			: weekend
				? "eveningWeekend"
				: lectureFree
					? "lectureFree"
					: "core";
		const nightCategory: Category = !workingStudent
			? "otherProfile"
			: lectureFree
				? "lectureFree"
				: "eveningWeekend";

		const key = mondayOf(day).toString();
		const week = weeks.get(key) ?? {
			core: 0,
			completedCore: 0,
			growingCore: 0,
			growing: new Set<string>(),
			lectureFree: 0,
			eveningWeekend: 0,
			otherProfile: 0,
		};
		week[daytimeCategory] += daytime * ratio;
		week[nightCategory] += night * ratio;
		if (daytimeCategory === "core" && interval.source === "work" && !interval.runningUntil) {
			week.completedCore += daytime * ratio;
		}
		if (interval.runningUntil === "now") {
			week.growing.add(`${interval.ref}@${interval.start.toString()}`);
			if (daytimeCategory === "core") week.growingCore += daytime * ratio;
		}
		weeks.set(key, week);
	}
}

function coveredByPriorWeeks(priorWeeks: readonly WorkingStudentPriorWeeks[], monday: PlainDate) {
	return priorWeeks.filter(
		(run) =>
			comparePlainDates(parsePlainDate(run.from), monday) <= 0 &&
			comparePlainDates(monday, parsePlainDate(run.until)) < 0,
	);
}

function severityOf(tier: "ok" | "warning" | "critical" | "exceeded"): StatutorySeverity | null {
	// The ceiling is reached, not breached, at 26 weeks: only the 27th week is critical.
	if (tier === "ok") return null;
	return tier === "exceeded" ? "critical" : "warning";
}

/**
 * Judges one employee's compliance weeks from `judgedWeeks.from` (a Monday) up to
 * `judgedWeeks.toExclusive` (a Monday), using every week of the rolling window before them. With
 * `ceilingToExclusive` (a later Monday) the weeks after them are judged for the 26-week ceiling
 * only, and only when a judged week is itself above 20 h: it raises the rolling count of later
 * weeks too. Without such a week the later weeks are not the judged window's findings.
 * `ceilingForwardOpen` decides that instead, when the caller has judged it on other facts.
 */
export function evaluateWorkingStudentEmployee(input: {
	readonly organizationId: string;
	readonly timezone: string;
	readonly judgedWeeks: {
		readonly from: string;
		readonly toExclusive: string;
		readonly ceilingToExclusive?: string;
		/** Whether to judge the weeks after them, in place of "a judged week is above 20 h". */
		readonly ceilingForwardOpen?: boolean;
	};
	readonly thresholds: StatutoryThresholdTable;
	/** Warning tiers and the organization's daytime band. */
	readonly preferences: Pick<
		StatutoryPreferences,
		| "warningThresholdPercent"
		| "criticalThresholdPercent"
		| "workingStudentDaytimeStartMinute"
		| "workingStudentDaytimeEndMinute"
	>;
	readonly facts: WorkingStudentEmployeeFacts;
}): WorkingStudentEvaluation {
	const { facts, thresholds } = input;
	const band = workingStudentDaytimeBandOf(input.preferences);
	const judgedFrom = mondayOf(parsePlainDate(input.judgedWeeks.from));
	const judgedUntil = parsePlainDate(input.judgedWeeks.toExclusive);
	const ceilingUntil = input.judgedWeeks.ceilingToExclusive
		? parsePlainDate(input.judgedWeeks.ceilingToExclusive)
		: judgedUntil;
	const evaluatedUntil =
		comparePlainDates(ceilingUntil, judgedUntil) > 0 ? ceilingUntil : judgedUntil;
	const evaluatedFrom = judgedFrom.subtract({ weeks: WORKING_STUDENT_ROLLING_WEEKS - 1 });

	const accumulators = new Map<string, WeekAccumulator>();
	for (const interval of facts.intervals) {
		accumulate(accumulators, interval, input.timezone, band, facts);
	}
	const workingStudentDaysOf = (monday: PlainDate) =>
		[0, 1, 2, 3, 4, 5, 6]
			.map((offset) => monday.add({ days: offset }).toString())
			.filter((day) => facts.isWorkingStudentDay(day));

	const weeks: WorkingStudentWeek[] = [];
	const counted: { monday: PlainDate; source: "own" | "prior" }[] = [];
	const findings: WorkingStudentFinding[] = [];
	let judgedWeekOverLimit = false;

	for (
		let monday = evaluatedFrom;
		comparePlainDates(monday, evaluatedUntil) < 0;
		monday = monday.add({ weeks: 1 })
	) {
		const weekStart = monday.toString();
		const acc = accumulators.get(weekStart);
		const minutes = (milliseconds: number) => Math.round(milliseconds / 60_000);
		const core = minutes(acc?.core ?? 0);
		const lectureFree = minutes(acc?.lectureFree ?? 0);
		const eveningWeekend = minutes(acc?.eveningWeekend ?? 0);
		const otherProfile = minutes(acc?.otherProfile ?? 0);
		const total = minutes(
			(acc?.core ?? 0) +
				(acc?.lectureFree ?? 0) +
				(acc?.eveningWeekend ?? 0) +
				(acc?.otherProfile ?? 0),
		);
		const limitMinutes = thresholds.valueOn(WEEKLY_LIMIT_KEY, weekStart);
		const ceilingWeeks = thresholds.valueOn(CEILING_KEY, weekStart);
		const workingStudentDays = workingStudentDaysOf(monday);
		const isWorkingStudentWeek = workingStudentDays.length > 0;
		// The ceiling counts every week above 20 h, whatever the profile; the lecture-week rule
		// binds only the working-student days.
		const overLimit = limitMinutes !== null && total > limitMinutes;
		const lectureBreach = isWorkingStudentWeek && limitMinutes !== null && core > limitMinutes;
		const priorRuns = coveredByPriorWeeks(facts.priorOver20hWeeks, monday);

		if (overLimit) counted.push({ monday, source: "own" });
		else if (priorRuns.length > 0) counted.push({ monday, source: "prior" });
		const windowStart = monday.subtract({ weeks: WORKING_STUDENT_ROLLING_WEEKS - 1 });
		const inWindow = counted.filter((week) => comparePlainDates(week.monday, windowStart) >= 0);

		const week: WorkingStudentWeek = {
			weekStart,
			subjectKey: isoWeekKey(monday),
			isWorkingStudentWeek,
			limitMinutes,
			totalMinutes: total,
			coreMinutes: core,
			completedCoreMinutes: minutes(acc?.completedCore ?? 0),
			lectureFreeMinutes: lectureFree,
			eveningWeekendMinutes: eveningWeekend,
			otherProfileMinutes: otherProfile,
			overLimit,
			lectureBreach,
			priorOver20hWeek: priorRuns.length > 0,
			rollingOver20hWeeks: inWindow.length,
			ceilingWeeks,
		};
		weeks.push(week);

		const judged = comparePlainDates(monday, judgedFrom) >= 0;
		const ceilingOnly = comparePlainDates(monday, judgedUntil) >= 0;
		if (judged && !ceilingOnly && overLimit) judgedWeekOverLimit = true;
		// A later week is only the judged window's business when a judged week raises its count.
		const forwardOpen = input.judgedWeeks.ceilingForwardOpen ?? judgedWeekOverLimit;
		if (!judged || !isWorkingStudentWeek || (ceilingOnly && !forwardOpen)) continue;

		const periodEnd = monday.add({ weeks: 1 }).toString();
		const base = {
			organizationId: input.organizationId,
			employeeId: facts.employeeId,
			domain: "working_student" as const,
			subjectKey: week.subjectKey,
			periodStart: weekStart,
			periodEnd,
			acknowledgementKind: "working_student_over_20h_week" as const,
		};

		if (lectureBreach && limitMinutes !== null && !ceilingOnly) {
			const legalReference =
				thresholds.rowOn(WEEKLY_LIMIT_KEY, weekStart)?.legalReference ??
				WORKING_STUDENT_LEGAL_REFERENCE;
			const usage = classifyStatutoryUsage({ used: core, limit: limitMinutes }, input.preferences);
			findings.push({
				...base,
				id: statutoryFindingId("working_student_lecture_week", facts.employeeId, week.subjectKey),
				kind: "working_student_lecture_week",
				// Recorded work already broke the rule; a planned excess can still be changed.
				severity: week.completedCoreMinutes > limitMinutes ? "critical" : "warning",
				legalReference,
				summary: {
					tier: usage.tier,
					usedPercent: usage.usedPercent,
					used: { unit: "minutes", value: core },
					limit: { unit: "minutes", value: limitMinutes },
					remaining: { unit: "minutes", value: 0 },
				},
				adminDetail: {
					facts: {
						totalMinutes: total,
						coreMinutes: core,
						completedCoreMinutes: week.completedCoreMinutes,
						lectureFreeMinutes: lectureFree,
						eveningWeekendMinutes: eveningWeekend,
						otherProfileMinutes: otherProfile,
					},
				},
				// What the rule judges, not how the minutes were recorded: a shift worked as planned,
				// weekend or evening work, and a re-recorded identical lecture-free period leave it as is.
				// A clock-in without a shift grows by the minute: it counts by identity until clocked out.
				// The organization's daytime band decides which minutes are core: changing it makes the
				// week's acknowledgement stale.
				inputFingerprint: statutoryInputFingerprint({
					kind: "working_student_lecture_week",
					employeeId: facts.employeeId,
					subjectKey: week.subjectKey,
					limitMinutes,
					daytime: [band.startMinute, band.endMinute],
					coreMinutes: minutes((acc?.core ?? 0) - (acc?.growingCore ?? 0)),
					runningClockIns: [...(acc?.growing ?? [])].sort(),
					workingStudentDays,
					lectureFreeDays: lectureFreeWeekdaysOf(facts.lectureFreePeriods, monday),
				}),
				// The planner's publish acknowledgement judges the depth the same way.
				...(acc && acc.growing.size > 0
					? { stableDepth: { used: minutes(acc.core - acc.growingCore) } }
					: {}),
			});
		}

		if (overLimit && ceilingWeeks !== null) {
			const usage = classifyStatutoryUsage(
				{ used: inWindow.length, limit: ceilingWeeks },
				input.preferences,
			);
			const severity = severityOf(usage.tier);
			if (severity) {
				findings.push({
					...base,
					id: statutoryFindingId(
						"working_student_26_week_ceiling",
						facts.employeeId,
						week.subjectKey,
					),
					kind: "working_student_26_week_ceiling",
					severity,
					legalReference:
						thresholds.rowOn(CEILING_KEY, weekStart)?.legalReference ??
						WORKING_STUDENT_LEGAL_REFERENCE,
					summary: {
						tier: usage.tier,
						usedPercent: usage.usedPercent,
						used: { unit: "weeks", value: inWindow.length },
						limit: { unit: "weeks", value: ceilingWeeks },
						remaining: { unit: "weeks", value: Math.max(0, ceilingWeeks - inWindow.length) },
					},
					adminDetail: {
						facts: {
							ownOver20hWeeks: inWindow.filter((w) => w.source === "own").length,
							priorOver20hWeeks: inWindow.filter((w) => w.source === "prior").length,
							rollingWindowStart: windowStart.toString(),
						},
					},
					inputFingerprint: statutoryInputFingerprint({
						kind: "working_student_26_week_ceiling",
						employeeId: facts.employeeId,
						subjectKey: week.subjectKey,
						ceilingWeeks,
						limitMinutes,
						countedWeeks: inWindow.map((w) => ({
							weekStart: w.monday.toString(),
							source: w.source,
						})),
					}),
				});
			}
		}
	}

	return { weeks, findings };
}
