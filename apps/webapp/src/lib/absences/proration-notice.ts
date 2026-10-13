/**
 * The one-time proration notice (#1112): after proration ships, owners and admins see every
 * employee whose 2026 allowance is now prorated below the full allowance, with any overdrawn
 * vacation. Terms are defined in `./CONTEXT.md`.
 *
 * Pure and client-safe: a row is plain data.
 */

import { FIRST_PRORATED_YEAR } from "./prorated-allowance";
import type { VacationBalance } from "./types";

/** The year the notice lists: the first prorated year (#1104 rule 11). */
export const PRORATION_NOTICE_YEAR = FIRST_PRORATED_YEAR;

export interface ProrationNoticeRow {
	employeeId: string;
	name: string;
	/** The policy's allowance for a full year. */
	fullAllowance: number;
	/** The prorated allowance of the year. */
	proratedAllowance: number;
	/** Vacation taken or requested beyond the balance; 0 when the employee is not overdrawn. */
	overdrawnDays: number;
}

/**
 * The notice row of an employee, from their vacation balance of the notice year: null unless the
 * allowance is prorated below the full allowance. A custom allowance is final, so it is never
 * listed.
 */
export function prorationNoticeRow(input: {
	employeeId: string;
	name: string;
	balance: VacationBalance | null;
}): ProrationNoticeRow | null {
	const allowance = input.balance?.allowance;
	if (!input.balance || !allowance) return null;
	if (allowance.reason.kind !== "prorated" || allowance.allowance >= allowance.fullAllowance) {
		return null;
	}
	const { totalDays, usedDays, pendingDays } = input.balance;
	return {
		employeeId: input.employeeId,
		name: input.name,
		fullAllowance: allowance.fullAllowance,
		proratedAllowance: allowance.allowance,
		overdrawnDays: Math.max(0, Math.round((usedDays + pendingDays - totalDays) * 100) / 100),
	};
}
