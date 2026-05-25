import { headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import Script from "next/script";
import { connection } from "next/server";
import authImage from "@/../public/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import { FontSizeToggle } from "@/components/font-size-toggle";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { env } from "@/env";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import {
	classifyDomainHost,
	type DomainAuthContext,
	getDomainConfig,
	getPlatformDomainConfig,
} from "@/lib/domain";
import { getCustomDomainFromHeaders } from "@/lib/domain/request-domain";
import { getCookieConsentScript } from "@/lib/platform-settings";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import { parseCookieConsentScript, selectAuthCookieConsentScript } from "./cookie-consent-script";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Derive custom domains from the trusted request Host header.
	const headersList = await headers();
	const host = headersList.get("host");
	const domainClassification = classifyDomainHost(host);
	if (domainClassification?.type === "unknownPlatform") {
		notFound();
	}
	const customDomain = getCustomDomainFromHeaders(headersList);

	// Fetch domain config if on a platform or custom domain, otherwise use global config
	let domainContext: DomainAuthContext | null = null;
	const platformDomainContext = await getPlatformDomainConfig(host ?? "");
	const globalTurnstileSiteKey = env.TURNSTILE_SITE_KEY ?? null;
	if (platformDomainContext) {
		domainContext = {
			...platformDomainContext,
			turnstile: {
				enabled: !!globalTurnstileSiteKey,
				siteKey: globalTurnstileSiteKey,
				isEnterprise: false,
			},
		};
	} else if (domainClassification?.type === "platformOrganization") {
		notFound();
	} else if (customDomain) {
		domainContext = await getDomainConfig(customDomain);
	} else {
		// Main domain: use global Turnstile config from env vars
		domainContext = {
			organizationId: "",
			domain: "",
			authConfig: {
				emailPasswordEnabled: true,
				socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
				ssoEnabled: false,
				passkeyEnabled: true,
			},
			branding: null,
			socialOAuthConfigured: {
				google: false,
				github: false,
				linkedin: false,
				apple: false,
			},
			turnstile: {
				enabled: !!globalTurnstileSiteKey,
				siteKey: globalTurnstileSiteKey,
				isEnterprise: false,
			},
		};
	}

	// Fetch cookie consent script for auth pages
	const platformCookieConsentScript = customDomain ? null : await getCookieConsentScript();
	const cookieConsentScript = selectAuthCookieConsentScript(
		platformDomainContext ? null : domainContext,
		platformCookieConsentScript,
	);
	const parsedCookieConsentScript = parseCookieConsentScript(cookieConsentScript);
	const { content: cookieConsentScriptContent, ...cookieConsentScriptProps } =
		parsedCookieConsentScript ?? {};

	return (
		<DomainAuthProvider domainContext={domainContext}>
			{/* Cookie consent script - injected on auth pages only */}
			{cookieConsentScriptProps.src ? (
				<Script
					{...cookieConsentScriptProps}
					id={cookieConsentScriptProps.id ?? "cookie-consent"}
					strategy="afterInteractive"
				/>
			) : cookieConsentScriptContent ? (
				<Script
					{...cookieConsentScriptProps}
					id={cookieConsentScriptProps.id ?? "cookie-consent"}
					strategy="afterInteractive"
				>
					{cookieConsentScriptContent}
				</Script>
			) : null}
			<div className="relative min-h-svh overflow-x-hidden bg-background">
				<Image
					alt=""
					className="absolute inset-0 size-full object-cover"
					fill
					priority
					sizes="100vw"
					src={authImage}
				/>
				<div className="absolute inset-0 bg-background/35 dark:bg-background/55" />

				<section className="relative z-10 flex min-h-svh flex-col px-4 py-4 sm:px-8 sm:py-6 lg:px-10">
					<div className="flex items-center justify-end gap-2 drop-shadow-sm">
						<ThemeToggle />
						<FontSizeToggle />
						<LanguageSwitcher />
					</div>

					<main className="flex flex-1 items-center justify-center py-8 sm:py-10">
						<div className="w-full max-w-3xl">{children}</div>
					</main>

					<div className="pt-2 drop-shadow-sm">
						<InfoFooter />
					</div>
				</section>
			</div>
		</DomainAuthProvider>
	);
}
