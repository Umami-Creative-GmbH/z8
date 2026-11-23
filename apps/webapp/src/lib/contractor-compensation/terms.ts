import {
	currencyMinorUnitDigits,
	formatUnits,
	normalizeDecimalInput,
	parseUnits,
} from "@/lib/money/exact-decimal";
import type { CompensationBasis, DayUnitRuleKind } from "./kinds";

/**
 * Contractor compensation terms (#1998, spec #1935): what an External
 * Contractor is paid, effective-dated per contractor employment period. Kept
 * strictly apart from employee employment terms (`contract_type` fixed |
 * hourly), payroll and Billable Time cost rates.
 *
 * Client-safe: the editor validates with it and the server parses with it.
 */

export {
	type CompensationBasis,
	compensationBases,
	type DayUnitRuleKind,
	dayUnitRuleKinds,
} from "./kinds";

/** How a local calendar day's completed work becomes billed days. */
export type DayUnitRule =
	/** Any day with completed work counts as 1.0 day. */
	| { kind: "any_work_full_day" }
	/** Up to and including the threshold 0.5 day, above it 1.0 day. */
	| { kind: "half_and_full_day"; halfDayThresholdMinutes: number }
	/** Worked minutes ÷ standard day, at most 1.0 when capped. */
	| { kind: "prorated_by_standard_day"; standardDayMinutes: number; capAtOneDay: boolean };

/** One set of terms; the rate is in minor units of its currency (cents for EUR). */
export type ContractorCompensation =
	| { basis: "hourly"; currency: string; rateMinor: bigint }
	| { basis: "daily"; currency: string; rateMinor: bigint; dayUnitRule: DayUnitRule };

export const DEFAULT_CONTRACTOR_CURRENCY = "EUR";
export const DEFAULT_HALF_DAY_THRESHOLD_MINUTES = 240;
export const DEFAULT_STANDARD_DAY_MINUTES = 480;
export const DEFAULT_CAP_AT_ONE_DAY = true;
export const MINUTES_PER_DAY = 1440;

/** Decimals a stored rate keeps (`numeric(12, 3)`): enough for every ISO 4217 currency in use. */
export const STORED_RATE_SCALE = 3;
/** A rate is below one million in its currency's major unit. */
const MAX_RATE_MAJOR = BigInt(1_000_000);

/** The terms as the editor submits them and the server receives them (wire-safe). */
export interface ContractorCompensationInput {
	basis: CompensationBasis;
	/** Entered decimal ("650", "650,50", "85.5"). */
	rateAmount: string;
	currency: string;
	dayUnitRule?: DayUnitRuleKind | null;
	halfDayThresholdMinutes?: number | null;
	standardDayMinutes?: number | null;
	capAtOneDay?: boolean | null;
}

export type ContractorCompensationRefusal =
	| "invalid_basis"
	| "invalid_currency"
	| "invalid_rate"
	| "rate_not_positive"
	| "rate_too_large"
	| "rate_too_precise"
	| "invalid_day_unit_rule"
	| "invalid_half_day_threshold"
	| "invalid_standard_day";

export type ParsedContractorCompensation =
	| { ok: true; compensation: ContractorCompensation }
	| { ok: false; reason: ContractorCompensationRefusal };

const CURRENCY_CODE = /^[A-Z]{3}$/;
/** A plain decimal, at any precision; `parseUnits` then decides whether it fits. */
const DECIMAL_SYNTAX = /^-?\d{1,19}(?:\.\d{1,19})?$/;

function supportedCurrencies(): ReadonlySet<string> | null {
	const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "currency") => string[] };
	return typeof intl.supportedValuesOf === "function"
		? new Set(intl.supportedValuesOf("currency"))
		: null;
}

/** Whether a code is an ISO 4217 currency this runtime knows. */
export function isCurrencyCode(value: string): boolean {
	if (!CURRENCY_CODE.test(value)) return false;
	return supportedCurrencies()?.has(value) ?? true;
}

function isMinutes(value: unknown): value is number {
	return (
		typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MINUTES_PER_DAY
	);
}

function parseDayUnitRule(
	input: ContractorCompensationInput,
): DayUnitRule | ContractorCompensationRefusal {
	switch (input.dayUnitRule) {
		case "any_work_full_day":
			return { kind: "any_work_full_day" };
		case "half_and_full_day": {
			const threshold = input.halfDayThresholdMinutes ?? DEFAULT_HALF_DAY_THRESHOLD_MINUTES;
			return isMinutes(threshold)
				? { kind: "half_and_full_day", halfDayThresholdMinutes: threshold }
				: "invalid_half_day_threshold";
		}
		case "prorated_by_standard_day": {
			const standard = input.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES;
			if (!isMinutes(standard)) return "invalid_standard_day";
			return {
				kind: "prorated_by_standard_day",
				standardDayMinutes: standard,
				capAtOneDay: input.capAtOneDay ?? DEFAULT_CAP_AT_ONE_DAY,
			};
		}
		default:
			return "invalid_day_unit_rule";
	}
}

/**
 * Reads entered terms. A rate is a positive amount with at most the currency's
 * minor-unit digits; a daily basis needs a day-unit rule, whose minute settings
 * default to 240 (half-day threshold) and 480 (standard day, capped at 1.0).
 */
export function parseContractorCompensation(
	input: ContractorCompensationInput,
): ParsedContractorCompensation {
	if (input.basis !== "hourly" && input.basis !== "daily") {
		return { ok: false, reason: "invalid_basis" };
	}
	const currency = input.currency.trim().toUpperCase();
	if (!isCurrencyCode(currency)) return { ok: false, reason: "invalid_currency" };

	const digits = currencyMinorUnitDigits(currency);
	const normalized = normalizeDecimalInput(input.rateAmount);
	if (!DECIMAL_SYNTAX.test(normalized)) return { ok: false, reason: "invalid_rate" };
	// A well-formed decimal that `parseUnits` refuses has more decimals than the
	// currency allows (its minor digits never exceed STORED_RATE_SCALE).
	const rateMinor = parseUnits(normalized, digits);
	if (rateMinor === null) return { ok: false, reason: "rate_too_precise" };
	if (rateMinor <= BigInt(0)) return { ok: false, reason: "rate_not_positive" };
	if (rateMinor >= MAX_RATE_MAJOR * BigInt(`1${"0".repeat(digits)}`)) {
		return { ok: false, reason: "rate_too_large" };
	}

	if (input.basis === "hourly") {
		return { ok: true, compensation: { basis: "hourly", currency, rateMinor } };
	}
	const dayUnitRule = parseDayUnitRule(input);
	if (typeof dayUnitRule === "string") return { ok: false, reason: dayUnitRule };
	return { ok: true, compensation: { basis: "daily", currency, rateMinor, dayUnitRule } };
}

/** The rate as a decimal string with the currency's minor-unit digits: 65050 EUR is "650.50". */
export function formatContractorRate(
	compensation: Pick<ContractorCompensation, "currency" | "rateMinor">,
): string {
	return formatUnits(compensation.rateMinor, currencyMinorUnitDigits(compensation.currency));
}

/** The terms as the database stores them (`contractor_compensation_terms` columns). */
export interface StoredContractorCompensation {
	compensationBasis: CompensationBasis;
	rateAmount: string;
	currency: string;
	dayUnitRule: DayUnitRuleKind | null;
	halfDayThresholdMinutes: number | null;
	standardDayMinutes: number | null;
	capAtOneDay: boolean | null;
}

export function toStoredCompensation(
	compensation: ContractorCompensation,
): StoredContractorCompensation {
	const rule = compensation.basis === "daily" ? compensation.dayUnitRule : null;
	return {
		compensationBasis: compensation.basis,
		rateAmount: formatContractorRate(compensation),
		currency: compensation.currency,
		dayUnitRule: rule?.kind ?? null,
		halfDayThresholdMinutes:
			rule?.kind === "half_and_full_day" ? rule.halfDayThresholdMinutes : null,
		standardDayMinutes: rule?.kind === "prorated_by_standard_day" ? rule.standardDayMinutes : null,
		capAtOneDay: rule?.kind === "prorated_by_standard_day" ? rule.capAtOneDay : null,
	};
}

/** Reads stored terms. Throws on a row the table's checks would have refused. */
export function fromStoredCompensation(row: StoredContractorCompensation): ContractorCompensation {
	const parsed = parseContractorCompensation({
		basis: row.compensationBasis,
		rateAmount: row.rateAmount,
		currency: row.currency,
		dayUnitRule: row.dayUnitRule,
		halfDayThresholdMinutes: row.halfDayThresholdMinutes,
		standardDayMinutes: row.standardDayMinutes,
		capAtOneDay: row.capAtOneDay,
	});
	if (!parsed.ok) throw new RangeError(`Stored contractor terms are invalid: ${parsed.reason}`);
	return parsed.compensation;
}

/** Wire-safe terms for the editor and the history (the rate as a decimal string). */
export type ContractorCompensationView = StoredContractorCompensation;

export function sameCompensation(
	left: ContractorCompensation,
	right: ContractorCompensation,
): boolean {
	const a = toStoredCompensation(left);
	const b = toStoredCompensation(right);
	return (
		a.compensationBasis === b.compensationBasis &&
		a.rateAmount === b.rateAmount &&
		a.currency === b.currency &&
		a.dayUnitRule === b.dayUnitRule &&
		a.halfDayThresholdMinutes === b.halfDayThresholdMinutes &&
		a.standardDayMinutes === b.standardDayMinutes &&
		a.capAtOneDay === b.capAtOneDay
	);
}
