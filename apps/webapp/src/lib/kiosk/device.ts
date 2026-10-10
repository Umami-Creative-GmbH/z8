"use client";

import {
	KIOSK_TOKEN_HEADER,
	KIOSK_TOKEN_STORAGE_KEY,
	type KioskClockRefusal,
	type KioskDeviceInfo,
	type KioskRefusalCode,
} from "./protocol";

/**
 * The kiosk device's side of the protocol (#859): where it keeps its device
 * token and how it calls kiosk endpoints. The token is the only thing the
 * device stores; storage that throws (private mode, blocked site data) reads
 * as "not paired".
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

/** Calls a kiosk endpoint with the device token. Never queued: kiosks work online only. */
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
 */
export type KioskCallResult<T> =
	| { kind: "ok"; body: T }
	| { kind: "refused"; status: number; refusal: KioskClockRefusal }
	| { kind: "kiosk"; code: KioskRefusalCode }
	| { kind: "offline" };

export async function kioskCall<T>(
	token: string,
	path: string,
	init: RequestInit = {},
): Promise<KioskCallResult<T>> {
	if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
	let response: Response;
	try {
		response = await kioskFetch(token, path, init);
	} catch {
		return { kind: "offline" };
	}
	const kioskRefusal = await kioskRefusalOf(response);
	if (kioskRefusal) return { kind: "kiosk", code: kioskRefusal };
	const body = (await response.json().catch(() => null)) as unknown;
	if (response.ok && body !== null) return { kind: "ok", body: body as T };
	const refusal =
		body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
			? (body as KioskClockRefusal)
			: { code: "failed" };
	return { kind: "refused", status: response.status, refusal };
}

/** A kiosk call with a JSON body. */
export function kioskPost<T>(token: string, path: string, body: unknown) {
	return kioskCall<T>(token, path, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json" },
		body: JSON.stringify(body),
	});
}

export type KioskSession =
	| { state: "paired"; token: string; kiosk: KioskDeviceInfo }
	| { state: "unpaired" }
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
	if (refusal === "kiosk_unknown") {
		forgetKioskToken();
		return { state: "unpaired" };
	}
	if (!response.ok) return { state: "unreachable" };
	const body = (await response.json().catch(() => null)) as { kiosk?: KioskDeviceInfo } | null;
	return body?.kiosk ? { state: "paired", token, kiosk: body.kiosk } : { state: "unreachable" };
}

export type KioskPairingResult =
	| { status: "paired"; token: string; kiosk: KioskDeviceInfo }
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
	} | null;
	if (!body?.token || !body.kiosk) return { status: "unreachable" };
	storeKioskToken(body.token);
	return { status: "paired", token: body.token, kiosk: body.kiosk };
}
