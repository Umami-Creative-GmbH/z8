// Types
export type {
	OAuthState,
	OAuthCredentials,
	OAuthTokens,
	OAuthUserInfo,
	OAuthProviderImpl,
	OrgSocialOAuthConfig,
	CreateSocialOAuthInput,
	UpdateSocialOAuthInput,
	TestOAuthResult,
} from "./types";

// Service functions
export {
	// PKCE utilities
	generateCodeVerifier,
	generateCodeChallenge,
	generateNonce,
	// State management
	createOAuthState,
	verifyOAuthState,
	STATE_COOKIE_NAME,
	STATE_COOKIE_MAX_AGE,
	// Credential resolution
	getOrgSocialOAuthConfig,
	resolveCredentials,
	// OAuth flow
	buildAuthorizationUrl,
	exchangeCode,
	getUserInfo,
	// Admin operations
	listOrgSocialOAuthConfigs,
	createSocialOAuthConfig,
	updateSocialOAuthConfig,
	deleteSocialOAuthConfig,
	updateTestStatus,
	getConfiguredProviders,
} from "./service";

// Provider-specific exports
export { parseAppleFormPost } from "./providers/apple";
