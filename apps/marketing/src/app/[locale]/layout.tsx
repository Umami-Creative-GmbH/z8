import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { themes } from "@/components/theme/tokens";
import { isLocale, locales } from "@/i18n/locales";
import "../globals.css";

export const metadata: Metadata = {
	title: "Z8",
	description: "Workforce management and time tracking",
};

/**
 * Inline script that runs before React hydrates to prevent theme flash.
 * Reads localStorage synchronously and sets CSS custom properties on <html>.
 */
const themeScript = `(function(){try{var d=localStorage.getItem("z8-theme");if(d==="dark"){document.documentElement.dataset.theme="dark";var t=${JSON.stringify(themes.dark)};for(var k in t)document.documentElement.style.setProperty("--z8-"+k,t[k])}}catch(e){}})()`;

export function generateStaticParams() {
	return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	if (!isLocale(locale)) {
		notFound();
	}

	return (
		<html lang={locale} suppressHydrationWarning>
			<head>
				<Script id="theme-init" strategy="beforeInteractive">
					{themeScript}
				</Script>
			</head>
			<body className="antialiased">{children}</body>
		</html>
	);
}
