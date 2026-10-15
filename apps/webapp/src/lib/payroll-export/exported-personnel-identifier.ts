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
import type { PayrollExportFormatId } from "./format-registry";
import { germanPersonnelNumber } from "./formatters/expense-lines";
import {
	CUSTOM_FIELD_IDENTIFIER,
	type PayrollIdentityRow,
	type PersonnelNumberType,
} from "./personnel-identifier";

/** What a target writes for a row, or null when the row has no identifier yet. */
export type ExportedPersonnelIdentifier = (row: PayrollIdentityRow) => string | null;

function configRecord(config: unknown): Record<string, unknown> {
	return typeof config === "object" && config !== null ? (config as Record<string, unknown>) : {};
}

/**
 * The identifier rule of a format's configuration, or null when the format
 * has none to check (an unknown Workday strategy). A row without its custom
 * field value yields null: the missing-identifier check refuses it, not this one.
 */
export function exportedPersonnelIdentifier(
	formatId: PayrollExportFormatId,
	config: unknown,
): ExportedPersonnelIdentifier | null {
	const record = configRecord(config);
	switch (formatId) {
		case "personio": {
			const { employeeMatchStrategy } = { ...DEFAULT_PERSONIO_CONFIG, ...record } as PersonioConfig;
			return (row) => personioMatchValue(row, employeeMatchStrategy);
		}
		case "workday_api": {
			const { employeeMatchStrategy } = { ...DEFAULT_WORKDAY_CONFIG, ...record };
			// An unknown strategy fails the connector's own configuration check instead.
			if (!isWorkdayMatchStrategy(employeeMatchStrategy)) return null;
			return (row) => workdayMatchValue(row, employeeMatchStrategy);
		}
		// SAP SuccessFactors matches by one rule through its API and in its CSV file.
		case "successfactors_api":
		case "successfactors_csv": {
			const { employeeMatchStrategy } = {
				...DEFAULT_SUCCESSFACTORS_CONFIG,
				...record,
			} as SuccessFactorsConfig;
			return (row) => successFactorsMatchValue(row, employeeMatchStrategy);
		}
		// The German formats group their lines by the personnel number.
		case "datev_lohn":
		case "lexware_lohn":
		case "sage_lohn": {
			const germanConfig = record as { personnelNumberType: PersonnelNumberType };
			return (row) =>
				germanConfig.personnelNumberType === CUSTOM_FIELD_IDENTIFIER && !row.personnelIdentifier
					? null
					: germanPersonnelNumber(row, germanConfig);
		}
		default: {
			const unhandled: never = formatId;
			return unhandled;
		}
	}
}
