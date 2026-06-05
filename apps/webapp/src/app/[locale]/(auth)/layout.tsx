import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Script from "next/script";
import { connection } from "next/server";
import { AuthBackgroundImage } from "@/components/auth-background-image";
import { selectRandomAuthBackgroundImage } from "@/components/auth-background-images";
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
	const backgroundImage = selectRandomAuthBackgroundImage();

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
				<AuthBackgroundImage initialImage={backgroundImage} />
				<section className="relative z-10 flex min-h-svh flex-col px-4 pt-4 pb-0 sm:px-8 sm:pt-6 sm:pb-0 lg:px-10">
					<div className="auth-shell-controls auth-shell-controls-readable flex items-center justify-end gap-2 drop-shadow-sm [&_[data-slot=dropdown-menu-trigger]]:!border-white/20 [&_[data-slot=dropdown-menu-trigger]]:!bg-slate-950/85 [&_[data-slot=dropdown-menu-trigger]]:!text-white [&_[data-slot=dropdown-menu-trigger]]:!shadow-lg [&_[data-slot=dropdown-menu-trigger]]:!shadow-slate-950/20 [&_[data-slot=dropdown-menu-trigger]]:!backdrop-blur-xl [&_[data-slot=dropdown-menu-trigger]:hover]:!bg-slate-950/95 [&_[data-slot=select-trigger]]:!border-white/20 [&_[data-slot=select-trigger]]:!bg-slate-950/85 [&_[data-slot=select-trigger]]:!text-white [&_[data-slot=select-trigger]]:!shadow-lg [&_[data-slot=select-trigger]]:!shadow-slate-950/20 [&_[data-slot=select-trigger]]:!backdrop-blur-xl [&_[data-slot=select-trigger]:hover]:!bg-slate-950/95 [&_[data-slot=select-trigger]_svg]:!text-white">
						<ThemeToggle />
						<FontSizeToggle />
						<LanguageSwitcher />
					</div>

					<main className="flex flex-1 items-center justify-center py-8 sm:py-10">
						<div className="w-full max-w-3xl">{children}</div>
					</main>

					<div className="pt-2 pb-2 drop-shadow-sm">
						<InfoFooter />
					</div>
				</section>
			</div>
		</DomainAuthProvider>
	);
}
