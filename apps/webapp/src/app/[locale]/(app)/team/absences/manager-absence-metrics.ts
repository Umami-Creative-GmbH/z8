import {
	clipAbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "@/lib/absences/absence-days";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

interface VacationAllowanceData {
	defaultAnnualDays: string;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
	carryoverExpiryMonths: number | null;
}

interface EmployeeAllowanceData {
	customAnnualDays: string | null;
	customCarryoverDays: string | null;
}

export interface ManagerAbsenceMetrics {
	vacationAllowance: number;
	usedVacationDays: number;
	pendingVacationDays: number;
	remainingVacationDays: number;
	sickDays: number;
}

export function calculateManagerAbsenceMetrics(input: {
	year: number;
	allowance: VacationAllowanceData | null;
	employeeAllowance: EmployeeAllowanceData | null;
	absences: AbsenceWithCategory[];
	/** The employee's working days in the year; defaults to Monday to Friday. */
	isWorkingDay?: IsWorkingDay;
}): ManagerAbsenceMetrics {
	const isWorkingDay = input.isWorkingDay ?? mondayToFriday;
	const year = { startDate: `${input.year}-01-01`, endDate: `${input.year}-12-31` };
	const sickDays = input.absences.reduce((total, absence) => {
		if (absence.status !== "approved" || absence.category.type !== "sick") {
			return total;
		}

		return total + selectedYearAbsenceDays(absence, year, isWorkingDay);
	}, 0);

	if (!input.allowance) {
		return {
			vacationAllowance: 0,
			usedVacationDays: 0,
			pendingVacationDays: 0,
			remainingVacationDays: 0,
			sickDays,
		};
	}

	const balance = calculateVacationBalance({
		organizationAllowance: input.allowance,
		employeeAllowance: input.employeeAllowance,
		absences: [],
		currentDate: currentTimestamp(),
		year: input.year,
	});
	const usedVacationDays = input.absences.reduce((total, absence) => {
		if (absence.status !== "approved" || !absence.category.countsAgainstVacation) {
			return total;
		}

		return total + selectedYearAbsenceDays(absence, year, isWorkingDay);
	}, 0);
	const pendingVacationDays = input.absences.reduce((total, absence) => {
		if (absence.status !== "pending" || !absence.category.countsAgainstVacation) {
			return total;
		}

		return total + selectedYearAbsenceDays(absence, year, isWorkingDay);
	}, 0);

	return {
		vacationAllowance: balance.totalDays,
		usedVacationDays,
		pendingVacationDays,
		remainingVacationDays: Math.max(0, balance.totalDays - usedVacationDays - pendingVacationDays),
		sickDays,
	};
}

function selectedYearAbsenceDays(
	absence: AbsenceWithCategory,
	year: { startDate: string; endDate: string },
	isWorkingDay: IsWorkingDay,
): number {
	const clipped = clipAbsenceDayRange(absence, year);
	return clipped ? countAbsenceDays(clipped, isWorkingDay) : 0;
}
