/**
 * Expense wage types (#851): the code each payroll line kind is paid under, per
 * payroll file format. Only file formats carry expense lines; the API connectors
 * (Personio, Workday, SuccessFactors API) never do. Free of server imports so the
 * settings UI can share it.
 */

import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";
import {
	type PayrollExportFileFormatId,
	payrollExportFileFormatIds,
	payrollExportFormatKind,
} from "./format-registry";

/** The file formats of the format registry (#823). */
export const EXPENSE_PAYROLL_FORMATS: readonly ExpensePayrollFormat[] =
	payrollExportFileFormatIds();
export type ExpensePayrollFormat = PayrollExportFileFormatId;

export function isExpensePayrollFormat(value: unknown): value is ExpensePayrollFormat {
	return typeof value === "string" && payrollExportFormatKind(value) === "file";
}

/** One code per file format; `null` leaves the kind unmapped for that format. */
export type ExpenseWageTypeCodes = Record<ExpensePayrollFormat, string | null>;

export interface ExpenseWageTypeMapping {
	kind: PayrollLineKind;
	codes: ExpenseWageTypeCodes;
}

export const MAX_EXPENSE_WAGE_TYPE_CODE_LENGTH = 32;

export const EMPTY_EXPENSE_WAGE_TYPE_CODES = Object.fromEntries(
	EXPENSE_PAYROLL_FORMATS.map((format) => [format, null]),
) as ExpenseWageTypeCodes;

/**
 * A trimmed code, `null` for an empty one, or `undefined` when the value is not
 * a code: too long, or containing control characters that would corrupt a file.
 */
export function normalizeExpenseWageTypeCode(value: unknown): string | null | undefined {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") return undefined;
	const code = value.trim();
	if (code === "") return null;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
	if (code.length > MAX_EXPENSE_WAGE_TYPE_CODE_LENGTH || /[\u0000-\u001f\u007f]/.test(code)) {
		return undefined;
	}
	return code;
}
