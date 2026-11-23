import type { ContractorTermsRefusal } from "@/lib/contractor-compensation/refusal";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";

/**
 * How every refusal of the contractor compensation actions (#1998) reads, by
 * the `refusal` code the server sends; the server sends no wording of its own.
 * The terms form words its fields' errors from the same texts.
 */
export const CONTRACTOR_COMPENSATION_REFUSALS = {
	invalid_date: ["settings.contracts.contractors.errors.invalidDate", "Choose a valid date."],
	not_contractor: [
		"settings.contracts.contractors.errors.notContractor",
		"Contractor terms need an active External Contractor engagement.",
	],
	before_engagement: [
		"settings.contracts.contractors.errors.beforeEngagement",
		"Terms cannot start before the engagement started.",
	],
	invalid_basis: ["settings.contracts.contractors.errors.invalidBasis", "Choose hourly or daily."],
	invalid_currency: [
		"settings.contracts.contractors.errors.invalidCurrency",
		"Enter an ISO 4217 currency code, such as EUR.",
	],
	invalid_rate: ["settings.contracts.contractors.errors.invalidRate", "Enter a rate."],
	rate_not_positive: [
		"settings.contracts.contractors.errors.rateNotPositive",
		"Enter a rate above zero.",
	],
	rate_too_large: [
		"settings.contracts.contractors.errors.rateTooLarge",
		"Enter a rate below one million.",
	],
	rate_too_precise: [
		"settings.contracts.contractors.errors.rateTooPrecise",
		"The rate has more decimals than the currency allows.",
	],
	invalid_day_unit_rule: [
		"settings.contracts.contractors.errors.invalidDayUnitRule",
		"Choose how worked days are counted.",
	],
	invalid_half_day_threshold: [
		"settings.contracts.contractors.errors.invalidHalfDayThreshold",
		"Enter a half-day threshold from 1 to 1440 minutes.",
	],
	invalid_standard_day: [
		"settings.contracts.contractors.errors.invalidStandardDay",
		"Enter a standard day from 1 to 1440 minutes.",
	],
	NotFoundError: [
		"settings.contracts.contractors.errors.notFound",
		"This person was not found in your organization.",
	],
} satisfies RefusalMessages<
	Exclude<ContractorTermsRefusal, "employee_not_found"> | "NotFoundError"
>;
