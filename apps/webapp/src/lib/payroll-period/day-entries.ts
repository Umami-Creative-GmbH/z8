import type { PayrollPeriodDay } from "./types";

/**
 * Whether the employee recorded anything on the day: credited work touching it or an
 * absence, pending included. A holiday alone is not an entry. Days without entries are
 * left out of settling and of the PDF day sheets, so neither shows empty days.
 */
export function dayHasEntries(
	day: Pick<PayrollPeriodDay, "hasEntries" | "creditedMinutes" | "absences">,
): boolean {
	return day.hasEntries ?? (day.creditedMinutes !== 0 || day.absences.length > 0);
}
