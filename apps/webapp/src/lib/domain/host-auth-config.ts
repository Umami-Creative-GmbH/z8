import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { ssoProvider } from "@/db/auth-schema";
import { enterpriseIdentitySetup, organizationPlatformAuthConfig } from "@/db/schema";
import { type AuthConfig, DEFAULT_AUTH_CONFIG, isRegistrationEnabled } from "./types";

/**
 * Sign-in methods per host (#1885). A custom domain stores its config on its
 * `organization_domain` row; the canonical platform domain stores its own in
 * `organization_platform_auth_config`. The sign-in page and the auth server's
 * method guard read the same resolved config.
 */

/** Reads a stored config (a JSON string or an object) and fills fields older configs lack. */
export function parseStoredAuthConfig(raw: unknown): AuthConfig | null {
	let value: unknown = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const stored = value as Partial<AuthConfig>;
	return {
		...stored,
		emailPasswordEnabled: stored.emailPasswordEnabled ?? DEFAULT_AUTH_CONFIG.emailPasswordEnabled,
		socialProvidersEnabled: Array.isArray(stored.socialProvidersEnabled)
			? stored.socialProvidersEnabled.filter((id): id is string => typeof id === "string")
			: DEFAULT_AUTH_CONFIG.socialProvidersEnabled,
		ssoEnabled: stored.ssoEnabled ?? false,
		passkeyEnabled: stored.passkeyEnabled ?? DEFAULT_AUTH_CONFIG.passkeyEnabled,
		registrationEnabled: isRegistrationEnabled(stored),
	};
}

/**
 * The organization's SSO providers that can sign people in: owned by the
 * organization and domain-verified (the SSO plugin refuses unverified ones).
 * The enterprise identity setup's provider comes first.
 */
export async function listUsableSsoProviderIds(organizationId: string): Promise<string[]> {
	const [providers, setup] = await Promise.all([
		db
			.select({ providerId: ssoProvider.providerId })
			.from(ssoProvider)
			.where(
				and(eq(ssoProvider.organizationId, organizationId), eq(ssoProvider.domainVerified, true)),
			),
		db
			.select({ providerId: enterpriseIdentitySetup.providerId })
			.from(enterpriseIdentitySetup)
			.where(eq(enterpriseIdentitySetup.organizationId, organizationId))
			.limit(1),
	]);
	const ids = providers.map((provider) => provider.providerId).sort();
	const preferred = setup[0]?.providerId;
	return preferred && ids.includes(preferred)
		? [preferred, ...ids.filter((id) => id !== preferred)]
		: ids;
}

/**
 * Points SSO at a provider the organization can sign in with: the configured one
 * when it still qualifies, otherwise the first usable one. Without one, SSO is off,
 * so the page never shows a button that cannot work.
 */
export function withUsableSsoProvider(config: AuthConfig, usableProviderIds: string[]): AuthConfig {
	const ssoProviderId =
		config.ssoProviderId && usableProviderIds.includes(config.ssoProviderId)
			? config.ssoProviderId
			: usableProviderIds[0];
	if (!config.ssoEnabled || !ssoProviderId) {
		const withoutSso: AuthConfig = { ...config, ssoEnabled: false };
		delete withoutSso.ssoProviderId;
		return withoutSso;
	}
	return { ...config, ssoProviderId };
}

/** The canonical domain's defaults: every method open, SSO on once a provider is usable. */
export function defaultPlatformAuthConfig(): AuthConfig {
	return { ...DEFAULT_AUTH_CONFIG, ssoEnabled: true, registrationEnabled: true };
}

/** The canonical domain's config as stored, or its defaults. For settings. */
export async function getStoredPlatformAuthConfig(organizationId: string): Promise<AuthConfig> {
	const [row] = await db
		.select({ authConfig: organizationPlatformAuthConfig.authConfig })
		.from(organizationPlatformAuthConfig)
		.where(eq(organizationPlatformAuthConfig.organizationId, organizationId))
		.limit(1);
	return parseStoredAuthConfig(row?.authConfig) ?? defaultPlatformAuthConfig();
}

/** The canonical domain's config as the sign-in page and the auth server apply it. */
export async function getPlatformAuthConfig(organizationId: string): Promise<AuthConfig> {
	const [config, providerIds] = await Promise.all([
		getStoredPlatformAuthConfig(organizationId),
		listUsableSsoProviderIds(organizationId),
	]);
	return withUsableSsoProvider(config, providerIds);
}

export async function savePlatformAuthConfig(
	organizationId: string,
	config: AuthConfig,
): Promise<void> {
	await db
		.insert(organizationPlatformAuthConfig)
		.values({ organizationId, authConfig: config })
		.onConflictDoUpdate({
			target: organizationPlatformAuthConfig.organizationId,
			set: { authConfig: config, updatedAt: sql`now()` },
		});
}
