import type { Metadata } from "next";
import type { Locale } from "./locales";
import { alternatePath, getLocalizedPath } from "./locales";

const siteUrl = "https://z8-time.app";

const homeMetadata: Record<Locale, { title: string; description: string }> = {
	de: {
		title: "Z8 | Zeiterfassung und Workforce Management",
		description:
			"Z8 vereint Zeiterfassung, Lohnexport, Schichtplanung und Analysen fuer moderne Unternehmen.",
	},
	en: {
		title: "Z8 | Time Tracking and Workforce Management",
		description:
			"Z8 brings time tracking, payroll export, scheduling, and analytics together for modern teams.",
	},
};

export function localizedMetadata(locale: Locale, pathname: string): Metadata {
	const path = getLocalizedPath(pathname, locale);
	const alternates = alternatePath(path);

	return {
		...homeMetadata[locale],
		alternates: {
			canonical: `${siteUrl}${path}`,
			languages: {
				de: `${siteUrl}${alternates.de}`,
				en: `${siteUrl}${alternates.en}`,
				"x-default": `${siteUrl}${alternates["x-default"]}`,
			},
		},
		openGraph: {
			...homeMetadata[locale],
			url: `${siteUrl}${path}`,
			siteName: "Z8",
			type: "website",
			locale: locale === "de" ? "de_DE" : "en_US",
		},
	};
}
