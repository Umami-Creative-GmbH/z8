/**
 * How Z8 configures the Better Auth API-key plugin (#763). Shared by the
 * production auth instance and the suites that verify real keys.
 */

/**
 * Keys reference their organization (ADR 0001). The defaults apply only to a
 * key without its own limit; every key Z8 creates stores the limit its admin chose.
 */
export const API_KEY_PLUGIN_OPTIONS = {
	references: "organization",
	rateLimit: {
		enabled: true,
		timeWindow: 60 * 1000, // 1 minute
		maxRequests: 100, // 100 requests per minute default
	},
	enableMetadata: true,
} as const;

/**
 * The plugin's HTTP management endpoints. Z8 closes them (`disabledPaths`): org
 * API keys are created, changed and revoked only through the settings actions,
 * which enforce the per-org limit and audit every change. Server-side
 * `auth.api.verifyApiKey` is unaffected.
 */
export const API_KEY_HTTP_PATHS = [
	"/api-key/create",
	"/api-key/get",
	"/api-key/update",
	"/api-key/delete",
	"/api-key/list",
	"/api-key/verify",
	"/api-key/delete-all-expired-api-keys",
] as const;
