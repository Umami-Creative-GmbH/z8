import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type {
	ExchangeRate,
	ItemConversion,
	ManualRateConversion,
	ReferenceRateConversion,
} from "./currency-conversion.types";
import {
	currencyMinorUnitDigits,
	divideToUnits,
	formatUnits,
	MAX_AMOUNT_UNITS,
	multiplyToUnits,
	normalizeDecimalInput,
	parseUnits,
	type RoundingMode,
	roundToScale,
	STORED_AMOUNT_SCALE,
} from "./money";

/**
 * Conversion of a foreign-currency expense into the report's reimbursement
 * currency (#607). The original amount and currency are always kept; an item
 * in another currency counts only through an explicit, visible basis:
 * - `card_charge`: the employee's evidenced actual charge in the reimbursement
 *   currency (e.g. the card statement line). It is used exactly, never rounded.
 * - `manual_rate`: a documented rate an expense administrator authorized,
 *   with its rate date (fitting the expense date), reason and evidence
 *   reference. The administrator never authorizes a rate on their own
 *   report (`conversion-store.ts`). The result is rounded once, half up, to
 *   the reimbursement currency's minor units.
 * Nothing is guessed: without a basis for the item's exact currency pair the
 * item is "missing" a conversion, and a result that cannot be represented is
 * "unsupported".
 * - `reference_rate` (#608): a rate from the reference feed the organization
 *   approved (`reference-rate.ts`), priced like `manual_rate`, with the
 *   publication it came from.
 */

export {
	type CardChargeConversion,
	CONVERSION_BASES,
	type ConversionBasis,
	type ExchangeRate,
	type ItemConversion,
	type ManualRateConversion,
	type ReferenceRateConversion,
	type ReferenceRateSource,
} from "./currency-conversion.types";

/** Commercial rounding, applied once to a rate-based result. */
export const CONVERSION_ROUNDING_MODE: RoundingMode = "half_up";
export const MAX_RATE_FRACTION_DIGITS = 10;
export const MAX_RATE_INTEGER_DIGITS = 12;
export const MAX_CONVERSION_REASON_LENGTH = 500;
/**
 * Evidence reference of an authorized manual rate (e.g. "Bank statement
 * 2026-09, line 14" or a document ID); the same bound as an allowance
 * override's evidence (#610).
 */
export const MAX_RATE_EVIDENCE_LENGTH = 2000;
/**
 * How long before the expense date a documented rate may be dated. A rate is
 * never dated after the expense (it cannot have been known then). 31 days
 * still admits rates published monthly for the expense's month or the month
 * before (official monthly conversion tables, a card issuer's monthly
 * statement rate), while the automatic reference-rate fallback stays at 7
 * days (`reference-rate.ts`). Older rates are refused rather than trusted.
 */
export const MAX_MANUAL_RATE_AGE_DAYS = 31;
const ZERO = BigInt(0);

type ConversionRounding = { rounding: { mode: RoundingMode; minorUnitDigits: number } };

/**
 * What a conversion applied, as frozen with a submission. A manual rate's
 * `evidence` is absent from revisions frozen before facts version 11.
 */
export type AppliedConversion =
	| { basis: "card_charge"; evidenceReceiptId: string | null }
	| (Omit<ManualRateConversion, "sourceCurrency" | "targetCurrency" | "evidence"> & {
			evidence?: string;
	  } & ConversionRounding)
	| (Omit<ReferenceRateConversion, "sourceCurrency" | "targetCurrency"> & ConversionRounding);

export type ConversionOutcome =
	/** The item already is in the reimbursement currency. */
	| { kind: "same_currency" }
	| {
			kind: "converted";
			/** Units at `STORED_AMOUNT_SCALE`; always positive. */
			units: bigint;
			reimbursement: { amount: string; currency: string };
			applied: AppliedConversion;
	  }
	/** No conversion exists for the item's exact currency pair. */
	| { kind: "missing" }
	| {
			kind: "unsupported";
			/**
			 * `reimbursement_currency`: its minor units cannot be stored at two
			 * decimals; `result_out_of_range`: the result rounds to zero or exceeds
			 * the stored amount range.
			 */
			reason: "reimbursement_currency" | "result_out_of_range";
	  };

function storableDigits(currency: string): number | null {
	const digits = currencyMinorUnitDigits(currency);
	return digits <= STORED_AMOUNT_SCALE ? digits : null;
}

function inRange(units: bigint): boolean {
	return units > ZERO && units <= MAX_AMOUNT_UNITS;
}

/**
 * Prices `original` in `reimbursementCurrency` through `conversion`. Pure:
 * the same inputs always give the same, exactly rounded result.
 */
export function convertToReimbursement(
	original: { amount: string; currency: string },
	reimbursementCurrency: string,
	conversion: ItemConversion | null | undefined,
): ConversionOutcome {
	if (original.currency === reimbursementCurrency) return { kind: "same_currency" };
	if (
		!conversion ||
		conversion.sourceCurrency !== original.currency ||
		conversion.targetCurrency !== reimbursementCurrency
	) {
		return { kind: "missing" };
	}
	const digits = storableDigits(reimbursementCurrency);
	if (digits === null) return { kind: "unsupported", reason: "reimbursement_currency" };
	const converted = (units: bigint, applied: AppliedConversion): ConversionOutcome =>
		inRange(units)
			? {
					kind: "converted",
					units,
					reimbursement: {
						amount: formatUnits(units, STORED_AMOUNT_SCALE),
						currency: reimbursementCurrency,
					},
					applied,
				}
			: { kind: "unsupported", reason: "result_out_of_range" };

	if (conversion.basis === "card_charge") {
		const charged = parseUnits(conversion.chargedAmount, digits);
		if (charged === null) return { kind: "unsupported", reason: "result_out_of_range" };
		return converted(
			roundToScale({ units: charged, scale: digits }, STORED_AMOUNT_SCALE, "half_up"),
			{
				basis: "card_charge",
				evidenceReceiptId: conversion.evidenceReceiptId,
			},
		);
	}

	const { rate } = conversion;
	const mode = CONVERSION_ROUNDING_MODE;
	let minor: bigint;
	if (rate.base === original.currency && rate.quote === reimbursementCurrency) {
		minor = multiplyToUnits(original.amount, rate.value, digits, mode);
	} else if (rate.base === reimbursementCurrency && rate.quote === original.currency) {
		minor = divideToUnits(original.amount, rate.value, digits, mode);
	} else {
		return { kind: "missing" };
	}
	const units = roundToScale({ units: minor, scale: digits }, STORED_AMOUNT_SCALE, mode);
	const rounding = { mode, minorUnitDigits: digits };
	if (conversion.basis === "reference_rate") {
		const { sourceCurrency: _source, targetCurrency: _target, ...reference } = conversion;
		return converted(units, {
			...reference,
			rate: { ...rate },
			source: { ...conversion.source },
			rounding,
		});
	}
	const { sourceCurrency: _source, targetCurrency: _target, ...manual } = conversion;
	return converted(units, {
		...manual,
		rate: { ...rate },
		authorizedBy: { ...conversion.authorizedBy },
		rounding,
	});
}

/** An applied conversion with its result: what drafts show and submissions freeze. */
export type ConversionResult = AppliedConversion & {
	reimbursement: { amount: string; currency: string };
};

/** The applied conversion of a foreign item, or null when none applies. */
export function appliedConversion(
	original: { amount: string | null; currency: string | null },
	reimbursementCurrency: string,
	conversion: ItemConversion | null | undefined,
): ConversionResult | null {
	if (!original.amount || !original.currency) return null;
	const outcome = convertToReimbursement(
		{ amount: original.amount, currency: original.currency },
		reimbursementCurrency,
		conversion,
	);
	return outcome.kind === "converted"
		? { ...outcome.applied, reimbursement: { ...outcome.reimbursement } }
		: null;
}

export type ConversionRequirement =
	/** A foreign item needs a card charge or an authorized rate. */
	| "conversion_missing"
	/** The recorded conversion cannot be applied (currency or result range). */
	| "conversion_unsupported"
	/** A card charge needs the attachment that shows it. */
	| "conversion_evidence"
	/**
	 * An authorized rate's date no longer fits the expense date (the employee
	 * changed the date afterwards): an administrator must document a new rate.
	 */
	| "conversion_rate_date";

/** What keeps an item's conversion from being submittable; empty when none is needed. */
export function conversionRequirements(
	original: { amount: string | null; currency: string | null; expenseDate?: string | null },
	reimbursementCurrency: string,
	conversion: ItemConversion | null | undefined,
): ConversionRequirement[] {
	if (!original.amount || !original.currency) return [];
	const outcome = convertToReimbursement(
		{ amount: original.amount, currency: original.currency },
		reimbursementCurrency,
		conversion,
	);
	switch (outcome.kind) {
		case "same_currency":
			return [];
		case "missing":
			return ["conversion_missing"];
		case "unsupported":
			return ["conversion_unsupported"];
		case "converted":
			if (outcome.applied.basis === "card_charge" && !outcome.applied.evidenceReceiptId) {
				return ["conversion_evidence"];
			}
			// A missing expense date is reported as `expense_date` by the item itself.
			if (
				outcome.applied.basis === "manual_rate" &&
				original.expenseDate &&
				manualRateDateProblem(outcome.applied.rateDate, original.expenseDate) !== null
			) {
				return ["conversion_rate_date"];
			}
			return [];
	}
}

export type ManualRateDateProblem = "after_expense_date" | "too_early";

/**
 * Whether a documented rate's date fits the expense date: not after it and at
 * most `MAX_MANUAL_RATE_AGE_DAYS` before it. Both are zoneless calendar dates;
 * an unparsable date counts as not fitting.
 */
export function manualRateDateProblem(
	rateDate: string,
	expenseDate: string,
): ManualRateDateProblem | null {
	let rate: ReturnType<typeof parsePlainDate>;
	let expense: ReturnType<typeof parsePlainDate>;
	try {
		rate = parsePlainDate(rateDate);
		expense = parsePlainDate(expenseDate);
	} catch {
		return "too_early";
	}
	if (comparePlainDates(rate, expense) > 0) return "after_expense_date";
	const earliest = expense.subtract({ days: MAX_MANUAL_RATE_AGE_DAYS });
	return comparePlainDates(rate, earliest) < 0 ? "too_early" : null;
}

/**
 * Policy amounts (mileage or per diem rates, #606/#609) in another currency
 * than the reimbursement currency have no evidenced charge or authorized rate
 * to convert them with, so they are refused rather than converted at a guess.
 */
export function convertPolicyAmount(
	amount: { amount: string; currency: string },
	reimbursementCurrency: string,
): { kind: "same_currency"; amount: string } | { kind: "unsupported"; reason: "policy_currency" } {
	return amount.currency === reimbursementCurrency
		? { kind: "same_currency", amount: amount.amount }
		: { kind: "unsupported", reason: "policy_currency" };
}

/**
 * A card charge as entered: positive, within the stored range and no more
 * precise than the reimbursement currency's minor units. Returns the stored
 * two-decimal form, or null.
 */
export function parseCardChargeAmount(value: string, reimbursementCurrency: string): string | null {
	const digits = storableDigits(reimbursementCurrency);
	if (digits === null) return null;
	const units = parseUnits(normalizeDecimalInput(value), digits);
	if (units === null) return null;
	const stored = roundToScale({ units, scale: digits }, STORED_AMOUNT_SCALE, "half_up");
	return inRange(stored) ? formatUnits(stored, STORED_AMOUNT_SCALE) : null;
}

export interface ManualRateInput {
	base: string;
	quote: string;
	rate: string;
	rateDate: string;
	reason: string;
	/** Where the rate can be verified (document, statement line, reference). */
	evidence: string;
}

export type ManualRateFieldError =
	| "invalid_pair"
	| "invalid_rate"
	| "invalid_date"
	/** The rate is dated after the expense date. */
	| "after_expense_date"
	/** The rate is dated more than `MAX_MANUAL_RATE_AGE_DAYS` before the expense date. */
	| "too_early"
	/** The expense has no date yet, so no rate date can be checked against it. */
	| "expense_date_missing"
	| "required"
	| "too_long";

export type ParseManualRateResult =
	| {
			ok: true;
			value: { rate: ExchangeRate; rateDate: string; reason: string; evidence: string };
	  }
	| {
			ok: false;
			errors: Partial<
				Record<"pair" | "rate" | "rateDate" | "reason" | "evidence", ManualRateFieldError>
			>;
	  };

const PLAIN_RATE = /^(\d+)(?:\.(\d+))?$/;

/**
 * Validates an administrator's documented rate for the item's currency pair
 * and expense date: the rate date must fit the expense date
 * (`manualRateDateProblem`), and the rate needs a reason and evidence.
 */
export function parseManualRateInput(
	input: ManualRateInput,
	pair: { sourceCurrency: string; targetCurrency: string },
	expenseDate: string | null,
): ParseManualRateResult {
	const errors: Extract<ParseManualRateResult, { ok: false }>["errors"] = {};
	const base = input.base.trim().toUpperCase();
	const quote = input.quote.trim().toUpperCase();
	const forward = base === pair.sourceCurrency && quote === pair.targetCurrency;
	const inverse = base === pair.targetCurrency && quote === pair.sourceCurrency;
	if (pair.sourceCurrency === pair.targetCurrency || !(forward || inverse)) {
		errors.pair = "invalid_pair";
	}

	const value = normalizeDecimalInput(input.rate);
	const match = PLAIN_RATE.exec(value);
	const units = match ? parseUnits(value, MAX_RATE_FRACTION_DIGITS) : null;
	const integerDigits = match?.[1]?.replace(/^0+(?=\d)/, "").length ?? 0;
	if (units === null || units <= ZERO || integerDigits > MAX_RATE_INTEGER_DIGITS) {
		errors.rate = "invalid_rate";
	}

	let rateDate = "";
	try {
		rateDate = parsePlainDate(input.rateDate.trim()).toString();
	} catch {
		errors.rateDate = "invalid_date";
	}
	if (rateDate) {
		if (!expenseDate) errors.rateDate = "expense_date_missing";
		else {
			const problem = manualRateDateProblem(rateDate, expenseDate);
			if (problem) errors.rateDate = problem;
		}
	}

	const reason = input.reason.trim();
	if (!reason) errors.reason = "required";
	else if (reason.length > MAX_CONVERSION_REASON_LENGTH) errors.reason = "too_long";

	const evidence = input.evidence.trim();
	if (!evidence) errors.evidence = "required";
	else if (evidence.length > MAX_RATE_EVIDENCE_LENGTH) errors.evidence = "too_long";

	const normalized = normalizeRate(value);
	if (Object.keys(errors).length > 0 || !normalized) return { ok: false, errors };
	return {
		ok: true,
		value: { rate: { base, quote, value: normalized }, rateDate, reason, evidence },
	};
}

/**
 * A positive rate in its shortest plain form: "0.9215000000" (the stored
 * `numeric(22, 10)` text) becomes "0.9215". Null when it is not a rate.
 */
export function normalizeRate(value: string): string | null {
	const units = PLAIN_RATE.test(value) ? parseUnits(value, MAX_RATE_FRACTION_DIGITS) : null;
	if (units === null || units <= ZERO) return null;
	return formatUnits(units, MAX_RATE_FRACTION_DIGITS).replace(/\.?0+$/, "");
}

let supportedCurrencies: Set<string> | null = null;

/**
 * Whether an organization may reimburse in `currency`: a known ISO 4217 code
 * whose minor units fit the two stored decimals (EUR, CHF, JPY; not KWD).
 */
export function isReimbursementCurrencySupported(currency: string): boolean {
	supportedCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
	return (
		/^[A-Z]{3}$/.test(currency) &&
		supportedCurrencies.has(currency) &&
		storableDigits(currency) !== null
	);
}
