import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	organizationSocialOAuth,
	type SocialOAuthProvider,
	type SocialOAuthProviderConfig,
} from "@/db/schema";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { deleteOrgSecret, getOrgSecret, storeOrgSecret } from "@/lib/vault/secrets";
import { appleProvider } from "./providers/apple";
import { githubProvider } from "./providers/github";
import { googleProvider } from "./providers/google";
import { linkedinProvider } from "./providers/linkedin";
import type {
	CreateSocialOAuthInput,
	OAuthCredentials,
	OAuthProviderImpl,
	OAuthState,
	OAuthTokens,
	OAuthUserInfo,
	OrgSocialOAuthConfig,
	UpdateSocialOAuthInput,
} from "./types";

const logger = createLogger("SocialOAuthService");

// State cookie settings
export const STATE_COOKIE_NAME = "z8_social_oauth_state";
export const STATE_COOKIE_MAX_AGE = 600; // 10 minutes
const STATE_SECRET = env.BETTER_AUTH_SECRET;

// Provider implementations
const providers: Record<SocialOAuthProvider, OAuthProviderImpl> = {
	google: googleProvider,
	github: githubProvider,
	linkedin: linkedinProvider,
	apple: appleProvider,
};

// Vault secret paths
function getSecretPath(provider: SocialOAuthProvider): string {
	return `social/${provider}/client_secret`;
}

function getApplePrivateKeyPath(): string {
	return "social/apple/private_key";
}

/**
 * Parse provider config from DB (may be JSON string or object)
 */
function parseProviderConfig(
	config: SocialOAuthProviderConfig | string | null,
): SocialOAuthProviderConfig | null {
	if (!config) return null;
	if (typeof config === "string") {
		try {
			return JSON.parse(config) as SocialOAuthProviderConfig;
		} catch {
			return null;
		}
	}
	return config;
}

// ==============================================
// PKCE Utilities
// ==============================================

/**
 * Generate a cryptographically random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
	return crypto.randomBytes(32).toString("base64url");
}

/**
 * Generate code challenge from verifier (S256 method)
 */
export function generateCodeChallenge(verifier: string): string {
	const hash = crypto.createHash("sha256").update(verifier).digest();
	return hash.toString("base64url");
}

/**
 * Generate a random nonce for OIDC
 */
export function generateNonce(): string {
	return crypto.randomBytes(16).toString("base64url");
}

// ==============================================
// State Management
// ==============================================

/**
 * Create a signed OAuth state object
 */
export function createOAuthState(params: {
	organizationId: string | null;
	callbackURL: string;
	codeVerifier: string;
	nonce: string;
}): OAuthState {
	const createdAt = Date.now();
	const dataToSign = JSON.stringify({
		organizationId: params.organizationId,
		callbackURL: params.callbackURL,
		codeVerifier: params.codeVerifier,
		nonce: params.nonce,
		createdAt,
	});

	const signature = crypto
		.createHmac("sha256", STATE_SECRET)
		.update(dataToSign)
		.digest("base64url");

	return {
		organizationId: params.organizationId,
		callbackURL: params.callbackURL,
		codeVerifier: params.codeVerifier,
		nonce: params.nonce,
		createdAt,
		signature,
	};
}

/**
 * Verify and parse an OAuth state object
 */
export function verifyOAuthState(stateJson: string): OAuthState | null {
	try {
		const state: OAuthState = JSON.parse(stateJson);

		// Check expiration (10 minutes)
		if (Date.now() - state.createdAt > STATE_COOKIE_MAX_AGE * 1000) {
			logger.warn("OAuth state expired");
			return null;
		}

		// Verify signature
		const dataToSign = JSON.stringify({
			organizationId: state.organizationId,
			callbackURL: state.callbackURL,
			codeVerifier: state.codeVerifier,
			nonce: state.nonce,
			createdAt: state.createdAt,
		});

		const expectedSignature = crypto
			.createHmac("sha256", STATE_SECRET)
			.update(dataToSign)
			.digest("base64url");

		if (state.signature !== expectedSignature) {
			logger.warn("OAuth state signature mismatch");
			return null;
		}

		return state;
	} catch (error) {
		logger.error({ error }, "Failed to parse OAuth state");
		return null;
	}
}

// ==============================================
// Credential Resolution
// ==============================================

/**
 * Get organization-specific social OAuth config
 */
export async function getOrgSocialOAuthConfig(
	organizationId: string,
	provider: SocialOAuthProvider,
): Promise<OrgSocialOAuthConfig | null> {
	const config = await db.query.organizationSocialOAuth.findFirst({
		where: and(
			eq(organizationSocialOAuth.organizationId, organizationId),
			eq(organizationSocialOAuth.provider, provider),
			eq(organizationSocialOAuth.isActive, true),
		),
	});

	if (!config) return null;

	return {
		id: config.id,
		organizationId: config.organizationId,
		provider: config.provider,
		clientId: config.clientId,
		providerConfig: parseProviderConfig(config.providerConfig),
		isActive: config.isActive,
		lastTestAt: config.lastTestAt,
		lastTestSuccess: config.lastTestSuccess,
		lastTestError: config.lastTestError,
		createdAt: config.createdAt,
		updatedAt: config.updatedAt,
	};
}

/**
 * Get OAuth credentials for a provider
 * Checks for org-specific credentials first, then falls back to global
 */
export async function resolveCredentials(
	organizationId: string | null,
	provider: SocialOAuthProvider,
): Promise<{ credentials: OAuthCredentials; isOrgSpecific: boolean } | null> {
	// Try org-specific first
	if (organizationId) {
		const orgConfig = await getOrgSocialOAuthConfig(organizationId, provider);
		if (orgConfig) {
			const clientSecret = await getOrgSecret(organizationId, getSecretPath(provider));
			if (clientSecret) {
				// For Apple, also get the private key
				const providerConfig = orgConfig.providerConfig ?? undefined;
				if (provider === "apple") {
					const privateKey = await getOrgSecret(organizationId, getApplePrivateKeyPath());
					if (!privateKey) {
						logger.warn({ organizationId }, "Apple private key not found in Vault");
						// Fall through to global credentials
					} else {
						return {
							credentials: {
								clientId: orgConfig.clientId,
								clientSecret: privateKey, // For Apple, this is the private key
								providerConfig,
							},
							isOrgSpecific: true,
						};
					}
				} else {
					return {
						credentials: {
							clientId: orgConfig.clientId,
							clientSecret,
							providerConfig,
						},
						isOrgSpecific: true,
					};
				}
			}
		}
	}

	// Fall back to global credentials from environment
	const globalCredentials = getGlobalCredentials(provider);
	if (globalCredentials) {
		return {
			credentials: globalCredentials,
			isOrgSpecific: false,
		};
	}

	return null;
}

/**
 * Get global OAuth credentials from environment variables
 */
function getGlobalCredentials(provider: SocialOAuthProvider): OAuthCredentials | null {
	switch (provider) {
		case "google":
			if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
				return {
					clientId: env.GOOGLE_CLIENT_ID,
					clientSecret: env.GOOGLE_CLIENT_SECRET,
				};
			}
			break;
		case "github":
			if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
				return {
					clientId: env.GITHUB_CLIENT_ID,
					clientSecret: env.GITHUB_CLIENT_SECRET,
				};
			}
			break;
		case "linkedin":
			if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
				return {
					clientId: env.LINKEDIN_CLIENT_ID,
					clientSecret: env.LINKEDIN_CLIENT_SECRET,
				};
			}
			break;
		case "apple":
			// Apple requires additional config that's typically not in env vars for global
			// Organizations would need to configure this specifically
			break;
	}
	return null;
}

// ==============================================
// OAuth Flow
// ==============================================

/**
 * Build the authorization URL for a provider
 */
export function buildAuthorizationUrl(params: {
	provider: SocialOAuthProvider;
	credentials: OAuthCredentials;
	redirectUri: string;
	state: string;
	codeVerifier: string;
	nonce: string;
}): string {
	const { provider, credentials, redirectUri, state, codeVerifier, nonce } = params;
	const impl = providers[provider];

	const codeChallenge = generateCodeChallenge(codeVerifier);

	return impl.getAuthorizationUrl({
		credentials,
		redirectUri,
		state,
		codeChallenge,
		nonce,
	});
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(params: {
	provider: SocialOAuthProvider;
	credentials: OAuthCredentials;
	code: string;
	redirectUri: string;
	codeVerifier: string;
}): Promise<OAuthTokens> {
	const { provider, credentials, code, redirectUri, codeVerifier } = params;
	const impl = providers[provider];

	return impl.exchangeCode({
		credentials,
		code,
		redirectUri,
		codeVerifier,
	});
}

/**
 * Get user info from provider
 */
export async function getUserInfo(
	provider: SocialOAuthProvider,
	accessToken: string,
	idToken?: string,
): Promise<OAuthUserInfo> {
	const impl = providers[provider];
	return impl.getUserInfo(accessToken, idToken);
}

// ==============================================
// Admin Operations
// ==============================================

/**
 * List all social OAuth configs for an organization
 */
export async function listOrgSocialOAuthConfigs(
	organizationId: string,
): Promise<OrgSocialOAuthConfig[]> {
	const configs = await db.query.organizationSocialOAuth.findMany({
		where: eq(organizationSocialOAuth.organizationId, organizationId),
		orderBy: (config, { asc }) => [asc(config.provider)],
	});

	return configs.map((config) => ({
		id: config.id,
		organizationId: config.organizationId,
		provider: config.provider,
		clientId: config.clientId,
		providerConfig: parseProviderConfig(config.providerConfig),
		isActive: config.isActive,
		lastTestAt: config.lastTestAt,
		lastTestSuccess: config.lastTestSuccess,
		lastTestError: config.lastTestError,
		createdAt: config.createdAt,
		updatedAt: config.updatedAt,
	}));
}

/**
 * Create a new social OAuth config
 */
export async function createSocialOAuthConfig(
	input: CreateSocialOAuthInput,
): Promise<OrgSocialOAuthConfig> {
	const { organizationId, provider, clientId, clientSecret, providerConfig } = input;

	// Store client secret in Vault
	await storeOrgSecret(organizationId, getSecretPath(provider), clientSecret);

	// For Apple, also store the private key if provided
	if (provider === "apple" && providerConfig?.apple) {
		// The clientSecret for Apple is actually the private key
		// We've already stored it above, but we also need to store it at the private_key path
		await storeOrgSecret(organizationId, getApplePrivateKeyPath(), clientSecret);
	}

	// Create database record
	const [config] = await db
		.insert(organizationSocialOAuth)
		.values({
			organizationId,
			provider,
			clientId,
			providerConfig: providerConfig
				? (JSON.stringify(providerConfig) as unknown as SocialOAuthProviderConfig)
				: null,
			isActive: true,
		})
		.returning();

	return {
		id: config.id,
		organizationId: config.organizationId,
		provider: config.provider,
		clientId: config.clientId,
		providerConfig: parseProviderConfig(config.providerConfig),
		isActive: config.isActive,
		lastTestAt: config.lastTestAt,
		lastTestSuccess: config.lastTestSuccess,
		lastTestError: config.lastTestError,
		createdAt: config.createdAt,
		updatedAt: config.updatedAt,
	};
}

/**
 * Update a social OAuth config
 */
export async function updateSocialOAuthConfig(
	configId: string,
	input: UpdateSocialOAuthInput,
): Promise<OrgSocialOAuthConfig> {
	// Get existing config
	const existing = await db.query.organizationSocialOAuth.findFirst({
		where: eq(organizationSocialOAuth.id, configId),
	});

	if (!existing) {
		throw new Error("Social OAuth config not found");
	}

	// Update client secret in Vault if provided
	if (input.clientSecret) {
		await storeOrgSecret(
			existing.organizationId,
			getSecretPath(existing.provider),
			input.clientSecret,
		);

		// For Apple, also update the private key
		if (existing.provider === "apple") {
			await storeOrgSecret(existing.organizationId, getApplePrivateKeyPath(), input.clientSecret);
		}
	}

	// Update database record
	const [updated] = await db
		.update(organizationSocialOAuth)
		.set({
			clientId: input.clientId ?? existing.clientId,
			providerConfig: input.providerConfig
				? (JSON.stringify(input.providerConfig) as unknown as SocialOAuthProviderConfig)
				: existing.providerConfig,
			isActive: input.isActive ?? existing.isActive,
		})
		.where(eq(organizationSocialOAuth.id, configId))
		.returning();

	return {
		id: updated.id,
		organizationId: updated.organizationId,
		provider: updated.provider,
		clientId: updated.clientId,
		providerConfig: parseProviderConfig(updated.providerConfig),
		isActive: updated.isActive,
		lastTestAt: updated.lastTestAt,
		lastTestSuccess: updated.lastTestSuccess,
		lastTestError: updated.lastTestError,
		createdAt: updated.createdAt,
		updatedAt: updated.updatedAt,
	};
}

/**
 * Delete a social OAuth config
 */
export async function deleteSocialOAuthConfig(configId: string): Promise<void> {
	// Get existing config
	const existing = await db.query.organizationSocialOAuth.findFirst({
		where: eq(organizationSocialOAuth.id, configId),
	});

	if (!existing) {
		throw new Error("Social OAuth config not found");
	}

	// Delete secret from Vault
	await deleteOrgSecret(existing.organizationId, getSecretPath(existing.provider));

	// For Apple, also delete the private key
	if (existing.provider === "apple") {
		await deleteOrgSecret(existing.organizationId, getApplePrivateKeyPath());
	}

	// Delete database record
	await db.delete(organizationSocialOAuth).where(eq(organizationSocialOAuth.id, configId));
}

/**
 * Update test status for a social OAuth config
 */
export async function updateTestStatus(
	configId: string,
	success: boolean,
	error?: string,
): Promise<void> {
	await db
		.update(organizationSocialOAuth)
		.set({
			lastTestAt: new Date(),
			lastTestSuccess: success,
			lastTestError: success ? null : error || "Unknown error",
		})
		.where(eq(organizationSocialOAuth.id, configId));
}

/**
 * Check which providers have org-specific credentials configured
 */
export async function getConfiguredProviders(
	organizationId: string,
): Promise<Record<SocialOAuthProvider, boolean>> {
	const configs = await listOrgSocialOAuthConfigs(organizationId);
	const activeConfigs = configs.filter((c) => c.isActive);

	return {
		google: activeConfigs.some((c) => c.provider === "google"),
		github: activeConfigs.some((c) => c.provider === "github"),
		linkedin: activeConfigs.some((c) => c.provider === "linkedin"),
		apple: activeConfigs.some((c) => c.provider === "apple"),
	};
}
