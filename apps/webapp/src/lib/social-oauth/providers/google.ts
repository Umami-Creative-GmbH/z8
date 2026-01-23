import { createLogger } from "@/lib/logger";
import type { OAuthCredentials, OAuthProviderImpl, OAuthTokens, OAuthUserInfo } from "../types";

const logger = createLogger("SocialOAuth:Google");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const googleProvider: OAuthProviderImpl = {
	getAuthorizationUrl({ credentials, redirectUri, state, codeChallenge, nonce }) {
		const params = new URLSearchParams({
			client_id: credentials.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "openid email profile",
			state,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			nonce: nonce || "",
			access_type: "offline", // Get refresh token
			prompt: "consent", // Force consent to get refresh token
		});

		return `${GOOGLE_AUTH_URL}?${params.toString()}`;
	},

	async exchangeCode({ credentials, code, redirectUri, codeVerifier }) {
		const response = await fetch(GOOGLE_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret,
				code,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
				code_verifier: codeVerifier,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			logger.error({ status: response.status, error }, "Failed to exchange code for tokens");
			throw new Error(`Failed to exchange code: ${error}`);
		}

		const data = await response.json();

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			idToken: data.id_token,
			tokenType: data.token_type,
			expiresIn: data.expires_in,
			scope: data.scope,
		} as OAuthTokens;
	},

	async getUserInfo(accessToken, idToken) {
		// First try to parse the ID token if available
		if (idToken) {
			try {
				const [, payloadBase64] = idToken.split(".");
				const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString());
				return {
					providerUserId: payload.sub,
					email: payload.email,
					emailVerified: payload.email_verified ?? false,
					name: payload.name ?? null,
					image: payload.picture ?? null,
				};
			} catch (error) {
				logger.warn({ error }, "Failed to parse ID token, falling back to userinfo endpoint");
			}
		}

		// Fall back to userinfo endpoint
		const response = await fetch(GOOGLE_USERINFO_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			const error = await response.text();
			logger.error({ status: response.status, error }, "Failed to get user info");
			throw new Error(`Failed to get user info: ${error}`);
		}

		const data = await response.json();

		return {
			providerUserId: data.sub,
			email: data.email,
			emailVerified: data.email_verified ?? false,
			name: data.name ?? null,
			image: data.picture ?? null,
		} as OAuthUserInfo;
	},
};
