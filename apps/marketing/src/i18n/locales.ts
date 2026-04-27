export const locales = ["de", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "de";

export function isLocale(value: string): value is Locale {
	return locales.includes(value as Locale);
}

export function getLocalizedPath(pathname: string, locale: Locale): string {
	const hashIndex = pathname.indexOf("#");
	const pathWithoutHash = hashIndex === -1 ? pathname : pathname.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : pathname.slice(hashIndex);
	const segments = pathWithoutHash.split("/").filter(Boolean);

	if (segments.length > 0 && isLocale(segments[0])) {
		segments[0] = locale;
		return `/${segments.join("/")}${hash}`;
	}

	return `/${locale}${pathWithoutHash === "/" ? "" : pathWithoutHash}${hash}`;
}

export function alternatePath(pathname: string): Record<Locale | "x-default", string> {
	return {
		de: getLocalizedPath(pathname, "de"),
		en: getLocalizedPath(pathname, "en"),
		"x-default": getLocalizedPath(pathname, defaultLocale),
	};
}
