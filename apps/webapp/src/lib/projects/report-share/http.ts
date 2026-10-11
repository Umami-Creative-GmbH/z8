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

/**
 * The best of `supported` for an `Accept-Language` header, by quality and then
 * order; a regional tag (`fr-CH`) matches its language. Null when none fits.
 */
export function pickShareLocale(
	acceptLanguage: string | null,
	supported: readonly string[],
): string | null {
	if (!acceptLanguage) return null;
	const ranges = acceptLanguage
		.split(",")
		.map((part, index) => {
			const [tag = "", ...params] = part.trim().split(";");
			const quality = params
				.map((param) => param.trim())
				.find((param) => param.startsWith("q="));
			const q = quality ? Number(quality.slice(2)) : 1;
			return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
		})
		.filter((range) => range.tag !== "" && range.q > 0)
		.sort((a, b) => b.q - a.q || a.index - b.index);
	for (const { tag } of ranges) {
		if (supported.includes(tag)) return tag;
		const language = tag.split("-")[0] ?? "";
		if (supported.includes(language)) return language;
	}
	return null;
}
