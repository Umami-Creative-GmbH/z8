export const SETUP_COOKIE_NAME =
	process.env.NODE_ENV === "production" ? "__Host-z8-setup" : "z8-setup";

export function setupCookieOptions(
	secure = process.env.NODE_ENV === "production",
) {
	return { httpOnly: true, secure, sameSite: "strict" as const, path: "/" };
}

export function applySetupResponseHeaders(response: {
	headers: Headers;
}): void {
	response.headers.set("Cache-Control", "private, no-store, max-age=0");
	response.headers.set("Referrer-Policy", "no-referrer");
	response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
}
