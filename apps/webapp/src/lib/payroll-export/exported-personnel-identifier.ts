/**
 * The personnel identifier each export target writes for an employee's rows
 * (#1198), as one rule per format: the duplicate-identifier check compares what
 * the target actually writes, the fallback to the employee ID included.
 */

import { germanPersonnelNumber } from "./formatters/expense-lines";
import {
	CUSTOM_FIELD_IDENTIFIER,
	type PayrollIdentityRow,
	type PersonnelNumberType,
} from "./personnel-identifier";

/** What a target writes for a row, or null when the row has no identifier yet. */
export type ExportedPersonnelIdentifier = (row: PayrollIdentityRow) => string | null;

/** The formats that group their lines by the German personnel number. */
const GERMAN_PERSONNEL_NUMBER_FORMATS: ReadonlySet<string> = new Set([
	"datev_lohn",
	"lexware_lohn",
	"sage_lohn",
]);

/**
 * The identifier rule of a format's configuration, or null for a format the
 * duplicate check does not cover. A row without its custom field value yields
 * null: the missing-identifier check refuses it, not this one.
 */
export function exportedPersonnelIdentifier(
	formatId: string,
	config: unknown,
): ExportedPersonnelIdentifier | null {
	if (!GERMAN_PERSONNEL_NUMBER_FORMATS.has(formatId)) return null;
	const germanConfig = (typeof config === "object" && config !== null ? config : {}) as {
		personnelNumberType: PersonnelNumberType;
	};
	return (row) =>
		germanConfig.personnelNumberType === CUSTOM_FIELD_IDENTIFIER && !row.personnelIdentifier
			? null
			: germanPersonnelNumber(row, germanConfig);
}
