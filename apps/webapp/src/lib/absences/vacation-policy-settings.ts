/**
 * Proration settings of a vacation policy (#1104 rules 4 and 6, #1109).
 *
 * Client-safe: the policy form and the server actions share these rules.
 */

/** The statutory minimum a policy gets unless an admin sets another one. */
const DEFAULT_STATUTORY_MINIMUM_DAYS = 20;

export type StatutoryMinimumDaysProblem = "not_a_number" | "negative" | "above_annual_days";

/** The default statutory minimum of a policy: min(20, its annual days). */
export function defaultStatutoryMinimumDays(defaultAnnualDays: string): string {
	return String(Math.min(DEFAULT_STATUTORY_MINIMUM_DAYS, Number(defaultAnnualDays)));
}

/** Why a statutory minimum is invalid for a policy's annual days, or null when it is valid. */
export function checkStatutoryMinimumDays(
	statutoryMinimumDays: string,
	defaultAnnualDays: string,
): StatutoryMinimumDaysProblem | null {
	if (statutoryMinimumDays.trim() === "") return "not_a_number";
	const minimum = Number(statutoryMinimumDays);
	if (!Number.isFinite(minimum)) return "not_a_number";
	if (minimum < 0) return "negative";
	if (minimum > Number(defaultAnnualDays)) return "above_annual_days";
	return null;
}

/**
 * Policies that accrue monthly or biweekly already accrue in part years, so the
 * "Prorate in start and exit year" switch does not apply to them (#1104 rule 1).
 */
export function prorationAppliesToAccrualType(accrualType: string): boolean {
	return accrualType === "annual";
}
