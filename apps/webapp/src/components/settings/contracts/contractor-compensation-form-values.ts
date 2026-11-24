import {
	type CompensationBasis,
	type ContractorCompensationInput,
	type ContractorCompensationRefusal,
	type ContractorCompensationView,
	DEFAULT_CONTRACTOR_CURRENCY,
	DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
	DEFAULT_STANDARD_DAY_MINUTES,
	type DayUnitRuleKind,
	parseContractorCompensation,
} from "@/lib/contractor-compensation/terms";
import type { Translate } from "@/lib/organization-action/action-error-message";
import { CONTRACTOR_COMPENSATION_REFUSALS } from "./contractor-compensation-refusals";

/**
 * Contractor compensation as a form holds it (#1998): the values, their
 * parsing and wording, and the day-unit rule options. Shared by the
 * compensation card's terms form and the External Contractor invitation.
 */

/** Compensation as a form holds it: minutes as entered text. */
export interface CompensationFormValues {
	basis: CompensationBasis;
	rateAmount: string;
	currency: string;
	dayUnitRule: DayUnitRuleKind;
	halfDayThresholdMinutes: string;
	standardDayMinutes: string;
	capAtOneDay: boolean;
}

/** New compensation values, prefilled from `current` terms when there are any. */
export function defaultCompensationValues(
	current?: ContractorCompensationView | null,
): CompensationFormValues {
	return {
		basis: current?.compensationBasis ?? "daily",
		rateAmount: "",
		currency: current?.currency ?? DEFAULT_CONTRACTOR_CURRENCY,
		dayUnitRule: current?.dayUnitRule ?? "any_work_full_day",
		halfDayThresholdMinutes: String(
			current?.halfDayThresholdMinutes ?? DEFAULT_HALF_DAY_THRESHOLD_MINUTES,
		),
		standardDayMinutes: String(current?.standardDayMinutes ?? DEFAULT_STANDARD_DAY_MINUTES),
		capAtOneDay: current?.capAtOneDay ?? true,
	};
}

/** What the server receives: only the settings the chosen basis and rule use. */
export function compensationInputOf(value: CompensationFormValues): ContractorCompensationInput {
	const daily = value.basis === "daily";
	return {
		basis: value.basis,
		rateAmount: value.rateAmount,
		currency: value.currency,
		dayUnitRule: daily ? value.dayUnitRule : null,
		halfDayThresholdMinutes:
			daily && value.dayUnitRule === "half_and_full_day"
				? Number(value.halfDayThresholdMinutes)
				: null,
		standardDayMinutes:
			daily && value.dayUnitRule === "prorated_by_standard_day"
				? Number(value.standardDayMinutes)
				: null,
		capAtOneDay:
			daily && value.dayUnitRule === "prorated_by_standard_day" ? value.capAtOneDay : null,
	};
}

/**
 * The refusal of the whole entry, worded for a field when it is one of
 * `reasons` (the refusals that field causes); the server parses the same way.
 */
export function compensationFieldError(
	t: Translate,
	value: CompensationFormValues,
	reasons: readonly ContractorCompensationRefusal[],
): string | undefined {
	const parsed = parseContractorCompensation(compensationInputOf(value));
	if (parsed.ok || !reasons.includes(parsed.reason)) return undefined;
	const [key, fallback] = CONTRACTOR_COMPENSATION_REFUSALS[parsed.reason];
	return t(key, fallback);
}

/** Which field each refusal of the entry belongs to. */
export const COMPENSATION_FIELD_REFUSALS = {
	currency: ["invalid_currency"],
	rateAmount: ["invalid_rate", "rate_not_positive", "rate_too_large", "rate_too_precise"],
	halfDayThresholdMinutes: ["invalid_half_day_threshold"],
	standardDayMinutes: ["invalid_standard_day"],
} as const satisfies Record<string, readonly ContractorCompensationRefusal[]>;

export const DAY_UNIT_RULE_OPTIONS: {
	value: DayUnitRuleKind;
	labelKey: string;
	label: string;
	hintKey: string;
	hint: string;
}[] = [
	{
		value: "any_work_full_day",
		labelKey: "settings.contracts.contractors.rules.anyWorkFullDay",
		label: "Any work is a full day",
		hintKey: "settings.contracts.contractors.rules.anyWorkFullDayHint",
		hint: "A local day with any completed work counts as 1.0 day.",
	},
	{
		value: "half_and_full_day",
		labelKey: "settings.contracts.contractors.rules.halfAndFullDay",
		label: "Half and full days",
		hintKey: "settings.contracts.contractors.rules.halfAndFullDayHint",
		hint: "Up to and including the threshold counts as 0.5 day, more as 1.0 day.",
	},
	{
		value: "prorated_by_standard_day",
		labelKey: "settings.contracts.contractors.rules.proratedByStandardDay",
		label: "Prorated by a standard day",
		hintKey: "settings.contracts.contractors.rules.proratedByStandardDayHint",
		hint: "Worked minutes divided by the standard day, optionally at most 1.0 day.",
	},
];
