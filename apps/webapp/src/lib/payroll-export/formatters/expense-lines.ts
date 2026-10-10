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

/** "123.40" as "123,40": the stored amount is never parsed into a float. */
export function commaDecimalAmount(amount: string): string {
	return amount.replace(".", ",");
}
