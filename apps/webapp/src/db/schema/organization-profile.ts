import { pgTable, text } from "drizzle-orm/pg-core";
import { organization } from "../auth-schema";

// Legal identity only. Operational geography and subscription billing stay separate.
export const organizationProfile = pgTable("organization_profile", {
	organizationId: text("organization_id")
		.primaryKey()
		.references(() => organization.id, { onDelete: "cascade" }),
	legalCompanyName: text("legal_company_name").notNull().default(""),
	addressLine1: text("address_line_1").notNull().default(""),
	addressLine2: text("address_line_2").notNull().default(""),
	postalCode: text("postal_code").notNull().default(""),
	city: text("city").notNull().default(""),
	stateOrRegion: text("state_or_region").notNull().default(""),
	country: text("country").notNull().default(""),
	vatId: text("vat_id").notNull().default(""),
});
