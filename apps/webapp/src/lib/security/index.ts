/**
 * Enterprise security module
 *
 * Provides enterprise security headers with environment-aware configuration.
 *
 * @example
 * ```ts
 * import { applySecurityHeaders } from "@/lib/security";
 *
 * // In middleware/proxy
 * applySecurityHeaders(response);
 * ```
 */

export { applySecurityHeaders, getSecurityConfig } from "./headers";
export type { SecurityHeadersConfig } from "./types";
