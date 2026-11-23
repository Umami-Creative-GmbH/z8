/**
 * Pure judgement of one employee's short-term calendar year (#1990). Inputs come from
 * `loadShortTermInputs`; nothing here reads the database.
 */
import { parsePlainDate } from "@/lib/datetime/temporal-core";
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
import type { ShortTermEmployeeInputs, ShortTermLimitKind } from "./load-inputs";

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
 * Months used by a continuous ≥ 5-day pattern: the time months (*Zeitmonate*) from the first to
 * the last counted day, a started month counting in full. 15 June to 14 September is 3 months.
 */
export function spannedMonths(firstDay: string, lastDay: string): number {
	const span = parsePlainDate(firstDay).until(parsePlainDate(lastDay).add({ days: 1 }), {
		largestUnit: "months",
	});
	return span.years * 12 + span.months + (span.days > 0 ? 1 : 0);
}

/**
 * Prior-employer offsets recorded in the other unit convert by the ratio of the two limits
 * (70 days ≙ 3 months), rounded up so the allowance is never overstated.
 */
function priorEmployerUsed(
	employee: ShortTermEmployeeInputs,
	year: number,
	limitKind: ShortTermLimitKind,
	limits: { days: number; months: number },
): { used: number; days: number; months: number } {
	let days = 0;
	let months = 0;
	for (const offset of employee.priorOffsets) {
		if (offset.year !== year) continue;
		if (offset.kind === "prior_short_term_work_days") days += offset.count;
		else months += offset.count;
	}
	const used =
		limitKind === "work_days"
			? days + Math.ceil((months * limits.days) / limits.months)
			: months + Math.ceil((days * limits.months) / limits.days);
	return { used, days, months };
}

export function judgeShortTermYear(input: {
	readonly organizationId: string;
	readonly employee: ShortTermEmployeeInputs;
	readonly year: number;
	readonly thresholds: StatutoryThresholdTable;
	readonly preferences: StatutoryPreferences;
}): ShortTermYearEvaluation | null {
	const { employee, year, thresholds, preferences } = input;
	if (!employee.shortTermYears.has(year)) return null;
	const inYear = (date: string) => date.startsWith(`${year}-`);
	const days = [
		...new Set([...employee.work, ...employee.planned].map((item) => item.date).filter(inYear)),
	].sort();
	const firstDay = days[0] ?? null;
	const lastDay = days.at(-1) ?? null;
	const limitKind = employee.limitKindByYear.get(year) ?? "work_days";

	// The baseline in force on the last counted day (or the year's start) governs the year.
	const governingDay = lastDay ?? `${year}-01-01`;
	const dayLimit = thresholds.valueOn("de_short_term_max_work_days_per_year", governingDay);
	const monthLimit = thresholds.valueOn("de_short_term_max_months_per_year", governingDay);
	if (dayLimit === null || monthLimit === null) {
		return { employeeId: employee.employeeId, year, allowance: null, findings: [] };
	}
	const limit = limitKind === "work_days" ? dayLimit : monthLimit;
	const ownUsed =
		limitKind === "work_days"
			? days.length
			: firstDay && lastDay
				? spannedMonths(firstDay, lastDay)
				: 0;
	const prior = priorEmployerUsed(employee, year, limitKind, {
		days: dayLimit,
		months: monthLimit,
	});
	const used = ownUsed + prior.used;
	const { tier, usedPercent } = classifyStatutoryUsage({ used, limit }, preferences);
	const allowance: ShortTermAllowance = {
		employeeId: employee.employeeId,
		year,
		limitKind,
		used,
		ownUsed,
		priorEmployerUsed: prior.used,
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
		const unit = limitKind === "work_days" ? "days" : "months";
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
					firstDay,
					lastDay,
				},
			},
			inputFingerprint: statutoryInputFingerprint({
				kind,
				year,
				limit,
				days,
				priorDays: prior.days,
				priorMonths: prior.months,
			}),
			acknowledgementKind: null,
		});
	}
	findings.push(...berufsmaessigkeitFindings(input));
	return { employeeId: employee.employeeId, year, allowance, findings };
}

/** Earnings of `minutes` at an hourly wage in minor units, rounded to the cent. */
function earningsCents(minutes: number, hourlyRateCents: number): number {
	return Math.round((minutes * hourlyRateCents) / 60);
}

/**
 * One prompt per month of `year` whose short-term earnings (completed work, plus planned shifts on
 * days without completed work) exceed that month's Minijob cap. Earning more than a Minijob is not
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
	const workedDays = new Set(employee.work.map((item) => item.date));
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
		// Completed work replaces the plan for its day.
		const planned = employee.planned
			.filter((item) => item.date.startsWith(month) && !workedDays.has(item.date))
			.sort(
				(a, b) =>
					a.date.localeCompare(b.date) ||
					a.startTime.localeCompare(b.startTime) ||
					(a.shiftId ?? "").localeCompare(b.shiftId ?? ""),
			);
		let earned = 0;
		let plannedCents = 0;
		let unpricedMinutes = 0;
		for (const item of work) {
			if (item.hourlyRateCents === null) unpricedMinutes += item.minutes;
			else earned += earningsCents(item.minutes, item.hourlyRateCents);
		}
		for (const item of planned) {
			if (item.hourlyRateCents === null) unpricedMinutes += item.minutes;
			else plannedCents += earningsCents(item.minutes, item.hourlyRateCents);
		}
		const total = earned + plannedCents;
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
			inputFingerprint: statutoryInputFingerprint({
				kind,
				month,
				cap,
				work: work.map((item) => [
					item.workPeriodId,
					item.date,
					item.minutes,
					item.hourlyRateCents,
					item.currency,
				]),
				planned: planned.map((item) => [
					item.shiftId ?? "proposed",
					item.date,
					item.startTime,
					item.endTime,
					item.hourlyRateCents,
					item.currency,
				]),
			}),
			acknowledgementKind: "short_term_berufsmaessigkeit_verified",
		});
	}
	return findings;
}
