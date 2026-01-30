/**
 * Security header configuration types
 */

export interface CSPDirectives {
	"default-src"?: string[];
	"script-src"?: string[];
	"style-src"?: string[];
	"img-src"?: string[];
	"font-src"?: string[];
	"connect-src"?: string[];
	"worker-src"?: string[];
	"frame-ancestors"?: string[];
	"form-action"?: string[];
	"base-uri"?: string[];
	"object-src"?: string[];
	"report-uri"?: string[];
	"upgrade-insecure-requests"?: boolean;
}

export interface SecurityHeadersConfig {
	/** Enable HSTS preload directive (requires domain to be submitted to hstspreload.org) */
	hstsPreload: boolean;
	/** CSP violation report endpoint */
	cspReportUri: string;
	/** Use report-only mode (doesn't block, just reports violations) */
	cspReportOnly: boolean;
	/** Environment mode */
	isDevelopment: boolean;
}

export interface CSPConfig {
	/** Cryptographic nonce for inline scripts and styles */
	nonce: string;
	/** Security headers configuration */
	config: SecurityHeadersConfig;
}

export interface CSPViolationReport {
	"csp-report": {
		"document-uri": string;
		referrer?: string;
		"violated-directive": string;
		"effective-directive": string;
		"original-policy": string;
		"blocked-uri": string;
		"status-code"?: number;
		"source-file"?: string;
		"line-number"?: number;
		"column-number"?: number;
	};
}
