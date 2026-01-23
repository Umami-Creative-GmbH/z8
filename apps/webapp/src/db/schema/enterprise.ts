import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization } from "../auth-schema";
import type { AuthConfig, SocialOAuthProvider, SocialOAuthProviderConfig } from "./types";

// Email transport type for organizationEmailConfig
export type EmailTransportType = "resend" | "smtp";

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

// ============================================
// ENTERPRISE: ORGANIZATION EMAIL CONFIG
// ============================================

/**
 * Per-organization email configuration
 *
 * Allows organizations to use their own email provider (Resend or SMTP)
 * instead of the system default.
 *
 * SECURITY: Sensitive secrets (API keys, passwords) are stored in HashiCorp Vault,
 * NOT in this table. This table only stores non-secret configuration.
 *
 * Vault secret paths:
 * - Resend API key: secret/organizations/{orgId}/email/resend_api_key
 * - SMTP password: secret/organizations/{orgId}/email/smtp_password
 */
export const organizationEmailConfig = pgTable(
	"organization_email_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Transport type: "resend" or "smtp"
		transportType: text("transport_type").$type<EmailTransportType>().notNull(),

		// SMTP non-secret configuration (only used when transportType = "smtp")
		smtpHost: text("smtp_host"),
		smtpPort: integer("smtp_port"),
		smtpSecure: boolean("smtp_secure").default(true), // Use TLS
		smtpRequireTls: boolean("smtp_require_tls").default(true), // Require STARTTLS
		smtpUsername: text("smtp_username"),
		// NOTE: smtpPassword is stored in Vault at: secret/organizations/{orgId}/email/smtp_password

		// NOTE: resendApiKey is stored in Vault at: secret/organizations/{orgId}/email/resend_api_key

		// Email sender information
		fromEmail: text("from_email").notNull(), // e.g., "noreply@acme.com"
		fromName: text("from_name"), // e.g., "ACME Corp"

		// Status tracking
		isActive: boolean("is_active").default(true).notNull(),
		lastTestAt: timestamp("last_test_at"),
		lastTestSuccess: boolean("last_test_success"),
		lastTestError: text("last_test_error"),

		// Audit timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("organizationEmailConfig_organizationId_idx").on(table.organizationId),
		index("organizationEmailConfig_isActive_idx").on(table.isActive),
	],
);

// ============================================
// ENTERPRISE: ORGANIZATION SOCIAL OAUTH
// ============================================

/**
 * Per-organization social OAuth credentials
 *
 * Allows organizations to use their own OAuth app credentials for social login
 * (Google, GitHub, LinkedIn, Apple) on their custom domains, instead of using
 * global/shared credentials.
 *
 * SECURITY: Client secrets are stored in HashiCorp Vault, NOT in this table.
 *
 * Vault secret paths:
 * - Google: secret/organizations/{orgId}/social/google/client_secret
 * - GitHub: secret/organizations/{orgId}/social/github/client_secret
 * - LinkedIn: secret/organizations/{orgId}/social/linkedin/client_secret
 * - Apple: secret/organizations/{orgId}/social/apple/client_secret
 * - Apple private key: secret/organizations/{orgId}/social/apple/private_key
 */
export const organizationSocialOAuth = pgTable(
	"organization_social_oauth",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Provider type: google, github, linkedin, apple
		provider: text("provider").$type<SocialOAuthProvider>().notNull(),

		// OAuth client ID (public, safe to store in DB)
		clientId: text("client_id").notNull(),

		// Provider-specific configuration (e.g., Apple's teamId, keyId)
		// Client secrets are stored in Vault, not here
		providerConfig: text("provider_config").$type<SocialOAuthProviderConfig>(),

		// Enable/disable without deleting
		isActive: boolean("is_active").default(true).notNull(),

		// Status tracking for testing
		lastTestAt: timestamp("last_test_at"),
		lastTestSuccess: boolean("last_test_success"),
		lastTestError: text("last_test_error"),

		// Audit timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		// One config per provider per organization
		uniqueIndex("organizationSocialOAuth_org_provider_idx").on(
			table.organizationId,
			table.provider,
		),
		index("organizationSocialOAuth_organizationId_idx").on(table.organizationId),
		index("organizationSocialOAuth_isActive_idx").on(table.isActive),
	],
);
