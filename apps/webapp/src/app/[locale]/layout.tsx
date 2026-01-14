import type { TolgeeStaticData } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import { BProgressBar } from "@/components/bprogress/bprogress";
import { ThemeProvider } from "@/components/theme-provider";
import { TolgeeNextProvider } from "@/tolgee/client";
import { ALL_LANGUAGES, TolgeeBase } from "@/tolgee/shared";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query";

type Props = {
	children: ReactNode;
	params: Promise<{ locale: string }>;
};

// Load translations from static JSON files
async function loadTranslations(locale: string): Promise<TolgeeStaticData> {
	try {
		// Import translations directly from static JSON files
		const translations = await (locale === "de"
			? import("../../../messages/de.json")
			: import("../../../messages/en.json"));

		return {
			[locale]: translations.default || translations,
		};
	} catch (error) {
		console.warn("Failed to load translations:", error);
		return {};
	}
}

// Generate static params for all locales to enable static generation
export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

// Separate component for loading translations to wrap in Suspense
async function TranslationProvider({ locale, children }: { locale: string; children: ReactNode }) {
	let records: TolgeeStaticData = {};
	let messages = {};

	try {
		records = await loadTranslations(locale);
	} catch (error) {
		console.warn("Failed to load Tolgee records:", error);
	}

	try {
		messages = await getMessages({ locale });
	} catch (error) {
		console.warn("Failed to load next-intl messages:", error);
	}

	return (
		<TolgeeNextProvider language={locale} staticData={records}>
			<NextIntlClientProvider locale={locale} messages={messages}>
				{children}
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}

// Component for translated meta tags (title, description, keywords)
// Uses next-intl instead of Tolgee to avoid observer side effects (duplicate elements, invisible characters)
async function TranslatedMeta({ locale }: { locale: string }) {
	try {
		const messages = await getMessages({ locale });
		const meta = (messages as Record<string, Record<string, string>>).meta || {};

		return (
			<>
				<title>{meta.title || "z8 - time app"}</title>
				<meta content={meta.description || "z8 - time app"} name="description" />
				<meta content={meta.keywords || "z8, time, app, productivity"} name="keywords" />
			</>
		);
	} catch (error) {
		console.warn("Failed to load translated meta:", error);
		return (
			<>
				<title>z8 - time app</title>
				<meta content="z8 - time app" name="description" />
				<meta content="z8, time, app, productivity" name="keywords" />
			</>
		);
	}
}

export default async function LocaleLayout({ children, params }: Props) {
	const { locale } = await params;

	return (
		<html lang={locale} suppressHydrationWarning>
			<head>
				<meta charSet="UTF-8" />
				<meta content="Umami Creative GmbH" name="author" />
				<meta content="#000000" name="theme-color" />
				<link href="/favicon.ico" rel="icon" sizes="any" type="image/x-icon" />
				<link href="/apple-touch-icon.png" rel="apple-touch-icon" sizes="180x180" />
				<link href="/favicon-32x32.png" rel="icon" sizes="32x32" type="image/png" />
				<link href="/favicon-16x16.png" rel="icon" sizes="16x16" type="image/png" />
				<link href="/site.webmanifest" rel="manifest" />
				<link color="#000000" href="/safari-pinned-tab.svg" rel="mask-icon" />
				<meta content="#000000" name="msapplication-TileColor" />
				<meta content="z8" name="apple-mobile-web-app-title" />
				<meta content="z8" name="application-name" />
				<meta content="yes" name="mobile-web-app-capable" />
				<meta content="yes" name="apple-mobile-web-app-capable" />
				<meta content="default" name="apple-mobile-web-app-status-bar-style" />
				<Suspense fallback={<title>z8 - time app</title>}>
					<TranslatedMeta locale={locale} />
				</Suspense>
			</head>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<Suspense
						fallback={
							<div
								style={{
									display: "flex",
									justifyContent: "center",
									alignItems: "center",
									minHeight: "100vh",
								}}
							>
								<div>Loading...</div>
							</div>
						}
					>
						<TranslationProvider locale={locale}>
							<QueryProvider>
								<BProgressBar />
								<TooltipProvider delayDuration={0}>
									{children}
									<Toaster position="bottom-right" richColors />
								</TooltipProvider>
							</QueryProvider>
						</TranslationProvider>
					</Suspense>
				</ThemeProvider>
			</body>
		</html>
	);
}
