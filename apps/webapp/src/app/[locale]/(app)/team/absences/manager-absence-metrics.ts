import {
	clipAbsenceDayRange,
	countAbsenceDays,
	type IsWorkingDay,
	mondayToFriday,
} from "@/lib/absences/absence-days";
import type { ProratedAllowance } from "@/lib/absences/prorated-allowance";
import type { AbsenceWithCategory, VacationBalance } from "@/lib/absences/types";

export interface ManagerAbsenceMetrics {
	vacationAllowance: number;
	usedVacationDays: number;
	pendingVacationDays: number;
	remainingVacationDays: number;
	/** Approved vacation beyond the allowance (overdrawn vacation, #1111); never deducted. */
	overdrawnVacationDays: number;
	sickDays: number;
	/** The vacation allowance and why it is prorated (#1111); absent without a policy. */
	proratedAllowance?: ProratedAllowance;
}

/**
 * An employee's row metrics in the manager view: the vacation figures of their balance
 * (`loadVacationBalances`, the same as on every other page) and their sick days in the year.
 */
export function calculateManagerAbsenceMetrics(input: {
	year: number;
	/** The employee's vacation balance for the year; undefined without a policy. */
	balance: VacationBalance | undefined;
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

		const clipped = clipAbsenceDayRange(absence, year);
		return clipped ? total + countAbsenceDays(clipped, isWorkingDay) : total;
	}, 0);

	const { balance } = input;
	if (!balance) {
		return {
			vacationAllowance: 0,
			usedVacationDays: 0,
			pendingVacationDays: 0,
			remainingVacationDays: 0,
			overdrawnVacationDays: 0,
			sickDays,
		};
	}

	return {
		vacationAllowance: balance.totalDays,
		usedVacationDays: balance.usedDays,
		pendingVacationDays: balance.pendingDays,
		remainingVacationDays: balance.remainingDays,
		overdrawnVacationDays: balance.overdrawnDays,
		sickDays,
		...(balance.allowance ? { proratedAllowance: balance.allowance } : {}),
	};
}
