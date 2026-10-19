"use client";

import {
	KIOSK_TOKEN_HEADER,
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskClockRefusal,
	type KioskDeviceInfo,
	type KioskOfflineContact,
	type KioskRefusalCode,
} from "./protocol";

/**
 * The kiosk device's side of the protocol (#859): where it keeps its device
 * token and how it calls kiosk endpoints. The token is the only thing this
 * module stores (an offline-mode kiosk keeps its cache and queue in IndexedDB,
 * `offline-device.ts`); storage that throws (private mode, blocked site data)
 * reads as "not paired".
 */

export function readKioskToken(): string | null {
	try {
		return window.localStorage.getItem(KIOSK_TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function storeKioskToken(token: string): void {
	try {
		window.localStorage.setItem(KIOSK_TOKEN_STORAGE_KEY, token);
	} catch {
		// The pairing still works for this page load; a reload asks to pair again.
	}
}

export function forgetKioskToken(): void {
	try {
		window.localStorage.removeItem(KIOSK_TOKEN_STORAGE_KEY);
	} catch {
		// Nothing stored, nothing to forget.
	}
}

/**
 * Calls a kiosk endpoint with the device token. Never queued: an offline-mode
 * kiosk queues frozen commands of its own instead (`offline-queue.ts`, #1292).
 */
export function kioskFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set(KIOSK_TOKEN_HEADER, token);
	return fetch(path, { ...init, headers, cache: "no-store" });
}

/** The refusal code of a kiosk endpoint's 401, if it is one. */
export async function kioskRefusalOf(response: Response): Promise<KioskRefusalCode | null> {
	if (response.status !== 401) return null;
	const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
	return body?.code === "kiosk_revoked" ? "kiosk_revoked" : "kiosk_unknown";
}

/**
 * What a kiosk call came back with (#862): the answer, a refusal with its
 * `code`, a refused device token (`kiosk`), or no connection (`offline`). A
 * call made while the browser reports itself offline is never sent.
 *
 * A refusal Z8 itself did not give is `unavailable`: a server error (5xx, e.g.
 * a proxy in front of a server that is down) or an answer that is not a Z8
 * answer (a captive portal's page). An offline-mode kiosk treats it as being
 * offline (#885); every other kiosk shows it as a failure, as before.
 *
 * `offline` with `sent` (#1363) is a request that left the device but got no
 * answer (the connection dropped, or it timed out): Z8 may have acted on it. A
 * call never sent has no `sent`.
 */
export type KioskCallResult<T> =
	| { kind: "ok"; body: T }
	| { kind: "refused"; status: number; refusal: KioskClockRefusal; unavailable: boolean }
	| { kind: "kiosk"; code: KioskRefusalCode }
	| { kind: "offline"; sent?: true };

/**
 * Whether a call's answer leaves open what Z8 did with it (#1363): sent without
 * an answer, a server error, an answer that is not Z8's, or Z8's own
 * `unconfirmed`. An action answered this way may have been recorded.
 */
export function isKioskCallUncertain(result: KioskCallResult<unknown>): boolean {
	if (result.kind === "offline") return result.sent === true;
	return result.kind === "refused" && (result.unavailable || result.refusal.code === "unconfirmed");
}

/** Whether a call did not reach Z8 in a way that answered it: offline, or not Z8's answer. */
export function isKioskCallUnreachable(result: KioskCallResult<unknown>): boolean {
	return result.kind === "offline" || (result.kind === "refused" && result.unavailable);
}

export async function kioskCall<T>(
	token: string,
	path: string,
	init: RequestInit = {},
	options: { timeoutMs?: number } = {},
): Promise<KioskCallResult<T>> {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
	const controller = options.timeoutMs === undefined ? null : new AbortController();
	const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : undefined;
	let response: Response;
	try {
		response = await kioskFetch(token, path, {
			...init,
			...(controller ? { signal: controller.signal } : {}),
		});
	} catch {
		return { kind: "offline", sent: true };
	} finally {
		clearTimeout(timer);
	}
	const kioskRefusal = await kioskRefusalOf(response);
	if (kioskRefusal) return { kind: "kiosk", code: kioskRefusal };
	const body = (await response.json().catch(() => null)) as unknown;
	if (response.ok && body !== null) return { kind: "ok", body: body as T };
	const answered =
		body !== null &&
		typeof body === "object" &&
		typeof (body as { code?: unknown }).code === "string";
	return {
		kind: "refused",
		status: response.status,
		refusal: answered ? (body as KioskClockRefusal) : { code: "failed" },
		unavailable: response.status >= 500 || !answered,
	};
}

/** A kiosk call with a JSON body; with `timeoutMs`, an unanswered call gives up (as `sent`). */
export function kioskPost<T>(
	token: string,
	path: string,
	body: unknown,
	options: { timeoutMs?: number } = {},
) {
	return kioskCall<T>(
		token,
		path,
		{
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify(body),
		},
		options,
	);
}

export type KioskSession =
	| { state: "paired"; token: string; kiosk: KioskDeviceInfo; offline?: KioskOfflineContact }
	/**
	 * `staleToken`: the stored token Z8 no longer knows (`kiosk_unknown`). It is still
	 * stored: the kiosk sends its queued commands with it once before forgetting it (#1292).
	 */
	| { state: "unpaired"; staleToken?: string }
	| { state: "revoked" }
	| { state: "unreachable" };

/** Asks the server which kiosk the stored token belongs to. */
export async function loadKioskSession(): Promise<KioskSession> {
	const token = readKioskToken();
	if (!token) return { state: "unpaired" };
	let response: Response;
	try {
		response = await kioskFetch(token, "/api/kiosk/session");
	} catch {
		return { state: "unreachable" };
	}
	const refusal = await kioskRefusalOf(response);
	if (refusal === "kiosk_revoked") return { state: "revoked" };
	if (refusal === "kiosk_unknown") return { state: "unpaired", staleToken: token };
	if (!response.ok) return { state: "unreachable" };
	const body = (await response.json().catch(() => null)) as {
		kiosk?: KioskDeviceInfo;
		offline?: KioskOfflineContact;
	} | null;
	if (!body?.kiosk) return { state: "unreachable" };
	return {
		state: "paired",
		token,
		kiosk: body.kiosk,
		...(body.offline ? { offline: body.offline } : {}),
	};
}

export type KioskPairingResult =
	| { status: "paired"; token: string; kiosk: KioskDeviceInfo; offline?: KioskOfflineContact }
	| { status: "invalid_code" | "malformed_code" | "rate_limited" | "unreachable" };

/** Exchanges a pairing code for a device token and stores the token. */
export async function pairKioskDevice(code: string): Promise<KioskPairingResult> {
	let response: Response;
	try {
		response = await fetch("/api/kiosk/pair", {
			method: "POST",
			headers: { "content-type": "application/json", accept: "application/json" },
			body: JSON.stringify({ code }),
			cache: "no-store",
		});
	} catch {
		return { status: "unreachable" };
	}
	if (response.status === 429) return { status: "rate_limited" };
	if (response.status === 400) return { status: "malformed_code" };
	if (response.status === 401) return { status: "invalid_code" };
	if (!response.ok) return { status: "unreachable" };
	const body = (await response.json().catch(() => null)) as {
		token?: string;
		kiosk?: KioskDeviceInfo;
		offline?: KioskOfflineContact;
	} | null;
	if (!body?.token || !body.kiosk) return { status: "unreachable" };
	storeKioskToken(body.token);
	return {
		status: "paired",
		token: body.token,
		kiosk: body.kiosk,
		...(body.offline ? { offline: body.offline } : {}),
	};
}
