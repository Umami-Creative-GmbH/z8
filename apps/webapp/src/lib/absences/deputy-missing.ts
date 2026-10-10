import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";

/**
 * The absent employee's timezone, the one zone every deputy rule judges days
 * in (spec #802): their own setting, then the organization's, then UTC.
 */
export function absentEmployeeTimezone(zones: {
	userTimezone: string | null | undefined;
	organizationTimezone: string | null | undefined;
}): string {
	return resolvePersonalTimezone({
		userTimezone: zones.userTimezone ?? undefined,
		organizationTimezone: zones.organizationTimezone ?? undefined,
	}).timezone;
}

/**
 * Whether an absence has not ended at an instant: its last day is on or after
 * the absent employee's plain date there (#1014). Dates are `YYYY-MM-DD`, so
 * they compare as strings.
 */
export function absenceNotEndedAt(endDate: string, at: Instant, timezone: string): boolean {
	return endDate >= plainDateAt(at, timezone).toString();
}

/**
 * "Deputy missing" (#1014): the absence's category requires a deputy, the
 * absence names none and it is pending or approved and not ended on the absent
 * employee's `today`. Ended absences keep whatever deputy they had.
 */
export function isDeputyMissing(
	absence: {
		deputyRequired: boolean;
		deputyEmployeeId: string | null;
		status: string;
		endDate: string;
	},
	today: string,
): boolean {
	return (
		absence.deputyRequired &&
		absence.deputyEmployeeId === null &&
		(absence.status === "pending" || absence.status === "approved") &&
		absence.endDate >= today
	);
}
