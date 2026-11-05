import {
	type OrganizationProfile,
	PROFILE_COUNTRIES,
} from "@/lib/organization/profile";

// Countries whose address format has no postal-code field in Google's
// libaddressinput RegionDataConstants (reviewed 2026-11-05):
// https://github.com/google/libaddressinput/blob/master/common/src/main/java/com/google/i18n/addressinput/common/RegionDataConstants.java
// Unknown/new country codes conservatively require a postal code.
const countriesWithoutPostalCode = new Set(
	"AE AG AO AQ AW BF BI BJ BO BQ BS BV BW BZ CD CF CG CI CK CM CW DJ DM ER FJ GA GD GH GM GQ GY HK JM KI KM KN LC LY ML MO MR MS MW NR NU PA PS QA RW SB SC SL SR SS ST SX SY TD TF TG TK TL TO TV UG VU WS YE ZW".split(
		" ",
	),
);

/** Explicit applicability for every country offered by the profile editor. */
export const AVV_POSTAL_CODE_REQUIRED_BY_COUNTRY: Readonly<
	Record<string, boolean>
> = Object.fromEntries(
	PROFILE_COUNTRIES.map((country) => [
		country,
		!countriesWithoutPostalCode.has(country),
	]),
);

export type AvvRequiredField =
	| "legalCompanyName"
	| "addressLine1"
	| "city"
	| "country"
	| "postalCode";

/** Partial profiles remain saveable; this rule only gates AVV consumption. */
export function getAvvMissingFields(
	profile: OrganizationProfile,
): AvvRequiredField[] {
	const country = profile.country.trim().toUpperCase();
	const fields: AvvRequiredField[] = [
		"legalCompanyName",
		"addressLine1",
		"city",
		"country",
	];
	if (country && AVV_POSTAL_CODE_REQUIRED_BY_COUNTRY[country] !== false)
		fields.push("postalCode");
	return fields.filter((field) => !profile[field].trim());
}

/** Shared presentation order; optional blank rows are omitted in UI and PDF. */
export function getRegisteredAddressLines(
	profile: OrganizationProfile,
): { field: keyof OrganizationProfile; value: string }[] {
	return [
		{ field: "addressLine1" as const, value: profile.addressLine1.trim() },
		{ field: "addressLine2" as const, value: profile.addressLine2.trim() },
		{
			field: "city" as const,
			value: [profile.postalCode.trim(), profile.city.trim()]
				.filter(Boolean)
				.join(" "),
		},
		{ field: "stateOrRegion" as const, value: profile.stateOrRegion.trim() },
		{ field: "country" as const, value: profile.country.trim() },
	].filter(({ value }) => value);
}
