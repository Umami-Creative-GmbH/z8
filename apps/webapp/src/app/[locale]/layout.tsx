import type { TolgeeStaticData } from "@tolgee/react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import { ProgressBar } from "@/components/progress-bar";
import { TolgeeNextProvider } from "@/tolgee/client";
import { ALL_LANGUAGES, TolgeeBase } from "@/tolgee/shared";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query";

type Props = {
	children: ReactNode;
	params: Promise<{ locale: string }>;
};

// Load translations without "use cache" to avoid hanging on Tolgee API calls
async function loadTranslations(locale: string): Promise<TolgeeStaticData> {
	// Create Tolgee instance with explicit locale (from route params) to avoid headers() access
	const tolgee = TolgeeBase().init({
		observerOptions: {
			fullKeyEncode: true,
		},
		language: locale,
	});

	try {
		// Add timeout to prevent hanging
		const timeoutPromise = new Promise<TolgeeStaticData>((_, reject) => {
			setTimeout(() => reject(new Error("Tolgee load timeout")), 5000);
		});

		return await Promise.race([tolgee.loadRequired() as Promise<TolgeeStaticData>, timeoutPromise]);
	} catch (error) {
		console.warn("Failed to load Tolgee translations:", error);
		// Return empty static data on failure
		return {} as TolgeeStaticData;
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
async function TranslatedMeta({ locale }: { locale: string }) {
	try {
		const staticData = await loadTranslations(locale);

		// Initialize a local Tolgee instance to resolve keys without using headers()
		const tolgee = TolgeeBase().init({
			observerOptions: {
				fullKeyEncode: true,
			},
			language: locale,
			staticData,
		});

		// Add timeout for tolgee.run() to prevent hanging
		const runWithTimeout = Promise.race([
			tolgee.run(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("Tolgee run timeout")), 3000)),
		]);

		await runWithTimeout;

		const t = tolgee.t;

		return (
			<>
				<title>{t("meta.title", "z8 - time app")}</title>
				<meta content={t("meta.description", "z8 - time app")} name="description" />
				<meta content={t("meta.keywords", "z8, time, app, productivity")} name="keywords" />
			</>
		);
	} catch (error) {
		console.warn("Failed to load translated meta:", error);
		// Return default meta tags on failure
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
		<html lang={locale}>
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
				<ProgressBar>
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
								<TooltipProvider delayDuration={0}>
									{children}
									<Toaster position="bottom-right" richColors />
								</TooltipProvider>
							</QueryProvider>
						</TranslationProvider>
					</Suspense>
				</ProgressBar>
			</body>
		</html>
	);
}
