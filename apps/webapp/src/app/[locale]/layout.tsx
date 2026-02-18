import type { TolgeeStaticData } from "@tolgee/react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import { BProgressBar } from "@/components/bprogress/bprogress";
import { OfflineBanner, SWUpdatePrompt } from "@/components/offline";
import { ThemeProvider } from "@/components/theme-provider";
import { TolgeeNextProvider } from "@/tolgee/client";
import { ALL_LANGUAGES, loadNamespaces, getNamespacesForRoute } from "@/tolgee/shared";
import { DOMAIN_HEADERS } from "@/proxy";
import { NonceProvider } from "@/lib/nonce-context";
import { NONCE_HEADER } from "@/lib/security";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query";

type Props = {
	children: ReactNode;
	params: Promise<{ locale: string }>;
};

// Load translations for the current route's required namespaces
async function loadRouteTranslations(locale: string, pathname: string): Promise<TolgeeStaticData> {
	// Get namespaces for this route
	const namespaces = getNamespacesForRoute(pathname);
	return loadNamespaces(locale, namespaces).catch((error) => {
		console.warn("Failed to load translations:", error);
		return {};
	});
}

// Generate static params for all locales to enable static generation
export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

// Separate component for loading translations to wrap in Suspense
async function TranslationProvider({ locale, children }: { locale: string; children: ReactNode }) {
	let records: TolgeeStaticData = {};
	let messages = {};

	// Get the current pathname to determine which namespaces to load
	const headersList = await headers();
	const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || "/";
	// Strip locale prefix from pathname (e.g., /en/settings -> /settings)
	const pathnameWithoutLocale = pathname.replace(new RegExp(`^/${locale}`), "") || "/";

	records = await loadRouteTranslations(locale, pathnameWithoutLocale).catch((error) => {
		console.warn("Failed to load Tolgee records:", error);
		return {};
	});

	messages = await getMessages({ locale }).catch((error) => {
		console.warn("Failed to load next-intl messages:", error);
		return {};
	});

	return (
		<TolgeeNextProvider language={locale} staticData={records}>
			<NextIntlClientProvider locale={locale} messages={messages}>
				{children}
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}

// Async wrapper that reads nonce from headers and provides it via context
async function NonceWrapper({ children }: { children: ReactNode }) {
	const headersList = await headers();
	const nonce = headersList.get(NONCE_HEADER) || undefined;

	return (
		<NonceProvider nonce={nonce}>
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				enableSystem
				disableTransitionOnChange
				nonce={nonce}
			>
				{children}
			</ThemeProvider>
		</NonceProvider>
	);
}

// Component for translated meta tags (title, description, keywords)
// Uses next-intl instead of Tolgee to avoid observer side effects (duplicate elements, invisible characters)
const DEFAULT_META = {
	title: "z8 - time app",
	description: "z8 - time app",
	keywords: "z8, time, app, productivity",
};

async function TranslatedMeta({ locale }: { locale: string }) {
	let meta = DEFAULT_META;

	const messages = await getMessages({ locale }).catch((error) => {
		console.warn("Failed to load translated meta:", error);
		return {};
	});
	const translatedMeta = (messages as Record<string, Record<string, string>>).meta || {};
	meta = {
		title: translatedMeta.title || DEFAULT_META.title,
		description: translatedMeta.description || DEFAULT_META.description,
		keywords: translatedMeta.keywords || DEFAULT_META.keywords,
	};

	return (
		<>
			<title>{meta.title}</title>
			<meta content={meta.description} name="description" />
			<meta content={meta.keywords} name="keywords" />
		</>
	);
}

export default async function LocaleLayout({ children, params }: Props) {
	const { locale } = await params;

	return (
		<html lang={locale} suppressHydrationWarning>
			<head>
				<meta charSet="UTF-8" />
				<meta content="Umami Creative GmbH" name="author" />
				<meta content="#000000" name="theme-color" />
				<meta content="light dark" name="color-scheme" />
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
					<NonceWrapper>
						<TranslationProvider locale={locale}>
							<QueryProvider>
								<BProgressBar />
								<TooltipProvider delayDuration={0}>
									<OfflineBanner />
									<SWUpdatePrompt />
									{children}
									<Toaster position="bottom-right" richColors />
								</TooltipProvider>
							</QueryProvider>
						</TranslationProvider>
					</NonceWrapper>
				</Suspense>
			</body>
		</html>
	);
}
