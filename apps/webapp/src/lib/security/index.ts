/**
 * Enterprise security module
 *
 * Provides nonce-based CSP and HSTS headers with environment-aware configuration.
 *
 * @example
 * ```ts
 * import { applySecurityHeaders, NONCE_HEADER } from "@/lib/security";
 *
 * // In middleware/proxy
 * const nonce = applySecurityHeaders(response);
 * ```
 */

export { applySecurityHeaders, getSecurityConfig, NONCE_HEADER } from "./headers";
export { buildCSPHeader, generateNonce, getCSPHeaderName } from "./csp";
export type {
	CSPConfig,
	CSPDirectives,
	CSPViolationReport,
	SecurityHeadersConfig,
} from "./types";
