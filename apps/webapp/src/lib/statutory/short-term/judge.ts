/**
 * Pure judgement of one employee's short-term calendar year (#1990). Inputs come from
 * `loadShortTermInputs`; nothing here reads the database. A fixed-term employment is judged on its
 * whole agreed length, across the year end (`shortTermStints`).
 */
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	classifyStatutoryUsage,
	type StatutoryFinding,
	type StatutoryUsageTier,
	severityOfUsageTier,
	statutoryFindingId,
} from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type { StatutoryPreferences } from "../preferences";
import type { StatutoryThresholdTable } from "../thresholds";
import type {
	ShortTermEmployeeInputs,
	ShortTermEmployment,
	ShortTermLimitKind,
	ShortTermPlanItem,
	ShortTermWorkItem,
	ShortTermYearWeek,
} from "./load-inputs";

export const SHORT_TERM_LEGAL_REFERENCE = "§ 8 Abs. 1 Nr. 2 SGB IV";

/** Finding kinds of the short-term monitor. */
export type ShortTermFindingKind = "short_term_work_days" | "short_term_months";

/** Wage-free state of one calendar year's allowance; planners may see all of it. */
export interface ShortTermAllowance {
	readonly employeeId: string;
	readonly year: number;
	readonly limitKind: ShortTermLimitKind;
	/** Used days or months: own short-term work and plans plus prior employers. */
	readonly used: number;
	/**
	 * Days from Z8's own short-term employments: agreed fixed-term lengths (in calendar days, or the
	 * working days an agreed week plans), completed work and planned shifts.
	 */
	readonly ownUsed: number;
	/** Days (or months) recorded for prior employers in this calendar year. */
	readonly priorEmployerUsed: number;
	readonly limit: number;
	readonly remaining: number;
	readonly tier: StatutoryUsageTier;
	readonly usedPercent: number;
	/** First and last counted short-term day of the year, `YYYY-MM-DD`. */
	readonly firstDay: string | null;
	readonly lastDay: string | null;
}

export interface ShortTermYearEvaluation {
	readonly employeeId: string;
	readonly year: number;
	/** Null when no statutory baseline covers the year (not evaluable). */
	readonly allowance: ShortTermAllowance | null;
	/** Allowance finding (warning tier and up) and Berufsmäßigkeit prompts. */
	readonly findings: readonly StatutoryFinding[];
}

/**
 * Under open-ended framework terms, counted days at most this many calendar days apart belong to
 * one stint: weekends, public holidays and a week's leave do not end an assignment, a longer
 * pause does.
 */
export const SHORT_TERM_STINT_GAP_DAYS = 14;

/**
 * When stints are added together, a full calendar month counts as 30 calendar days and
 * 3 months × 30 = 90 calendar days replace the 3-month limit (Geringfügigkeits-Richtlinien,
 * Zusammenrechnung mehrerer kurzfristiger Beschäftigungen).
 */
export const SHORT_TERM_DAYS_PER_FULL_MONTH = 30;

/** Work days a week from which the 3-month limit applies. */
const SHORT_TERM_FULL_WEEK_DAYS = 5;

/** At most one in this many full weeks may lack a day to a public holiday. */
const SHORT_TERM_WEEKS_PER_HOLIDAY_WEEK = 4;

/** A run of short-term calendar days, `YYYY-MM-DD` inclusive. */
export interface ShortTermStint {
	readonly firstDay: string;
	readonly lastDay: string;
	/**
	 * The `employmentKeys` key of the fixed-term employment this stint is the agreed length of;
	 * null for a run of observed work.
	 */
	readonly agreedEmployment: string | null;
}

/**
 * Splits counted days (sorted, distinct) into runs of observed work: a new run starts after a
 * pause of more than `SHORT_TERM_STINT_GAP_DAYS` or with a new employment (`employmentOf`).
 */
function observedRuns(
	days: readonly string[],
	employmentOf: ReadonlyMap<string, string>,
): ShortTermStint[] {
	const runs: { firstDay: string; lastDay: string; agreedEmployment: null }[] = [];
	for (const day of days) {
		const current = runs.at(-1);
		if (
			current &&
			parsePlainDate(current.lastDay).until(parsePlainDate(day)).days <=
				SHORT_TERM_STINT_GAP_DAYS &&
			employmentOf.get(current.lastDay) === employmentOf.get(day)
		) {
			current.lastDay = day;
		} else {
			runs.push({ firstDay: day, lastDay: day, agreedEmployment: null });
		}
	}
	return runs;
}

/** The `employmentKeys` key of `employments[index]`. */
function employmentKey(index: number): string {
	return `employment:${index}`;
}

/**
 * Which employment each counted day belongs to: the short-term employment covering it, else (should
 * the terms rows not cover it) its employment period. Days of one employment share a key.
 */
function employmentKeys(
	days: readonly string[],
	employments: readonly ShortTermEmployment[],
	employmentPeriodOf: ReadonlyMap<string, string | null>,
): Map<string, string> {
	return new Map(
		days.map((day) => {
			const index = employments.findIndex(
				(employment) =>
					employment.from <= day && (employment.until === null || day < employment.until),
			);
			return [
				day,
				index >= 0 ? employmentKey(index) : `period:${employmentPeriodOf.get(day) ?? ""}`,
			];
		}),
	);
}

/**
 * The agreed length of each fixed-term employment that overlaps `year`: from its first day to its
 * agreed last day, or to the day before later terms take over if that is earlier. Not clipped at
 * January 1 or December 31, and there as soon as it is agreed, before any shift is planned.
 */
function agreedStints(
	year: number,
	employments: readonly ShortTermEmployment[],
): Map<string, ShortTermStint> {
	const yearStart = `${year}-01-01`;
	const yearEnd = `${year}-12-31`;
	const stints = new Map<string, ShortTermStint>();
	for (const [index, employment] of employments.entries()) {
		if (!employment.fixedTermEndsOn) continue;
		const lastBeforeLaterTerms =
			employment.until === null
				? null
				: parsePlainDate(employment.until).subtract({ days: 1 }).toString();
		const lastDay =
			lastBeforeLaterTerms !== null && lastBeforeLaterTerms < employment.fixedTermEndsOn
				? lastBeforeLaterTerms
				: employment.fixedTermEndsOn;
		if (lastDay < employment.from || lastDay < yearStart || employment.from > yearEnd) continue;
		const key = employmentKey(index);
		stints.set(key, { firstDay: employment.from, lastDay, agreedEmployment: key });
	}
	return stints;
}

/**
 * The year's stints. A fixed-term employment overlapping the year is one stint over its whole
 * agreed length (`agreedStints`), pauses, days before January 1 and days after December 31
 * included: § 8 Abs. 1 Nr. 2 SGB IV judges an employment limited in advance by contract on its
 * agreed length, and the Geringfügigkeits-Richtlinien apply that to an employment across the year
 * end too. Under open-ended framework terms, and after an agreed end, each run of observed work in
 * the year is a stint (`observedRuns`), so the pauses between assignments do not count.
 *
 * #1990 says the allowance resets on January 1. That holds for adding up separate employments
 * within a calendar year, not for one continuing fixed-term employment: the law wins here.
 */
export function shortTermStints(input: {
	readonly year: number;
	/** The year's counted days, sorted and distinct. */
	readonly days: readonly string[];
	readonly employments: readonly ShortTermEmployment[];
	readonly employmentOf: ReadonlyMap<string, string>;
}): ShortTermStint[] {
	const agreed = agreedStints(input.year, input.employments);
	const observed = input.days.filter((day) => {
		const stint = agreed.get(input.employmentOf.get(day) ?? "");
		return !stint || day > stint.lastDay;
	});
	return [...agreed.values(), ...observedRuns(observed, input.employmentOf)].sort((a, b) =>
		a.firstDay.localeCompare(b.firstDay),
	);
}

/**
 * Work days per week read from counted days, for terms that plan no real week: the mean number
 * of counted days per Monday–Sunday week whose Monday to Friday lie within one stint, like the
 * mean over a planned rota's cycle (`averageWorkDaysPerWeek`). Irregular weeks of 3 and 5 days
 * average 4. A week one day short may have lost that day to a public holiday: up to one in four
 * full weeks (at least one, never all of them) count that day. Some weeks say nothing about the
 * pattern and are left out: partial first and last weeks, a week without counted days inside a
 * stint (a week off), and a week left short by an approved absence (`absenceDays`: a day of it
 * absent and not worked). Null until one full week that says something has been seen.
 */
export function observedWorkDaysPerWeek(
	days: readonly string[],
	employmentOf: ReadonlyMap<string, string>,
	absenceDays: ReadonlySet<string> = new Set(),
): number | null {
	const counted = new Set(days);
	const perWeek: number[] = [];
	for (const stint of observedRuns(days, employmentOf)) {
		const first = parsePlainDate(stint.firstDay);
		const last = parsePlainDate(stint.lastDay);
		let monday = first.subtract({ days: first.dayOfWeek - 1 });
		if (comparePlainDates(monday, first) < 0) monday = monday.add({ weeks: 1 });
		for (
			;
			comparePlainDates(monday.add({ days: 4 }), last) <= 0;
			monday = monday.add({ weeks: 1 })
		) {
			let count = 0;
			let absentUnworked = false;
			for (let offset = 0; offset < 7; offset++) {
				const day = monday.add({ days: offset }).toString();
				if (counted.has(day)) count++;
				else if (absenceDays.has(day)) absentUnworked = true;
			}
			if (count === 0 || (absentUnworked && count < SHORT_TERM_FULL_WEEK_DAYS)) continue;
			perWeek.push(count);
		}
	}
	if (perWeek.length === 0) return null;
	const oneDayShort = perWeek.filter((count) => count === SHORT_TERM_FULL_WEEK_DAYS - 1).length;
	const holidayWeeks = Math.min(
		oneDayShort,
		Math.max(1, Math.floor(perWeek.length / SHORT_TERM_WEEKS_PER_HOLIDAY_WEEK)),
		perWeek.length - 1,
	);
	const workDays = perWeek.reduce((sum, count) => sum + count, 0) + holidayWeeks;
	return workDays / perWeek.length;
}

/**
 * The allowance the employee's own short-term terms call for: `months` only when every terms
 * version that sets the employee's own week plans 5 or more work days a week, and the days under
 * terms without one (inherited defaults included) show a full week of 5 or more days, weeks off
 * and weeks left short by approved absences aside (`observedWorkDaysPerWeek`). Open-ended
 * framework terms that nobody worked or was planned under say nothing about the week and do not
 * choose the limit, with or without an own week; a fixed term's own week does, being agreed in
 * advance (`plannedWorkDaysPerWeek`). With no week planned or observed at all, the year counts
 * working days. Prior employers may still switch the year to working days.
 */
function ownLimitKindOf(
	week: ShortTermYearWeek,
	employmentOf: ReadonlyMap<string, string>,
	absenceDays: ReadonlySet<string>,
): ShortTermLimitKind {
	if (week.plannedWorkDaysPerWeek.some((perWeek) => perWeek < SHORT_TERM_FULL_WEEK_DAYS)) {
		return "work_days";
	}
	if (week.unplannedDays.length === 0) {
		return week.plannedWorkDaysPerWeek.length > 0 ? "months" : "work_days";
	}
	return (observedWorkDaysPerWeek(week.unplannedDays, employmentOf, absenceDays) ?? 0) >=
		SHORT_TERM_FULL_WEEK_DAYS
		? "months"
		: "work_days";
}

/**
 * Calendar days of `months` time months from `start` (§§ 187 Abs. 2, 188 Abs. 2 and 3 BGB): the
 * period ends on the day before the day with the start's number in the `months`-th following
 * month, or on that month's last day when it has no such day. 31 January – 30 April is 90 days.
 */
function timeMonthsDays(start: PlainDate, months: number): number {
	const month = start.with({ day: 1 }).add({ months });
	const end =
		start.day <= month.daysInMonth
			? month.with({ day: start.day }).subtract({ days: 1 })
			: month.with({ day: month.daysInMonth });
	return start.until(end).days + 1;
}

function calendarDays(stint: ShortTermStint): number {
	return parsePlainDate(stint.firstDay).until(parsePlainDate(stint.lastDay)).days + 1;
}

/** A stint's calendar days when stints are added: full calendar months count as 30 days. */
function combinedCalendarDays(stint: ShortTermStint): number {
	const last = parsePlainDate(stint.lastDay);
	let cursor = parsePlainDate(stint.firstDay);
	let total = 0;
	while (comparePlainDates(cursor, last) <= 0) {
		const monthEnd = cursor.with({ day: cursor.daysInMonth });
		const segmentEnd = comparePlainDates(monthEnd, last) < 0 ? monthEnd : last;
		const fullMonth = cursor.day === 1 && segmentEnd.equals(monthEnd);
		total += fullMonth ? SHORT_TERM_DAYS_PER_FULL_MONTH : cursor.until(segmentEnd).days + 1;
		cursor = segmentEnd.add({ days: 1 });
	}
	return total;
}

interface PriorEmployerTotals {
	readonly days: number;
	readonly months: number;
}

function priorEmployerTotals(employee: ShortTermEmployeeInputs, year: number): PriorEmployerTotals {
	let days = 0;
	let months = 0;
	for (const offset of employee.priorOffsets) {
		if (offset.year !== year) continue;
		if (offset.kind === "prior_short_term_work_days") days += offset.count;
		else months += offset.count;
	}
	return { days, months };
}

/** A fixed-term employment's agreed working days and what it uses of the 70-working-day limit. */
interface AgreedWorkingDays {
	readonly stint: ShortTermStint;
	/** Working days its agreed week plans over its agreed length. */
	readonly agreed: number;
	/** Those, plus days worked or planned that the week does not plan. */
	readonly used: number;
}

/**
 * The working days a fixed-term employment uses of the 70-working-day limit when its terms plan
 * the employee's own week (`agreedWeeks`): § 8 Abs. 1 Nr. 2 SGB IV asks whether the employment is
 * limited in advance by contract, so the working days its week plans over the agreed length count
 * as soon as it is agreed, before any shift is planned. Counted per calendar day of the agreed
 * length, under the week in force that day: a day the week plans counts, and so does a counted
 * day it does not plan (work on a free day). A multi-week rota counts its mean per day, rounded
 * once, or its counted days where they are more. Parts without an own week count their counted
 * days only. Null when no part plans a week: then only counted days count.
 */
function agreedWorkingDaysOf(
	stint: ShortTermStint,
	employment: ShortTermEmployment,
	counted: ReadonlySet<string>,
): AgreedWorkingDays | null {
	const weeks = employment.agreedWeeks;
	if (!weeks.some((week) => week.weekdays !== null || week.workDaysPerWeek !== null)) return null;
	let plannedDays = 0;
	let exactDays = 0;
	let rotaShare = 0;
	let rotaCounted = 0;
	let weekIndex = 0;
	const last = parsePlainDate(stint.lastDay);
	for (
		let cursor = parsePlainDate(stint.firstDay);
		comparePlainDates(cursor, last) <= 0;
		cursor = cursor.add({ days: 1 })
	) {
		const day = cursor.toString();
		while ((weeks[weekIndex]?.until ?? "9999-12-31") <= day) weekIndex++;
		const current = weeks[weekIndex];
		const week = current && current.from <= day ? current : null;
		if (week?.weekdays) {
			const planned = week.weekdays.includes(cursor.dayOfWeek);
			if (planned) plannedDays++;
			if (planned || counted.has(day)) exactDays++;
		} else if (week && week.workDaysPerWeek !== null) {
			rotaShare += week.workDaysPerWeek / 7;
			if (counted.has(day)) rotaCounted++;
		} else if (counted.has(day)) {
			exactDays++;
		}
	}
	const rotaDays = Math.round(rotaShare);
	return {
		stint,
		agreed: plannedDays + rotaDays,
		used: exactDays + Math.max(rotaDays, rotaCounted),
	};
}

/** What an agreed fixed term alone exceeds, from the day it is agreed. */
interface AgreedTermOverLimit {
	readonly stint: ShortTermStint;
	readonly reason: "agreed_fixed_term_exceeds_limit" | "agreed_fixed_term_exceeds_working_days";
	/** Under the 70-working-day limit: the working days its agreed week plans. */
	readonly agreedWorkingDays: number | null;
}

interface AllowanceCount {
	readonly limitKind: ShortTermLimitKind;
	readonly limit: number;
	readonly ownUsed: number;
	readonly priorEmployerUsed: number;
	/**
	 * An agreed fixed term over the limit on its own: longer than 3 time months, or planning more
	 * than 70 working days.
	 */
	readonly agreedTermOverLimit: AgreedTermOverLimit | null;
	/** Under the 70-working-day limit: each fixed term's agreed working days (fingerprinted). */
	readonly agreedWorkingDays: readonly AgreedWorkingDays[];
}

/**
 * The year's allowance under § 8 Abs. 1 Nr. 2 SGB IV and the Geringfügigkeits-Richtlinien:
 *
 * - **3 months** when every stint follows a continuous week of 5 or more work days, counted in
 *   calendar days. One stint alone is measured in time months (*Zeitmonate*) from its first day
 *   (`timeMonthsDays`): 15 June – 14 September is 3 months (92 days), 31 January – 30 April
 *   is 90 days, and 15 June – 15 August uses 62 of them, not a
 *   started third month. A fixed-term employment is one stint over its whole agreed length, its
 *   pauses and the other calendar year included (see `shortTermStints`): agreed for longer than
 *   3 time months, it is exceeded as soon as it is agreed, and is reported against its own limit
 *   if the added-up stints are not exceeded too. Several stints (also a prior employer's) are
 *   added: a full calendar month counts as 30 days, a part month with its actual days, against
 *   90 calendar days. The pauses between stints never count.
 * - **70 working days** as soon as one stint has a shorter or irregular week, and also when such
 *   stints meet ≥ 5-day stints: then every stint counts with its working days (`workingDays`:
 *   a fixed-term employment's in the other calendar year too). A fixed-term employment whose
 *   terms plan the employee's own week counts the working days that week plans over its whole
 *   agreed length as soon as it is agreed (`agreedWorkingDaysOf`); planning more than 70, it is
 *   exceeded before any shift is planned. Prior employers' working days count as recorded; a prior
 *   employer's months, whose working days are not recorded, count as 70 / 3 working days each (the
 *   ratio of the two limits), rounded up.
 */
function countAllowance(input: {
	readonly ownLimitKind: ShortTermLimitKind;
	readonly workingDays: readonly string[];
	readonly stints: readonly ShortTermStint[];
	readonly employments: readonly ShortTermEmployment[];
	readonly prior: PriorEmployerTotals;
	readonly dayLimit: number;
	readonly monthLimit: number;
}): AllowanceCount {
	const { prior, stints, dayLimit, monthLimit } = input;
	if (input.ownLimitKind === "work_days" || prior.days > 0) {
		const counted = new Set(input.workingDays);
		const agreedWorkingDays = stints.flatMap((stint) => {
			const employment = input.employments.find(
				(_, index) => employmentKey(index) === stint.agreedEmployment,
			);
			const agreed = employment ? agreedWorkingDaysOf(stint, employment, counted) : null;
			return agreed ? [agreed] : [];
		});
		const otherDays = input.workingDays.filter(
			(day) =>
				!agreedWorkingDays.some(({ stint }) => stint.firstDay <= day && day <= stint.lastDay),
		);
		const overLimit = agreedWorkingDays.find(({ agreed }) => agreed > dayLimit);
		return {
			limitKind: "work_days",
			limit: dayLimit,
			ownUsed: agreedWorkingDays.reduce((sum, { used }) => sum + used, otherDays.length),
			priorEmployerUsed: prior.days + Math.ceil((prior.months * dayLimit) / monthLimit),
			agreedTermOverLimit: overLimit
				? {
						stint: overLimit.stint,
						reason: "agreed_fixed_term_exceeds_working_days",
						agreedWorkingDays: overLimit.agreed,
					}
				: null,
			agreedWorkingDays,
		};
	}
	const ownLimit = (stint: ShortTermStint) =>
		timeMonthsDays(parsePlainDate(stint.firstDay), monthLimit);
	const overLimitStint = stints.find(
		(stint) => stint.agreedEmployment !== null && calendarDays(stint) > ownLimit(stint),
	);
	const agreedTermOverLimit: AgreedTermOverLimit | null = overLimitStint
		? {
				stint: overLimitStint,
				reason: "agreed_fixed_term_exceeds_limit",
				agreedWorkingDays: null,
			}
		: null;
	const [only] = stints;
	if (stints.length === 1 && only && prior.months === 0) {
		return {
			limitKind: "months",
			limit: ownLimit(only),
			ownUsed: calendarDays(only),
			priorEmployerUsed: 0,
			agreedTermOverLimit,
			agreedWorkingDays: [],
		};
	}
	const limit = monthLimit * SHORT_TERM_DAYS_PER_FULL_MONTH;
	const ownUsed = stints.reduce((sum, stint) => sum + combinedCalendarDays(stint), 0);
	const priorEmployerUsed = prior.months * SHORT_TERM_DAYS_PER_FULL_MONTH;
	if (agreedTermOverLimit && ownUsed + priorEmployerUsed <= limit) {
		// Full months counted as 30 days can bring the added-up stints under 90 although the agreed
		// term alone runs past its 3 time months: that term is not short-term on its own.
		return {
			limitKind: "months",
			limit: ownLimit(agreedTermOverLimit.stint),
			ownUsed: calendarDays(agreedTermOverLimit.stint),
			priorEmployerUsed: 0,
			agreedTermOverLimit,
			agreedWorkingDays: [],
		};
	}
	return {
		limitKind: "months",
		limit,
		ownUsed,
		priorEmployerUsed,
		agreedTermOverLimit,
		agreedWorkingDays: [],
	};
}

export function judgeShortTermYear(input: {
	readonly organizationId: string;
	readonly employee: ShortTermEmployeeInputs;
	readonly year: number;
	readonly thresholds: StatutoryThresholdTable;
	readonly preferences: StatutoryPreferences;
}): ShortTermYearEvaluation | null {
	const { employee, year, thresholds, preferences } = input;
	const week = employee.weekByYear.get(year);
	if (!week) return null;
	const inYear = (date: string) => date.startsWith(`${year}-`);
	// Counted days of every loaded year: a fixed-term employment across the year end counts its
	// days in the other year too.
	const counted = [...employee.work, ...employee.planned];
	const allDays = [...new Set(counted.map((item) => item.date))].sort();
	const days = allDays.filter(inYear);
	const employmentOf = employmentKeys(
		allDays,
		employee.employments,
		new Map(counted.map((item) => [item.date, item.employmentPeriodId])),
	);
	const stints = shortTermStints({ year, days, employments: employee.employments, employmentOf });
	const agreed = stints.filter((stint) => stint.agreedEmployment !== null);
	// The year's days, and the other years' days of a fixed-term employment overlapping it.
	const workingDays = allDays.filter(
		(day) =>
			inYear(day) ||
			agreed.some(
				(stint) =>
					employmentOf.get(day) === stint.agreedEmployment &&
					stint.firstDay <= day &&
					day <= stint.lastDay,
			),
	);
	const ownLimitKind = ownLimitKindOf(week, employmentOf, new Set(employee.absenceDays));
	const firstDay = days[0] ?? null;
	const lastDay = days.at(-1) ?? null;

	// The baseline in force on the last counted day (or the year's start) governs the year.
	const governingDay = lastDay ?? `${year}-01-01`;
	const dayLimit = thresholds.valueOn("de_short_term_max_work_days_per_year", governingDay);
	const monthLimit = thresholds.valueOn("de_short_term_max_months_per_year", governingDay);
	if (dayLimit === null || monthLimit === null) {
		return { employeeId: employee.employeeId, year, allowance: null, findings: [] };
	}
	const prior = priorEmployerTotals(employee, year);
	const { limitKind, limit, ownUsed, priorEmployerUsed, agreedTermOverLimit, agreedWorkingDays } =
		countAllowance({
			ownLimitKind,
			workingDays,
			stints,
			employments: employee.employments,
			prior,
			dayLimit,
			monthLimit,
		});
	const used = ownUsed + priorEmployerUsed;
	const { tier, usedPercent } = classifyStatutoryUsage({ used, limit }, preferences);
	const allowance: ShortTermAllowance = {
		employeeId: employee.employeeId,
		year,
		limitKind,
		used,
		ownUsed,
		priorEmployerUsed,
		limit,
		remaining: Math.max(0, limit - used),
		tier,
		usedPercent,
		firstDay,
		lastDay,
	};

	const findings: StatutoryFinding[] = [];
	const severity = severityOfUsageTier(tier);
	if (severity) {
		const kind: ShortTermFindingKind =
			limitKind === "work_days" ? "short_term_work_days" : "short_term_months";
		// Working days for the 70-day limit, calendar days for the 3-month limit (see the kind).
		const unit = "days";
		const subjectKey = String(year);
		findings.push({
			id: statutoryFindingId(kind, employee.employeeId, subjectKey),
			organizationId: input.organizationId,
			employeeId: employee.employeeId,
			domain: "short_term",
			kind,
			severity,
			subjectKey,
			periodStart: `${year}-01-01`,
			periodEnd: `${year + 1}-01-01`,
			legalReference: SHORT_TERM_LEGAL_REFERENCE,
			summary: {
				tier,
				usedPercent,
				used: { unit, value: used },
				limit: { unit, value: limit },
				remaining: { unit, value: allowance.remaining },
			},
			adminDetail: {
				facts: {
					ownUsed,
					priorEmployerDays: prior.days,
					priorEmployerMonths: prior.months,
					stints: stints.length,
					firstDay,
					lastDay,
					...(agreedTermOverLimit && {
						reason: agreedTermOverLimit.reason,
						agreedFirstDay: agreedTermOverLimit.stint.firstDay,
						agreedLastDay: agreedTermOverLimit.stint.lastDay,
						...(agreedTermOverLimit.agreedWorkingDays !== null && {
							agreedWorkingDays: agreedTermOverLimit.agreedWorkingDays,
						}),
					}),
				},
			},
			inputFingerprint: statutoryInputFingerprint({
				kind,
				year,
				limit,
				days: workingDays,
				stints: stints.map((stint) => [stint.firstDay, stint.lastDay]),
				// A fixed term's agreed week counts before any day is worked or planned, and which
				// weekdays it plans decides which counted days come on top: a new week moves `used`
				// although the counted days and the agreed total stay put.
				...(agreedWorkingDays.length > 0 && {
					agreedWorkingDays: agreedWorkingDays.map(({ stint, agreed, used }) => [
						stint.firstDay,
						agreed,
						used,
					]),
				}),
				priorDays: prior.days,
				priorMonths: prior.months,
			}),
			acknowledgementKind: null,
		});
	}
	findings.push(...berufsmaessigkeitFindings(input));
	return { employeeId: employee.employeeId, year, allowance, findings };
}

/**
 * What a Berufsmäßigkeit verification depends on: each day's minutes at each wage, not whether
 * they were planned or worked. A shift worked as planned, a running shift with its open clock-in
 * (minutes so far plus the rest, on one minute grid), a clocked-out break within a running shift
 * and the date rolling past midnight keep it;
 * added, removed, longer or shorter work and shifts, a new wage or cap change it. An open clock-in
 * without a shift grows by the minute, so it counts by its identity until it closes.
 */
function berufsmaessigkeitFingerprint(input: {
	readonly month: string;
	readonly cap: number;
	readonly work: readonly ShortTermWorkItem[];
	readonly planned: readonly ShortTermPlanItem[];
}): string {
	const minutesByDay = new Map<string, number>();
	const openWithoutShift: string[] = [];
	for (const item of [...input.work, ...input.planned]) {
		if ("workPeriodId" in item && item.inProgress === "unplanned") {
			openWithoutShift.push(item.workPeriodId);
			continue;
		}
		const key = `${item.date}|${item.hourlyRateCents ?? "unpriced"}|${item.currency}`;
		minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + item.minutes);
	}
	return statutoryInputFingerprint({
		kind: "short_term_berufsmaessigkeit_check",
		month: input.month,
		cap: input.cap,
		days: [...minutesByDay].sort(([a], [b]) => a.localeCompare(b)),
		openWithoutShift: openWithoutShift.sort(),
	});
}

/**
 * One prompt per month of `year` whose short-term earnings (completed work, open clock-ins up to
 * now, and planned shifts, running ones for their rest) exceed that month's Minijob cap (see
 * `load-inputs.ts` for how work is matched to its shift). Earning more than a Minijob is not
 * itself a breach: the employer must verify the employment is not *berufsmäßig*. Z8 never decides
 * that; an org admin documents the verification as a `short_term_berufsmaessigkeit_verified`
 * acknowledgement, which goes stale when the month's work, shifts, wages or cap change.
 */
function berufsmaessigkeitFindings(input: {
	readonly organizationId: string;
	readonly employee: ShortTermEmployeeInputs;
	readonly year: number;
	readonly thresholds: StatutoryThresholdTable;
	readonly preferences: StatutoryPreferences;
}): StatutoryFinding[] {
	const { employee, year, thresholds, preferences } = input;
	const months = new Set(
		[...employee.work, ...employee.planned]
			.filter((item) => item.date.startsWith(`${year}-`))
			.map((item) => item.date.slice(0, 7)),
	);
	const findings: StatutoryFinding[] = [];
	for (const month of [...months].sort()) {
		const monthStart = `${month}-01`;
		const cap = thresholds.valueOn("de_minijob_monthly_limit_cents", monthStart);
		if (cap === null) continue;
		const work = employee.work
			.filter((item) => item.date.startsWith(month))
			.sort((a, b) => a.workPeriodId.localeCompare(b.workPeriodId));
		const planned = employee.planned
			.filter((item) => item.date.startsWith(month))
			.sort(
				(a, b) =>
					a.date.localeCompare(b.date) ||
					a.startTime.localeCompare(b.startTime) ||
					(a.shiftId ?? "").localeCompare(b.shiftId ?? ""),
			);
		// Cent-minutes (minutes × hourly cents), rounded once per sum: the total of running work and
		// the rest of its shift must not move by a cent as minutes pass from one to the other.
		let earnedCentMinutes = 0;
		let plannedCentMinutes = 0;
		let unpricedMinutes = 0;
		for (const item of work) {
			if (item.hourlyRateCents === null) unpricedMinutes += item.minutes;
			else earnedCentMinutes += item.minutes * item.hourlyRateCents;
		}
		for (const item of planned) {
			if (item.hourlyRateCents === null) unpricedMinutes += item.minutes;
			else plannedCentMinutes += item.minutes * item.hourlyRateCents;
		}
		const earned = Math.round(earnedCentMinutes / 60);
		const total = Math.round((earnedCentMinutes + plannedCentMinutes) / 60);
		const plannedCents = total - earned;
		if (total <= cap) continue;

		const { tier, usedPercent } = classifyStatutoryUsage({ used: total, limit: cap }, preferences);
		const kind = "short_term_berufsmaessigkeit_check";
		const monthEnd = parsePlainDate(monthStart).add({ months: 1 }).toString();
		const currency = [...work, ...planned][0]?.currency ?? "EUR";
		findings.push({
			id: statutoryFindingId(kind, employee.employeeId, month),
			organizationId: input.organizationId,
			employeeId: employee.employeeId,
			domain: "short_term",
			kind,
			severity: "warning",
			subjectKey: month,
			periodStart: monthStart,
			periodEnd: monthEnd,
			legalReference: SHORT_TERM_LEGAL_REFERENCE,
			// Restricted readers get the tier only (`earningsDerived`).
			summary: { tier, usedPercent },
			earningsDerived: true,
			adminDetail: {
				currency,
				amountsCents: { earned, planned: plannedCents, total, cap },
				facts: { unpricedMinutes },
			},
			inputFingerprint: berufsmaessigkeitFingerprint({ month, cap, work, planned }),
			acknowledgementKind: "short_term_berufsmaessigkeit_verified",
		});
	}
	return findings;
}
