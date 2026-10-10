import { DateTime } from "luxon";
import { countAbsenceDays, type IsWorkingDay, mondayToFriday } from "@/lib/absences/absence-days";
import { getYearRange } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory, DayPeriod } from "@/lib/absences/types";
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
	const { start, end } = getYearRange(input.year);
	const sickDays = input.absences.reduce((total, absence) => {
		if (absence.status !== "approved" || absence.category.type !== "sick") {
			return total;
		}

		return total + calculateSelectedYearAbsenceDays(absence, start, end, isWorkingDay);
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

		return total + calculateSelectedYearAbsenceDays(absence, start, end, isWorkingDay);
	}, 0);
	const pendingVacationDays = input.absences.reduce((total, absence) => {
		if (absence.status !== "pending" || !absence.category.countsAgainstVacation) {
			return total;
		}

		return total + calculateSelectedYearAbsenceDays(absence, start, end, isWorkingDay);
	}, 0);

	return {
		vacationAllowance: balance.totalDays,
		usedVacationDays,
		pendingVacationDays,
		remainingVacationDays: Math.max(0, balance.totalDays - usedVacationDays - pendingVacationDays),
		sickDays,
	};
}

function calculateSelectedYearAbsenceDays(
	absence: AbsenceWithCategory,
	yearStart: DateTime,
	yearEnd: DateTime,
	isWorkingDay: IsWorkingDay,
): number {
	const absenceStart = DateTime.fromISO(absence.startDate, {
		zone: "utc",
	}).startOf("day");
	const absenceEnd = DateTime.fromISO(absence.endDate, { zone: "utc" }).endOf("day");

	if (absenceEnd < yearStart || absenceStart > yearEnd) {
		return 0;
	}

	const clippedStart = absenceStart < yearStart ? yearStart : absenceStart;
	const clippedEnd = absenceEnd > yearEnd ? yearEnd : absenceEnd;
	const startDate = clippedStart.toISODate();
	const endDate = clippedEnd.toISODate();

	if (!startDate || !endDate) {
		return 0;
	}

	const startPeriod: DayPeriod = absenceStart < yearStart ? "am" : absence.startPeriod;
	const endPeriod: DayPeriod = absenceEnd > yearEnd ? "pm" : absence.endPeriod;

	return countAbsenceDays({ startDate, startPeriod, endDate, endPeriod }, isWorkingDay);
}
