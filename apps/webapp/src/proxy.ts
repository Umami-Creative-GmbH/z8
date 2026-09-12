import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import {
	classifyDomainHost,
	resolvePlatformOrganization,
} from "@/lib/domain/platform-domain";
import {
	checkRateLimit,
	createRateLimitResponse,
	getClientIp,
} from "@/lib/rate-limit";
import { applySecurityHeaders } from "@/lib/security";
import { applySetupResponseHeaders } from "@/lib/setup/http";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";

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
	"/accept-invitation",
	"/forgot-password",
	"/reset-password",
	"/verify-email",
	"/verify-email-pending",
	"/verify-2fa",
	"/welcome",
	"/licenses",
	"/join",
	"/setup",
];

// Routes that authenticated users should be redirected away from
const AUTH_ROUTES = ["/sign-in", "/sign-up", "/forgot-password", "/welcome"];

const i18nMiddleware = createMiddleware(routing);

const SESSION_COOKIE_NAMES = [
	"__Secure-better-auth.session-token",
	"__Secure-better-auth.session_token",
	"__Secure-better-auth.session_data",
	"better-auth.session-token",
	"better-auth.session_token",
	"better-auth.session_data",
];

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Extract locale and path without locale for consistent handling
	const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(?:\/|$)/, "/");
	const locale =
		pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] || DEFAULT_LANGUAGE;
	const isApiRoute = pathname.startsWith("/api/");
	// API handlers perform authentication and authorization without page middleware.
	if (isApiRoute) {
		return NextResponse.next();
	}

	const setupLocale = routing.locales.find(
		(candidate) =>
			pathname === `/${candidate}/setup` ||
			pathname.startsWith(`/${candidate}/setup/`),
	);
	const isSetupPage =
		Boolean(setupLocale) ||
		pathWithoutLocale === "/setup" ||
		pathWithoutLocale.startsWith("/setup/");
	const domainClassification = classifyDomainHost(request.headers.get("host"));
	if (domainClassification?.type === "unknownPlatform") {
		const response = new NextResponse("Not found", { status: 404 });
		applySecurityHeaders(response);
		if (isSetupPage) applySetupResponseHeaders(response);
		return response;
	}
	if (domainClassification?.type === "platformOrganization") {
		const platformOrganization = await resolvePlatformOrganization(
			domainClassification.label,
		);
		if (!platformOrganization) {
			const response = new NextResponse("Not found", { status: 404 });
			applySecurityHeaders(response);
			if (isSetupPage) applySetupResponseHeaders(response);
			return response;
		}
	}
	// Exchange in a Route Handler before any HTML/analytics can see a credential URL.
	// An internal rewrite avoids a second browser request containing the secret.
	if (isSetupPage && request.nextUrl.searchParams.has("code")) {
		const authorizeUrl = new URL("/api/setup/authorize", request.url);
		for (const code of request.nextUrl.searchParams.getAll("code")) {
			authorizeUrl.searchParams.append("code", code);
		}
		authorizeUrl.searchParams.set("locale", setupLocale || locale);
		const response = NextResponse.rewrite(authorizeUrl);
		applySetupResponseHeaders(response);
		return response;
	}

	// Platform setup check - redirect to /setup if not configured
	// This runs before all other checks to ensure unconfigured instances are protected
	if (!isSetupPage) {
		const { isPlatformConfigured } = await import("@/lib/setup/config-cache");
		const configured = await isPlatformConfigured();
		if (!configured) {
			const setupUrl = new URL(`/${locale}/setup`, request.url);
			return NextResponse.redirect(setupUrl);
		}
	} else {
		// On setup page - redirect to home if already configured
		const { isPlatformConfigured } = await import("@/lib/setup/config-cache");
		const configured = await isPlatformConfigured();
		if (configured) {
			const homeUrl = new URL(`/${setupLocale || locale}/`, request.url);
			const response = NextResponse.redirect(homeUrl);
			applySetupResponseHeaders(response);
			return response;
		}
	}

	// Rate limiting for auth pages. API routes are excluded by the matcher below and
	// must enforce rate limits in their route handlers.
	if (
		pathWithoutLocale === "/sign-in" ||
		pathWithoutLocale === "/sign-up" ||
		pathWithoutLocale === "/forgot-password"
	) {
		const clientIp = getClientIp(request);
		const endpoint =
			pathWithoutLocale === "/sign-up"
				? "signUp"
				: pathWithoutLocale === "/forgot-password"
					? "passwordReset"
					: "auth";

		const rateLimitResult = await checkRateLimit(clientIp, endpoint);

		if (!rateLimitResult.allowed) {
			return createRateLimitResponse(rateLimitResult, request);
		}
	}

	// Handle i18n routing first
	const response = i18nMiddleware(request);

	// If i18n middleware redirected (e.g., for locale prefix), return immediately
	if (response.status === 307 || response.status === 308) {
		if (isSetupPage) applySetupResponseHeaders(response);
		return response;
	}

	// Check if this is a public route
	const isPublicRoute =
		isSetupPage ||
		PUBLIC_ROUTES.some(
			(route) =>
				pathWithoutLocale === route ||
				pathWithoutLocale.startsWith(`${route}/`),
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
	const hasSessionCookie = SESSION_COOKIE_NAMES.some((cookieName) =>
		request.cookies.has(cookieName),
	);

	// Handle authentication redirects
	if (!hasSessionCookie) {
		// Not authenticated - redirect to sign-in if trying to access protected route
		if (!isPublicRoute) {
			const locale =
				pathname.match(/^\/([a-z]{2})(?:\/|$)/)?.[1] || DEFAULT_LANGUAGE;
			const signInUrl = new URL(`/${locale}/sign-in`, request.url);
			signInUrl.searchParams.set("callbackUrl", pathWithoutLocale);
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

	// Apply enterprise security headers (HSTS, frame/referrer/content type policies)
	applySecurityHeaders(response);
	if (isSetupPage) applySetupResponseHeaders(response);

	// Custom domain detection. Platform organization subdomains are resolved separately
	// and must not be tagged as customer-owned custom domains.
	if (domainClassification?.type === "customDomain") {
		response.headers.set(DOMAIN_HEADERS.DOMAIN, domainClassification.hostname);
	}

	return response;
}

export const config = {
	matcher: ["/((?!ingest|_next|.*\\..*).*)"],
};
