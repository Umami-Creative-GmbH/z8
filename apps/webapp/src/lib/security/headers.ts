/**
 * Enterprise security headers module
 */

import { buildCSPHeader, generateNonce, getCSPHeaderName } from "./csp";
import type { SecurityHeadersConfig } from "./types";

/** Header name for passing nonce to layout */
export const NONCE_HEADER = "x-nonce";

/**
 * Get security headers configuration from environment
 */
export function getSecurityConfig(): SecurityHeadersConfig {
	const isDevelopment = process.env.NODE_ENV === "development";

	return {
		hstsPreload: process.env.SECURITY_HSTS_PRELOAD === "true",
		cspReportUri: process.env.SECURITY_CSP_REPORT_URI || "/api/csp-report",
		cspReportOnly: process.env.SECURITY_CSP_REPORT_ONLY === "true",
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
 * @returns The generated nonce (for passing to components)
 */
export function applySecurityHeaders(response: Response): string {
	const config = getSecurityConfig();
	const nonce = generateNonce();

	// CSP header (skip in development if not explicitly enabled)
	const cspHeader = buildCSPHeader({ nonce, config });
	const cspHeaderName = getCSPHeaderName(config.cspReportOnly);
	response.headers.set(cspHeaderName, cspHeader);

	// HSTS - only in production (browsers ignore it over HTTP anyway)
	if (!config.isDevelopment) {
		response.headers.set("Strict-Transport-Security", buildHSTSHeader(config.hstsPreload));
	}

	// Standard security headers
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "DENY");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

	// Pass nonce to layout via header
	response.headers.set(NONCE_HEADER, nonce);

	return nonce;
}
