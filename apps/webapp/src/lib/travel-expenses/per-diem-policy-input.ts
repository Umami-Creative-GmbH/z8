import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { MAX_POLICY_NOTE_LENGTH, MAX_POLICY_SOURCE_LENGTH } from "./mileage-policy-input";
import { formatUnits, parseUnits, STORED_AMOUNT_SCALE } from "./money";
import { isSupportedCurrency } from "./receipt-report";
import {
	canAdoptPerDiemDefaultFrom,
	findStatutoryPerDiemDefault,
	type PerDiemRates,
} from "./statutory-per-diem-defaults";

/**
 * What an expense administrator submits to activate a per diem policy
 * version (#609), validated before any write. Either the organization's own
 * domestic amounts with their source, or an adopted verified statutory
 * default, whose amounts and source always come from the catalog.
 */

export const PER_DIEM_RATE_FIELDS = [
	"fullDay",
	"partialDay",
	"breakfastDeduction",
	"lunchDeduction",
	"dinnerDeduction",
] as const satisfies readonly (keyof PerDiemRates)[];

export interface PerDiemPolicyVersionFormInput {
	source: "organization" | "statutory_default";
	effectiveFrom?: string | null;
	/** Organization versions only. */
	currency?: string | null;
	rates?: Partial<Record<keyof PerDiemRates, string | null>>;
	sourceReference?: string | null;
	sourceVersion?: string | null;
	/** Statutory default only. */
	defaultKey?: string | null;
	note?: string | null;
	replacesVersionId?: string | null;
}

export interface PerDiemPolicyVersionInput {
	effectiveFrom: string;
	currency: string;
	/** Domestic amounts (area "DE"). */
	rates: PerDiemRates;
	source:
		| { kind: "organization"; reference: string | null; version: string | null; defaultKey: null }
		| { kind: "statutory_default"; reference: string; version: string; defaultKey: string };
	note: string | null;
	replacesVersionId: string | null;
}

export type PerDiemPolicyInputError =
	| "invalid_date"
	| "before_default_validity"
	| "invalid_currency"
	| "invalid_amount"
	| "exceeds_full_day"
	| "unknown_default"
	| "too_long";

export type PerDiemPolicyInputErrors = Partial<
	Record<
		| "effectiveFrom"
		| "currency"
		| keyof PerDiemRates
		| "sourceReference"
		| "sourceVersion"
		| "defaultKey"
		| "note",
		PerDiemPolicyInputError
	>
>;

const MAX_AMOUNT_UNITS = BigInt(100_000); // 1000.00

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function boundedText(
	value: string | null | undefined,
	max: number,
): { value: string | null } | { error: "too_long" } {
	const text = blankToNull(value);
	return text && text.length > max ? { error: "too_long" } : { value: text };
}

/** A non-negative amount ("14" or "5,60") at two decimals; null when malformed or too large. */
export function parsePerDiemAmount(value: string): string | null {
	const trimmed = value.trim();
	const normalized = trimmed.includes(".") ? trimmed : trimmed.replace(",", ".");
	if (!/^\d{1,6}(?:\.\d+)?$/.test(normalized)) return null;
	const units = parseUnits(normalized, STORED_AMOUNT_SCALE);
	if (units === null || units > MAX_AMOUNT_UNITS) return null;
	return formatUnits(units, STORED_AMOUNT_SCALE);
}

function parseRates(
	input: PerDiemPolicyVersionFormInput["rates"],
	errors: PerDiemPolicyInputErrors,
): PerDiemRates | null {
	const rates: Partial<PerDiemRates> = {};
	for (const field of PER_DIEM_RATE_FIELDS) {
		const parsed = parsePerDiemAmount(blankToNull(input?.[field]) ?? "");
		if (parsed === null) errors[field] = "invalid_amount";
		else rates[field] = parsed;
	}
	const full = rates.fullDay ? parseUnits(rates.fullDay, STORED_AMOUNT_SCALE) : null;
	if (full !== null && full <= BigInt(0)) errors.fullDay = "invalid_amount";
	if (full !== null) {
		for (const field of PER_DIEM_RATE_FIELDS) {
			const value = rates[field];
			if (field !== "fullDay" && value && (parseUnits(value, STORED_AMOUNT_SCALE) ?? BigInt(0)) > full) {
				errors[field] = "exceeds_full_day";
			}
		}
	}
	return PER_DIEM_RATE_FIELDS.every((field) => rates[field] && !errors[field])
		? (rates as PerDiemRates)
		: null;
}

export function parsePerDiemPolicyVersionInput(
	input: PerDiemPolicyVersionFormInput,
):
	| { ok: true; input: PerDiemPolicyVersionInput }
	| { ok: false; errors: PerDiemPolicyInputErrors } {
	const errors: PerDiemPolicyInputErrors = {};
	let effectiveFrom: string | null = null;
	try {
		const entered = blankToNull(input.effectiveFrom);
		if (entered) effectiveFrom = parsePlainDate(entered).toString();
		else errors.effectiveFrom = "invalid_date";
	} catch {
		errors.effectiveFrom = "invalid_date";
	}
	const note = boundedText(input.note, MAX_POLICY_NOTE_LENGTH);
	if ("error" in note) errors.note = note.error;
	const replacesVersionId = blankToNull(input.replacesVersionId);

	if (input.source === "statutory_default") {
		const entry = findStatutoryPerDiemDefault(blankToNull(input.defaultKey) ?? "");
		if (!entry) errors.defaultKey = "unknown_default";
		else if (effectiveFrom && !canAdoptPerDiemDefaultFrom(entry, effectiveFrom)) {
			errors.effectiveFrom = "before_default_validity";
		}
		if (Object.keys(errors).length > 0 || !entry || !effectiveFrom || "error" in note) {
			return { ok: false, errors };
		}
		return {
			ok: true,
			input: {
				effectiveFrom,
				currency: entry.currency,
				rates: { ...entry.rates },
				source: {
					kind: "statutory_default",
					reference: entry.reference,
					version: entry.version,
					defaultKey: entry.key,
				},
				note: note.value,
				replacesVersionId,
			},
		};
	}

	const currency = blankToNull(input.currency)?.toUpperCase() ?? null;
	if (!currency || !isSupportedCurrency(currency)) errors.currency = "invalid_currency";
	const rates = parseRates(input.rates, errors);
	const reference = boundedText(input.sourceReference, MAX_POLICY_SOURCE_LENGTH);
	if ("error" in reference) errors.sourceReference = reference.error;
	const version = boundedText(input.sourceVersion, MAX_POLICY_SOURCE_LENGTH);
	if ("error" in version) errors.sourceVersion = version.error;
	if (
		Object.keys(errors).length > 0 ||
		!effectiveFrom ||
		!currency ||
		!rates ||
		"error" in note ||
		"error" in reference ||
		"error" in version
	) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		input: {
			effectiveFrom,
			currency,
			rates,
			source: {
				kind: "organization",
				reference: reference.value,
				version: version.value,
				defaultKey: null,
			},
			note: note.value,
			replacesVersionId,
		},
	};
}
