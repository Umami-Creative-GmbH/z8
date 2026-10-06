import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { MILEAGE_VEHICLES, type MileageVehicle, parseMileageRate } from "./mileage";
import { isSupportedCurrency } from "./receipt-report";
import {
	canAdoptStatutoryDefaultFrom,
	findStatutoryMileageDefault,
} from "./statutory-allowance-defaults";

/**
 * What an expense administrator submits to activate a mileage policy version
 * (#606), validated before any write. Either the organization's own rates
 * with their source, or an adopted verified statutory default, whose rates and
 * source always come from the catalog and never from the client.
 */

export const MAX_POLICY_SOURCE_LENGTH = 300;
export const MAX_POLICY_NOTE_LENGTH = 500;

export interface MileagePolicyVersionFormInput {
	source: "organization" | "statutory_default";
	effectiveFrom?: string | null;
	/** Organization versions only. */
	currency?: string | null;
	ratesPerKm?: Partial<Record<MileageVehicle, string | null>>;
	sourceReference?: string | null;
	sourceVersion?: string | null;
	/** Statutory default only. */
	defaultKey?: string | null;
	note?: string | null;
	/** The active version starting the same day that this one replaces, if any. */
	replacesVersionId?: string | null;
}

export interface MileagePolicyVersionInput {
	effectiveFrom: string;
	currency: string;
	ratesPerKm: Partial<Record<MileageVehicle, string>>;
	source:
		| { kind: "organization"; reference: string | null; version: string | null; defaultKey: null }
		| { kind: "statutory_default"; reference: string; version: string; defaultKey: string };
	note: string | null;
	replacesVersionId: string | null;
}

export type MileagePolicyInputError =
	| "invalid_date"
	| "before_default_validity"
	| "invalid_currency"
	| "invalid_rate"
	| "rate_required"
	| "unknown_default"
	| "too_long";

export type MileagePolicyInputErrors = Partial<
	Record<
		| "effectiveFrom"
		| "currency"
		| MileageVehicle
		| "rates"
		| "sourceReference"
		| "sourceVersion"
		| "defaultKey"
		| "note",
		MileagePolicyInputError
	>
>;

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

export function parseMileagePolicyVersionInput(
	input: MileagePolicyVersionFormInput,
):
	| { ok: true; input: MileagePolicyVersionInput }
	| { ok: false; errors: MileagePolicyInputErrors } {
	const errors: MileagePolicyInputErrors = {};

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
		const entry = findStatutoryMileageDefault(blankToNull(input.defaultKey) ?? "");
		if (!entry) errors.defaultKey = "unknown_default";
		else if (effectiveFrom && !canAdoptStatutoryDefaultFrom(entry, effectiveFrom)) {
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
				ratesPerKm: { ...entry.ratesPerKm },
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

	const ratesPerKm: Partial<Record<MileageVehicle, string>> = {};
	for (const vehicle of MILEAGE_VEHICLES) {
		const entered = blankToNull(input.ratesPerKm?.[vehicle]);
		if (!entered) continue;
		const rate = parseMileageRate(entered);
		if (rate === null) errors[vehicle] = "invalid_rate";
		else ratesPerKm[vehicle] = rate;
	}
	if (Object.keys(ratesPerKm).length === 0 && !MILEAGE_VEHICLES.some((v) => errors[v])) {
		errors.rates = "rate_required";
	}

	const reference = boundedText(input.sourceReference, MAX_POLICY_SOURCE_LENGTH);
	if ("error" in reference) errors.sourceReference = reference.error;
	const version = boundedText(input.sourceVersion, MAX_POLICY_SOURCE_LENGTH);
	if ("error" in version) errors.sourceVersion = version.error;

	if (
		Object.keys(errors).length > 0 ||
		!effectiveFrom ||
		!currency ||
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
			ratesPerKm,
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
