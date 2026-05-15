import { DateTime } from "luxon";
import { fromJSDate } from "@/lib/datetime/luxon-utils";
import {
	calculateBusinessDaysWithHalfDays,
	calculateCarryoverExpiryDate,
	getYearRange,
} from "./date-utils";
import type { AbsenceWithCategory, VacationBalance } from "./types";

interface VacationAllowanceData {
	defaultAnnualDays: string; // decimal from DB
	allowCarryover: boolean;
	maxCarryoverDays: string | null; // decimal from DB
	carryoverExpiryMonths: number | null;
}

interface EmployeeAllowanceData {
	customAnnualDays: string | null; // decimal from DB
	customCarryoverDays: string | null; // decimal from DB
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
	absences,
	currentDate,
	year,
	adjustmentTotal = 0,
	timezone = "UTC",
}: {
	organizationAllowance: VacationAllowanceData;
	employeeAllowance?: EmployeeAllowanceData | null;
	absences: AbsenceWithCategory[];
	currentDate: Date | DateTime;
	year: number;
	adjustmentTotal?: number; // Sum of all vacation adjustment events
	timezone?: string;
}): VacationBalance {
	// Convert currentDate to DateTime if needed
	const current = currentDate instanceof Date ? fromJSDate(currentDate, "utc") : currentDate;

	// 1. Calculate total annual days
	let totalDays = employeeAllowance?.customAnnualDays
		? parseFloat(employeeAllowance.customAnnualDays)
		: parseFloat(organizationAllowance.defaultAnnualDays);

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

	// 3. Add manual adjustments (sum of adjustment events)
	totalDays += adjustmentTotal;

	// 4. Calculate used days (approved absences that count against vacation)
	const { start, end } = getYearRange(year);
	const usedDays = absences
		.filter((absence) => {
			const isApproved = absence.status === "approved";
			const countsAgainstVacation = absence.category.countsAgainstVacation;
			const inYear = absenceOverlapsRange(absence, start, end);

			return isApproved && countsAgainstVacation && inYear;
		})
		.reduce((sum, absence) => {
			const clippedAbsence = clipAbsenceToRange(absence, start, end);
			if (!clippedAbsence) return sum;

			// Use half-day aware calculation
			const days = calculateBusinessDaysWithHalfDays(
				clippedAbsence.startDate,
				clippedAbsence.startPeriod,
				clippedAbsence.endDate,
				clippedAbsence.endPeriod,
				[], // holidays not applied at this level - they're handled upstream
			);
			return sum + days;
		}, 0);

	// 5. Calculate pending days (pending requests that count against vacation)
	const pendingDays = absences
		.filter((absence) => {
			const isPending = absence.status === "pending";
			const countsAgainstVacation = absence.category.countsAgainstVacation;
			const inYear = absenceOverlapsRange(absence, start, end);

			return isPending && countsAgainstVacation && inYear;
		})
		.reduce((sum, absence) => {
			const clippedAbsence = clipAbsenceToRange(absence, start, end);
			if (!clippedAbsence) return sum;

			// Use half-day aware calculation
			const days = calculateBusinessDaysWithHalfDays(
				clippedAbsence.startDate,
				clippedAbsence.startPeriod,
				clippedAbsence.endDate,
				clippedAbsence.endPeriod,
				[], // holidays not applied at this level - they're handled upstream
			);
			return sum + days;
		}, 0);

	// 6. Calculate remaining days
	const remainingDays = Math.max(0, totalDays - usedDays - pendingDays);

	return {
		year,
		totalDays,
		usedDays,
		pendingDays,
		remainingDays,
		carryoverDays: carryoverDays > 0 ? carryoverDays : undefined,
		carryoverExpiryDate,
	};
}

function absenceOverlapsRange(
	absence: AbsenceWithCategory,
	rangeStart: DateTime,
	rangeEnd: DateTime,
) {
	const absenceStart = DateTime.fromISO(absence.startDate, { zone: "utc" }).startOf("day");
	const absenceEnd = DateTime.fromISO(absence.endDate, { zone: "utc" }).endOf("day");

	return absenceStart <= rangeEnd && absenceEnd >= rangeStart;
}

function clipAbsenceToRange(
	absence: AbsenceWithCategory,
	rangeStart: DateTime,
	rangeEnd: DateTime,
): Pick<AbsenceWithCategory, "startDate" | "startPeriod" | "endDate" | "endPeriod"> | null {
	const absenceStart = DateTime.fromISO(absence.startDate, { zone: "utc" }).startOf("day");
	const absenceEnd = DateTime.fromISO(absence.endDate, { zone: "utc" }).endOf("day");
	const clippedStart = absenceStart < rangeStart ? rangeStart : absenceStart;
	const clippedEnd = absenceEnd > rangeEnd ? rangeEnd : absenceEnd;

	if (clippedStart > clippedEnd) return null;

	return {
		startDate: clippedStart.toISODate() ?? absence.startDate,
		startPeriod: clippedStart.hasSame(absenceStart, "day") ? absence.startPeriod : "full_day",
		endDate: clippedEnd.toISODate() ?? absence.endDate,
		endPeriod: clippedEnd.hasSame(absenceEnd, "day") ? absence.endPeriod : "full_day",
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

/**
 * Prorate annual vacation days for mid-year employee start
 *
 * @param annualDays - Full year annual days
 * @param startDate - Employee start date
 * @param year - Current year
 * @returns Prorated days
 */
export function prorateAnnualDays(
	annualDays: number,
	startDate: Date | DateTime,
	year: number,
): number {
	// Convert to DateTime if needed
	const start = startDate instanceof Date ? fromJSDate(startDate, "utc") : startDate;

	const yearStart = DateTime.utc(year, 1, 1);
	const yearEnd = DateTime.utc(year, 12, 31);

	// If started before or at the beginning of the year, no proration
	if (start <= yearStart) {
		return annualDays;
	}

	// If started after the year, no days
	if (start > yearEnd) {
		return 0;
	}

	// Calculate proportion of year remaining
	const totalDays = yearEnd.diff(yearStart, "days").days;
	const remainingDays = yearEnd.diff(start, "days").days;
	const proportion = remainingDays / totalDays;

	return Math.floor(annualDays * proportion);
}
