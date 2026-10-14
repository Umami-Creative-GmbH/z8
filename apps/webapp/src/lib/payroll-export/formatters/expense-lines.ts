import {
	assertUniquePersonnelIdentifiers,
	CUSTOM_FIELD_IDENTIFIER,
	type PayrollIdentityRow,
	type PersonnelNumberType,
	requirePersonnelIdentifier,
} from "../personnel-identifier";
import type { ExpenseLineData } from "../types";

/**
 * Shared rules for writing a payroll run's expense money lines (#852): the
 * label that tells a euro amount apart from hours in the German payroll
 * formats, and the order every format writes them in.
 */

/** Bemerkung of an expense line in DATEV and Sage files. */
export const GERMAN_EXPENSE_LINE_NOTE = "Reisekostenerstattung in EUR";

/** The lines with the personnel number each format identifies them by, in file order. */
export function expenseLinesInFileOrder(
	lines: readonly ExpenseLineData[],
	personnelNumber: (line: ExpenseLineData) => string,
): Array<{ personnelNumber: string; line: ExpenseLineData }> {
	return lines
		.map((line) => ({ personnelNumber: personnelNumber(line), line }))
		.toSorted(
			(left, right) =>
				left.personnelNumber.localeCompare(right.personnelNumber) ||
				left.line.wageTypeCode.localeCompare(right.line.wageTypeCode),
		);
}

/**
 * The personnel number of the German formats' configs: the frozen custom field
 * value when one is configured (#821, never a fallback), else the employee
 * number when configured and set, else the employee id, as for hours and absences.
 */
export function germanPersonnelNumber(
	line: PayrollIdentityRow,
	config: { personnelNumberType: PersonnelNumberType },
): string {
	if (config.personnelNumberType === CUSTOM_FIELD_IDENTIFIER) {
		return requirePersonnelIdentifier(line);
	}
	if (config.personnelNumberType === "employeeNumber" && line.employeeNumber) {
		return line.employeeNumber;
	}
	return line.employeeId;
}

/**
 * The German formats group lines by personnel number (#1198): two employees
 * under one number would be merged into one line, so the file is refused.
 */
export function refuseSharedGermanPersonnelNumbers(
	rows: readonly PayrollIdentityRow[],
	config: { personnelNumberType: PersonnelNumberType },
): void {
	assertUniquePersonnelIdentifiers(rows, (row) => germanPersonnelNumber(row, config));
}

/** "123.40" as "123,40": the stored amount is never parsed into a float. */
export function commaDecimalAmount(amount: string): string {
	return amount.replace(".", ",");
}
