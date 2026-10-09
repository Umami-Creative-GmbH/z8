/**
 * HTTP transport for the sevdesk API (#905).
 *
 * - Base URL `https://my.sevdesk.de/api/v1` (openapi.yaml `servers`).
 * - The per-user API token goes into the `Authorization` header as the raw value
 *   (openapi.yaml: "needs to be provided as a value of an Authorization Header";
 *   third-party guides: no `Bearer`). Query-parameter auth was removed on
 *   2025-04-29 (tech.sevdesk.com, "Breaking change: removal of API authentication
 *   method"), so the token never goes into a URL.
 * - Rate limits are not documented. A 429 means the call was not performed: back
 *   off (honouring `Retry-After` when sent) and retry a few times, then fail with
 *   `not_performed`.
 * - Failures surface only as `AccountingProviderError`. Messages never contain the
 *   token; sevdesk's own error message is passed on shortened, with the token
 *   scrubbed in case it was echoed.
 */

import "server-only";
import { AccountingProviderError } from "../provider";
import { rateLimitBackoffMs } from "../retry-after";

export const SEVDESK_BASE_URL = "https://my.sevdesk.de/api/v1";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;
const MAX_ERROR_MESSAGE_LENGTH = 300;

export interface SevdeskTransportOptions {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	baseUrl?: string;
	timeoutMs?: number;
}

export interface SevdeskResponse {
	status: number;
	body: unknown;
}

export interface SevdeskRequest {
	method: "GET" | "POST";
	path: string;
	query?: Record<string, string | number>;
	/** JSON text (keeps the documented field order exactly as built). */
	body?: string;
	/**
	 * Statuses the caller interprets itself instead of failing, e.g. 400/404 for
	 * "Invoice was not found".
	 */
	accept?: readonly number[];
}

export type SevdeskClient = (request: SevdeskRequest) => Promise<SevdeskResponse>;

const defaultSleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** sevdesk's error message (`{ error: { message } }`), shortened and without the token. */
export function sevdeskErrorMessage(body: unknown, token: string): string | null {
	const error = isRecord(body) ? body.error : undefined;
	const message = isRecord(error) ? error.message : isRecord(body) ? body.message : undefined;
	if (typeof message !== "string" || message.trim() === "") return null;
	const scrubbed = token ? message.split(token).join("[token]") : message;
	return scrubbed.length > MAX_ERROR_MESSAGE_LENGTH
		? `${scrubbed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
		: scrubbed;
}

async function readBody(response: Response): Promise<unknown> {
	const text = await response.text().catch(() => "");
	if (text === "") return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * A sevdesk client bound to one token. A POST that may have reached sevdesk
 * (timeout, connection lost, 5xx other than 503) fails with `outcome_unknown`;
 * the same on a GET is `not_performed` because reading has no effect.
 */
export function createSevdeskClient(
	token: string,
	options: SevdeskTransportOptions = {},
): SevdeskClient {
	const fetchImpl = options.fetch ?? fetch;
	const sleep = options.sleep ?? defaultSleep;
	const baseUrl = options.baseUrl ?? SEVDESK_BASE_URL;
	const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

	return async (request) => {
		const url = new URL(`${baseUrl}${request.path}`);
		for (const [name, value] of Object.entries(request.query ?? {})) {
			url.searchParams.set(name, String(value));
		}
		const mutating = request.method !== "GET";

		for (let attempt = 0; ; attempt += 1) {
			let response: Response;
			try {
				response = await fetchImpl(url.toString(), {
					method: request.method,
					headers: {
						Authorization: token,
						Accept: "application/json",
						...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
					},
					body: request.body,
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (error) {
				throw new AccountingProviderError(
					mutating ? "outcome_unknown" : "not_performed",
					mutating
						? "sevdesk did not answer; the draft may or may not have been created"
						: "sevdesk could not be reached",
					{ cause: error instanceof Error ? error.name : undefined },
				);
			}

			if (response.status === 429) {
				await response.body?.cancel().catch(() => undefined);
				if (attempt >= MAX_RATE_LIMIT_RETRIES) {
					throw new AccountingProviderError(
						"not_performed",
						"sevdesk is limiting requests right now. Try again in a minute",
					);
				}
				await sleep(
					rateLimitBackoffMs(response.headers.get("retry-after"), attempt, {
						baseMs: BASE_BACKOFF_MS,
						maxMs: MAX_BACKOFF_MS,
					}),
				);
				continue;
			}

			const body = await readBody(response);
			if (response.ok || request.accept?.includes(response.status)) {
				return { status: response.status, body };
			}
			const detail = sevdeskErrorMessage(body, token);
			if (response.status === 401) {
				throw new AccountingProviderError("unauthorized", "sevdesk refused the API token");
			}
			if (response.status === 503) {
				throw new AccountingProviderError("not_performed", "sevdesk is unavailable right now");
			}
			if (response.status >= 500) {
				throw new AccountingProviderError(
					mutating ? "outcome_unknown" : "not_performed",
					mutating
						? "sevdesk failed while saving; the draft may or may not have been created"
						: "sevdesk failed to answer",
				);
			}
			if (response.status === 403) {
				throw new AccountingProviderError(
					"rejected",
					"The sevdesk user of this API token lacks the permission for this request",
				);
			}
			throw new AccountingProviderError(
				"rejected",
				detail ? `sevdesk refused the request: ${detail}` : "sevdesk refused the request",
			);
		}
	};
}
