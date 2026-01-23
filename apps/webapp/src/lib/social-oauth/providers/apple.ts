import crypto from "node:crypto";
import { createLogger } from "@/lib/logger";
import type { OAuthCredentials, OAuthProviderImpl, OAuthTokens, OAuthUserInfo } from "../types";

const logger = createLogger("SocialOAuth:Apple");

const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

/**
 * Generate a client secret JWT for Apple Sign In
 * Apple requires a signed JWT instead of a simple client secret
 */
function generateClientSecret(params: {
	teamId: string;
	keyId: string;
	clientId: string;
	privateKey: string;
}): string {
	const { teamId, keyId, clientId, privateKey } = params;

	const now = Math.floor(Date.now() / 1000);
	const exp = now + 86400 * 180; // 180 days max

	// JWT Header
	const header = {
		alg: "ES256",
		kid: keyId,
		typ: "JWT",
	};

	// JWT Payload
	const payload = {
		iss: teamId,
		iat: now,
		exp,
		aud: "https://appleid.apple.com",
		sub: clientId,
	};

	// Encode header and payload
	const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
	const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const signingInput = `${encodedHeader}.${encodedPayload}`;

	// Sign with ES256 (ECDSA using P-256 and SHA-256)
	const sign = crypto.createSign("SHA256");
	sign.update(signingInput);
	const signature = sign.sign(privateKey);

	// Convert DER signature to raw format for JWT
	// ES256 signature is 64 bytes (32 bytes R + 32 bytes S)
	const rawSignature = derToRaw(signature);
	const encodedSignature = rawSignature.toString("base64url");

	return `${signingInput}.${encodedSignature}`;
}

/**
 * Convert DER encoded signature to raw format
 */
function derToRaw(derSignature: Buffer): Buffer {
	// DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
	let offset = 2; // Skip 0x30 and total length

	// Read R
	if (derSignature[offset] !== 0x02) throw new Error("Invalid DER signature");
	offset++;
	const rLength = derSignature[offset];
	offset++;
	let r = derSignature.subarray(offset, offset + rLength);
	offset += rLength;

	// Read S
	if (derSignature[offset] !== 0x02) throw new Error("Invalid DER signature");
	offset++;
	const sLength = derSignature[offset];
	offset++;
	let s = derSignature.subarray(offset, offset + sLength);

	// Remove leading zeros and pad to 32 bytes
	if (r.length > 32) r = r.subarray(r.length - 32);
	if (s.length > 32) s = s.subarray(s.length - 32);

	const raw = Buffer.alloc(64);
	r.copy(raw, 32 - r.length);
	s.copy(raw, 64 - s.length);

	return raw;
}

export const appleProvider: OAuthProviderImpl = {
	getAuthorizationUrl({ credentials, redirectUri, state, nonce }) {
		const params = new URLSearchParams({
			client_id: credentials.clientId,
			redirect_uri: redirectUri,
			response_type: "code id_token",
			response_mode: "form_post", // Apple requires form_post for id_token
			scope: "name email",
			state,
		});

		if (nonce) {
			params.set("nonce", nonce);
		}

		return `${APPLE_AUTH_URL}?${params.toString()}`;
	},

	async exchangeCode({ credentials, code, redirectUri }) {
		const config = credentials.providerConfig?.apple;
		if (!config?.teamId || !config?.keyId) {
			throw new Error("Apple Sign In requires teamId and keyId in provider config");
		}

		// For Apple, the clientSecret is actually the private key
		const privateKey = credentials.clientSecret;
		if (!privateKey.includes("BEGIN PRIVATE KEY")) {
			throw new Error("Apple Sign In requires a valid private key");
		}

		// Generate the client secret JWT
		const clientSecret = generateClientSecret({
			teamId: config.teamId,
			keyId: config.keyId,
			clientId: credentials.clientId,
			privateKey,
		});

		const response = await fetch(APPLE_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: credentials.clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: redirectUri,
				grant_type: "authorization_code",
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
			tokenType: data.token_type || "Bearer",
			expiresIn: data.expires_in,
		} as OAuthTokens;
	},

	async getUserInfo(_accessToken, idToken) {
		// Apple only provides user info via ID token
		// The access token cannot be used to fetch user info
		if (!idToken) {
			throw new Error("Apple Sign In requires an ID token");
		}

		try {
			const [, payloadBase64] = idToken.split(".");
			const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString());

			// Apple's ID token contains:
			// - sub: unique user identifier (stable across all Apple apps)
			// - email: user's email (only on first sign-in unless requested each time)
			// - email_verified: whether email is verified
			// - is_private_email: whether this is a private relay email

			return {
				providerUserId: payload.sub,
				email: payload.email || "",
				emailVerified: payload.email_verified === "true" || payload.email_verified === true,
				name: null, // Name is only provided on first sign-in via form_post
				image: null, // Apple doesn't provide profile images
			} as OAuthUserInfo;
		} catch (error) {
			logger.error({ error }, "Failed to parse Apple ID token");
			throw new Error("Failed to parse Apple ID token");
		}
	},
};

/**
 * Parse Apple's form_post response which may include user info
 * This should be called from the callback route handler
 */
export function parseAppleFormPost(body: FormData): {
	code: string;
	state: string;
	idToken?: string;
	user?: { name?: { firstName?: string; lastName?: string }; email?: string };
} {
	const code = body.get("code") as string;
	const state = body.get("state") as string;
	const idToken = body.get("id_token") as string | null;
	const userJson = body.get("user") as string | null;

	let user: { name?: { firstName?: string; lastName?: string }; email?: string } | undefined;
	if (userJson) {
		try {
			user = JSON.parse(userJson);
		} catch {
			logger.warn("Failed to parse user JSON from Apple form_post");
		}
	}

	return {
		code,
		state,
		idToken: idToken || undefined,
		user,
	};
}
