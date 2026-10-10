/**
 * Firebase Cloud Messaging HTTP v1 sender (#843).
 *
 * Authenticates with a service account (OAuth 2.0 JWT bearer grant, signed
 * with node:crypto) and sends one message per device token. Credentials come
 * from FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY; without all three
 * native push is off.
 */

import { createSign } from "node:crypto";
import { type NativePushMessage, toFcmMessage } from "./native-push-message";

export interface FcmCredentials {
	projectId: string;
	clientEmail: string;
	privateKey: string;
}

export type FcmSendResult =
	| { kind: "sent" }
	| { kind: "invalid_token" }
	| { kind: "failed"; status?: number; error: string };

export interface FcmSender {
	send(token: string, message: NativePushMessage): Promise<FcmSendResult>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const ASSERTION_LIFETIME_SECONDS = 3600;
const ACCESS_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * FCM error codes that mean the token will never work again. `INVALID_ARGUMENT`
 * is not one of them: FCM also returns it for a malformed message, which would
 * otherwise deactivate every device. It counts only when the error names the
 * token field (`isTokenFieldViolation`).
 */
const INVALID_TOKEN_ERROR_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);
const TOKEN_FIELD = "message.token";

export function readFcmCredentials(env: {
	FCM_PROJECT_ID?: string;
	FCM_CLIENT_EMAIL?: string;
	FCM_PRIVATE_KEY?: string;
}): FcmCredentials | null {
	const projectId = env.FCM_PROJECT_ID?.trim();
	const clientEmail = env.FCM_CLIENT_EMAIL?.trim();
	const privateKey = env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n");
	if (!projectId || !clientEmail || !privateKey?.trim()) return null;
	return { projectId, clientEmail, privateKey };
}

function base64Url(value: string): string {
	return Buffer.from(value).toString("base64url");
}

function signedAssertion(credentials: FcmCredentials, issuedAtSeconds: number): string {
	const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
	const claims = base64Url(
		JSON.stringify({
			iss: credentials.clientEmail,
			scope: MESSAGING_SCOPE,
			aud: TOKEN_URL,
			iat: issuedAtSeconds,
			exp: issuedAtSeconds + ASSERTION_LIFETIME_SECONDS,
		}),
	);
	const signature = createSign("RSA-SHA256")
		.update(`${header}.${claims}`)
		.sign(credentials.privateKey, "base64url");
	return `${header}.${claims}.${signature}`;
}

class FcmRequestError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

interface FcmErrorDetail {
	errorCode?: unknown;
	fieldViolations?: Array<{ field?: unknown }>;
}

function fcmErrorDetails(body: unknown): FcmErrorDetail[] {
	const details = (body as { error?: { details?: unknown } })?.error?.details;
	return Array.isArray(details)
		? details.filter((detail): detail is FcmErrorDetail => typeof detail === "object" && !!detail)
		: [];
}

function fcmErrorCode(details: FcmErrorDetail[]): string | null {
	for (const detail of details) {
		if (typeof detail.errorCode === "string") return detail.errorCode;
	}
	return null;
}

/** A `google.rpc.BadRequest` detail that blames the device token itself. */
function isTokenFieldViolation(details: FcmErrorDetail[]): boolean {
	return details.some(
		(detail) =>
			Array.isArray(detail.fieldViolations) &&
			detail.fieldViolations.some((violation) => violation?.field === TOKEN_FIELD),
	);
}

function isInvalidTokenError(errorCode: string | null, details: FcmErrorDetail[]): boolean {
	if (errorCode && INVALID_TOKEN_ERROR_CODES.has(errorCode)) return true;
	return errorCode === "INVALID_ARGUMENT" && isTokenFieldViolation(details);
}

export function createFcmSender(
	credentials: FcmCredentials,
	deps: { fetch?: FetchLike; now?: () => number } = {},
): FcmSender {
	const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
	const now = deps.now ?? Date.now;
	let cached: { token: string; expiresAt: number } | null = null;

	async function accessToken(): Promise<string> {
		if (cached && now() < cached.expiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS) return cached.token;
		const issuedAt = Math.floor(now() / 1000);
		const response = await fetchFn(TOKEN_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion: signedAssertion(credentials, issuedAt),
			}).toString(),
		});
		if (!response.ok) {
			throw new FcmRequestError("fcm_access_token_refused", response.status);
		}
		const body = (await response.json()) as { access_token?: string; expires_in?: number };
		if (!body.access_token) throw new FcmRequestError("fcm_access_token_missing");
		cached = {
			token: body.access_token,
			expiresAt: issuedAt * 1000 + (body.expires_in ?? ASSERTION_LIFETIME_SECONDS) * 1000,
		};
		return cached.token;
	}

	return {
		async send(token, message) {
			try {
				const response = await fetchFn(
					`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.projectId)}/messages:send`,
					{
						method: "POST",
						headers: {
							authorization: `Bearer ${await accessToken()}`,
							"content-type": "application/json",
						},
						body: JSON.stringify(toFcmMessage(token, message)),
					},
				);
				if (response.ok) return { kind: "sent" };
				const details = fcmErrorDetails(await response.json().catch(() => null));
				const errorCode = fcmErrorCode(details);
				if (isInvalidTokenError(errorCode, details)) return { kind: "invalid_token" };
				if (response.status === 401) cached = null;
				return {
					kind: "failed",
					status: response.status,
					error: errorCode ?? `fcm_http_${response.status}`,
				};
			} catch (error) {
				return {
					kind: "failed",
					status: error instanceof FcmRequestError ? error.status : undefined,
					error: error instanceof Error ? error.message : "fcm_request_failed",
				};
			}
		},
	};
}
