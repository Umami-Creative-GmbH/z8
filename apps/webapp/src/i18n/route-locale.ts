import { ALL_LANGUAGES } from "@/tolgee/catalog-config";

/**
 * Splits a supported locale prefix off a path. Only supported locales count, three-letter
 * tags such as `gsw` included; `/xx/team` keeps its first segment.
 */
export function splitRouteLocale(pathname: string): {
	locale: string | undefined;
	pathWithoutLocale: string;
} {
	const locale = ALL_LANGUAGES.find(
		(candidate) => pathname === `/${candidate}` || pathname.startsWith(`/${candidate}/`),
	);
	return {
		locale,
		pathWithoutLocale: locale ? pathname.slice(locale.length + 1) || "/" : pathname,
	};
}
