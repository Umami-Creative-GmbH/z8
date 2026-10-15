import { DateTime } from "luxon";
import type { VacationAccrualType } from "@/db/schema/vacation";
import { fromJSDate } from "@/lib/datetime/luxon-utils";
import {
	clipAbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "./absence-days";
import { calculateCarryoverExpiryDate } from "./date-utils";
import type { ProratedAllowance } from "./prorated-allowance";
import type { AbsenceWithCategory, VacationBalance } from "./types";
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
	employeeAllowance,
	allowance,
	absences,
	isWorkingDay = mondayToFriday,
	currentDate,
	year,
	adjustmentTotal = 0,
	previouslyTakenDays = 0,
	timezone = "UTC",
}: {
	organizationAllowance: VacationAllowanceData;
	employeeAllowance?: EmployeeAllowanceData | null;
	/**
	 * The employee's vacation allowance for the year, prorated in a year they join or leave
	 * (`loadProratedVacationAllowances`). Without it, the custom or the policy's full allowance.
	 */
	allowance?: ProratedAllowance;
	absences: AbsenceWithCategory[];
	/** The employee's working days; defaults to Monday to Friday. */
	isWorkingDay?: IsWorkingDay;
	currentDate: Date | DateTime;
	year: number;
	previouslyTakenDays?: number;
	adjustmentTotal?: number; // Sum of all vacation adjustment events
	timezone?: string;
}): VacationBalance {
	// Convert currentDate to DateTime if needed
	const current = currentDate instanceof Date ? fromJSDate(currentDate, "utc") : currentDate;

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

	if (organizationAllowance.allowCarryover && employeeAllowance?.customCarryoverDays) {
		const carryover = parseFloat(employeeAllowance.customCarryoverDays);

		if (organizationAllowance.carryoverExpiryMonths) {
			const carryoverExpiryDT = calculateCarryoverExpiryDate(
				year,
				organizationAllowance.carryoverExpiryMonths,
				timezone,
			);

			// Only add carryover if not expired
			if (current <= carryoverExpiryDT) {
				carryoverDays = carryover;
				totalDays += carryover;
			}

			// Convert back to Date for VacationBalance interface (will update later)
			carryoverExpiryDate = carryoverExpiryDT.toJSDate();
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
		...(allowance ? { allowance } : {}),
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
