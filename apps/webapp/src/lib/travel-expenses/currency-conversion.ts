import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	currencyMinorUnitDigits,
	divideToUnits,
	formatUnits,
	multiplyToUnits,
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
 *   with its rate date and reason. The result is rounded once, half up, to
 *   the reimbursement currency's minor units.
 * Nothing is guessed: without a basis for the item's exact currency pair the
 * item is "missing" a conversion, and a result that cannot be represented is
 * "unsupported".
 * - `reference_rate` (#608): a rate from the reference feed the organization
 *   approved (`reference-rate.ts`), priced like `manual_rate`, with the
 *   publication it came from.
 */

export const CONVERSION_BASES = ["card_charge", "manual_rate", "reference_rate"] as const;
export type ConversionBasis = (typeof CONVERSION_BASES)[number];

/** Commercial rounding, applied once to a rate-based result. */
export const CONVERSION_ROUNDING_MODE: RoundingMode = "half_up";
export const MAX_RATE_FRACTION_DIGITS = 10;
export const MAX_RATE_INTEGER_DIGITS = 12;
export const MAX_CONVERSION_REASON_LENGTH = 500;
/** Largest amount of the stored `decimal(12, 2)` columns, in units. */
const MAX_AMOUNT_UNITS = BigInt(99_999_999_999);
const ZERO = BigInt(0);

/** `1 base = value quote`; the pair is the item's two currencies, in either order. */
export interface ExchangeRate {
	base: string;
	quote: string;
	/** Positive plain decimal with at most `MAX_RATE_FRACTION_DIGITS` decimals. */
	value: string;
}

interface ConversionPair {
	/** The original (receipt) currency the conversion was recorded for. */
	sourceCurrency: string;
	/** The reimbursement currency of the report. */
	targetCurrency: string;
}

export interface CardChargeConversion extends ConversionPair {
	basis: "card_charge";
	/** What the card was actually charged, in the reimbursement currency ("92.17"). */
	chargedAmount: string;
	/** The item's attachment showing the charge; null once that file was removed. */
	evidenceReceiptId: string | null;
}

export interface ManualRateConversion extends ConversionPair {
	basis: "manual_rate";
	rate: ExchangeRate;
	/** Calendar date the rate applies to; it has no zone. */
	rateDate: string;
	/** Why and from which source the administrator documented this rate. */
	reason: string;
	authorizedBy: { employeeId: string; name: string };
	/** Canonical UTC instant of the authorization. */
	authorizedAt: string;
}

/** Where an applied reference rate came from, kept with it (#608). */
export interface ReferenceRateSource {
	provider: "ecb";
	/** The stored publication version that was applied. */
	publicationId: string;
	/** 1 for the first publication of its date; a correction is a later version. */
	publicationVersion: number;
	/** SHA-256 of the publication's canonical rates. */
	contentSha256: string;
	/** Canonical UTC instant this publication version was fetched. */
	retrievedAt: string;
	/** Canonical UTC instant the organization approved the reference source. */
	policyApprovedAt: string;
}

export interface ReferenceRateConversion extends ConversionPair {
	basis: "reference_rate";
	/** As published: `1 EUR = value X`, in either direction of the item's pair. */
	rate: ExchangeRate;
	/** The publication's own date; before `expenseDate` when it is a fallback. */
	rateDate: string;
	/** The expense date the publication was chosen for. */
	expenseDate: string;
	source: ReferenceRateSource;
}

/** The conversion recorded for one item. */
export type ItemConversion = CardChargeConversion | ManualRateConversion | ReferenceRateConversion;

type ConversionRounding = { rounding: { mode: RoundingMode; minorUnitDigits: number } };

/** What a conversion applied, as frozen with a submission. */
export type AppliedConversion =
	| { basis: "card_charge"; evidenceReceiptId: string | null }
	| (Omit<ManualRateConversion, "sourceCurrency" | "targetCurrency"> & ConversionRounding)
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
	| "conversion_evidence";

/** What keeps an item's conversion from being submittable; empty when none is needed. */
export function conversionRequirements(
	original: { amount: string | null; currency: string | null },
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
			return outcome.applied.basis === "card_charge" && !outcome.applied.evidenceReceiptId
				? ["conversion_evidence"]
				: [];
	}
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
	const units = parseUnits(value.trim(), digits);
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
}

export type ManualRateFieldError =
	| "invalid_pair"
	| "invalid_rate"
	| "invalid_date"
	| "required"
	| "too_long";

export type ParseManualRateResult =
	| { ok: true; value: { rate: ExchangeRate; rateDate: string; reason: string } }
	| {
			ok: false;
			errors: Partial<Record<"pair" | "rate" | "rateDate" | "reason", ManualRateFieldError>>;
	  };

const PLAIN_RATE = /^(\d+)(?:\.(\d+))?$/;

/** Validates an administrator's documented rate for the item's currency pair. */
export function parseManualRateInput(
	input: ManualRateInput,
	pair: { sourceCurrency: string; targetCurrency: string },
): ParseManualRateResult {
	const errors: Extract<ParseManualRateResult, { ok: false }>["errors"] = {};
	const base = input.base.trim().toUpperCase();
	const quote = input.quote.trim().toUpperCase();
	const forward = base === pair.sourceCurrency && quote === pair.targetCurrency;
	const inverse = base === pair.targetCurrency && quote === pair.sourceCurrency;
	if (pair.sourceCurrency === pair.targetCurrency || !(forward || inverse)) {
		errors.pair = "invalid_pair";
	}

	const value = input.rate.trim();
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

	const reason = input.reason.trim();
	if (!reason) errors.reason = "required";
	else if (reason.length > MAX_CONVERSION_REASON_LENGTH) errors.reason = "too_long";

	const normalized = normalizeRate(value);
	if (Object.keys(errors).length > 0 || !normalized) return { ok: false, errors };
	return { ok: true, value: { rate: { base, quote, value: normalized }, rateDate, reason } };
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
