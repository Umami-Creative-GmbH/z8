import {
	calculateBusinessDaysWithHalfDays,
	getYearRange,
} from "@/lib/absences/date-utils";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { calculateVacationBalance } from "@/lib/absences/vacation-calculator";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { DateTime } from "luxon";

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
}): ManagerAbsenceMetrics {
	const { start, end } = getYearRange(input.year);
	const sickDays = input.absences
		.filter(
			(absence) => {
				const absenceStart = DateTime.fromISO(absence.startDate);

				return (
					absence.status === "approved" &&
					absence.category.type === "sick" &&
					absenceStart >= start &&
					absenceStart <= end
				);
			},
		)
		.reduce(
			(total, absence) =>
				total +
				calculateBusinessDaysWithHalfDays(
					absence.startDate,
					absence.startPeriod,
					absence.endDate,
					absence.endPeriod,
					[],
				),
			0,
		);

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
		absences: input.absences,
		currentDate: currentTimestamp(),
		year: input.year,
	});

	return {
		vacationAllowance: balance.totalDays,
		usedVacationDays: balance.usedDays,
		pendingVacationDays: balance.pendingDays,
		remainingVacationDays: balance.remainingDays,
		sickDays,
	};
}
