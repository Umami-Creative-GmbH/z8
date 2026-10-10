import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";

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
