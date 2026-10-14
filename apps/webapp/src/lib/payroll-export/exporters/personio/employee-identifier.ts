/**
 * The value Personio matches an employee by, under the configured strategy.
 * Shared by the exporter and the duplicate-identifier check (#1199), so the
 * check compares exactly what the exporter sends.
 */
import {
	CUSTOM_FIELD_IDENTIFIER,
	type PayrollIdentityRow,
	requirePersonnelIdentifier,
} from "../../personnel-identifier";
import type { PersonioConfig } from "./types";

type PersonioMatchRow = Partial<PayrollIdentityRow> & {
	employeeNumber: string | null;
	email?: string | null;
};

/**
 * The match value, or null when the row has none. A custom field strategy
 * matches the frozen field value against the Personio personnel number (#821);
 * any other strategy than email matches the employee number.
 */
export function personioMatchValue(
	record: PersonioMatchRow,
	strategy: PersonioConfig["employeeMatchStrategy"],
): string | null {
	if (strategy === CUSTOM_FIELD_IDENTIFIER) return record.personnelIdentifier || null;
	const identifier = strategy === "email" ? record.email : record.employeeNumber;
	return identifier || null;
}

/** The match value the exporter sends; a missing custom field value refuses the export. */
export function selectPersonioEmployeeIdentifier(
	record: PersonioMatchRow,
	strategy: PersonioConfig["employeeMatchStrategy"],
): string | null {
	if (strategy === CUSTOM_FIELD_IDENTIFIER) {
		return requirePersonnelIdentifier({
			employeeId: record.employeeId ?? "",
			employeeNumber: record.employeeNumber,
			personnelIdentifier: record.personnelIdentifier,
		});
	}
	return personioMatchValue(record, strategy);
}
