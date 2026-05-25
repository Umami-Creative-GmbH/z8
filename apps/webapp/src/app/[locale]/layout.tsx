import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import { BProgressBar } from "@/components/bprogress/bprogress";
import { FontSizeProvider } from "@/components/font-size-preference";
import { OfflineBanner, SWUpdatePrompt } from "@/components/offline";
import { PostHogProvider } from "@/components/posthog-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { auth } from "@/lib/auth";
import { DOMAIN_HEADERS } from "@/proxy";
import { TolgeeNextProvider } from "@/tolgee/client";
import { ALL_LANGUAGES, loadRouteTranslations } from "@/tolgee/shared";
import "../globals.css";
import { eq } from "drizzle-orm";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query";

type Props = {
	children: ReactNode;
	params: Promise<{ locale: string }>;
};

// Generate static params for all locales to enable static generation
export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

// Separate component for loading translations to wrap in Suspense
async function TranslationProvider({ locale, children }: { locale: string; children: ReactNode }) {
	// Get the current pathname to determine which namespaces to load
	const headersList = await headers();
	const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || "/";
	// Strip locale prefix from pathname (e.g., /en/settings -> /settings)
	const pathnameWithoutLocale = pathname.replace(new RegExp(`^/${locale}`), "") || "/";

	const records = await loadRouteTranslations(locale, pathnameWithoutLocale).catch((error) => {
		console.warn("Failed to load Tolgee records:", error);
		return {};
	});

	return (
		<TolgeeNextProvider language={locale} staticData={records}>
			<NextIntlClientProvider locale={locale} messages={{ locale }}>
				{children}
			</NextIntlClientProvider>
		</TolgeeNextProvider>
	);
}

// Keep global metadata static to avoid loading legacy root locale messages on every page.
const DEFAULT_META = {
	title: "z8 - time app",
	description: "z8 - time app",
	keywords: "z8, time, app, productivity",
};

const FONT_SIZE_INIT_SCRIPT = `try{var fontSize=localStorage.getItem("z8-font-size");if(fontSize==="comfortable"||fontSize==="large"){document.documentElement.dataset.fontSize=fontSize;}else{document.documentElement.removeAttribute("data-font-size");}}catch{}`;

function TranslatedMeta() {
	return (
		<>
			<title>{DEFAULT_META.title}</title>
			<meta content={DEFAULT_META.description} name="description" />
			<meta content={DEFAULT_META.keywords} name="keywords" />
		</>
	);
}

async function getHelpImproveProduct(): Promise<boolean> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return false;
	}

	const settings = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, session.user.id),
		columns: { helpImproveProduct: true },
	});

	return settings?.helpImproveProduct ?? true;
}

function AppProviders({ children, locale }: { children: ReactNode; locale: string }) {
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
			<FontSizeProvider>
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
			</FontSizeProvider>
		</ThemeProvider>
	);
}

async function PostHogConsentProvider({ children }: { children: ReactNode }) {
	const helpImproveProduct = await getHelpImproveProduct();

	return <PostHogProvider helpImproveProduct={helpImproveProduct}>{children}</PostHogProvider>;
}

export default async function LocaleLayout({ children, params }: Props) {
	const { locale } = await params;
	setRequestLocale(locale);

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
				<script dangerouslySetInnerHTML={{ __html: FONT_SIZE_INIT_SCRIPT }} />
				<TranslatedMeta />
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
							<div>Loading…</div>
						</div>
					}
				>
					<PostHogConsentProvider>
						<AppProviders locale={locale}>{children}</AppProviders>
					</PostHogConsentProvider>
				</Suspense>
			</body>
		</html>
	);
}
