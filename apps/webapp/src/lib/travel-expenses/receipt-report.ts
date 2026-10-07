import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type ConversionRequirement,
	conversionRequirements,
	type ItemConversion,
} from "./currency-conversion";
import { isFutureDated } from "./future-dates";
import { itemReimbursementAmount, type ReimbursementItemInput } from "./item-amount";
import { currencyMinorUnitDigits, formatUnits, STORED_AMOUNT_SCALE, sumUnits } from "./money";
import { missingReceiptRequirements, type ReceiptExceptionContext } from "./receipt-exception";
import {
	EXPENSE_PAYERS,
	type ExpensePayer,
	RECEIPT_EXPENSE_CATEGORIES,
	type ReceiptExpenseCategory,
} from "./receipt-report.types";

/**
 * Receipt expense items of a travel expense report (#600). A draft item may be
 * incomplete; every entered value is still well-formed. Amounts stay decimal
 * strings and are summed in minor units, never as floating point numbers.
 */

export {
	EXPENSE_PAYERS,
	type ExpensePayer,
	RECEIPT_EXPENSE_CATEGORIES,
	type ReceiptExpenseCategory,
} from "./receipt-report.types";

export const DEFAULT_REIMBURSEMENT_CURRENCY = "EUR";
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_ACCOUNTING_REFERENCE_LENGTH = 100;
/** Matches the stored `decimal(12, 2)` columns. */
const MAX_AMOUNT_MINOR = 99_999_999_999;

export interface ReceiptItemDraft {
	/** Calendar date printed on the receipt (YYYY-MM-DD); it has no zone. */
	expenseDate: string | null;
	category: ReceiptExpenseCategory | null;
	description: string | null;
	/** Original receipt amount, normalized to two decimals. */
	amount: string | null;
	/** Original receipt currency (ISO 4217). */
	currency: string | null;
	paidBy: ExpensePayer | null;
	/** Optional free-text accounting attribution for finance, until projects arrive. */
	accountingReference: string | null;
}

export type ReceiptItemDraftInput = { [K in keyof ReceiptItemDraft]: string | null };

export type ReceiptItemFieldError =
	| "invalid_date"
	| "invalid_category"
	| "invalid_amount"
	| "invalid_currency"
	| "invalid_payer"
	| "too_long";

export type ParseReceiptItemDraftResult =
	| { ok: true; draft: ReceiptItemDraft }
	| { ok: false; errors: Partial<Record<keyof ReceiptItemDraft, ReceiptItemFieldError>> };

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

let supportedCurrencies: Set<string> | null = null;

export function isSupportedCurrency(code: string): boolean {
	supportedCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
	return /^[A-Z]{3}$/.test(code) && supportedCurrencies.has(code);
}

/** Minor-unit digits of a currency, e.g. 2 for EUR and 0 for JPY. */
export function currencyFractionDigits(code: string): number {
	return currencyMinorUnitDigits(code);
}

/** Parses a positive decimal amount ("12.5" or "12,5") into minor units of two decimals. */
function parseAmountMinor(value: string, fractionDigits: number): number | null {
	const normalized = value.includes(".") ? value : value.replace(",", ".");
	const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(normalized);
	if (!match) return null;
	const fraction = match[2] ?? "";
	if (fraction.replace(/0+$/, "").length > fractionDigits) return null;
	const minor = Number(match[1]) * 100 + Number(fraction.padEnd(2, "0"));
	return minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

/** An entered amount as the draft stores it ("89,1" is "89.10"); null when malformed. */
export function normalizeReceiptAmount(value: string, fractionDigits: number): string | null {
	const minor = parseAmountMinor(value, fractionDigits);
	return minor === null ? null : formatMinor(minor);
}

function formatMinor(minor: number): string {
	const sign = minor < 0 ? "-" : "";
	const absolute = Math.abs(minor);
	return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
	return (values as readonly string[]).includes(value);
}

export function parseReceiptItemDraft(input: ReceiptItemDraftInput): ParseReceiptItemDraftResult {
	const errors: Partial<Record<keyof ReceiptItemDraft, ReceiptItemFieldError>> = {};
	const draft: ReceiptItemDraft = {
		expenseDate: null,
		category: null,
		description: null,
		amount: null,
		currency: null,
		paidBy: null,
		accountingReference: null,
	};

	const expenseDate = blankToNull(input.expenseDate);
	if (expenseDate) {
		try {
			draft.expenseDate = parsePlainDate(expenseDate).toString();
		} catch {
			errors.expenseDate = "invalid_date";
		}
	}

	const category = blankToNull(input.category);
	if (category) {
		if (isOneOf(RECEIPT_EXPENSE_CATEGORIES, category)) draft.category = category;
		else errors.category = "invalid_category";
	}

	const description = blankToNull(input.description);
	if (description) {
		if (description.length > MAX_DESCRIPTION_LENGTH) errors.description = "too_long";
		else draft.description = description;
	}

	const currency = blankToNull(input.currency)?.toUpperCase() ?? null;
	if (currency) {
		if (isSupportedCurrency(currency)) draft.currency = currency;
		else errors.currency = "invalid_currency";
	}

	const amount = blankToNull(input.amount);
	if (amount) {
		const minor = parseAmountMinor(
			amount,
			draft.currency ? currencyFractionDigits(draft.currency) : 2,
		);
		if (minor === null) errors.amount = "invalid_amount";
		else draft.amount = formatMinor(minor);
	}

	const paidBy = blankToNull(input.paidBy);
	if (paidBy) {
		if (isOneOf(EXPENSE_PAYERS, paidBy)) draft.paidBy = paidBy;
		else errors.paidBy = "invalid_payer";
	}

	const accountingReference = blankToNull(input.accountingReference);
	if (accountingReference) {
		if (accountingReference.length > MAX_ACCOUNTING_REFERENCE_LENGTH)
			errors.accountingReference = "too_long";
		else draft.accountingReference = accountingReference;
	}

	return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, draft };
}

export type ReceiptItemRequirement =
	| "expense_date"
	/** The expense date is later than today anywhere on earth (#685). */
	| "future_date"
	| "category"
	| "description"
	| "amount"
	| "payment_ownership"
	| "receipt"
	/** A missing-receipt exception was requested without an explanation (#604). */
	| "receipt_exception_reason"
	/** A missing-receipt exception was requested, but the organization does not allow them (#604). */
	| "receipt_exception_not_allowed"
	/** A foreign receipt's conversion (#607); nothing is guessed. */
	| ConversionRequirement;

/** What still keeps a receipt item from being submittable, in form order. */
export function receiptItemMissingRequirements(
	draft: ReceiptItemDraft,
	context: {
		receiptCount: number;
		reimbursementCurrency: string;
		receiptException?: ReceiptExceptionContext;
		conversion?: ItemConversion | null;
		/** When submission is (or would be) asked for; a future-dated expense waits for its date. */
		now: Instant;
	},
): ReceiptItemRequirement[] {
	const missing: ReceiptItemRequirement[] = [];
	if (!draft.expenseDate) missing.push("expense_date");
	else if (isFutureDated(draft.expenseDate, context.now)) missing.push("future_date");
	if (!draft.category) missing.push("category");
	if (!draft.description) missing.push("description");
	if (!draft.amount || !draft.currency) missing.push("amount");
	else
		missing.push(
			...conversionRequirements(draft, context.reimbursementCurrency, context.conversion),
		);
	if (!draft.paidBy) missing.push("payment_ownership");
	if (context.receiptCount < 1)
		missing.push(...missingReceiptRequirements(context.receiptException));
	return missing;
}

export interface ReceiptReportTotals {
	currency: string;
	/** Employee-paid costs: the employee's reimbursement entitlement. */
	reimbursable: string;
	/** Company-paid costs: visible, but never owed to the employee. */
	companyPaid: string;
	/** Items whose amount, payer or currency does not allow them to be counted yet. */
	excludedItemCount: number;
}

/** Each item counts as `itemReimbursementAmount` prices it; amounts are summed exactly. */
export function receiptReportTotals(
	items: readonly ReimbursementItemInput[],
	reimbursementCurrency: string,
): ReceiptReportTotals {
	const amounts = items.map((item) => itemReimbursementAmount(item, reimbursementCurrency));
	const sumPaidBy = (payer: ExpensePayer) =>
		formatUnits(
			sumUnits(
				amounts.flatMap((amount) =>
					amount.counted && amount.paidBy === payer ? [amount.units] : [],
				),
			),
			STORED_AMOUNT_SCALE,
		);
	return {
		currency: reimbursementCurrency,
		reimbursable: sumPaidBy("employee"),
		companyPaid: sumPaidBy("company"),
		excludedItemCount: amounts.filter((amount) => !amount.counted).length,
	};
}
