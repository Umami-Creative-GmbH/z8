/**
 * Working-student (§ 6 Abs. 1 Nr. 3 SGB V, *Werkstudentenprivileg*) week math (#1991). Pure: the
 * loader (`monitor.ts`) gathers the facts, this module judges them.
 *
 * Compliance weeks run Monday–Sunday in the organization's timezone. Every minute of work is
 * classified by where it falls in that zone:
 *
 * - **core**: a lecture-period weekday between 06:00 and 18:00, the time studies need;
 * - **lecture-free**: a day inside a recorded `employee_study_period` (semester break);
 * - **evening/weekend**: Saturday, Sunday, or a weekday before 06:00 or from 18:00.
 *
 * A week above the weekly limit (20 h) is an unexcused lecture-week breach when its core minutes
 * alone exceed the limit; when the excess falls on lecture-free days, evenings, nights or weekends
 * the week is permitted. Every week above the limit, permitted or not, counts toward the rolling
 * ceiling (26 weeks in the 52 weeks up to and including the judged week), together with recorded
 * prior-employer weeks, each of which ages out of the window on its own.
 *
 * The 06:00–18:00 daytime band is Z8's reading of the social-insurance carriers' "evening and night
 * hours" exception (GKV-Spitzenverband circular on employed students); the law names no hour, so it
 * is not a statutory baseline. Both limits come from `statutory_threshold`.
 */
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import { comparePlainDates, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutorySeverity,
	statutoryFindingId,
} from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type { StatutoryPreferences } from "../preferences";
import type { StatutoryThresholdTable } from "../thresholds";

/** Weekday daytime (minutes after local midnight) that counts against the lecture-week limit. */
export const WORKING_STUDENT_DAYTIME_START_MINUTE = 6 * 60;
export const WORKING_STUDENT_DAYTIME_END_MINUTE = 18 * 60;

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
	/** Whether the employee's effective contract is `working_student` in the week of `monday`. */
	readonly isWorkingStudentWeek: (monday: string) => boolean;
}

export interface WorkingStudentWeek {
	readonly weekStart: string;
	/** ISO week, e.g. `2026-W10`. */
	readonly subjectKey: string;
	readonly isWorkingStudentWeek: boolean;
	/** Weekly limit in force on the Monday, or null when no baseline covers it. */
	readonly limitMinutes: number | null;
	readonly totalMinutes: number;
	readonly coreMinutes: number;
	/** Core minutes from completed work only. */
	readonly completedCoreMinutes: number;
	readonly lectureFreeMinutes: number;
	readonly eveningWeekendMinutes: number;
	/** Own work above the weekly limit in a working-student week. */
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
	/** Every week from the rolling window's start up to the last judged week, oldest first. */
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

type Category = "core" | "lectureFree" | "eveningWeekend";

interface WeekAccumulator {
	core: number;
	completedCore: number;
	lectureFree: number;
	eveningWeekend: number;
	intervals: Map<string, WorkingStudentWorkInterval>;
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

function overlapMinutes(start: Instant, end: Instant, from: Instant, until: Instant): number {
	const lo = Math.max(start.epochMilliseconds, from.epochMilliseconds);
	const hi = Math.min(end.epochMilliseconds, until.epochMilliseconds);
	return hi > lo ? (hi - lo) / 60_000 : 0;
}

/** Adds an interval's net minutes, by local day and category, to the weeks they fall in. */
function accumulate(
	weeks: Map<string, WeekAccumulator>,
	interval: WorkingStudentWorkInterval,
	timezone: string,
	lectureFreePeriods: readonly WorkingStudentLectureFreePeriod[],
): void {
	const elapsed = (interval.end.epochMilliseconds - interval.start.epochMilliseconds) / 60_000;
	if (elapsed <= 0 || interval.netMinutes <= 0) return;
	const ratio = interval.netMinutes / elapsed;
	const at = (day: PlainDate, minute: number) =>
		day
			.toPlainDateTime({ hour: Math.floor(minute / 60), minute: minute % 60 })
			.toZonedDateTime(timezone)
			.toInstant();

	for (
		let day = plainDateAt(interval.start, timezone);
		day.toZonedDateTime(timezone).toInstant().epochMilliseconds < interval.end.epochMilliseconds;
		day = day.add({ days: 1 })
	) {
		const dayStart = day.toZonedDateTime(timezone).toInstant();
		const nextDay = day.add({ days: 1 }).toZonedDateTime(timezone).toInstant();
		const daytimeStart = at(day, WORKING_STUDENT_DAYTIME_START_MINUTE);
		const daytimeEnd = at(day, WORKING_STUDENT_DAYTIME_END_MINUTE);
		const night =
			overlapMinutes(interval.start, interval.end, dayStart, daytimeStart) +
			overlapMinutes(interval.start, interval.end, daytimeEnd, nextDay);
		const daytime = overlapMinutes(interval.start, interval.end, daytimeStart, daytimeEnd);
		if (night + daytime === 0) continue;

		const weekend = day.dayOfWeek >= 6;
		const lectureFree = !weekend && isLectureFree(lectureFreePeriods, day);
		const daytimeCategory: Category = weekend
			? "eveningWeekend"
			: lectureFree
				? "lectureFree"
				: "core";
		const nightCategory: Category = lectureFree ? "lectureFree" : "eveningWeekend";

		const key = mondayOf(day).toString();
		const week = weeks.get(key) ?? {
			core: 0,
			completedCore: 0,
			lectureFree: 0,
			eveningWeekend: 0,
			intervals: new Map(),
		};
		week.intervals.set(`${interval.source}:${interval.ref}`, interval);
		week[daytimeCategory] += daytime * ratio;
		week[nightCategory] += night * ratio;
		if (daytimeCategory === "core" && interval.source === "work") {
			week.completedCore += daytime * ratio;
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
 * `judgedWeeks.toExclusive` (a Monday), using every week of the rolling window before them.
 */
export function evaluateWorkingStudentEmployee(input: {
	readonly organizationId: string;
	readonly timezone: string;
	readonly judgedWeeks: { readonly from: string; readonly toExclusive: string };
	readonly thresholds: StatutoryThresholdTable;
	readonly preferences: Pick<
		StatutoryPreferences,
		"warningThresholdPercent" | "criticalThresholdPercent"
	>;
	readonly facts: WorkingStudentEmployeeFacts;
}): WorkingStudentEvaluation {
	const { facts, thresholds } = input;
	const judgedFrom = mondayOf(parsePlainDate(input.judgedWeeks.from));
	const judgedUntil = parsePlainDate(input.judgedWeeks.toExclusive);
	const evaluatedFrom = judgedFrom.subtract({ weeks: WORKING_STUDENT_ROLLING_WEEKS - 1 });

	const accumulators = new Map<string, WeekAccumulator>();
	for (const interval of facts.intervals) {
		accumulate(accumulators, interval, input.timezone, facts.lectureFreePeriods);
	}

	const weeks: WorkingStudentWeek[] = [];
	const counted: { monday: PlainDate; source: "own" | "prior" }[] = [];
	const findings: WorkingStudentFinding[] = [];

	for (
		let monday = evaluatedFrom;
		comparePlainDates(monday, judgedUntil) < 0;
		monday = monday.add({ weeks: 1 })
	) {
		const weekStart = monday.toString();
		const acc = accumulators.get(weekStart);
		const core = Math.round(acc?.core ?? 0);
		const lectureFree = Math.round(acc?.lectureFree ?? 0);
		const eveningWeekend = Math.round(acc?.eveningWeekend ?? 0);
		const total = Math.round(
			(acc?.core ?? 0) + (acc?.lectureFree ?? 0) + (acc?.eveningWeekend ?? 0),
		);
		const limitMinutes = thresholds.valueOn(WEEKLY_LIMIT_KEY, weekStart);
		const ceilingWeeks = thresholds.valueOn(CEILING_KEY, weekStart);
		const isWorkingStudentWeek = facts.isWorkingStudentWeek(weekStart);
		const overLimit = isWorkingStudentWeek && limitMinutes !== null && total > limitMinutes;
		const lectureBreach = overLimit && limitMinutes !== null && core > limitMinutes;
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
			completedCoreMinutes: Math.round(acc?.completedCore ?? 0),
			lectureFreeMinutes: lectureFree,
			eveningWeekendMinutes: eveningWeekend,
			overLimit,
			lectureBreach,
			priorOver20hWeek: priorRuns.length > 0,
			rollingOver20hWeeks: inWindow.length,
			ceilingWeeks,
		};
		weeks.push(week);

		const judged = comparePlainDates(monday, judgedFrom) >= 0;
		if (!judged || !isWorkingStudentWeek) continue;

		const periodEnd = monday.add({ weeks: 1 }).toString();
		const weekIntervals = [...(acc?.intervals.values() ?? [])]
			.map((interval) => ({
				source: interval.source,
				ref: interval.ref,
				start: interval.start.toString(),
				end: interval.end.toString(),
				netMinutes: interval.netMinutes,
			}))
			.sort((a, b) =>
				a.start === b.start ? (a.ref < b.ref ? -1 : 1) : a.start < b.start ? -1 : 1,
			);
		const base = {
			organizationId: input.organizationId,
			employeeId: facts.employeeId,
			domain: "working_student" as const,
			subjectKey: week.subjectKey,
			periodStart: weekStart,
			periodEnd,
			acknowledgementKind: "working_student_over_20h_week" as const,
		};

		if (lectureBreach && limitMinutes !== null) {
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
					},
				},
				inputFingerprint: statutoryInputFingerprint({
					kind: "working_student_lecture_week",
					employeeId: facts.employeeId,
					subjectKey: week.subjectKey,
					limitMinutes,
					daytime: [WORKING_STUDENT_DAYTIME_START_MINUTE, WORKING_STUDENT_DAYTIME_END_MINUTE],
					intervals: weekIntervals,
					lectureFreePeriods: facts.lectureFreePeriods
						.filter((period) => period.startsOn < periodEnd && period.endsOn >= weekStart)
						.map((period) => ({ ...period }))
						.sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1)),
				}),
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
