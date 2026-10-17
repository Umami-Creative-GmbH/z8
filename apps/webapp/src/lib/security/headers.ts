/**
 * Enterprise security headers module
 */

import { env } from "@/env";
import { splitRouteLocale } from "@/i18n/route-locale";
import type { SecurityHeadersConfig } from "./types";

/**
 * Get security headers configuration from environment
 */
export function getSecurityConfig(): SecurityHeadersConfig {
	const isDevelopment = env.NODE_ENV === "development";

	return {
		hstsPreload: env.SECURITY_HSTS_PRELOAD === "true",
		isDevelopment,
	};
}

/**
 * Build HSTS header value
 */
function buildHSTSHeader(preload: boolean): string {
	const parts = ["max-age=31536000", "includeSubDomains"];
	if (preload) {
		parts.push("preload");
	}
	return parts.join("; ");
}

/**
 * Whether a path is the kiosk page itself in a supported language
 * (`/{locale}/kiosk`, #1367): the one document that may use the camera, which
 * it does to read employee kiosk badges on the device. An unprefixed `/kiosk`
 * only redirects there, and no other path (`/en/kiosk-x`, `/en/settings/kiosks`)
 * counts.
 */
function isKioskDocument(pathname: string): boolean {
	const { locale, pathWithoutLocale } = splitRouteLocale(pathname);
	return locale !== undefined && pathWithoutLocale === "/kiosk";
}

/**
 * The Permissions-Policy: first-party geolocation everywhere, never the
 * microphone, and the camera only for the kiosk page (#1367).
 */
function permissionsPolicy(pathname: string | undefined): string {
	const camera = pathname !== undefined && isKioskDocument(pathname) ? "(self)" : "()";
	return `camera=${camera}, microphone=(), geolocation=(self)`;
}

/**
 * Apply all security headers to a response. `pathname` is the requested page's
 * path; without it, the response gets the most restrictive permissions.
 */
export function applySecurityHeaders(response: Response, options?: { pathname?: string }): void {
	const config = getSecurityConfig();

	// HSTS - only in production (browsers ignore it over HTTP anyway)
	if (!config.isDevelopment) {
		response.headers.set("Strict-Transport-Security", buildHSTSHeader(config.hstsPreload));
	}

	// Standard security headers
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("Permissions-Policy", permissionsPolicy(options?.pathname));
}
