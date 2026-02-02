import { headers } from "next/headers";
import Script from "next/script";
import { connection } from "next/server";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { env } from "@/env";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import { type DomainAuthContext, getDomainConfig } from "@/lib/domain";
import { getCookieConsentScript } from "@/lib/platform-settings";
import { DOMAIN_HEADERS } from "@/proxy";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default async function AuthLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Get domain from proxy headers
	const headersList = await headers();
	const customDomain = headersList.get(DOMAIN_HEADERS.DOMAIN);

	// Fetch domain config if on custom domain, otherwise use global config
	let domainContext: DomainAuthContext | null = null;
	if (customDomain) {
		domainContext = await getDomainConfig(customDomain);
	} else {
		// Main domain: use global Turnstile config from env vars
		const globalTurnstileSiteKey = env.TURNSTILE_SITE_KEY ?? null;
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
	const cookieConsentScript = await getCookieConsentScript();

	return (
		<DomainAuthProvider domainContext={domainContext}>
			{/* Cookie consent script - injected on auth pages only */}
			{cookieConsentScript && (
				<Script
					id="cookie-consent"
					strategy="afterInteractive"
					dangerouslySetInnerHTML={{ __html: cookieConsentScript }}
				/>
			)}
			<div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
				<div className="w-full md:max-w-3xl">
					<div className="mb-4 flex justify-end gap-2">
						<ThemeToggle />
						<LanguageSwitcher />
					</div>
					{children}
					<div className="mt-6">
						<InfoFooter />
					</div>
				</div>
			</div>
		</DomainAuthProvider>
	);
}
