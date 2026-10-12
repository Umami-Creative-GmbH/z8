/**
 * Payroll line kinds (#745): what a payroll run carries for one report, each kind
 * mapped to a wage type per payroll file format. The kinds are neutral; the
 * organization decides taxability through the wage type it maps. Kept free of
 * runtime imports beyond the receipt categories so the schema can reference it.
 */

import { RECEIPT_EXPENSE_CATEGORIES, type ReceiptExpenseCategory } from "./receipt-report.types";

/** Payroll runs carry euro amounts only; nothing is converted. */
export const PAYROLL_CURRENCY = "EUR";

export type PayrollLineKind =
	| "per_diem_statutory"
	| "per_diem_excess"
	| "mileage_statutory"
	| "mileage_excess"
	| `receipt_${ReceiptExpenseCategory}`;

export const PAYROLL_LINE_KINDS: readonly PayrollLineKind[] = [
	"per_diem_statutory",
	"per_diem_excess",
	"mileage_statutory",
	"mileage_excess",
	...RECEIPT_EXPENSE_CATEGORIES.map((category) => `receipt_${category}` as const),
];

export function isPayrollLineKind(value: unknown): value is PayrollLineKind {
	return typeof value === "string" && (PAYROLL_LINE_KINDS as readonly string[]).includes(value);
}
