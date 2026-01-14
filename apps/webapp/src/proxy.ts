import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";

// Main domain from environment variable
const MAIN_DOMAIN = process.env.NEXT_PUBLIC_MAIN_DOMAIN || "localhost:3000";

// Headers used to pass domain context to pages
export const DOMAIN_HEADERS = {
	ORG_ID: "x-z8-org-id",
	DOMAIN: "x-z8-domain",
	AUTH_CONFIG: "x-z8-auth-config",
	BRANDING: "x-z8-branding",
} as const;

export function proxy(request: NextRequest) {
	const handleI18nRouting = createMiddleware({
		locales: ALL_LANGUAGES,
		defaultLocale: DEFAULT_LANGUAGE,
		localePrefix: "always",
		localeDetection: true,
	});
	const response = handleI18nRouting(request);

	// If next-intl middleware already handled the redirect (e.g., for invalid locales),
	// return its response immediately
	if (response.status === 307 || response.status === 308) {
		return response;
	}

	// Custom domain detection
	const hostname = request.headers.get("host") || "";
	const normalizedHostname = hostname.toLowerCase().replace(/:\d+$/, "");
	const isMainDomain =
		normalizedHostname === MAIN_DOMAIN.toLowerCase().replace(/:\d+$/, "") ||
		normalizedHostname === "localhost" ||
		normalizedHostname.endsWith(".localhost");

	// Set custom domain header for server components to read
	if (!isMainDomain && normalizedHostname) {
		response.headers.set(DOMAIN_HEADERS.DOMAIN, normalizedHostname);
	}

	return response;
}

export const config = {
	// Skip all paths that should not be internationalized
	matcher: ["/((?!api|_next|.*\\..*).*)"],
};
