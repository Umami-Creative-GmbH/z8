/**
 * The best of `supported` for an `Accept-Language` header, by quality and then
 * order; a regional tag (`fr-CH`) matches its language. Null when none fits.
 * Proxy-safe: no imports.
 */
export function pickAcceptLanguage(
	acceptLanguage: string | null,
	supported: readonly string[],
): string | null {
	if (!acceptLanguage) return null;
	const ranges = acceptLanguage
		.split(",")
		.map((part, index) => {
			const [tag = "", ...params] = part.trim().split(";");
			const quality = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
			const q = quality ? Number(quality.slice(2)) : 1;
			return {
				tag: tag.trim().toLowerCase(),
				q: Number.isFinite(q) ? q : 0,
				index,
			};
		})
		.filter((range) => range.tag !== "" && range.q > 0)
		.sort((a, b) => b.q - a.q || a.index - b.index);
	const supportedLanguages = new Set(supported);
	for (const { tag } of ranges) {
		if (supportedLanguages.has(tag)) return tag;
		const language = tag.split("-")[0] ?? "";
		if (supportedLanguages.has(language)) return language;
	}
	return null;
}
