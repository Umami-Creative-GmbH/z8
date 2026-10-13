/**
 * The prorated allowance (#1104, #1110): the vacation allowance of a year the employee joins or
 * leaves. Terms are defined in `./CONTEXT.md`.
 *
 * Pure and client-safe. The result is plain data (numbers and ISO date strings), so it can cross
 * the server/client boundary as part of a vacation balance.
 */

import { Temporal } from "temporal-polyfill";
import {
	comparePlainDates,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/** One employment of an employee: from its first day to its last working day. */
export interface EmploymentStint {
	/** The first day of the employment; null when the start is not known. */
	startDate: PlainDate | null;
	/** The last working day of the employment; null while no departure is recorded. */
	lastWorkingDay: PlainDate | null;
}

/** The fields of a vacation policy (`vacation_allowance`) proration reads. */
export interface ProrationPolicy {
	defaultAnnualDays: string;
	accrualType: string;
	prorateInStartAndExitYear: boolean;
	statutoryMinimumDays: string;
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
	/** The policy's allowance for a full year, or the custom allowance. */
	fullAllowance: number;
	/** The vacation allowance of the year: the prorated allowance, or the full one. */
	allowance: number;
	reason: ProrationReason;
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
 * - An employee without any period yet has one open employment from `employee.startDate`.
 * - The last working day comes from the newest pending or effective departure of the period, even
 *   when that day is in the future. An "offboard now" departure has none, so it is the day of the
 *   cutoff's last instant in the departure's zone. A canceled or blocked departure ends nothing.
 * - A closed legacy period without a departure ended on its snapshot of `employee.endDate`.
 *
 * Employee dates are stored as UTC midnight of the calendar date, so they convert in UTC.
 */
export function employmentStintsFromRecords(input: {
	employeeStartDate: Date | null;
	periods: readonly EmploymentPeriodRecord[];
	departures: readonly DepartureRecord[];
	/** The organization's timezone. */
	timezone: string;
}): EmploymentStint[] {
	const employeeStart = input.employeeStartDate ? utcCalendarDate(input.employeeStartDate) : null;
	if (input.periods.length === 0) {
		return [{ startDate: employeeStart, lastWorkingDay: null }];
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

	const fullAllowance = Number.parseFloat(input.policy.defaultAnnualDays);
	if (input.year < FIRST_PRORATED_YEAR) return full(fullAllowance, "before_rollout");
	if (input.policy.accrualType !== "annual") return full(fullAllowance, "accrual_policy");
	if (!input.policy.prorateInStartAndExitYear) return full(fullAllowance, "proration_off");

	const yearStart = Temporal.PlainDate.from({ year: input.year, month: 1, day: 1 });
	const yearEnd = Temporal.PlainDate.from({ year: input.year, month: 12, day: 31 });
	const inYear = input.employments.filter(
		(employment) =>
			(employment.lastWorkingDay === null ||
				comparePlainDates(employment.lastWorkingDay, yearStart) >= 0) &&
			(employment.startDate === null || comparePlainDates(employment.startDate, yearEnd) <= 0),
	);
	if (inYear.some((employment) => employment.startDate === null)) {
		return full(fullAllowance, "no_known_start");
	}
	if (inYear.length === 0) {
		return { fullAllowance, allowance: 0, reason: { kind: "not_employed" } };
	}

	const statutoryMinimum = Number.parseFloat(input.policy.statutoryMinimumDays);
	const employments = (inYear as Array<EmploymentStint & { startDate: PlainDate }>)
		.toSorted((left, right) => comparePlainDates(left.startDate, right.startDate))
		.map((employment) =>
			prorateEmployment({
				employment,
				year: input.year,
				yearStart,
				yearEnd,
				fullAllowance,
				statutoryMinimum,
			}),
		);
	if (employments.every((employment) => employment === null)) {
		return full(fullAllowance, "full_year");
	}

	const prorated = employments.filter((employment) => employment !== null);
	const sum = roundDays(prorated.reduce((total, employment) => total + employment.days, 0));
	return {
		fullAllowance,
		allowance: Math.min(sum, fullAllowance),
		reason: { kind: "prorated", employments: prorated, cappedAtFullAllowance: sum > fullAllowance },
	};
}

function full(fullAllowance: number, cause: FullAllowanceCause): ProratedAllowance {
	return { fullAllowance, allowance: fullAllowance, reason: { kind: "none", cause } };
}

/** One employment's share of the year, or null when it covers the whole year. */
function prorateEmployment(input: {
	employment: EmploymentStint & { startDate: PlainDate };
	year: number;
	yearStart: PlainDate;
	yearEnd: PlainDate;
	fullAllowance: number;
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
