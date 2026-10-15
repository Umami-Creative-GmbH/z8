import { z } from "zod";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";

export const organizationSchema = z.object({
	timezone: z
		.string()
		.refine(isValidIanaTimeZone, "Choose a valid organization timezone")
		.optional(),
	trackingStartDate: z.union([z.iso.date(), z.literal("")]).optional(),
	name: z
		.string()
		.min(2, "Organization name must be at least 2 characters")
		.max(100, "Organization name must be less than 100 characters"),
	slug: z
		.string()
		.min(2, "Slug must be at least 2 characters")
		.max(50, "Slug must be less than 50 characters")
		.regex(
			/^[a-z0-9-]+$/,
			"Slug must contain only lowercase letters, numbers, and hyphens",
		)
		.refine((slug) => !slug.startsWith("-") && !slug.endsWith("-"), {
			message: "Slug cannot start or end with a hyphen",
		}),
});

export type OrganizationFormValues = z.infer<typeof organizationSchema>;

/**
 * Generate a URL-safe slug from an organization name
 * Converts to lowercase, replaces spaces/special chars with hyphens
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
		.replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}
