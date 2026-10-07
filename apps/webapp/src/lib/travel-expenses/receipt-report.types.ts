/**
 * Receipt expense categories and payers (#600). Kept free of imports: the
 * database schema references these, and every runtime image that loads the
 * schema would otherwise need the report calculation's dependencies.
 * `receipt-report.ts` re-exports them.
 */

export const RECEIPT_EXPENSE_CATEGORIES = [
	"transport",
	"accommodation",
	"meals",
	"parking",
	"other",
] as const;
export type ReceiptExpenseCategory = (typeof RECEIPT_EXPENSE_CATEGORIES)[number];

export const EXPENSE_PAYERS = ["employee", "company"] as const;
export type ExpensePayer = (typeof EXPENSE_PAYERS)[number];
