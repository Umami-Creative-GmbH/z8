import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { pickAcceptLanguage } from "@/i18n/accept-language";
import { splitRouteLocale } from "@/i18n/route-locale";
import { routing } from "@/i18n/routing";
import {
	classifyDomainHost,
	resolvePlatformOrganization,
} from "@/lib/domain/platform-domain";
import { resolvePublicRedirectOrigin } from "@/lib/domain/request-origin";
import {
	checkRateLimit,
	createRateLimitResponse,
	getClientIp,
} from "@/lib/rate-limit";
import { applyShareResponseHeaders } from "@/lib/projects/report-share/http";
import { applySecurityHeaders } from "@/lib/security";
import { applySetupResponseHeaders } from "@/lib/setup/http";
import { DEFAULT_LANGUAGE } from "@/tolgee/catalog-config";

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
	// Kiosk devices have no user session; they authenticate with a device token (#859).
	"/kiosk",
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

// Next 16 builds the proxy's request.url from its listening address, so browser
// redirects resolve against the validated public origin instead.
async function publicRedirectUrl(
	path: string,
	request: NextRequest,
): Promise<URL> {
	return new URL(path, await resolvePublicRedirectOrigin(request));
}

// next-intl resolves its locale-prefix redirect against request.url too.
async function rebaseLocaleRedirect(
	response: NextResponse,
	request: NextRequest,
): Promise<void> {
	const location = response.headers.get("location");
	if (!location) return;
	const target = new URL(location, request.url);
	if (target.origin !== new URL(request.url).origin) return;
	const publicUrl = await publicRedirectUrl(
		`${target.pathname}${target.search}${target.hash}`,
		request,
	);
	response.headers.set("location", publicUrl.toString());
}

// `/share/<token>`, or with an explicit language prefix such as `/de/share/<token>`.
const SHARE_PAGE_PATH = /^\/(?:([a-z]{2,3})\/)?share\/([^/]+)\/?$/;

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/**
 * Report share link pages (#806): rate-limited per client IP and per token,
 * never cached, indexed or referred, and rendered without the locale
 * redirect, so the token never travels in a second request. The language is
 * the URL's prefix, else the recipient's browser language, else the creator's.
 */
async function handleSharePage(
	request: NextRequest,
	prefix: string | undefined,
	token: string,
): Promise<Response> {
	const prefixLocale = routing.locales.find((candidate) => candidate === prefix);
	if (prefix !== undefined && !prefixLocale) {
		const response = new NextResponse("Not found", { status: 404 });
		applySecurityHeaders(response);
		return applyShareResponseHeaders(response);
	}
	for (const [identifier, endpoint] of [
		[getClientIp(request), "reportShare"],
		[`report-share:${await sha256Hex(token)}`, "reportShareToken"],
	] as const) {
		const rateLimit = await checkRateLimit(identifier, endpoint);
		if (!rateLimit.allowed) {
			return applyShareResponseHeaders(
				createRateLimitResponse(rateLimit, request),
			);
		}
	}

	let response: NextResponse;
	if (prefixLocale) {
		response = NextResponse.next();
	} else {
		const locale =
			pickAcceptLanguage(
				request.headers.get("accept-language"),
				routing.locales,
			) ??
			(await (
				await import("@/lib/projects/report-share/creator-locale")
			).shareLinkCreatorLocaleForToken(token)) ??
			DEFAULT_LANGUAGE;
		response = NextResponse.rewrite(
			new URL(`/${locale}/share/${token}`, request.url),
		);
	}
	applySecurityHeaders(response);
	return applyShareResponseHeaders(response);
}

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	// Extract locale and path without locale for consistent handling
	const { locale: routeLocale, pathWithoutLocale } = splitRouteLocale(pathname);
	const locale = routeLocale ?? DEFAULT_LANGUAGE;
	const isApiRoute = pathname.startsWith("/api/");
	// API handlers perform authentication and authorization without page middleware.
	if (isApiRoute) {
		return NextResponse.next();
	}

	const isSetupPage =
		pathWithoutLocale === "/setup" || pathWithoutLocale.startsWith("/setup/");
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
		authorizeUrl.searchParams.set("locale", locale);
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
			const setupUrl = await publicRedirectUrl(`/${locale}/setup`, request);
			return NextResponse.redirect(setupUrl);
		}
	} else {
		// On setup page - redirect to home if already configured
		const { isPlatformConfigured } = await import("@/lib/setup/config-cache");
		const configured = await isPlatformConfigured();
		if (configured) {
			const homeUrl = await publicRedirectUrl(
				`/${locale}/`,
				request,
			);
			const response = NextResponse.redirect(homeUrl);
			applySetupResponseHeaders(response);
			return response;
		}
	}

	// Report share link pages open without a session; the token in the path is the credential.
	const sharePage = pathname.match(SHARE_PAGE_PATH);
	if (sharePage) {
		return handleSharePage(request, sharePage[1], sharePage[2] ?? "");
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
		await rebaseLocaleRedirect(response, request);
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
			const signInUrl = await publicRedirectUrl(`/${locale}/sign-in`, request);
			signInUrl.searchParams.set("callbackUrl", pathWithoutLocale);
			return NextResponse.redirect(signInUrl);
		}
	} else {
		// Authenticated - redirect away from auth routes
		if (isAuthRoute) {
			const dashboardUrl = await publicRedirectUrl(`/${locale}/`, request);
			return NextResponse.redirect(dashboardUrl);
		}
	}

	// Set pathname header for server components (used for callback URLs)
	response.headers.set(DOMAIN_HEADERS.PATHNAME, pathname);

	// Apply enterprise security headers (HSTS, frame/referrer/content type policies); the
	// kiosk page alone may use the camera, to read badges (#1367).
	applySecurityHeaders(response, { pathname });
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
