import { calculateCarryoverExpiryDate, getYearRange } from "./date-utils";
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
	adjustmentDays: string; // decimal from DB
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
}: {
	organizationAllowance: VacationAllowanceData;
	employeeAllowance?: EmployeeAllowanceData | null;
	absences: AbsenceWithCategory[];
	currentDate: Date;
	year: number;
}): VacationBalance {
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
			carryoverExpiryDate = calculateCarryoverExpiryDate(
				year,
				organizationAllowance.carryoverExpiryMonths,
			);

			// Only add carryover if not expired
			if (currentDate <= carryoverExpiryDate) {
				carryoverDays = carryover;
				totalDays += carryover;
			}
		} else {
			// No expiry, add full carryover
			carryoverDays = carryover;
			totalDays += carryover;
		}
	}

	// 3. Add manual adjustments
	if (employeeAllowance?.adjustmentDays) {
		totalDays += parseFloat(employeeAllowance.adjustmentDays);
	}

	// 4. Calculate used days (approved absences that count against vacation)
	const { start, end } = getYearRange(year);
	const usedDays = absences
		.filter((absence) => {
			const isApproved = absence.status === "approved";
			const countsAgainstVacation = absence.category.countsAgainstVacation;
			const inYear = absence.startDate >= start && absence.startDate <= end;
			return isApproved && countsAgainstVacation && inYear;
		})
		.reduce((sum, absence) => {
			// For now, calculate days as simple date difference
			// In production, would use business days calculation
			const days =
				Math.ceil(
					(absence.endDate.getTime() - absence.startDate.getTime()) / (1000 * 60 * 60 * 24),
				) + 1;
			return sum + days;
		}, 0);

	// 5. Calculate pending days (pending requests that count against vacation)
	const pendingDays = absences
		.filter((absence) => {
			const isPending = absence.status === "pending";
			const countsAgainstVacation = absence.category.countsAgainstVacation;
			const inYear = absence.startDate >= start && absence.startDate <= end;
			return isPending && countsAgainstVacation && inYear;
		})
		.reduce((sum, absence) => {
			const days =
				Math.ceil(
					(absence.endDate.getTime() - absence.startDate.getTime()) / (1000 * 60 * 60 * 24),
				) + 1;
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
export function prorateAnnualDays(annualDays: number, startDate: Date, year: number): number {
	const yearStart = new Date(year, 0, 1);
	const yearEnd = new Date(year, 11, 31);

	// If started before or at the beginning of the year, no proration
	if (startDate <= yearStart) {
		return annualDays;
	}

	// If started after the year, no days
	if (startDate > yearEnd) {
		return 0;
	}

	// Calculate proportion of year remaining
	const totalDays = (yearEnd.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24);
	const remainingDays = (yearEnd.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
	const proportion = remainingDays / totalDays;

	return Math.floor(annualDays * proportion);
}
