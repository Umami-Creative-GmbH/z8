import { createLogger } from "@/lib/logger";
import type { OAuthCredentials, OAuthProviderImpl, OAuthTokens, OAuthUserInfo } from "../types";

const logger = createLogger("SocialOAuth:GitHub");

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

export const githubProvider: OAuthProviderImpl = {
	getAuthorizationUrl({ credentials, redirectUri, state }) {
		// GitHub doesn't support PKCE natively, but we still use state for CSRF protection
		const params = new URLSearchParams({
			client_id: credentials.clientId,
			redirect_uri: redirectUri,
			scope: "read:user user:email",
			state,
			allow_signup: "true",
		});

		return `${GITHUB_AUTH_URL}?${params.toString()}`;
	},

	async exchangeCode({ credentials, code, redirectUri }) {
		const response = await fetch(GITHUB_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				client_id: credentials.clientId,
				client_secret: credentials.clientSecret,
				code,
				redirect_uri: redirectUri,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			logger.error({ status: response.status, error }, "Failed to exchange code for tokens");
			throw new Error(`Failed to exchange code: ${error}`);
		}

		const data = await response.json();

		if (data.error) {
			logger.error(
				{ error: data.error, description: data.error_description },
				"GitHub OAuth error",
			);
			throw new Error(data.error_description || data.error);
		}

		return {
			accessToken: data.access_token,
			tokenType: data.token_type || "bearer",
			scope: data.scope,
		} as OAuthTokens;
	},

	async getUserInfo(accessToken) {
		// Get user profile
		const userResponse = await fetch(GITHUB_USER_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});

		if (!userResponse.ok) {
			const error = await userResponse.text();
			logger.error({ status: userResponse.status, error }, "Failed to get user info");
			throw new Error(`Failed to get user info: ${error}`);
		}

		const userData = await userResponse.json();

		// Get user emails (primary email may be hidden)
		let email = userData.email;
		let emailVerified = false;

		if (!email) {
			const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			});

			if (emailsResponse.ok) {
				const emails = await emailsResponse.json();
				// Find primary verified email
				const primaryEmail = emails.find(
					(e: { primary: boolean; verified: boolean; email: string }) => e.primary && e.verified,
				);
				if (primaryEmail) {
					email = primaryEmail.email;
					emailVerified = primaryEmail.verified;
				} else {
					// Fall back to any verified email
					const verifiedEmail = emails.find(
						(e: { verified: boolean; email: string }) => e.verified,
					);
					if (verifiedEmail) {
						email = verifiedEmail.email;
						emailVerified = verifiedEmail.verified;
					}
				}
			}
		}

		if (!email) {
			throw new Error(
				"Unable to retrieve email from GitHub. Please ensure your email is public or verified.",
			);
		}

		return {
			providerUserId: String(userData.id),
			email,
			emailVerified,
			name: userData.name ?? userData.login ?? null,
			image: userData.avatar_url ?? null,
		} as OAuthUserInfo;
	},
};
