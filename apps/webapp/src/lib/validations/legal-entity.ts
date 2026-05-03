import { z } from "zod";

const optionalTrimmedString = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z.string().trim().optional(),
);

const optionalCountryCode = z.preprocess(
	(value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
	z.string().trim().length(2, "Use a two-letter country code").optional(),
);

export const legalEntityFormSchema = z.object({
	name: z.string().trim().min(1, "Name is required"),
	legalName: optionalTrimmedString,
	registrationNumber: optionalTrimmedString,
	taxId: optionalTrimmedString,
	countryCode: optionalCountryCode,
	street: optionalTrimmedString,
	city: optionalTrimmedString,
	postalCode: optionalTrimmedString,
	country: optionalTrimmedString,
	defaultCurrency: z.string().trim().length(3, "Use a three-letter currency code"),
	timezone: z.string().trim().min(1, "Timezone is required"),
	isActive: z.boolean(),
});

export type LegalEntityFormValues = z.infer<typeof legalEntityFormSchema>;
