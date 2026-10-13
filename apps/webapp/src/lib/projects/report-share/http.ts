/**
 * HTTP rules of the report share link page (#806), applied by the proxy. The
 * page's URL carries a credential, so nothing may cache it, index it, or send
 * it on as a referrer. Proxy-safe: no database or Node-only imports.
 */

export function applyShareResponseHeaders<R extends Response>(response: R): R {
	response.headers.set("Cache-Control", "private, no-store, max-age=0");
	response.headers.set("Referrer-Policy", "no-referrer");
	response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
	return response;
}
