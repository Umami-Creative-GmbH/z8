import { Temporal } from "temporal-polyfill";
import type { VacationAccrualType } from "@/db/schema/vacation";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import {
	clipAbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "./absence-days";
import {
	allocateLeaveCharges,
	chargesByDay,
	type EarningYearLeave,
	establishedExpiry,
	type LeaveCharge,
	type LeaveExpiryClassification,
	leaveProtection,
} from "./earning-year-leave";
import type { ProratedAllowance } from "./prorated-allowance";
import type { AbsenceWithCategory, EarningYearBalance, VacationBalance } from "./types";
import { isAccrualPolicy } from "./vacation-policy-settings";

/** The fields of a vacation policy (`vacation_allowance`) a balance reads. */
export interface VacationAllowanceData {
	defaultAnnualDays: string; // decimal from DB
	accrualType: VacationAccrualType;
	allowCarryover: boolean;
	maxCarryoverDays: string | null; // decimal from DB
	carryoverExpiryMonths: number | null;
}

interface EmployeeAllowanceData {
	customAnnualDays: string | null; // decimal from DB
	customCarryoverDays: string | null; // decimal from DB
}

/**
 * The days a balance starts from before carryover and adjustments: on an annual policy the
 * vacation allowance (prorated in a start or exit year, `loadProratedVacationAllowances`), or
 * without one the custom or policy allowance; on an accrual policy 0, whose balance grows only
 * through its accrual adjustments (#1106).
 */
export function startingAllowanceDays(input: {
	policy: Pick<VacationAllowanceData, "defaultAnnualDays" | "accrualType">;
	allowance?: Pick<ProratedAllowance, "days"> | null;
	employeeAllowance?: Pick<EmployeeAllowanceData, "customAnnualDays"> | null;
}): number {
	if (isAccrualPolicy(input.policy)) return 0;
	if (input.allowance) return input.allowance.days;
	return input.employeeAllowance?.customAnnualDays
		? parseFloat(input.employeeAllowance.customAnnualDays)
		: parseFloat(input.policy.defaultAnnualDays);
}

/** Approved vacation taken beyond the balance's days, to the hundredth; 0 when none (#1111). */
export function overdrawnVacationDays(usedDays: number, totalDays: number): number {
	return Math.max(0, Math.round((usedDays - totalDays) * 100) / 100);
}

/** Carried earning-year leave as the balance reads it (#2080). */
export type CarriedEarningYearLeave = EarningYearLeave & {
	/** The expiry job already removed this leave's unused days (`expired_at` set). */
	debited: boolean;
	/** Carried again at a later year-end; the successor holds the unused days. */
	carriedForward?: boolean;
};

/** The vacation year's own leave: its earning policy and how much of it is statutory. */
export interface OwnYearLeaveTerms {
	earningPolicyId: string | null;
	classification?: LeaveExpiryClassification;
	/** Statutory minimum ÷ reference allowance of the year's policy, at most 1. */
	statutoryRatio: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The year's own earned days as earning-year leave, split only under separate terms. */
export function ownYearLeave(
	year: number,
	days: number,
	terms: OwnYearLeaveTerms,
): EarningYearLeave[] {
	const own = Math.max(0, round2(days));
	const base = {
		earningYear: year,
		earningPolicyId: terms.earningPolicyId,
		configuredExpiry: null,
	};
	if (
		terms.classification?.expiryRules === "german" &&
		terms.classification.extraDaysSeparateTerms
	) {
		const statutory = Math.min(own, round2(own * Math.min(1, Math.max(0, terms.statutoryRatio))));
		return [
			{
				...base,
				key: `own:${year}:statutory`,
				portion: "statutory",
				protection: leaveProtection("statutory", terms.classification),
				capacity: statutory,
			},
			{
				...base,
				key: `own:${year}:extra`,
				portion: "extra",
				protection: leaveProtection("extra", terms.classification),
				capacity: round2(own - statutory),
			},
		];
	}
	return [
		{
			...base,
			key: `own:${year}:all`,
			portion: "all",
			protection: leaveProtection("all", terms.classification),
			capacity: own,
		},
	];
}

/**
 * The vacation days of each day of the year, from approved (and unless `settledOnly`, pending)
 * vacation, with historical usage charged on 1 January.
 */
export function vacationCharges(input: {
	absences: readonly AbsenceWithCategory[];
	year: number;
	isWorkingDay: IsWorkingDay;
	previouslyTakenDays: number;
	settledOnly?: boolean;
}): LeaveCharge[] {
	const charged = input.absences.filter(
		(absence) =>
			absence.category.countsAgainstVacation &&
			(absence.status === "approved" || (!input.settledOnly && absence.status === "pending")),
	);
	const charges = chargesByDay(charged, input.year, (absence, date) => {
		const clipped = clipAbsenceDayRange(absence, { startDate: date, endDate: date });
		return clipped ? countAbsenceDays(clipped, input.isWorkingDay) : 0;
	});
	if (input.previouslyTakenDays > 0)
		charges.push({ date: `${input.year}-01-01`, days: input.previouslyTakenDays });
	return charges;
}

/** Carried leave's days in the balance at `now`, and its per-year view. */
function carriedLeaveBalances(
	carried: readonly CarriedEarningYearLeave[],
	used: ReadonlyMap<string, number>,
	now: Instant,
): { days: number; rows: EarningYearBalance[] } {
	let days = 0;
	const rows: EarningYearBalance[] = [];
	for (const item of carried) {
		const expiry = establishedExpiry(item);
		const expired = Boolean(expiry) && compareInstants(now, expiry as Instant) > 0;
		const usedDays = used.get(item.key) ?? 0;
		// Before the job runs, a passed deadline already drops the unused days; once it ran, the
		// remaining capacity is exactly what was used by the deadline.
		const counted = expired && !item.debited ? usedDays : item.capacity;
		days += counted;
		rows.push({
			earningYear: item.earningYear,
			earningPolicyId: item.earningPolicyId,
			portion: item.portion,
			protection: item.protection,
			days: round2(counted),
			usedDays,
			remainingDays: expired ? 0 : round2(Math.max(0, item.capacity - usedDays)),
			expiryDate: expiry ? dateFromInstant(expiry) : null,
			expired,
		});
	}
	return { days: round2(days), rows };
}

/**
 * Calculate vacation balance for an employee
 *
 * @param organizationAllowance - Organization-wide vacation allowance
 * @param employeeAllowance - Employee-specific allowance overrides
 * @param absences - Absence entries for the employee
 * @param currentDate - Current date for carryover expiry check
 * @returns Vacation balance
 */
export function calculateVacationBalance({
	organizationAllowance,
	frozenCarryover,
	employeeAllowance,
	allowance,
	absences,
	isWorkingDay = mondayToFriday,
	currentDate,
	year,
	adjustmentTotal = 0,
	previouslyTakenDays = 0,
	timezone = "UTC",
	earningYearLeave,
	legacyCarryoverProtected = false,
}: {
	organizationAllowance: VacationAllowanceData;
	/** Persisted terms of a newly committed transfer, including explicit no-expiry. */
	frozenCarryover?: {
		expiryDate: Date | null;
		expiredAt?: Date | null;
		timezone?: string;
	};
	employeeAllowance?: EmployeeAllowanceData | null;
	/**
	 * The employee's vacation allowance for the year, prorated in a year they join or leave
	 * (`loadProratedVacationAllowances`). Without it, the custom or the policy's full allowance.
	 */
	allowance?: ProratedAllowance;
	absences: AbsenceWithCategory[];
	/** The employee's working days; defaults to Monday to Friday. */
	isWorkingDay?: IsWorkingDay;
	currentDate: Date | Instant;
	year: number;
	previouslyTakenDays?: number;
	adjustmentTotal?: number; // Sum of all vacation adjustment events
	timezone?: string;
	/**
	 * Earning-year leave carried into the year by committed transfers (#2080). Replaces
	 * `frozenCarryover`: each earning year counts by its own protection and deadline.
	 */
	earningYearLeave?: {
		carried: readonly CarriedEarningYearLeave[];
		ownYear: OwnYearLeaveTerms;
	};
	/**
	 * Legacy carryover (no committed transfer) whose earning policy is not designated for the
	 * policy's own terms: it stays outstanding regardless of the policy's permission or deadline.
	 */
	legacyCarryoverProtected?: boolean;
}): VacationBalance {
	const currentInstant = currentDate instanceof Date ? instantFromDate(currentDate) : currentDate;

	// 1. Calculate total annual days: the (prorated) allowance, or 0 on an accrual policy
	const allowanceDays = startingAllowanceDays({
		policy: organizationAllowance,
		allowance,
		employeeAllowance,
	});
	let totalDays = allowanceDays;

	// 2. Add carryover days from previous year (if not expired)
	let carryoverDays = 0;
	let carryoverExpiryDate: Date | undefined;

	let earningYears: EarningYearBalance[] | undefined;
	if (earningYearLeave) {
		const leave = [
			...earningYearLeave.carried,
			...ownYearLeave(year, allowanceDays + adjustmentTotal, earningYearLeave.ownYear),
		];
		const { used } = allocateLeaveCharges(
			leave,
			vacationCharges({ absences, year, isWorkingDay, previouslyTakenDays }),
			timezone,
		);
		const carried = carriedLeaveBalances(earningYearLeave.carried, used, currentInstant);
		carryoverDays = carried.days;
		totalDays += carried.days;
		earningYears = carried.rows;
		const upcoming = carried.rows
			.filter((row) => row.expiryDate && !row.expired && row.remainingDays > 0)
			.map((row) => row.expiryDate as Date)
			.toSorted((a, b) => a.getTime() - b.getTime())[0];
		carryoverExpiryDate =
			upcoming ??
			carried.rows
				.filter((row) => row.expiryDate && row.expired)
				.map((row) => row.expiryDate as Date)
				.toSorted((a, b) => b.getTime() - a.getTime())[0];
	} else if (frozenCarryover) {
		carryoverExpiryDate = frozenCarryover.expiryDate ?? undefined;
		if (
			!frozenCarryover.expiredAt &&
			(!frozenCarryover.expiryDate ||
				compareInstants(currentInstant, instantFromDate(frozenCarryover.expiryDate)) <= 0)
		) {
			carryoverDays = Number(employeeAllowance?.customCarryoverDays ?? 0);
			totalDays += carryoverDays;
		}
	} else if (
		(organizationAllowance.allowCarryover || legacyCarryoverProtected) &&
		employeeAllowance?.customCarryoverDays
	) {
		const carryover = parseFloat(employeeAllowance.customCarryoverDays);

		if (organizationAllowance.carryoverExpiryMonths && !legacyCarryoverProtected) {
			const carryoverExpiryInstant = Temporal.PlainDate.from({
				year,
				month: 1,
				day: 1,
			})
				.add({ months: organizationAllowance.carryoverExpiryMonths })
				.toZonedDateTime(timezone)
				.toInstant()
				.subtract({ milliseconds: 1 });

			// Only add carryover if not expired
			if (compareInstants(currentInstant, carryoverExpiryInstant) <= 0) {
				carryoverDays = carryover;
				totalDays += carryover;
			}

			// Convert back to Date for VacationBalance interface
			carryoverExpiryDate = dateFromInstant(carryoverExpiryInstant);
		} else {
			// No expiry, add full carryover
			carryoverDays = carryover;
			totalDays += carryover;
		}
	}

	// 3. Add adjustments (sum of manual and accrual adjustment events)
	totalDays += adjustmentTotal;

	// 4. Absence days of approved (used) and pending vacation inside the calendar year
	const calendarYear = { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
	const vacationDaysInYear = (status: AbsenceWithCategory["status"]) =>
		absences.reduce((sum, absence) => {
			if (absence.status !== status || !absence.category.countsAgainstVacation) return sum;
			const clipped = clipAbsenceDayRange(absence, calendarYear);
			return clipped ? sum + countAbsenceDays(clipped, isWorkingDay) : sum;
		}, 0);
	const usedDays = vacationDaysInYear("approved") + previouslyTakenDays;

	// 5. Calculate pending days (pending requests that count against vacation)
	const pendingDays = vacationDaysInYear("pending");

	// 6. Calculate remaining days
	const remainingDays = Math.max(0, totalDays - usedDays - pendingDays);

	// 7. Overdrawn vacation: approved vacation beyond the balance, shown but never reclaimed (#1111)
	const overdrawnDays = overdrawnVacationDays(usedDays, totalDays);

	return {
		year,
		totalDays,
		allowanceDays,
		usedDays,
		...(previouslyTakenDays !== 0 ? { previouslyTakenDays } : {}),
		pendingDays,
		remainingDays,
		overdrawnDays,
		carryoverDays: carryoverDays > 0 ? carryoverDays : undefined,
		carryoverExpiryDate,
		...(carryoverExpiryDate
			? { carryoverExpiryTimezone: frozenCarryover?.timezone ?? timezone }
			: {}),
		...(allowance ? { allowance } : {}),
		...(earningYears?.length ? { earningYears } : {}),
	};
}

/**
 * Check if employee has sufficient vacation balance for a request
 *
 * @param balance - Current vacation balance
 * @param requestedDays - Number of days being requested
 * @returns True if sufficient balance
 */
export function hasSufficientBalance(balance: VacationBalance, requestedDays: number): boolean {
	return balance.remainingDays >= requestedDays;
}

/** Annual carryover excludes approved and explicitly recorded historical usage; pending requests do not settle usage. */
export function calculateCarryoverDays(input: {
	totalAllowance: number;
	usedDays: number;
	previouslyTakenDays: number;
	maxCarryoverDays: string | null;
}) {
	const remaining = Math.max(0, input.totalAllowance - input.usedDays - input.previouslyTakenDays);
	const cap = input.maxCarryoverDays === null ? remaining : Number(input.maxCarryoverDays);
	return {
		remaining,
		applied: Math.min(remaining, cap),
		capped: remaining > cap,
	};
}
