import { createLogger } from "@/lib/logger";
import type { OAuthProviderImpl, OAuthTokens, OAuthUserInfo } from "../types";

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

		// The public profile does not include verification status. Always fetch the
		// authenticated email list before using an address for account linking.
		const emailsResponse = await fetch(GITHUB_EMAILS_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});
		if (!emailsResponse.ok) {
			throw new Error("Unable to retrieve verified email from GitHub");
		}

		const emails: { primary: boolean; verified: boolean; email: string }[] =
			await emailsResponse.json();
		const verifiedEmails = emails.filter((entry) => entry.verified === true && entry.email);
		const selectedEmail =
			verifiedEmails.find((entry) => entry.email === userData.email) ??
			verifiedEmails.find((entry) => entry.primary) ??
			verifiedEmails[0];
		if (!selectedEmail) {
			throw new Error("Unable to retrieve verified email from GitHub");
		}

		return {
			providerUserId: String(userData.id),
			email: selectedEmail.email,
			emailVerified: true,
			name: userData.name ?? userData.login ?? null,
			image: userData.avatar_url ?? null,
		} as OAuthUserInfo;
	},
};
