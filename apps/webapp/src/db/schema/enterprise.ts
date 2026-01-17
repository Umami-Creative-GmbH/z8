import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization } from "../auth-schema";
import type { AuthConfig } from "./types";

// ============================================
// ENTERPRISE: CUSTOM DOMAINS
// ============================================

// Custom domain configuration per organization
export const organizationDomain = pgTable(
	"organization_domain",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Custom domain configuration
		domain: text("domain").notNull().unique(), // e.g., "login.acme.com"
		domainVerified: boolean("domain_verified").default(false).notNull(),
		verificationToken: text("verification_token"),
		verificationTokenExpiresAt: timestamp("verification_token_expires_at"),

		// Auth method configuration for this domain (JSON)
		authConfig: text("auth_config")
			.$type<AuthConfig>()
			.default(
				sql`'{"emailPasswordEnabled":true,"socialProvidersEnabled":[],"ssoEnabled":false,"passkeyEnabled":true}'`,
			),

		isPrimary: boolean("is_primary").default(false).notNull(), // Primary domain for org

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("organizationDomain_organizationId_idx").on(table.organizationId),
		index("organizationDomain_domain_idx").on(table.domain),
		index("organizationDomain_domainVerified_idx").on(table.domainVerified),
		// Enforce only one domain per organization
		uniqueIndex("organizationDomain_org_single_idx").on(table.organizationId),
	],
);

// ============================================
// ENTERPRISE: ORGANIZATION BRANDING
// ============================================

// Custom branding for organization login pages
export const organizationBranding = pgTable(
	"organization_branding",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Login page branding
		logoUrl: text("logo_url"),
		backgroundImageUrl: text("background_image_url"),
		appName: text("app_name"), // Override "z8" branding

		// Theme customization
		primaryColor: text("primary_color"), // e.g., "#3b82f6" or "oklch(0.6 0.2 250)"
		accentColor: text("accent_color"), // Optional secondary color

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [index("organizationBranding_organizationId_idx").on(table.organizationId)],
);
