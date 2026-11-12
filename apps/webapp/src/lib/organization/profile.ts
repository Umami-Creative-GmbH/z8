import { countries } from "country-flag-icons";
import { z } from "zod";

export interface OrganizationProfile {
	legalCompanyName: string;
	addressLine1: string;
	addressLine2: string;
	postalCode: string;
	city: string;
	stateOrRegion: string;
	country: string;
	vatId: string;
}

export const EMPTY_ORGANIZATION_PROFILE: OrganizationProfile = {
	legalCompanyName: "",
	addressLine1: "",
	addressLine2: "",
	postalCode: "",
	city: "",
	stateOrRegion: "",
	country: "",
	vatId: "",
};

// Exclude regional flags; use country codes for persisted registered addresses.
export const PROFILE_COUNTRIES = countries.filter(
	(code) => /^[A-Z]{2}$/.test(code) && code !== "EU" && code !== "UN",
);
const countryCodes = new Set(PROFILE_COUNTRIES);
export type ProfileFieldError =
	| "invalidText"
	| "tooLong"
	| "invalidCountry"
	| "invalidVatId";
export type ProfileFieldErrors = Partial<
	Record<keyof OrganizationProfile, ProfileFieldError>
>;
export type ProfileSaveResult =
	| { ok: true; profile: OrganizationProfile }
	| { ok: false; fieldErrors: ProfileFieldErrors };

const textField = (max: number) =>
	z
		.string({ error: "invalidText" })
		.trim()
		.max(max, "tooLong")
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls before PostgreSQL and single-line address rendering.
		.regex(/^[^\u0000-\u001f\u007f]*$/, "invalidText");

/** A saved profile: every field optional, trimmed, codes upper-cased. Issue messages are ProfileFieldErrors. */
export const organizationProfileSchema = z.object({
	legalCompanyName: textField(300).default(""),
	addressLine1: textField(300).default(""),
	addressLine2: textField(300).default(""),
	postalCode: textField(32).default(""),
	city: textField(200).default(""),
	stateOrRegion: textField(200).default(""),
	country: textField(2)
		.toUpperCase()
		.refine(
			(value) => value === "" || countryCodes.has(value),
			"invalidCountry",
		)
		.default(""),
	vatId: textField(16)
		.toUpperCase()
		.refine(
			(value) => value === "" || /^[A-Z]{2}[A-Z0-9]{2,14}$/.test(value),
			"invalidVatId",
		)
		.default(""),
});

/** The same optional-field contract is used by the form and authenticated action. */
export function validateOrganizationProfile(input: unknown): ProfileSaveResult {
	const parsed = organizationProfileSchema.safeParse(input);
	if (parsed.success) return { ok: true, profile: parsed.data };
	const fieldErrors: ProfileFieldErrors = {};
	for (const issue of parsed.error.issues) {
		const field = issue.path[0];
		if (
			typeof field === "string" &&
			Object.hasOwn(EMPTY_ORGANIZATION_PROFILE, field)
		) {
			fieldErrors[field as keyof OrganizationProfile] ??=
				issue.message as ProfileFieldError;
		}
	}
	return { ok: false, fieldErrors };
}
