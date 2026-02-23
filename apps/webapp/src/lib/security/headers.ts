/**
 * Enterprise security headers module
 */

import type { SecurityHeadersConfig } from "./types";

/**
 * Get security headers configuration from environment
 */
export function getSecurityConfig(): SecurityHeadersConfig {
	const isDevelopment = process.env.NODE_ENV === "development";

	return {
		hstsPreload: process.env.SECURITY_HSTS_PRELOAD === "true",
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
 * Apply all security headers to a response
 */
export function applySecurityHeaders(response: Response): void {
	const config = getSecurityConfig();

	// HSTS - only in production (browsers ignore it over HTTP anyway)
	if (!config.isDevelopment) {
		response.headers.set("Strict-Transport-Security", buildHSTSHeader(config.hstsPreload));
	}

	// Standard security headers
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}
