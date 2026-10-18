/**
 * The prorated allowance (#1104, #1110): the vacation allowance of a year the employee joins or
 * leaves. Terms are defined in `./CONTEXT.md`.
 *
 * Pure and client-safe. The result is plain data (numbers and ISO date strings), so it can cross
 * the server/client boundary as part of a vacation balance.
 */

import { Temporal } from "temporal-polyfill";
import type { VacationAccrualType } from "@/db/schema/vacation";
import {
	comparePlainDates,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { isAccrualPolicy } from "./vacation-policy-settings";

/** One employment of an employee: from its first day to its last working day. */
export interface EmploymentStint {
	/** The first day of the employment; null when the start is not known. */
	startDate: PlainDate | null;
	/** The last working day of the employment; null while no departure is recorded. */
	lastWorkingDay: PlainDate | null;
}

/** The fields of a vacation policy (`vacation_allowance`) proration reads. */
export interface ProrationPolicy {
	/** The reference allowance for a five-day working week. */
	defaultAnnualDays: string;
	accrualType: VacationAccrualType;
	prorateInStartAndExitYear: boolean;
	/** The statutory minimum for a five-day working week. */
	statutoryMinimumDays: string;
	/**
	 * The combined policy/working-week periods of the year (Absences ADR 0003). Without them, the
	 * policy's reference amounts apply to the whole year on a five-day week.
	 */
	allowanceRates?: readonly AllowanceRate[];
}

/** The first year whose allowances convert to the working week (Absences ADR 0003). */
export const FIRST_WORKING_WEEK_YEAR = 2026;

/** The working week policy amounts are stated for. */
export const REFERENCE_WORKING_DAYS_PER_WEEK = 5;

/**
 * One period of a year with the same vacation policy amounts and working days per week. The
 * vacation allowance converts the reference amounts by working days per week ÷ 5.
 */
export interface AllowanceRate {
	/** First day, `YYYY-MM-DD`. */
	startDate: string;
	/** Last day (inclusive), `YYYY-MM-DD`. */
	endDate: string;
	referenceAnnualDays: number;
	referenceStatutoryMinimumDays: number;
	/** At least 1: a schedule without working days is a configuration error, not a rate. */
	workingDaysPerWeek: number;
}

/** How the full allowance was converted from the reference allowance (Absences ADR 0003). */
export interface WorkingWeekConversion {
	/** The policy's reference allowance over the employed dates of the year. */
	referenceAllowance: number;
	/** The working days per week over the employed dates of the year, oldest first. */
	periods: Array<{ startDate: string; endDate: string; workingDaysPerWeek: number }>;
}

/** Why the full allowance applies. */
export type FullAllowanceCause =
	/** Employed for the whole year. */
	| "full_year"
	/** The employee has a custom allowance for the year, which is final. */
	| "custom_allowance"
	/** The policy's "Prorate in start and exit year" switch is off. */
	| "proration_off"
	/** The policy accrues monthly or biweekly, which already covers part years. */
	| "accrual_policy"
	/** Years before 2026 are never prorated (#1104 rule 11). */
	| "before_rollout"
	/** The employee has no known start date (#1104 rule 10). */
	| "no_known_start";

/** One employment's share of a prorated allowance. */
export interface ProratedEmployment {
	/** Started in the year, left in the year, or both. */
	kind: "start" | "exit" | "start_and_exit";
	/** The first day, `YYYY-MM-DD`, when the employment started in the year; otherwise null. */
	startDate: string | null;
	/** The last working day, `YYYY-MM-DD`, when the employment ends in the year; otherwise null. */
	lastWorkingDay: string | null;
	/** Full employment months in the year. */
	employmentMonths: number;
	/** The days this employment earns, after rounding and the floor. */
	days: number;
	/** The statutory minimum raised the days of this employment. */
	floorApplied: boolean;
}

export type ProrationReason =
	| { kind: "none"; cause: FullAllowanceCause }
	| {
			kind: "prorated";
			/** The employments in the year, oldest first. */
			employments: ProratedEmployment[];
			/** The employments together earned more than the full allowance (rehire). */
			cappedAtFullAllowance: boolean;
	  }
	/** Not employed on any day of the year. */
	| { kind: "not_employed" };

export interface ProratedAllowance {
	/**
	 * The policy's allowance for a full year, converted to the employee's working week over the
	 * dates they are employed in the year; or the custom allowance.
	 */
	fullAllowance: number;
	/** The days of the vacation allowance of the year: the prorated allowance, or the full one. */
	days: number;
	reason: ProrationReason;
	/** Present when the working week is not five days on some employed date of the year. */
	workingWeek?: WorkingWeekConversion;
}

/** An `employee_employment_period` row. */
export interface EmploymentPeriodRecord {
	id: string;
	startedAt: Date | null;
	endedAt: Date | null;
	startProvenance: "recorded" | "legacy" | "unknown";
}

/** An `employee_departure` row. */
export interface DepartureRecord {
	employmentPeriodId: string;
	status: string;
	lastWorkingDay: string | null;
	cutoffAt: Date;
	timezone: string;
	createdAt: Date;
}

/**
 * The employments of an employee from their stored records.
 *
 * - The first (legacy) employment starts on `employee.startDate`, which tracks admin edits; the
 *   legacy period's copy does not. A recorded rehire starts on its `startedAt` in `timezone`.
 *   An unknown-start period, or a legacy one without `employee.startDate`, has no known start.
 * - An employee without any period yet has one employment from `employee.startDate` to
 *   `employee.endDate`, open while no end date is set.
 * - The last working day comes from the newest pending or effective departure of the period, even
 *   when that day is in the future. An "offboard now" departure has none, so it is the day of the
 *   cutoff's last instant in the departure's zone. A canceled or blocked departure ends nothing.
 * - A closed legacy period without a departure ended on its snapshot of `employee.endDate`.
 *
 * Employee dates are stored as UTC midnight of the calendar date, so they convert in UTC.
 */
export function employmentStintsFromRecords(input: {
	employeeStartDate: Date | null;
	/** `employee.endDate`: the last working day while the employee has no employment period. */
	employeeEndDate?: Date | null;
	periods: readonly EmploymentPeriodRecord[];
	departures: readonly DepartureRecord[];
	/** The organization's timezone. */
	timezone: string;
}): EmploymentStint[] {
	const employeeStart = input.employeeStartDate ? utcCalendarDate(input.employeeStartDate) : null;
	if (input.periods.length === 0) {
		const employeeEnd = input.employeeEndDate ? utcCalendarDate(input.employeeEndDate) : null;
		return [{ startDate: employeeStart, lastWorkingDay: employeeEnd }];
	}

	return input.periods.map((period) => {
		const startDate =
			period.startProvenance === "recorded" && period.startedAt
				? plainDateAt(instantFromDate(period.startedAt), input.timezone)
				: period.startProvenance === "legacy"
					? employeeStart
					: null;
		return { startDate, lastWorkingDay: lastWorkingDayOf(period, input) };
	});
}

function lastWorkingDayOf(
	period: EmploymentPeriodRecord,
	input: { departures: readonly DepartureRecord[]; timezone: string },
): PlainDate | null {
	const departure = input.departures
		.filter(
			(candidate) =>
				candidate.employmentPeriodId === period.id &&
				(candidate.status === "pending" || candidate.status === "effective"),
		)
		.toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
	if (departure) {
		return departure.lastWorkingDay
			? parsePlainDate(departure.lastWorkingDay)
			: lastDayBefore(departure.cutoffAt, departure.timezone);
	}
	if (!period.endedAt) return null;
	return period.startProvenance === "recorded"
		? lastDayBefore(period.endedAt, input.timezone)
		: utcCalendarDate(period.endedAt);
}

/** The calendar day of the last instant before an exclusive end. */
function lastDayBefore(exclusiveEnd: Date, timezone: string): PlainDate {
	return plainDateAt(instantFromDate(exclusiveEnd).subtract({ milliseconds: 1 }), timezone);
}

function utcCalendarDate(date: Date): PlainDate {
	return plainDateAt(instantFromDate(date), "UTC");
}

/** The first year that is prorated (#1104 rule 11). */
export const FIRST_PRORATED_YEAR = 2026;

const MONTHS_PER_YEAR = 12;
const WAITING_PERIOD_MONTHS = 6;

/**
 * The vacation allowance of an employee for a year.
 *
 * A custom allowance is final. Otherwise the policy's allowance is prorated in a year the
 * employee joins or leaves: 1/12 per full employment month, a fraction of ½ day or more rounded up
 * (BUrlG §5(2)), and never below the statutory minimum once the waiting period is complete and
 * the employee does not leave by 30 June. Each employment is prorated on its own; together they
 * never exceed the full allowance.
 */
export function resolveVacationAllowance(input: {
	policy: ProrationPolicy;
	/** `employee_vacation_allowance.customAnnualDays` for the year; null or empty when unset. */
	customAnnualDays?: string | null;
	/** Every employment of the employee, in any order. */
	employments: readonly EmploymentStint[];
	year: number;
}): ProratedAllowance {
	if (input.customAnnualDays != null && input.customAnnualDays !== "") {
		const custom = Number.parseFloat(input.customAnnualDays);
		return full(custom, "custom_allowance");
	}

	if (input.year < FIRST_PRORATED_YEAR) {
		return full(Number.parseFloat(input.policy.defaultAnnualDays), "before_rollout");
	}

	const yearStart = Temporal.PlainDate.from({ year: input.year, month: 1, day: 1 });
	const yearEnd = Temporal.PlainDate.from({ year: input.year, month: 12, day: 31 });
	const inYear = input.employments.filter(
		(employment) =>
			(employment.lastWorkingDay === null ||
				comparePlainDates(employment.lastWorkingDay, yearStart) >= 0) &&
			(employment.startDate === null || comparePlainDates(employment.startDate, yearEnd) <= 0),
	);
	// The converted rates average over the dates employed in the year (Absences ADR 0003).
	const rates = allowanceRatesOf(input.policy, yearStart, yearEnd);
	const employedDates = inYear.map((employment) => employedRange(employment, yearStart, yearEnd));
	const yearRate = averageRate(rates, employedDates.length ? employedDates : [[yearStart, yearEnd]]);
	const fullAllowance = yearRate.annual;
	const withConversion = (allowance: ProratedAllowance): ProratedAllowance =>
		yearRate.workingWeek ? { ...allowance, workingWeek: yearRate.workingWeek } : allowance;

	if (isAccrualPolicy(input.policy)) return withConversion(full(fullAllowance, "accrual_policy"));
	if (!input.policy.prorateInStartAndExitYear) {
		return withConversion(full(fullAllowance, "proration_off"));
	}
	if (inYear.some((employment) => employment.startDate === null)) {
		return withConversion(full(fullAllowance, "no_known_start"));
	}
	if (inYear.length === 0) {
		return withConversion({ fullAllowance, days: 0, reason: { kind: "not_employed" } });
	}

	const employments = (inYear as Array<EmploymentStint & { startDate: PlainDate }>)
		.toSorted((left, right) => comparePlainDates(left.startDate, right.startDate))
		.map((employment) => {
			const stintRate = averageRate(rates, [employedRange(employment, yearStart, yearEnd)]);
			return prorateEmployment({
				employment,
				year: input.year,
				yearStart,
				yearEnd,
				fullAllowance: stintRate.annual,
				statutoryMinimum: stintRate.minimum,
			});
		});
	if (employments.every((employment) => employment === null)) {
		return withConversion(full(fullAllowance, "full_year"));
	}

	const prorated = employments.filter((employment) => employment !== null);
	const sum = roundDays(prorated.reduce((total, employment) => total + employment.days, 0));
	return withConversion({
		fullAllowance,
		days: Math.min(sum, fullAllowance),
		reason: { kind: "prorated", employments: prorated, cappedAtFullAllowance: sum > fullAllowance },
	});
}

function full(fullAllowance: number, cause: FullAllowanceCause): ProratedAllowance {
	return { fullAllowance, days: fullAllowance, reason: { kind: "none", cause } };
}

type DateRange = readonly [from: PlainDate, through: PlainDate];

/** The days of an employment in the year; an unknown start counts from 1 January. */
function employedRange(employment: EmploymentStint, yearStart: PlainDate, yearEnd: PlainDate) {
	const from =
		employment.startDate && comparePlainDates(employment.startDate, yearStart) > 0
			? employment.startDate
			: yearStart;
	const through =
		employment.lastWorkingDay && comparePlainDates(employment.lastWorkingDay, yearEnd) < 0
			? employment.lastWorkingDay
			: yearEnd;
	return [from, through] as const satisfies DateRange;
}

function allowanceRatesOf(
	policy: ProrationPolicy,
	yearStart: PlainDate,
	yearEnd: PlainDate,
): readonly AllowanceRate[] {
	return policy.allowanceRates?.length
		? policy.allowanceRates
		: [
				{
					startDate: yearStart.toString(),
					endDate: yearEnd.toString(),
					referenceAnnualDays: Number.parseFloat(policy.defaultAnnualDays),
					referenceStatutoryMinimumDays: Number.parseFloat(policy.statutoryMinimumDays),
					workingDaysPerWeek: REFERENCE_WORKING_DAYS_PER_WEEK,
				},
			];
}

/**
 * The share of a year the days `[from, until)` weigh: a full calendar month is 1/12, and each day
 * 1/12 of its month's actual length (#989, Absences ADR 0003).
 */
export function yearShare(from: PlainDate, until: PlainDate): number {
	let share = 0;
	for (let date = from; comparePlainDates(date, until) < 0; ) {
		const nextMonth = date.with({ day: 1 }).add({ months: 1 });
		const next = comparePlainDates(nextMonth, until) < 0 ? nextMonth : until;
		share += date.until(next).days / date.daysInMonth / MONTHS_PER_YEAR;
		date = next;
	}
	return share;
}

/**
 * The converted annual allowance and statutory minimum averaged over the given dates, each day
 * weighted by `yearShare` as in the weighted policy (#989), and the weights are
 * normalized over the dates, so days not employed never reduce the rate. Rounded once to two
 * decimals.
 */
function averageRate(
	rates: readonly AllowanceRate[],
	ranges: readonly DateRange[],
): { annual: number; minimum: number; workingWeek?: WorkingWeekConversion } {
	let weight = 0;
	let annual = 0;
	let minimum = 0;
	let reference = 0;
	const weeks: WorkingWeekConversion["periods"] = [];
	const sortedRanges = ranges.toSorted((left, right) => comparePlainDates(left[0], right[0]));
	for (const rate of rates) {
		const factor = rate.workingDaysPerWeek / REFERENCE_WORKING_DAYS_PER_WEEK;
		for (const [rangeFrom, rangeThrough] of sortedRanges) {
			const from = latestDate(parsePlainDate(rate.startDate), rangeFrom);
			const through = earliestDate(parsePlainDate(rate.endDate), rangeThrough);
			if (comparePlainDates(from, through) > 0) continue;
			const share = yearShare(from, through.add({ days: 1 }));
			weight += share;
			annual += rate.referenceAnnualDays * factor * share;
			minimum += rate.referenceStatutoryMinimumDays * factor * share;
			reference += rate.referenceAnnualDays * share;
			weeks.push({
				startDate: from.toString(),
				endDate: through.toString(),
				workingDaysPerWeek: rate.workingDaysPerWeek,
			});
		}
	}
	if (weight === 0) return { annual: 0, minimum: 0 };
	const converted = weeks.some(
		(week) => week.workingDaysPerWeek !== REFERENCE_WORKING_DAYS_PER_WEEK,
	);
	return {
		annual: roundDays(annual / weight),
		minimum: roundDays(minimum / weight),
		workingWeek: converted
			? { referenceAllowance: roundDays(reference / weight), periods: mergeWeeks(weeks) }
			: undefined,
	};
}

/** Oldest first, adjacent periods with the same working days per week joined. */
function mergeWeeks(weeks: WorkingWeekConversion["periods"]): WorkingWeekConversion["periods"] {
	const merged: WorkingWeekConversion["periods"] = [];
	for (const week of weeks.toSorted((left, right) =>
		left.startDate.localeCompare(right.startDate),
	)) {
		const last = merged.at(-1);
		if (
			last?.workingDaysPerWeek === week.workingDaysPerWeek &&
			parsePlainDate(last.endDate).add({ days: 1 }).toString() === week.startDate
		) {
			last.endDate = week.endDate;
		} else {
			merged.push({ ...week });
		}
	}
	return merged;
}

function latestDate(left: PlainDate, right: PlainDate): PlainDate {
	return comparePlainDates(left, right) >= 0 ? left : right;
}

function earliestDate(left: PlainDate, right: PlainDate): PlainDate {
	return comparePlainDates(left, right) <= 0 ? left : right;
}

/** One employment's share of the year, or null when it covers the whole year. */
function prorateEmployment(input: {
	employment: EmploymentStint & { startDate: PlainDate };
	year: number;
	yearStart: PlainDate;
	yearEnd: PlainDate;
	/** The employment's converted annual allowance. */
	fullAllowance: number;
	/** The employment's converted statutory minimum. */
	statutoryMinimum: number;
}): ProratedEmployment | null {
	const { employment, yearStart, yearEnd } = input;
	const startsInYear = comparePlainDates(employment.startDate, yearStart) > 0;
	const leavesInYear =
		employment.lastWorkingDay !== null && comparePlainDates(employment.lastWorkingDay, yearEnd) < 0;
	if (!startsInYear && !leavesInYear) return null;

	const countFrom = startsInYear ? employment.startDate : yearStart;
	const countTo = leavesInYear ? (employment.lastWorkingDay as PlainDate) : yearEnd;
	const employmentMonths = fullMonthsBetween(countFrom, countTo);
	const earned = roundHalfDayUp((input.fullAllowance * employmentMonths) / MONTHS_PER_YEAR);

	const waitingPeriodEnd = employmentMonthEnd(employment.startDate, WAITING_PERIOD_MONTHS);
	const firstHalfEnd = Temporal.PlainDate.from({ year: input.year, month: 6, day: 30 });
	const floorEligible =
		comparePlainDates(waitingPeriodEnd, countTo) <= 0 &&
		!(leavesInYear && comparePlainDates(countTo, firstHalfEnd) <= 0);
	const floor = Math.min(input.statutoryMinimum, input.fullAllowance);
	const floorApplied = floorEligible && floor > earned;

	return {
		kind: startsInYear && leavesInYear ? "start_and_exit" : startsInYear ? "start" : "exit",
		startDate: startsInYear ? employment.startDate.toString() : null,
		lastWorkingDay: leavesInYear ? countTo.toString() : null,
		employmentMonths,
		days: floorApplied ? floor : earned,
		floorApplied,
	};
}

/** Full employment months from `from` (their first day) that end on or before `to`. */
function fullMonthsBetween(from: PlainDate, to: PlainDate): number {
	let months = 0;
	while (comparePlainDates(employmentMonthEnd(from, months + 1), to) <= 0) months += 1;
	return months;
}

/**
 * The last day of the `count`th employment month starting on `start`: the day before the same
 * day of the month `count` months later, or that month's last day when it has no such day
 * (BGB §§187(2), 188(2)-(3)). 15 Oct → 14 Nov; 31 Jan → 28 Feb.
 */
function employmentMonthEnd(start: PlainDate, count: number): PlainDate {
	const sameDay = start.add({ months: count });
	return sameDay.day < start.day ? sameDay : sameDay.subtract({ days: 1 });
}

/** BUrlG §5(2): a fraction of ½ day or more becomes a whole day; smaller fractions stay. */
function roundHalfDayUp(days: number): number {
	const whole = Math.floor(days);
	return days - whole >= 0.5 - 1e-9 ? whole + 1 : roundDays(days);
}

function roundDays(days: number): number {
	return Math.round(days * 100) / 100;
}
