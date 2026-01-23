import { createLogger } from "@/lib/logger";
import type { OAuthCredentials, OAuthProviderImpl, OAuthTokens, OAuthUserInfo } from "../types";

const logger = createLogger("SocialOAuth:LinkedIn");

// LinkedIn uses OpenID Connect
const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";

export const linkedinProvider: OAuthProviderImpl = {
	getAuthorizationUrl({ credentials, redirectUri, state, nonce }) {
		const params = new URLSearchParams({
			client_id: credentials.clientId,
			redirect_uri: redirectUri,
			response_type: "code",
			scope: "openid profile email",
			state,
		});

		if (nonce) {
			params.set("nonce", nonce);
		}

		return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
	},

	async exchangeCode({ credentials, code, redirectUri }) {
		const response = await fetch(LINKEDIN_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret,
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
			idToken: data.id_token,
			tokenType: data.token_type || "Bearer",
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
		const response = await fetch(LINKEDIN_USERINFO_URL, {
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
