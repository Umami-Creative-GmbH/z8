import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { type ReactNode, Suspense } from "react";
import { Toaster } from "sonner";
import { BProgressBar } from "@/components/bprogress/bprogress";
import { DeploymentRefreshChecker } from "@/components/deployment-refresh";
import { FontSizeProvider } from "@/components/font-size-preference";
import { OfflineBanner, SWUpdatePrompt } from "@/components/offline";
import { NeutralAppFrameLoading } from "@/components/shells/app-frame-loading";
import { ThemeProvider } from "@/components/theme-provider";
import { env } from "@/env";
import { DOMAIN_HEADERS } from "@/proxy";
import { ALL_LANGUAGES, loadRouteTranslations } from "@/tolgee/shared";
import "../globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryProvider } from "@/lib/query";
import { TranslationProviders } from "./translation-providers";

type Props = {
	children: ReactNode;
	params: Promise<{ locale: string }>;
};

// Generate static params for all locales to enable static generation
export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

// Separate component for loading translations to wrap in Suspense
async function TranslationProvider({
	locale,
	children,
}: {
	locale: string;
	children: ReactNode;
}) {
	// Get the current pathname to determine which namespaces to load
	const headersList = await headers();
	const pathname = headersList.get(DOMAIN_HEADERS.PATHNAME) || "/";
	// Strip locale prefix from pathname (e.g., /en/settings -> /settings)
	const pathnameWithoutLocale =
		pathname.replace(new RegExp(`^/${locale}`), "") || "/";

	const records = await loadRouteTranslations(
		locale,
		pathnameWithoutLocale,
	).catch((error) => {
		console.warn("Failed to load Tolgee records:", error);
		return {};
	});

	return (
		<TranslationProviders locale={locale} records={records}>
			{children}
		</TranslationProviders>
	);
}

// Keep global metadata static to avoid loading legacy root locale messages on every page.
const DEFAULT_META = {
	title: "z8 - time app",
	description: "z8 - time app",
	keywords: "z8, time, app, productivity",
};

function TranslatedMeta() {
	return (
		<>
			<title>{DEFAULT_META.title}</title>
			<meta content={DEFAULT_META.description} name="description" />
			<meta content={DEFAULT_META.keywords} name="keywords" />
		</>
	);
}

function ApplicationContent({ children }: { children: ReactNode }) {
	return (
		<QueryProvider>
			<BProgressBar />
			<TooltipProvider delayDuration={0}>
				<OfflineBanner />
				<SWUpdatePrompt />
				<Suspense fallback={null}>
					<DeploymentRefreshChecker
						clientBuildHash={env.NEXT_PUBLIC_BUILD_HASH ?? "development"}
					/>
				</Suspense>
				{children}
				<Toaster position="bottom-right" richColors />
			</TooltipProvider>
		</QueryProvider>
	);
}

function AppProviders({
	children,
	locale,
}: {
	children: ReactNode;
	locale: string;
}) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<FontSizeProvider>
				<Suspense
					fallback={
						<TranslationProviders locale={locale} records={{}}>
							<ApplicationContent>
								<NeutralAppFrameLoading />
							</ApplicationContent>
						</TranslationProviders>
					}
				>
					<TranslationProvider locale={locale}>
						<ApplicationContent>{children}</ApplicationContent>
					</TranslationProvider>
				</Suspense>
			</FontSizeProvider>
		</ThemeProvider>
	);
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
				<link
					href="/apple-touch-icon.png"
					rel="apple-touch-icon"
					sizes="180x180"
				/>
				<link
					href="/favicon-32x32.png"
					rel="icon"
					sizes="32x32"
					type="image/png"
				/>
				<link
					href="/favicon-16x16.png"
					rel="icon"
					sizes="16x16"
					type="image/png"
				/>
				<link href="/site.webmanifest" rel="manifest" />
				<link color="#000000" href="/safari-pinned-tab.svg" rel="mask-icon" />
				<meta content="#000000" name="msapplication-TileColor" />
				<meta content="z8" name="apple-mobile-web-app-title" />
				<meta content="z8" name="application-name" />
				<meta content="yes" name="mobile-web-app-capable" />
				<meta content="yes" name="apple-mobile-web-app-capable" />
				<meta content="default" name="apple-mobile-web-app-status-bar-style" />
				<TranslatedMeta />
			</head>
			<body>
				<AppProviders locale={locale}>{children}</AppProviders>
			</body>
		</html>
	);
}
