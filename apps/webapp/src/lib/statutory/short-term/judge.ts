/**
 * Pure judgement of one employee's short-term calendar year (#1990). Inputs come from
 * `loadShortTermInputs`; nothing here reads the database.
 */
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
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
	/** Days (or months) from Z8's own completed work and planned shifts. */
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
 * Counted days at most this many calendar days apart belong to one stint: weekends, public
 * holidays and a week's leave do not end an employment, a longer pause does.
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

/** A run of counted short-term days, `YYYY-MM-DD` inclusive. */
export interface ShortTermStint {
	readonly firstDay: string;
	readonly lastDay: string;
}

/**
 * Splits the year's counted days (sorted, distinct) into stints: a new stint starts after a pause
 * of more than `SHORT_TERM_STINT_GAP_DAYS` or with a new employment period.
 */
export function shortTermStints(
	days: readonly string[],
	employmentPeriodOf: ReadonlyMap<string, string | null>,
): ShortTermStint[] {
	const stints: { firstDay: string; lastDay: string }[] = [];
	for (const day of days) {
		const current = stints.at(-1);
		if (
			current &&
			parsePlainDate(current.lastDay).until(parsePlainDate(day)).days <=
				SHORT_TERM_STINT_GAP_DAYS &&
			employmentPeriodOf.get(current.lastDay) === employmentPeriodOf.get(day)
		) {
			current.lastDay = day;
		} else {
			stints.push({ firstDay: day, lastDay: day });
		}
	}
	return stints;
}

/**
 * Work days per week read from counted days, for terms that plan no real week: the mean number
 * of counted days per Monday–Sunday week whose Monday to Friday lie within one stint, like the
 * mean over a planned rota's cycle (`averageWorkDaysPerWeek`). Irregular weeks of 3 and 5 days
 * average 4. A week one day short may have lost that day to a public holiday: up to one in four
 * full weeks (at least one, never all of them) count that day. Partial first and last weeks say
 * nothing about the pattern. Null until one full week has been seen.
 */
export function observedWorkDaysPerWeek(
	days: readonly string[],
	employmentPeriodOf: ReadonlyMap<string, string | null>,
): number | null {
	const counted = new Set(days);
	const perWeek: number[] = [];
	for (const stint of shortTermStints(days, employmentPeriodOf)) {
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
			for (let offset = 0; offset < 7; offset++) {
				if (counted.has(monday.add({ days: offset }).toString())) count++;
			}
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
 * terms without one (inherited defaults included) show a full week of 5 or more days. Prior
 * employers may still switch the year to working days.
 */
function ownLimitKindOf(
	week: ShortTermYearWeek,
	employmentPeriodOf: ReadonlyMap<string, string | null>,
): ShortTermLimitKind {
	if (week.plannedWorkDaysPerWeek.some((perWeek) => perWeek < SHORT_TERM_FULL_WEEK_DAYS)) {
		return "work_days";
	}
	if (!week.unplannedTerms) return "months";
	return (observedWorkDaysPerWeek(week.unplannedDays, employmentPeriodOf) ?? 0) >=
		SHORT_TERM_FULL_WEEK_DAYS
		? "months"
		: "work_days";
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

interface AllowanceCount {
	readonly limitKind: ShortTermLimitKind;
	readonly limit: number;
	readonly ownUsed: number;
	readonly priorEmployerUsed: number;
}

/**
 * The year's allowance under § 8 Abs. 1 Nr. 2 SGB IV and the Geringfügigkeits-Richtlinien:
 *
 * - **3 months** when every stint follows a continuous week of 5 or more work days, counted in
 *   calendar days. One stint alone is measured in time months (*Zeitmonate*) from its first day:
 *   15 June – 14 September is 3 months (92 days), and 15 June – 15 August uses 62 of them, not a
 *   started third month. Several stints (also a prior employer's) are added: a full calendar month
 *   counts as 30 days, a part month with its actual days, against 90 calendar days. The pauses
 *   between stints never count.
 * - **70 working days** as soon as one stint has a shorter or irregular week, and also when such
 *   stints meet ≥ 5-day stints: then every stint counts with its working days. Prior employers'
 *   working days count as recorded; a prior employer's months, whose working days are not
 *   recorded, count as 70 / 3 working days each (the ratio of the two limits), rounded up.
 */
function countAllowance(input: {
	readonly ownLimitKind: ShortTermLimitKind;
	readonly days: readonly string[];
	readonly stints: readonly ShortTermStint[];
	readonly prior: PriorEmployerTotals;
	readonly dayLimit: number;
	readonly monthLimit: number;
}): AllowanceCount {
	const { prior, stints, dayLimit, monthLimit } = input;
	if (input.ownLimitKind === "work_days" || prior.days > 0) {
		return {
			limitKind: "work_days",
			limit: dayLimit,
			ownUsed: input.days.length,
			priorEmployerUsed: prior.days + Math.ceil((prior.months * dayLimit) / monthLimit),
		};
	}
	const [only] = stints;
	if (stints.length === 1 && only && prior.months === 0) {
		const start = parsePlainDate(only.firstDay);
		return {
			limitKind: "months",
			limit: start.until(start.add({ months: monthLimit })).days,
			ownUsed: calendarDays(only),
			priorEmployerUsed: 0,
		};
	}
	return {
		limitKind: "months",
		limit: monthLimit * SHORT_TERM_DAYS_PER_FULL_MONTH,
		ownUsed: stints.reduce((sum, stint) => sum + combinedCalendarDays(stint), 0),
		priorEmployerUsed: prior.months * SHORT_TERM_DAYS_PER_FULL_MONTH,
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
	const counted = [...employee.work, ...employee.planned].filter((item) => inYear(item.date));
	const days = [...new Set(counted.map((item) => item.date))].sort();
	const employmentPeriodOf = new Map(counted.map((item) => [item.date, item.employmentPeriodId]));
	const stints = shortTermStints(days, employmentPeriodOf);
	const ownLimitKind = ownLimitKindOf(week, employmentPeriodOf);
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
	const { limitKind, limit, ownUsed, priorEmployerUsed } = countAllowance({
		ownLimitKind,
		days,
		stints,
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
				},
			},
			inputFingerprint: statutoryInputFingerprint({
				kind,
				year,
				limit,
				days,
				stints: stints.map((stint) => [stint.firstDay, stint.lastDay]),
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
