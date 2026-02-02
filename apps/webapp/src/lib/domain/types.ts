import type { AuthConfig, SocialOAuthProvider } from "@/db/schema";

// Re-export AuthConfig for consumers of this module
export type { AuthConfig };

/**
 * Which social OAuth providers have org-specific credentials configured
 */
export type SocialOAuthConfigured = Record<SocialOAuthProvider, boolean>;

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
}

/**
 * Turnstile configuration for auth pages
 */
export interface TurnstileConfig {
	enabled: boolean;
	siteKey: string | null;
	/** True if using organization-specific keys (enterprise), false if using global */
	isEnterprise: boolean;
}

/**
 * Combined domain context for auth pages
 */
export interface DomainAuthContext {
	organizationId: string;
	domain: string;
	authConfig: AuthConfig;
	branding: OrganizationBranding | null;
	/** Which social OAuth providers have org-specific credentials */
	socialOAuthConfigured: SocialOAuthConfigured;
	/** Turnstile captcha configuration */
	turnstile: TurnstileConfig;
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
};
