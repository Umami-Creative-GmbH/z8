/**
 * Security header configuration types
 */

export interface SecurityHeadersConfig {
	/** Enable HSTS preload directive (requires domain to be submitted to hstspreload.org) */
	hstsPreload: boolean;
	/** Environment mode */
	isDevelopment: boolean;
}
