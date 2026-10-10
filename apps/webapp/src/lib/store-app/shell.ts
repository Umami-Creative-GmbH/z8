/**
 * Detects the Z8 store app shell (the Capacitor app in `apps/mobile`).
 *
 * The shell appends `Z8StoreApp/<platform>` to the web view's user agent
 * (`appendUserAgent` in `apps/mobile/capacitor.config.ts`). Keep that token
 * and this marker in step; `apps/mobile` has a test that checks both.
 *
 * The browser helpers are safe during server rendering, where they report "not
 * the shell"; server code reads the request's header with
 * `getStoreAppPlatformFromUserAgent`. Use them for presentation and channel
 * choices only (hide the "Get the app" banner, prefer native push, show the
 * store app's email screen), never for authorization: a user agent can be set
 * by anyone.
 */

export const STORE_APP_USER_AGENT_MARKER = "Z8StoreApp";

export type StoreAppPlatform = "ios" | "android";

const STORE_APP_TOKEN = new RegExp(
	`(?:^|\\s)${STORE_APP_USER_AGENT_MARKER}/(ios|android)(?:\\s|$)`,
);

/** The shell's platform named by a user agent, e.g. a request's `User-Agent` header. */
export function getStoreAppPlatformFromUserAgent(
	userAgent: string | null | undefined,
): StoreAppPlatform | null {
	const match = STORE_APP_TOKEN.exec(userAgent ?? "");
	return match ? (match[1] as StoreAppPlatform) : null;
}

/** The shell's platform, or `null` outside the shell and on the server. */
export function getStoreAppPlatform(): StoreAppPlatform | null {
	if (typeof window === "undefined" || typeof navigator === "undefined") {
		return null;
	}

	return getStoreAppPlatformFromUserAgent(navigator.userAgent);
}

/** Whether the page runs inside the Z8 store app shell; `false` on the server. */
export function isStoreAppShell(): boolean {
	return getStoreAppPlatform() !== null;
}
