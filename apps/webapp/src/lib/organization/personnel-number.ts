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

/**
 * Every character `normalizePersonnelNumber` trims off the ends (JavaScript's
 * `String.prototype.trim` set). PostgreSQL's one-argument `btrim` strips only
 * spaces, so SQL that must agree with the rule (migration 0232, the unique
 * index, the uniqueness lookup) trims with this list.
 */
export const PERSONNEL_NUMBER_WHITESPACE =
	"\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/** `PERSONNEL_NUMBER_WHITESPACE` as a PostgreSQL string literal (`E'\u0009...'`). */
export const PERSONNEL_NUMBER_WHITESPACE_SQL = `E'${[...PERSONNEL_NUMBER_WHITESPACE]
	.map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
	.join("")}'`;

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
