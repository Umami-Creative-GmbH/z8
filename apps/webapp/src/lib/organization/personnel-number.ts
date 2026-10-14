/**
 * The one rule for a **Personnel number** (`employee.employeeNumber`, #881):
 * what is stored, and when two of them are the same number. Every place that
 * reads or writes one uses these, so validation, uniqueness checks and
 * matching (payslip batch, opening-balance upload) agree.
 *
 * - Stored value: the trimmed number with its original case; an empty or
 *   whitespace-only value is no number (`null`).
 * - Comparison key: the lowercase of the trimmed number. Leading zeros count
 *   (`0042` and `42` are different numbers).
 *
 * Pure and dependency-free, so client forms and server code share it.
 */

/** The value to store: trimmed with its case kept, or `null` for no number. */
export function normalizePersonnelNumber(value: string | null | undefined): string | null {
	const trimmed = value?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

/**
 * The key two personnel numbers are compared by, or `null` for no number.
 * Numbers with the same key are the same personnel number.
 */
export function personnelNumberKey(value: string | null | undefined): string | null {
	const normalized = normalizePersonnelNumber(value);
	return normalized === null ? null : normalized.toLocaleLowerCase("en");
}
