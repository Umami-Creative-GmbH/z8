import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";
import {
	checkRateLimit,
	createRateLimitResponse,
	getClientIp,
	RATE_LIMIT_CONFIGS,
} from "@/lib/rate-limit";

// Main domain from environment variable
const MAIN_DOMAIN = process.env.NEXT_PUBLIC_MAIN_DOMAIN || "localhost:3000";

// Headers used to pass context to pages
export const DOMAIN_HEADERS = {
	ORG_ID: "x-z8-org-id",
	DOMAIN: "x-z8-domain",
	AUTH_CONFIG: "x-z8-auth-config",
	BRANDING: "x-z8-branding",
	PATHNAME: "x-pathname",
} as const;

// Routes that don't require authentication
const PUBLIC_ROUTES = [
	"/sign-in",
	"/sign-up",
	"/forgot-password",
	"/reset-password",
	"/verify-email",
	"/verify-email-pending",
	"/verify-2fa",
	"/welcome",
	"/privacy",
	"/terms",
	"/imprint",
	"/licenses",
];

// Routes that authenticated users should be redirected away from
const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password", "/welcome"];

const i18nMiddleware = createMiddleware({
	locales: ALL_LANGUAGES,
	defaultLocale: DEFAULT_LANGUAGE,
	localePrefix: "always",
	localeDetection: true,
});

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Rate limiting for auth endpoints
	const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(?:\/|$)/, "/");
	if (
		pathWithoutLocale === "/sign-in" ||
		pathWithoutLocale === "/sign-up" ||
		pathWithoutLocale === "/forgot-password" ||
		pathWithoutLocale.startsWith("/api/auth/")
	) {
		const clientIp = getClientIp(request);
		const config =
			pathWithoutLocale === "/sign-up"
				? RATE_LIMIT_CONFIGS.signUp
				: pathWithoutLocale === "/forgot-password"
					? RATE_LIMIT_CONFIGS.passwordReset
					: RATE_LIMIT_CONFIGS.auth;

		const rateLimitResult = await checkRateLimit(clientIp, "auth", config);

		if (!rateLimitResult.allowed) {
			return createRateLimitResponse(rateLimitResult);
		}
	}

	// Handle i18n routing first
	const response = i18nMiddleware(request);

	// If i18n middleware redirected (e.g., for locale prefix), return immediately
	if (response.status === 307 || response.status === 308) {
		return response;
	}

	// Check if this is a public route
	const isPublicRoute = PUBLIC_ROUTES.some(
		(route) =>
			pathWithoutLocale === route || pathWithoutLocale.startsWith(`${route}/`),
	);

	// Check if this is an auth route (sign-in, sign-up, etc.)
	const isAuthRoute = AUTH_ROUTES.some(
		(route) =>
			pathWithoutLocale === route || pathWithoutLocale.startsWith(`${route}/`),
	);

	// Check for session cookie presence
	// NOTE: We only check cookie existence, not signature validity.
	// getCookieCache signature verification fails with externalized better-auth.
	// Real authentication happens server-side in pages/API routes via auth.api.getSession()
	const hasSessionCookie =
		request.cookies.has("better-auth.session_token") ||
		request.cookies.has("better-auth.session_data");

	// Handle authentication redirects
	if (!hasSessionCookie) {
		// Not authenticated - redirect to sign-in if trying to access protected route
		if (!isPublicRoute) {
			const locale =
				pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] || DEFAULT_LANGUAGE;
			const signInUrl = new URL(`/${locale}/sign-in`, request.url);
			signInUrl.searchParams.set("callbackUrl", pathname);
			return NextResponse.redirect(signInUrl);
		}
	} else {
		// Authenticated - redirect away from auth routes
		if (isAuthRoute) {
			const locale =
				pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] || DEFAULT_LANGUAGE;
			const dashboardUrl = new URL(`/${locale}/`, request.url);
			return NextResponse.redirect(dashboardUrl);
		}
	}

	// Set pathname header for server components (used for callback URLs)
	response.headers.set(DOMAIN_HEADERS.PATHNAME, pathname);

	// Security headers
	response.headers.set(
		"Content-Security-Policy",
		"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';",
	);
	response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

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
	// Match all routes except API, static files, and Next.js internals
	matcher: ["/((?!api|_next|.*\\..*).*)"],
};
