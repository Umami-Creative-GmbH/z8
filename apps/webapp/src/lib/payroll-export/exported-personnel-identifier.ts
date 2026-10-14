/**
 * The personnel identifier each export target writes or matches an employee by
 * (#1198, #1199), as one rule per format: the duplicate-identifier check
 * compares what the target actually sends, fallbacks included. API connectors
 * share their match rule with this module, so the check cannot drift from the
 * matching.
 */

import { personioMatchValue } from "./exporters/personio/employee-identifier";
import { DEFAULT_PERSONIO_CONFIG, type PersonioConfig } from "./exporters/personio/types";
import { successFactorsMatchValue } from "./exporters/successfactors/shared/employee-matcher";
import {
	DEFAULT_SUCCESSFACTORS_CONFIG,
	type SuccessFactorsConfig,
} from "./exporters/successfactors/types";
import { isWorkdayMatchStrategy, workdayMatchValue } from "./exporters/workday/match-value";
import { DEFAULT_WORKDAY_CONFIG } from "./exporters/workday/types";
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

/** SAP SuccessFactors matches by one rule through its API and in its CSV file. */
const SUCCESSFACTORS_FORMATS: ReadonlySet<string> = new Set([
	"successfactors_api",
	"successfactors_csv",
]);

function configRecord(config: unknown): Record<string, unknown> {
	return typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
}

/**
 * The identifier rule of a format's configuration, or null for a format the
 * duplicate check does not cover. A row without its custom field value yields
 * null: the missing-identifier check refuses it, not this one.
 */
export function exportedPersonnelIdentifier(
	formatId: string,
	config: unknown,
): ExportedPersonnelIdentifier | null {
	const record = configRecord(config);
	if (formatId === "personio") {
		const { employeeMatchStrategy } = { ...DEFAULT_PERSONIO_CONFIG, ...record } as PersonioConfig;
		return (row) => personioMatchValue(row, employeeMatchStrategy);
	}
	if (formatId === "workday_api") {
		const { employeeMatchStrategy } = { ...DEFAULT_WORKDAY_CONFIG, ...record };
		// An unknown strategy fails the connector's own configuration check instead.
		if (!isWorkdayMatchStrategy(employeeMatchStrategy)) return null;
		return (row) => workdayMatchValue(row, employeeMatchStrategy);
	}
	if (SUCCESSFACTORS_FORMATS.has(formatId)) {
		const { employeeMatchStrategy } = {
			...DEFAULT_SUCCESSFACTORS_CONFIG,
			...record,
		} as SuccessFactorsConfig;
		return (row) => successFactorsMatchValue(row, employeeMatchStrategy);
	}
	if (!GERMAN_PERSONNEL_NUMBER_FORMATS.has(formatId)) return null;
	const germanConfig = record as { personnelNumberType: PersonnelNumberType };
	return (row) =>
		germanConfig.personnelNumberType === CUSTOM_FIELD_IDENTIFIER && !row.personnelIdentifier
			? null
			: germanPersonnelNumber(row, germanConfig);
}
