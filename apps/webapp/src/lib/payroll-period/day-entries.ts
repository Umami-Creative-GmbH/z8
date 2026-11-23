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

/**
 * Whether a view that leaves out days without entries keeps the day: it has entries, or
 * it changed since it was settled, which payroll must see even once its entries are gone.
 * A day settled with nothing on it is left out like any other empty day: settling an
 * empty day pays nothing.
 */
export function dayHasEntriesOrChange(
	day: Pick<PayrollPeriodDay, "hasEntries" | "creditedMinutes" | "absences" | "settlement">,
): boolean {
	return dayHasEntries(day) || day.settlement?.state === "changed_since_settled";
}
