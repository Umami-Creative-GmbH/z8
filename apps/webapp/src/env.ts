import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	server: {
		// DATABASE_URL: z.string().url(), // Not used, using individual vars
		// Postgres connection details
		POSTGRES_HOST: z.string().optional(),
		POSTGRES_PORT: z.string().optional(),
		POSTGRES_DB: z.string().optional(),
		POSTGRES_USER: z.string().optional(),
		POSTGRES_PASSWORD: z.string().optional(),

		BETTER_AUTH_SECRET: z.string().min(1),
		// Valkey / Redis
		VALKEY_HOST: z.string().optional(),
		VALKEY_PORT: z.string().optional(),
		VALKEY_PASSWORD: z.string().optional(),
		REDIS_HOST: z.string().optional(),
		REDIS_PORT: z.string().optional(),
		REDIS_PASSWORD: z.string().optional(),

		// AWS S3 / Object Storage
		S3_BUCKET: z.string().optional(),
		S3_ACCESS_KEY_ID: z.string().optional(),
		S3_SECRET_ACCESS_KEY: z.string().optional(),
		S3_ENDPOINT: z.string().optional(),
		S3_REGION: z.string().optional(),
		S3_FORCE_PATH_STYLE: z.string().optional(),
		S3_PUBLIC_URL: z.string().optional(),

		// Worker / Jobs
		ENABLE_CRON_JOBS: z.string().optional(),
		WORKER_CONCURRENCY: z.string().optional(),

		// Vault
		VAULT_ADDR: z.string().optional(),
		VAULT_TOKEN: z.string().optional(),

		// Tolgee (Server side)
		TOLGEE_PROJECT_ID: z.string().optional(),
		TOLGEE_API_KEY: z.string().optional(),
		TOLGEE_API_URL: z.string().optional(),

		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),

		// Security headers
		SECURITY_HSTS_PRELOAD: z.enum(["true", "false"]).optional(),
		SECURITY_CSP_REPORT_URI: z.string().optional(),
		SECURITY_CSP_REPORT_ONLY: z.enum(["true", "false"]).optional(),

		// Rate limiting
		RATE_LIMIT_DISABLED: z.enum(["true", "false"]).optional(),
		RATE_LIMIT_AUTH: z.string().optional(), // format: "requests/seconds" e.g. "10/60"
		RATE_LIMIT_SIGNUP: z.string().optional(),
		RATE_LIMIT_PASSWORD_RESET: z.string().optional(),
		RATE_LIMIT_API: z.string().optional(),
		RATE_LIMIT_EXPORT: z.string().optional(),

		// Domain configuration (server-side only for runtime flexibility)
		MAIN_DOMAIN: z.string().optional(),

		// Social OAuth - Global/fallback credentials (optional, orgs can configure their own)
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		GITHUB_CLIENT_ID: z.string().optional(),
		GITHUB_CLIENT_SECRET: z.string().optional(),
		LINKEDIN_CLIENT_ID: z.string().optional(),
		LINKEDIN_CLIENT_SECRET: z.string().optional(),

		// Calendar Sync OAuth (separate from social login - different scopes)
		CALENDAR_GOOGLE_CLIENT_ID: z.string().optional(),
		CALENDAR_GOOGLE_CLIENT_SECRET: z.string().optional(),
		CALENDAR_MICROSOFT_CLIENT_ID: z.string().optional(),
		CALENDAR_MICROSOFT_CLIENT_SECRET: z.string().optional(),

		// Cloudflare Turnstile (global/platform-wide)
		TURNSTILE_SITE_KEY: z.string(),
		TURNSTILE_SECRET_KEY: z.string(),

		// Billing / Stripe (SaaS mode only - disabled for self-hosted)
		BILLING_ENABLED: z.enum(["true", "false"]).optional().default("false"),
		STRIPE_SECRET_KEY: z.string().optional(),
		STRIPE_WEBHOOK_SECRET: z.string().optional(),
		STRIPE_PRICE_MONTHLY_ID: z.string().optional(),
		STRIPE_PRICE_YEARLY_ID: z.string().optional(),
	},
	client: {
		NEXT_PUBLIC_APP_URL: z.url().optional(),
		NEXT_PUBLIC_TOLGEE_API_KEY: z.string().optional(),
		NEXT_PUBLIC_TOLGEE_API_URL: z.url().optional(),
	},
	runtimeEnv: {
		// DATABASE_URL: process.env.DATABASE_URL,
		POSTGRES_HOST: process.env.POSTGRES_HOST,
		POSTGRES_PORT: process.env.POSTGRES_PORT,
		POSTGRES_DB: process.env.POSTGRES_DB,
		POSTGRES_USER: process.env.POSTGRES_USER,
		POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,

		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		VALKEY_HOST: process.env.VALKEY_HOST,
		VALKEY_PORT: process.env.VALKEY_PORT,
		VALKEY_PASSWORD: process.env.VALKEY_PASSWORD,
		REDIS_HOST: process.env.REDIS_HOST,
		REDIS_PORT: process.env.REDIS_PORT,
		REDIS_PASSWORD: process.env.REDIS_PASSWORD,

		S3_BUCKET: process.env.S3_BUCKET,
		S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
		S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
		S3_ENDPOINT: process.env.S3_ENDPOINT,
		S3_REGION: process.env.S3_REGION,
		S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
		S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,

		ENABLE_CRON_JOBS: process.env.ENABLE_CRON_JOBS,
		WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
		VAULT_ADDR: process.env.VAULT_ADDR,
		VAULT_TOKEN: process.env.VAULT_TOKEN,
		TOLGEE_PROJECT_ID: process.env.TOLGEE_PROJECT_ID,
		TOLGEE_API_KEY: process.env.TOLGEE_API_KEY,
		TOLGEE_API_URL: process.env.TOLGEE_API_URL,
		NODE_ENV: process.env.NODE_ENV,
		SECURITY_HSTS_PRELOAD: process.env.SECURITY_HSTS_PRELOAD,
		SECURITY_CSP_REPORT_URI: process.env.SECURITY_CSP_REPORT_URI,
		SECURITY_CSP_REPORT_ONLY: process.env.SECURITY_CSP_REPORT_ONLY,
		RATE_LIMIT_DISABLED: process.env.RATE_LIMIT_DISABLED,
		RATE_LIMIT_AUTH: process.env.RATE_LIMIT_AUTH,
		RATE_LIMIT_SIGNUP: process.env.RATE_LIMIT_SIGNUP,
		RATE_LIMIT_PASSWORD_RESET: process.env.RATE_LIMIT_PASSWORD_RESET,
		RATE_LIMIT_API: process.env.RATE_LIMIT_API,
		RATE_LIMIT_EXPORT: process.env.RATE_LIMIT_EXPORT,
		NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
		MAIN_DOMAIN: process.env.MAIN_DOMAIN,
		NEXT_PUBLIC_TOLGEE_API_KEY: process.env.NEXT_PUBLIC_TOLGEE_API_KEY,
		NEXT_PUBLIC_TOLGEE_API_URL: process.env.NEXT_PUBLIC_TOLGEE_API_URL,
		GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
		LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
		LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
		CALENDAR_GOOGLE_CLIENT_ID: process.env.CALENDAR_GOOGLE_CLIENT_ID,
		CALENDAR_GOOGLE_CLIENT_SECRET: process.env.CALENDAR_GOOGLE_CLIENT_SECRET,
		CALENDAR_MICROSOFT_CLIENT_ID: process.env.CALENDAR_MICROSOFT_CLIENT_ID,
		CALENDAR_MICROSOFT_CLIENT_SECRET:
			process.env.CALENDAR_MICROSOFT_CLIENT_SECRET,
		TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,
		TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
		BILLING_ENABLED: process.env.BILLING_ENABLED,
		STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
		STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
		STRIPE_PRICE_MONTHLY_ID: process.env.STRIPE_PRICE_MONTHLY_ID,
		STRIPE_PRICE_YEARLY_ID: process.env.STRIPE_PRICE_YEARLY_ID,
	},
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
	onValidationError: (issues) => {
		console.error("❌ Invalid environment variables:");
		for (const issue of issues) {
			console.error(
				`   - ${issue.path?.join(".") ?? "unknown"}: ${issue.message}`,
			);
		}
		process.exit(1);
	},
});
