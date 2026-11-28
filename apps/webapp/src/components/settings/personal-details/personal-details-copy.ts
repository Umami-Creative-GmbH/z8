import type { RefusalMessages, Translate } from "@/lib/organization-action/action-error-message";
import type {
	HealthInsuranceKind,
	HealthInsuranceRefusal,
} from "@/lib/organization/personal-details/health-insurance";
import type { PersonalDetailsRefusalCode } from "@/lib/organization/personal-details/types";
import type {
	BankAccountRefusal,
	ValidFromRefusal,
} from "@/lib/organization/personal-details/validation";

/** How a refused change or end of personal details is worded (#2069, #2070, #2071). */
export const PERSONAL_DETAILS_REFUSALS = {
	not_found: [
		"settings.personalDetails.refusals.notFound",
		"This employee's personal details are not available to you.",
	],
	not_allowed: [
		"settings.personalDetails.refusals.notAllowed",
		"You may see but not change this employee's personal details.",
	],
	own_details: [
		"settings.personalDetails.refusals.ownDetails",
		"You can't change your own personal details directly.",
	],
	nothing_to_end: [
		"settings.personalDetails.refusals.nothingToEnd",
		"Nothing is on file from that date, so there is nothing to end.",
	],
	external_contractor: [
		"settings.personalDetails.refusals.externalContractor",
		"External Contractors have no health insurance on file.",
	],
	invalid_input: [
		"settings.personalDetails.refusals.invalidInput",
		"Check the highlighted fields and try again.",
	],
} satisfies RefusalMessages<PersonalDetailsRefusalCode>;

/** The message for one refused field; one static `t()` call per key for the extractor. */
export function fieldRefusalMessage(
	t: Translate,
	code: BankAccountRefusal | HealthInsuranceRefusal | ValidFromRefusal,
): string {
	switch (code) {
		case "account_holder_required":
			return t(
				"settings.personalDetails.fields.accountHolderRequired",
				"Enter the account holder.",
			);
		case "account_holder_too_long":
			return t(
				"settings.personalDetails.fields.accountHolderTooLong",
				"The account holder can have at most 70 characters.",
			);
		case "iban_required":
			return t("settings.personalDetails.fields.ibanRequired", "Enter the IBAN.");
		case "iban_format":
			return t(
				"settings.personalDetails.fields.ibanFormat",
				"An IBAN starts with a two-letter country code and two check digits.",
			);
		case "iban_not_sepa":
			return t(
				"settings.personalDetails.fields.ibanNotSepa",
				"Only IBANs from SEPA countries are accepted.",
			);
		case "iban_length":
			return t(
				"settings.personalDetails.fields.ibanLength",
				"This IBAN has the wrong length for its country.",
			);
		case "iban_checksum":
			return t(
				"settings.personalDetails.fields.ibanChecksum",
				"This IBAN's check digits don't match. Check it for typos.",
			);
		case "bic_format":
			return t(
				"settings.personalDetails.fields.bicFormat",
				"A BIC has 8 or 11 letters and digits, such as COBADEFFXXX.",
			);
		case "kind_invalid":
			return t(
				"settings.personalDetails.fields.healthInsuranceKindInvalid",
				"Choose statutory or private.",
			);
		case "insurer_unknown":
			return t(
				"settings.personalDetails.fields.insurerUnknown",
				"This insurer is not on the list. Choose one from the list or type its name.",
			);
		case "insurer_removed":
			return t(
				"settings.personalDetails.fields.insurerRemoved",
				"This insurer has left the list, for example after a merger. Choose its successor or type the name.",
			);
		case "insurer_name_required":
			return t("settings.personalDetails.fields.insurerNameRequired", "Enter the insurer's name.");
		case "insurer_name_too_long":
			return t(
				"settings.personalDetails.fields.insurerNameTooLong",
				"The insurer's name can have at most 120 characters.",
			);
		case "valid_from_invalid":
			return t("settings.personalDetails.fields.validFromInvalid", "Enter a valid date.");
	}
}

/** The kind of health insurance, as a label. */
export function healthInsuranceKindLabel(t: Translate, kind: HealthInsuranceKind): string {
	return kind === "statutory"
		? t("settings.personalDetails.healthInsurance.statutory", "Statutory")
		: t("settings.personalDetails.healthInsurance.private", "Private");
}

/** An IBAN in groups of four, as banks print it. */
export function formatIban(iban: string): string {
	return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

/** A masked IBAN: only its last four characters. */
export function maskedIban(lastFour: string): string {
	return `•••• ${lastFour}`;
}
