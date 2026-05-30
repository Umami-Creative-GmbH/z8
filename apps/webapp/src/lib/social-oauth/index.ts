// Types

// Provider-specific exports
export { parseAppleFormPost } from "./providers/apple";

// Service functions
export {
	// OAuth flow
	buildAuthorizationUrl,
	// State management
	createOAuthState,
	createSocialOAuthConfig,
	deleteSocialOAuthConfig,
	exchangeCode,
	generateCodeChallenge,
	// PKCE utilities
	generateCodeVerifier,
	generateNonce,
	getConfiguredProviders,
	// Credential resolution
	getOrgSocialOAuthConfig,
	getUserInfo,
	// Admin operations
	listOrgSocialOAuthConfigs,
	resolveCredentials,
	STATE_COOKIE_MAX_AGE,
	STATE_COOKIE_NAME,
	updateSocialOAuthConfig,
	updateTestStatus,
	verifyOAuthState,
} from "./service";
export type {
	CreateSocialOAuthInput,
	OAuthCredentials,
	OAuthProviderImpl,
	OAuthState,
	OAuthTokens,
	OAuthUserInfo,
	OrgSocialOAuthConfig,
	TestOAuthResult,
	UpdateSocialOAuthInput,
} from "./types";
