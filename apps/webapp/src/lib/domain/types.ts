import type { AuthConfig, CustomQuote } from "@/db/schema";

// Re-export AuthConfig for consumers of this module
export type { AuthConfig };

/**
 * Domain configuration for custom domain routing
 */
export interface DomainConfig {
	organizationId: string;
	domain: string;
	domainVerified: boolean;
	authConfig: AuthConfig;
	isPrimary: boolean;
}

/**
 * Organization branding for login page customization
 */
export interface OrganizationBranding {
	logoUrl: string | null;
	backgroundImageUrl: string | null;
	appName: string | null;
	primaryColor: string | null;
	accentColor: string | null;
	quotesEnabled: boolean;
	customQuotes: CustomQuote[] | null;
}

/**
 * Combined domain context for auth pages
 */
export interface DomainAuthContext {
	organizationId: string;
	domain: string;
	authConfig: AuthConfig;
	branding: OrganizationBranding | null;
}

/**
 * Default auth configuration when no custom domain is configured
 */
export const DEFAULT_AUTH_CONFIG: AuthConfig = {
	emailPasswordEnabled: true,
	socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
	ssoEnabled: false,
	passkeyEnabled: true,
};

/**
 * Default branding when no custom branding is configured
 */
export const DEFAULT_BRANDING: OrganizationBranding = {
	logoUrl: null,
	backgroundImageUrl: null,
	appName: null,
	primaryColor: null,
	accentColor: null,
	quotesEnabled: true,
	customQuotes: null,
};
