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

/** Configs saved before #1885 have no registration flag: registration stayed open. */
export function isRegistrationEnabled(
	config: Pick<AuthConfig, "registrationEnabled"> | null | undefined,
): boolean {
	return config?.registrationEnabled !== false;
}

/**
 * Social providers a host offers: the ones it lists that are configured. Without
 * a host config (no domain context) every configured provider is offered.
 */
export function filterOfferedSocialProviders<T extends { id: string }>(
	authConfig: Pick<AuthConfig, "socialProvidersEnabled"> | null | undefined,
	configuredProviders: T[],
): T[] {
	if (!authConfig) return configuredProviders;
	const offered = new Set(authConfig.socialProvidersEnabled);
	return configuredProviders.filter((provider) => offered.has(provider.id));
}

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
