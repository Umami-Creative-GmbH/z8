import type { NextResponse } from "next/server";

/** Every Better Auth session cookie name z8 may hold, with and without the HTTPS prefix. */
export const BETTER_AUTH_SESSION_COOKIE_NAMES = [
	"__Secure-better-auth.session-token",
	"__Secure-better-auth.session_token",
	"__Secure-better-auth.session_data",
	"__Secure-better-auth.session-token.sig",
	"__Secure-better-auth.session_token.sig",
	"better-auth.session-token",
	"better-auth.session_token",
	"better-auth.session_data",
	"better-auth.session-token.sig",
	"better-auth.session_token.sig",
] as const;

/** Whether the request still carries a session cookie, valid or not. */
export function hasBetterAuthSessionCookie(cookieHeader: string | null): boolean {
	if (!cookieHeader) return false;
	const names = new Set(
		cookieHeader.split(";").map((entry) => entry.split("=")[0]?.trim() ?? ""),
	);
	return BETTER_AUTH_SESSION_COOKIE_NAMES.some((name) => names.has(name));
}

/**
 * Expires every session cookie on the response. Browsers ignore a `__Secure-`
 * cookie written without `Secure`, deletions included, so those carry it.
 */
export function clearBetterAuthSessionCookies(response: NextResponse): void {
	for (const name of BETTER_AUTH_SESSION_COOKIE_NAMES) {
		response.cookies.delete({
			name,
			path: "/",
			...(name.startsWith("__Secure-") ? { secure: true } : {}),
		});
	}
}
