import {
	clipAbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "@/lib/absences/absence-days";
import type { ProratedAllowance } from "@/lib/absences/prorated-allowance";
import type {
	AbsenceWithCategory,
	VacationBalance,
	VacationBalanceConfiguration,
} from "@/lib/absences/types";

export interface ManagerAbsenceMetrics {
	vacationAllowance: number | null;
	usedVacationDays: number | null;
	previouslyTakenVacationDays?: number;
	pendingVacationDays: number | null;
	remainingVacationDays: number | null;
	/** Approved vacation beyond the allowance (overdrawn vacation, #1111); never deducted. */
	overdrawnVacationDays: number | null;
	sickDays: number;
	/** The vacation allowance and why it is prorated (#1111); absent without a policy. */
	proratedAllowance?: ProratedAllowance;
	vacationConfiguration?: VacationBalanceConfiguration | null;
}

/**
 * An employee's row metrics in the manager view: the vacation figures of their balance
 * (`loadVacationBalances`, the same as on every other page) and their sick days in the year.
 */
export function calculateManagerAbsenceMetrics(input: {
	year: number;
	/** The employee's vacation balance for the year; undefined without a policy. */
	balance: VacationBalance | undefined;
	configuration?: VacationBalanceConfiguration | null;
	absences: AbsenceWithCategory[];
	/** The employee's working days in the year; defaults to Monday to Friday. */
	isWorkingDay?: IsWorkingDay;
}): ManagerAbsenceMetrics {
	const isWorkingDay = input.isWorkingDay ?? mondayToFriday;
	const year = {
		startDate: `${input.year}-01-01`,
		endDate: `${input.year}-12-31`,
	};
	const sickDays = input.absences.reduce((total, absence) => {
		if (absence.status !== "approved" || absence.category.type !== "sick") {
			return total;
		}

		const clipped = clipAbsenceDayRange(absence, year);
		return clipped ? total + countAbsenceDays(clipped, isWorkingDay) : total;
	}, 0);

	const { balance } = input;
	if (!balance) {
		return {
			vacationAllowance: null,
			usedVacationDays: null,
			pendingVacationDays: null,
			remainingVacationDays: null,
			overdrawnVacationDays: null,
			sickDays,
			vacationConfiguration: input.configuration,
		};
	}

	return {
		vacationConfiguration: input.configuration,
		vacationAllowance: balance.totalDays,
		usedVacationDays: balance.usedDays,
		...(balance.previouslyTakenDays
			? { previouslyTakenVacationDays: balance.previouslyTakenDays }
			: {}),
		pendingVacationDays: balance.pendingDays,
		remainingVacationDays: balance.remainingDays,
		overdrawnVacationDays: balance.overdrawnDays,
		sickDays,
		...(balance.allowance ? { proratedAllowance: balance.allowance } : {}),
	};
}
