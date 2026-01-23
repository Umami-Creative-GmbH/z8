/**
 * Content Security Policy (CSP) builder utility
 */

import type { CSPConfig, CSPDirectives } from "./types";

/**
 * Generate a cryptographic nonce using Web Crypto API
 * Available in Edge Runtime and modern Node.js
 */
export function generateNonce(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return btoa(String.fromCharCode(...array));
}

/**
 * Build CSP directives for production (strict, nonce-based)
 */
function buildProductionDirectives(nonce: string, reportUri: string): CSPDirectives {
	return {
		"default-src": ["'self'"],
		"script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"],
		"style-src": ["'self'", `'nonce-${nonce}'`],
		"img-src": ["'self'", "data:", "blob:", "https:"],
		"font-src": ["'self'", "data:"],
		"connect-src": ["'self'", "https:"],
		"worker-src": ["'self'", "blob:"],
		"frame-ancestors": ["'none'"],
		"form-action": ["'self'"],
		"base-uri": ["'self'"],
		"object-src": ["'none'"],
		"report-uri": [reportUri],
		"upgrade-insecure-requests": true,
	};
}

/**
 * Build CSP directives for development (relaxed for HMR and local testing)
 * Allows http: connections for custom domain testing against localhost
 */
function buildDevelopmentDirectives(): CSPDirectives {
	return {
		"default-src": ["'self'"],
		"script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
		"style-src": ["'self'", "'unsafe-inline'"],
		"img-src": ["'self'", "data:", "blob:", "https:", "http:"],
		"font-src": ["'self'", "data:"],
		// Allow http: in dev for custom domain testing (e.g., custom.localhost -> localhost:3000)
		"connect-src": ["'self'", "https:", "http:", "ws:", "wss:"],
		"worker-src": ["'self'", "blob:"],
		"frame-ancestors": ["'none'"],
	};
}

/**
 * Serialize CSP directives into a header string
 */
function serializeDirectives(directives: CSPDirectives): string {
	const parts: string[] = [];

	for (const [directive, value] of Object.entries(directives)) {
		if (value === true) {
			// Boolean directives like upgrade-insecure-requests
			parts.push(directive);
		} else if (Array.isArray(value) && value.length > 0) {
			parts.push(`${directive} ${value.join(" ")}`);
		}
	}

	return parts.join("; ");
}

/**
 * Build the complete CSP header value
 */
export function buildCSPHeader(cspConfig: CSPConfig): string {
	const { nonce, config } = cspConfig;

	const directives = config.isDevelopment
		? buildDevelopmentDirectives()
		: buildProductionDirectives(nonce, config.cspReportUri);

	return serializeDirectives(directives);
}

/**
 * Get the CSP header name based on report-only mode
 */
export function getCSPHeaderName(reportOnly: boolean): string {
	return reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}
