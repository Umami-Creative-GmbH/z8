/**
 * HTTP access to the Lexware Office Public API (#904): bearer auth, the 2
 * requests/second limit, 429 back-off and the mapping of every failure to an
 * `AccountingProviderError`. Facts from https://developers.lexware.io/docs/
 * (read 2026-10-09): "API Rate Limits", "HTTP Status Codes", "Error Codes".
 *
 * The API key only ever goes into the Authorization header. It never appears
 * in an error message, an error cause, or a log line.
 */

import { AccountingProviderError } from "../provider";
import { rateLimitBackoffMs } from "../retry-after";

export const LEXWARE_API_BASE_URL = "https://api.lexware.io";

/**
 * Lexware allows 2 requests per second per client, as a token bucket shared by
 * all endpoints, and recommends a buffer for network jitter ("API Rate
 * Limits"). Z8 starts at most one request per key every 550 ms (≈1.8/s).
 */
export const LEXWARE_REQUEST_INTERVAL_MS = 550;

/** A 429 means "not performed": retry up to this often, backing off exponentially. */
export const LEXWARE_MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_BACKOFF_MS = 1_000;
const MAX_RETRY_AFTER_MS = 30_000;

/** Lexware's gateway answers 504 after 30 s ("HTTP Status Codes"); give up a little later. */
const REQUEST_TIMEOUT_MS = 35_000;

/** Visible ASCII only: anything else cannot go into an HTTP header unmangled. */
const HEADER_SAFE_KEY = /^[\x21-\x7e]+$/;

export type LexwareFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface LexwareTransport {
	fetch: LexwareFetch;
	sleep: (ms: number) => Promise<void>;
	/** Monotonic milliseconds, for pacing. */
	now: () => number;
	baseUrl: string;
	timeoutMs?: number;
}

/** Spaces request starts at least `intervalMs` apart; reserving a slot is synchronous. */
export interface LexwarePacer {
	wait(): Promise<void>;
	/** Pushes the next slot back, e.g. after Lexware answered 429. */
	defer(ms: number): void;
}

export function createLexwarePacer(
	transport: Pick<LexwareTransport, "now" | "sleep">,
	intervalMs = LEXWARE_REQUEST_INTERVAL_MS,
): LexwarePacer {
	let nextSlot = Number.NEGATIVE_INFINITY;
	return {
		async wait() {
			const now = transport.now();
			const slot = Math.max(now, nextSlot);
			nextSlot = slot + intervalMs;
			if (slot > now) await transport.sleep(slot - now);
		},
		defer(ms) {
			nextSlot = Math.max(nextSlot, transport.now() + ms);
		},
	};
}

export type LexwareMethod = "GET" | "POST";

export interface LexwareResponse {
	status: number;
	body: unknown;
}

const PROVIDER = "Lexware Office";

export function assertHeaderSafeApiKey(apiKey: string): void {
	if (!HEADER_SAFE_KEY.test(apiKey)) {
		throw new AccountingProviderError(
			"unauthorized",
			`${PROVIDER} API keys contain no spaces or line breaks; check the key you pasted`,
		);
	}
}

/**
 * The failure a call has when its outcome is unclear: a read can simply be
 * repeated, a create may already have happened in Lexware.
 */
function ambiguous(method: LexwareMethod, message: string): AccountingProviderError {
	return new AccountingProviderError(
		method === "GET" ? "not_performed" : "outcome_unknown",
		message,
	);
}

/**
 * Sends one request and returns its status and parsed JSON body. Retries a 429
 * with back-off (Lexware did not perform it). Throws `AccountingProviderError`
 * for transport failures, 429s that do not clear, and unreadable bodies; HTTP
 * error statuses are returned for the caller to map (`lexwareFailure`).
 */
export async function lexwareRequest(
	transport: LexwareTransport,
	pacer: LexwarePacer,
	apiKey: string,
	method: LexwareMethod,
	path: string,
	options: { query?: string; body?: unknown } = {},
): Promise<LexwareResponse> {
	assertHeaderSafeApiKey(apiKey);
	const url = `${transport.baseUrl}${path}${options.query ? `?${options.query}` : ""}`;
	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	};
	if (options.body !== undefined) headers["Content-Type"] = "application/json";

	for (let attempt = 0; ; attempt++) {
		await pacer.wait();
		let response: Response;
		try {
			response = await transport.fetch(url, {
				method,
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: AbortSignal.timeout(transport.timeoutMs ?? REQUEST_TIMEOUT_MS),
			});
		} catch {
			// The cause is dropped on purpose: transport errors can quote request details.
			throw ambiguous(method, `${PROVIDER} could not be reached`);
		}

		if (response.status === 429) {
			if (attempt >= LEXWARE_MAX_RATE_LIMIT_RETRIES) {
				throw new AccountingProviderError(
					"not_performed",
					`${PROVIDER} is limiting requests right now; try again in a minute`,
				);
			}
			const delay = rateLimitBackoffMs(response.headers.get("retry-after"), attempt, {
				baseMs: RATE_LIMIT_BACKOFF_MS,
				maxMs: MAX_RETRY_AFTER_MS,
			});
			pacer.defer(delay);
			continue;
		}

		const text = await response.text().catch(() => null);
		if (text === null) throw ambiguous(method, `${PROVIDER} did not answer completely`);
		if (text.trim() === "") return { status: response.status, body: null };
		try {
			return { status: response.status, body: JSON.parse(text) };
		} catch {
			if (response.ok) throw ambiguous(method, `${PROVIDER} sent an unreadable answer`);
			return { status: response.status, body: null };
		}
	}
}

const MAX_DETAIL_LENGTH = 300;

/**
 * Field names and rule codes from Lexware's error body ("Regular Error
 * Response" `details[].field/violation`, "Legacy Error Response"
 * `IssueList[].source/i18nKey`). Lexware's own `message` texts are not meant
 * for end users and may quote submitted data, so they are left out.
 */
function errorDetails(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	const parts: string[] = [];
	if (Array.isArray(record.details)) {
		for (const detail of record.details) {
			if (typeof detail !== "object" || detail === null) continue;
			const { field, violation } = detail as Record<string, unknown>;
			if (typeof field === "string") {
				parts.push(typeof violation === "string" ? `${field} (${violation})` : field);
			}
		}
	}
	if (Array.isArray(record.IssueList)) {
		for (const issue of record.IssueList) {
			if (typeof issue !== "object" || issue === null) continue;
			const { source, i18nKey } = issue as Record<string, unknown>;
			const label = [source, i18nKey].filter((part) => typeof part === "string").join(" ");
			if (label) parts.push(label);
		}
	}
	if (parts.length === 0) return null;
	const joined = parts.join(", ");
	return joined.length > MAX_DETAIL_LENGTH ? `${joined.slice(0, MAX_DETAIL_LENGTH - 1)}…` : joined;
}

/**
 * Maps an HTTP error status to the port's failure ("HTTP Status Codes",
 * "Error Codes"). `action` names what was attempted, for the admin.
 */
export function lexwareFailure(
	response: LexwareResponse,
	method: LexwareMethod,
	action: string,
): AccountingProviderError {
	const { status } = response;
	if (status === 401 || status === 403) {
		return new AccountingProviderError(
			"unauthorized",
			`${PROVIDER} refused the API key; create a new key under Public API in Lexware Office`,
		);
	}
	if (status === 402) {
		return new AccountingProviderError(
			"unauthorized",
			`${PROVIDER} refused the request because of the account's plan; the Public API needs the XL plan`,
		);
	}
	if (status === 503) {
		return new AccountingProviderError(
			"not_performed",
			`${PROVIDER} is temporarily unavailable; try again later`,
		);
	}
	if (status >= 500) {
		// 500 can also mean "rate limit exceeded"; 504 "may still have been processed".
		return ambiguous(method, `${PROVIDER} failed to ${action} (HTTP ${status})`);
	}
	const details = errorDetails(response.body);
	return new AccountingProviderError(
		"rejected",
		`${PROVIDER} refused to ${action} (HTTP ${status})${details ? `: ${details}` : ""}`,
	);
}
