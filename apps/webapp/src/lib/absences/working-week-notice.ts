/**
 * The one-time working-week notice (Absences ADR 0003): after the working-week conversion ships,
 * owners and admins see every employee whose 2026 allowance it reduces, with any overdrawn
 * vacation, and every employee whose work schedule has no working days. Nothing is reclaimed.
 * Terms are defined in `./CONTEXT.md`.
 *
 * Pure and client-safe: a row is plain data.
 */

import { FIRST_WORKING_WEEK_YEAR, type ProratedAllowance } from "./prorated-allowance";
import type { VacationBalance, VacationBalanceConfiguration } from "./types";

/** The year the notice lists: the first year converted to the working week. */
export const WORKING_WEEK_NOTICE_YEAR = FIRST_WORKING_WEEK_YEAR;

export type WorkingWeekNoticeRow =
	| {
			employeeId: string;
			name: string;
			/** The policy's reference allowance for a five-day week. */
			referenceAllowance: number;
			/** The full allowance converted to the employee's working week. */
			convertedAllowance: number;
			/** Approved vacation beyond the balance (`VacationBalance.overdrawnDays`); 0 when none. */
			overdrawnDays: number;
			/** The allowance with its explanation. */
			allowance: ProratedAllowance;
			configuration?: undefined;
	  }
	| {
			employeeId: string;
			name: string;
			/** A work schedule without working days leaves the allowance unknown. */
			configuration: Extract<VacationBalanceConfiguration, { periods: unknown }>;
			referenceAllowance: null;
			convertedAllowance: null;
			overdrawnDays: null;
			allowance: null;
	  };

/**
 * The notice row of an employee, from their vacation balance of the notice year: null unless the
 * working-week conversion lowers the allowance below the reference allowance. A custom allowance
 * is final, so it is never listed.
 */
export function workingWeekNoticeRow(input: {
	employeeId: string;
	name: string;
	balance: VacationBalance | null;
}): WorkingWeekNoticeRow | null {
	const allowance = input.balance?.allowance;
	const workingWeek = allowance?.workingWeek;
	if (!input.balance || !allowance || !workingWeek) return null;
	if (allowance.fullAllowance >= workingWeek.referenceAllowance) return null;
	return {
		employeeId: input.employeeId,
		name: input.name,
		referenceAllowance: workingWeek.referenceAllowance,
		convertedAllowance: allowance.fullAllowance,
		overdrawnDays: input.balance.overdrawnDays,
		allowance,
	};
}
