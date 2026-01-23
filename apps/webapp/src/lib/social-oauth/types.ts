import type { SocialOAuthProvider, SocialOAuthProviderConfig } from "@/db/schema";

/**
 * OAuth state stored in a secure cookie during the OAuth flow
 */
export interface OAuthState {
	/** Organization ID for org-specific credentials */
	organizationId: string | null;
	/** Original callback URL to redirect after login */
	callbackURL: string;
	/** PKCE code verifier for enhanced security */
	codeVerifier: string;
	/** Nonce for OIDC providers */
	nonce: string;
	/** Timestamp for expiration checking */
	createdAt: number;
	/** HMAC signature for tamper detection */
	signature: string;
}

/**
 * Credentials for an OAuth provider
 */
export interface OAuthCredentials {
	clientId: string;
	clientSecret: string;
	/** Additional config for Apple */
	providerConfig?: SocialOAuthProviderConfig;
}

/**
 * Result of exchanging an authorization code for tokens
 */
export interface OAuthTokens {
	accessToken: string;
	refreshToken?: string;
	idToken?: string;
	tokenType: string;
	expiresIn?: number;
	scope?: string;
}

/**
 * User info retrieved from OAuth provider
 */
export interface OAuthUserInfo {
	/** Provider-specific user ID */
	providerUserId: string;
	/** User's email address */
	email: string;
	/** Whether the email is verified */
	emailVerified: boolean;
	/** User's display name */
	name: string | null;
	/** User's profile image URL */
	image: string | null;
}

/**
 * Provider-specific OAuth implementation
 */
export interface OAuthProviderImpl {
	/** Get the authorization URL for this provider */
	getAuthorizationUrl(params: {
		credentials: OAuthCredentials;
		redirectUri: string;
		state: string;
		codeChallenge: string;
		nonce?: string;
	}): string;

	/** Exchange authorization code for tokens */
	exchangeCode(params: {
		credentials: OAuthCredentials;
		code: string;
		redirectUri: string;
		codeVerifier: string;
	}): Promise<OAuthTokens>;

	/** Get user info from provider */
	getUserInfo(accessToken: string, idToken?: string): Promise<OAuthUserInfo>;
}

/**
 * Configuration for an organization's social OAuth
 */
export interface OrgSocialOAuthConfig {
	id: string;
	organizationId: string;
	provider: SocialOAuthProvider;
	clientId: string;
	providerConfig: SocialOAuthProviderConfig | null;
	isActive: boolean;
	lastTestAt: Date | null;
	lastTestSuccess: boolean | null;
	lastTestError: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Input for creating a new social OAuth config
 */
export interface CreateSocialOAuthInput {
	organizationId: string;
	provider: SocialOAuthProvider;
	clientId: string;
	clientSecret: string;
	providerConfig?: SocialOAuthProviderConfig;
}

/**
 * Input for updating a social OAuth config
 */
export interface UpdateSocialOAuthInput {
	clientId?: string;
	clientSecret?: string;
	providerConfig?: SocialOAuthProviderConfig;
	isActive?: boolean;
}

/**
 * Result of testing an OAuth configuration
 */
export interface TestOAuthResult {
	success: boolean;
	error?: string;
}
