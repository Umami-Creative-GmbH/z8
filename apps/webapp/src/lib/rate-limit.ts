/**
 * Rate Limiting with @upstash/ratelimit
 *
 * Battle-tested rate limiting using sliding window algorithm.
 * Works with our existing Valkey/Redis connection.
 *
 * Environment Variables:
 * - RATE_LIMIT_DISABLED: Set to "true" to disable rate limiting entirely (auto-disabled in development)
 * - RATE_LIMIT_AUTH: Override auth rate limit (format: "requests/seconds", e.g., "10/60")
 * - RATE_LIMIT_SIGNUP: Override signup rate limit
 * - RATE_LIMIT_PASSWORD_RESET: Override password reset rate limit
 * - RATE_LIMIT_API: Override API rate limit
 * - RATE_LIMIT_EXPORT: Override export rate limit (format: "requests/seconds", e.g., "5/3600")
 */

import { Ratelimit } from "@upstash/ratelimit";
import { createLogger } from "@/lib/logger";
import { valkey } from "@/lib/valkey";
import { env } from "@/env";

/**
 * Check if rate limiting is disabled
 * - Explicitly disabled via RATE_LIMIT_DISABLED=true
 * - Auto-disabled in development unless explicitly enabled
 */
export function isRateLimitDisabled(): boolean {
	// Explicitly disabled
	if (env.RATE_LIMIT_DISABLED === "true") {
		return true;
	}
	// Explicitly enabled (even in dev)
	if (env.RATE_LIMIT_DISABLED === "false") {
		return false;
	}
	// Auto-disable in development
	return env.NODE_ENV === "development";
}

/**
 * Parse rate limit config from env var
 * Format: "requests/seconds" (e.g., "10/60" = 10 requests per 60 seconds)
 */
function parseRateLimitEnv(envValue: string | undefined, defaultRequests: number, defaultSeconds: number): { requests: number; seconds: number } {
	if (!envValue) {
		return { requests: defaultRequests, seconds: defaultSeconds };
	}
	const parts = envValue.split("/");
	if (parts.length !== 2) {
		logger.warn({ envValue }, "Invalid rate limit format, using defaults");
		return { requests: defaultRequests, seconds: defaultSeconds };
	}
	const requests = parseInt(parts[0], 10);
	const seconds = parseInt(parts[1], 10);
	if (isNaN(requests) || isNaN(seconds) || requests <= 0 || seconds <= 0) {
		logger.warn({ envValue }, "Invalid rate limit values, using defaults");
		return { requests: defaultRequests, seconds: defaultSeconds };
	}
	return { requests, seconds };
}

const logger = createLogger("RateLimit");

/**
 * Minimal Redis interface required by @upstash/ratelimit
 * Includes both evalsha and eval for NOSCRIPT fallback handling
 */
type RatelimitRedis = {
	evalsha: <TArgs extends unknown[], TData = unknown>(
		sha: string,
		keys: string[],
		args: TArgs,
	) => Promise<TData>;
	eval: <TArgs extends unknown[], TData = unknown>(
		script: string,
		keys: string[],
		args: TArgs,
	) => Promise<TData>;
	get: <TData = string>(key: string) => Promise<TData | null>;
	set: (key: string, value: string, opts?: { ex?: number }) => Promise<string | null>;
};

/**
 * Custom error class that properly stringifies for NOSCRIPT detection
 * @upstash/ratelimit checks `${error}`.includes("NOSCRIPT")
 */
class NoscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NOSCRIPT";
	}

	toString(): string {
		return `NOSCRIPT: ${this.message}`;
	}
}

/**
 * Redis adapter for @upstash/ratelimit using our existing ioredis connection
 *
 * Handles NOSCRIPT errors by re-throwing with proper format so the library
 * can detect them and fall back to EVAL
 */
const redisAdapter: RatelimitRedis = {
	evalsha: async <TArgs extends unknown[], TData = unknown>(
		sha: string,
		keys: string[],
		args: TArgs,
	): Promise<TData> => {
		try {
			return (await valkey.evalsha(sha, keys.length, ...keys, ...args.map(String))) as TData;
		} catch (error) {
			// Re-throw NOSCRIPT errors with proper format for @upstash/ratelimit detection
			if (error instanceof Error && error.message.includes("NOSCRIPT")) {
				throw new NoscriptError(error.message);
			}
			throw error;
		}
	},
	eval: async <TArgs extends unknown[], TData = unknown>(
		script: string,
		keys: string[],
		args: TArgs,
	): Promise<TData> => {
		return valkey.eval(script, keys.length, ...keys, ...args.map(String)) as Promise<TData>;
	},
	get: async <TData = string>(key: string): Promise<TData | null> => {
		return valkey.get(key) as Promise<TData | null>;
	},
	set: async (key: string, value: string, opts?: { ex?: number }): Promise<string | null> => {
		if (opts?.ex) {
			return valkey.set(key, value, "EX", opts.ex);
		}
		return valkey.set(key, value);
	},
};

// Rate limiters for different endpoints
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const redis = redisAdapter as any;

// Parse rate limits from env vars with defaults
const authConfig = parseRateLimitEnv(env.RATE_LIMIT_AUTH, 10, 60);
const signUpConfig = parseRateLimitEnv(env.RATE_LIMIT_SIGNUP, 5, 60);
const passwordResetConfig = parseRateLimitEnv(env.RATE_LIMIT_PASSWORD_RESET, 3, 60);
const apiConfig = parseRateLimitEnv(env.RATE_LIMIT_API, 100, 60);
const exportConfig = parseRateLimitEnv(env.RATE_LIMIT_EXPORT, 5, 3600);

const limiters = {
	/** Auth endpoints: configurable via RATE_LIMIT_AUTH (default: 10 requests per 60 seconds) */
	auth: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(authConfig.requests, `${authConfig.seconds} s`),
		prefix: "ratelimit:auth",
		analytics: false,
	}),
	/** Sign-up: configurable via RATE_LIMIT_SIGNUP (default: 5 requests per 60 seconds) */
	signUp: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(signUpConfig.requests, `${signUpConfig.seconds} s`),
		prefix: "ratelimit:signup",
		analytics: false,
	}),
	/** Password reset: configurable via RATE_LIMIT_PASSWORD_RESET (default: 3 requests per 60 seconds) */
	passwordReset: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(passwordResetConfig.requests, `${passwordResetConfig.seconds} s`),
		prefix: "ratelimit:password-reset",
		analytics: false,
	}),
	/** API general: configurable via RATE_LIMIT_API (default: 100 requests per 60 seconds) */
	api: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(apiConfig.requests, `${apiConfig.seconds} s`),
		prefix: "ratelimit:api",
		analytics: false,
	}),
	/** Export requests: configurable via RATE_LIMIT_EXPORT (default: 5 per hour) */
	export: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(exportConfig.requests, `${exportConfig.seconds} s`),
		prefix: "ratelimit:export",
		analytics: false,
	}),
};

export type RateLimitEndpoint = keyof typeof limiters;

export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Number of remaining requests in the window */
	remaining: number;
	/** Timestamp when the rate limit resets (Unix epoch in milliseconds) */
	resetAt: number;
	/** Number of seconds until reset */
	retryAfter: number;
}

// Legacy config export for backwards compatibility (uses env var values)
export const RATE_LIMIT_CONFIGS = {
	auth: { maxRequests: authConfig.requests, windowSeconds: authConfig.seconds },
	signUp: { maxRequests: signUpConfig.requests, windowSeconds: signUpConfig.seconds },
	passwordReset: { maxRequests: passwordResetConfig.requests, windowSeconds: passwordResetConfig.seconds },
	api: { maxRequests: apiConfig.requests, windowSeconds: apiConfig.seconds },
	export: { maxRequests: exportConfig.requests, windowSeconds: exportConfig.seconds },
};

/**
 * Check if a request is allowed under the rate limit
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID)
 * @param endpoint - Endpoint type for rate limiting
 * @returns Rate limit result
 */
export async function checkRateLimit(
	identifier: string,
	endpoint: RateLimitEndpoint,
): Promise<RateLimitResult> {
	try {
		// Check if rate limiting is disabled (auto-disabled in dev)
		if (isRateLimitDisabled()) {
			return {
				allowed: true,
				remaining: RATE_LIMIT_CONFIGS[endpoint]?.maxRequests ?? 100,
				resetAt: Date.now() + 60000,
				retryAfter: 0,
			};
		}

		// Check if Valkey is available
		if (valkey.status !== "ready") {
			logger.warn({ identifier, endpoint }, "Rate limiting unavailable - Valkey not connected");
			return {
				allowed: true,
				remaining: RATE_LIMIT_CONFIGS[endpoint]?.maxRequests ?? 100,
				resetAt: Date.now() + 60000,
				retryAfter: 0,
			};
		}

		const limiter = limiters[endpoint];
		if (!limiter) {
			logger.warn({ endpoint }, "Unknown rate limit endpoint");
			return {
				allowed: true,
				remaining: 100,
				resetAt: Date.now() + 60000,
				retryAfter: 0,
			};
		}

		const result = await limiter.limit(identifier);

		if (!result.success) {
			const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
			logger.info({ identifier, endpoint, retryAfter }, "Rate limit exceeded");
			return {
				allowed: false,
				remaining: result.remaining,
				resetAt: result.reset,
				retryAfter: Math.max(0, retryAfter),
			};
		}

		return {
			allowed: true,
			remaining: result.remaining,
			resetAt: result.reset,
			retryAfter: 0,
		};
	} catch (error) {
		// On error, allow the request but log the issue
		logger.error({ error, identifier, endpoint }, "Rate limit check failed");
		return {
			allowed: true,
			remaining: 100,
			resetAt: Date.now() + 60000,
			retryAfter: 0,
		};
	}
}

/**
 * Get the client IP from request headers
 * Handles various proxy configurations
 */
export function getClientIp(request: Request): string {
	// Check common proxy headers
	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) {
		// Take the first IP in the chain (original client)
		return forwardedFor.split(",")[0].trim();
	}

	const realIp = request.headers.get("x-real-ip");
	if (realIp) {
		return realIp.trim();
	}

	// Fallback - this won't be useful behind a proxy
	return "unknown";
}

/**
 * Generate HTML for rate limit error page
 */
function generateRateLimitHtml(retryAfter: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Too Many Requests</title>
	<style>
		* { box-sizing: border-box; margin: 0; padding: 0; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			background: #fff;
			color: #0f172a;
			padding: 1rem;
		}
		@media (prefers-color-scheme: dark) {
			body {
				background: #09090b;
				color: #fafafa;
			}
			.card { background: #1e293b; border-color: #334155; }
			.icon-bg { background: rgba(239, 68, 68, 0.2); }
			.message { color: #cbd5e1; }
			.countdown-box { background: #334155; }
			.countdown-label { color: #cbd5e1; }
			.btn { background: #3b82f6; }
			.btn:hover { background: #2563eb; }
			.btn:disabled { background: #475569; }
		}
		.card {
			background: white;
			border-radius: 1rem;
			box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
			max-width: 400px;
			width: 100%;
			padding: 2rem;
			text-align: center;
			border: 1px solid #e2e8f0;
		}
		.icon-bg {
			width: 4rem;
			height: 4rem;
			border-radius: 50%;
			background: #fef2f2;
			display: flex;
			align-items: center;
			justify-content: center;
			margin: 0 auto 1.5rem;
		}
		.icon {
			width: 2rem;
			height: 2rem;
			color: #dc2626;
		}
		h1 {
			font-size: 1.5rem;
			font-weight: 700;
			margin-bottom: 0.5rem;
			color: #dc2626;
		}
		.message {
			color: #475569;
			margin-bottom: 1.5rem;
			line-height: 1.5;
		}
		.countdown-box {
			background: #f8fafc;
			border-radius: 0.75rem;
			padding: 1.25rem;
			margin-bottom: 1.5rem;
			border: 1px solid #e2e8f0;
		}
		@media (prefers-color-scheme: dark) {
			.countdown-box { border-color: #475569; }
		}
		.countdown {
			font-size: 2.5rem;
			font-weight: 700;
			font-variant-numeric: tabular-nums;
			color: #dc2626;
		}
		.countdown-label {
			font-size: 0.875rem;
			color: #475569;
			margin-top: 0.25rem;
		}
		.btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 0.5rem;
			width: 100%;
			padding: 0.75rem 1.5rem;
			background: #3b82f6;
			color: white;
			border: none;
			border-radius: 0.5rem;
			font-size: 1rem;
			font-weight: 500;
			cursor: pointer;
			transition: background 0.2s;
			text-decoration: none;
		}
		.btn:hover { background: #2563eb; }
		.btn:disabled {
			background: #9ca3af;
			cursor: not-allowed;
		}
		.btn svg {
			width: 1.25rem;
			height: 1.25rem;
		}
		.spinner {
			animation: spin 1s linear infinite;
		}
		@keyframes spin {
			from { transform: rotate(0deg); }
			to { transform: rotate(360deg); }
		}
	</style>
</head>
<body>
	<div class="card">
		<div class="icon-bg">
			<svg class="icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
		</div>
		<h1>Too Many Requests</h1>
		<p class="message">You've made too many requests. Please wait before trying again.</p>
		<div class="countdown-box">
			<div class="countdown" id="countdown">${retryAfter}</div>
			<div class="countdown-label">seconds until you can retry</div>
		</div>
		<button class="btn" id="retryBtn" disabled>
			<svg id="btnIcon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
			<span id="btnText">Please wait...</span>
		</button>
	</div>
	<script>
		(function() {
			let remaining = ${retryAfter};
			const countdown = document.getElementById('countdown');
			const btn = document.getElementById('retryBtn');
			const btnText = document.getElementById('btnText');
			const btnIcon = document.getElementById('btnIcon');

			function update() {
				if (remaining <= 0) {
					countdown.textContent = '0';
					btn.disabled = false;
					btnText.textContent = 'Try Again';
					return;
				}
				countdown.textContent = remaining;
				remaining--;
				setTimeout(update, 1000);
			}

			btn.addEventListener('click', function() {
				btnText.textContent = 'Retrying...';
				btnIcon.classList.add('spinner');
				btn.disabled = true;
				window.location.reload();
			});

			update();
		})();
	</script>
</body>
</html>`;
}

/**
 * Create a rate limit response with proper headers
 * Returns HTML for browser requests, JSON for API requests
 */
export function createRateLimitResponse(result: RateLimitResult, request?: Request): Response {
	const headers: Record<string, string> = {
		"Retry-After": result.retryAfter.toString(),
		"X-RateLimit-Remaining": result.remaining.toString(),
		"X-RateLimit-Reset": Math.floor(result.resetAt / 1000).toString(),
	};

	// Check if request accepts HTML (browser navigation)
	const acceptHeader = request?.headers.get("accept") || "";
	const wantsHtml = acceptHeader.includes("text/html");

	if (wantsHtml) {
		return new Response(generateRateLimitHtml(result.retryAfter), {
			status: 429,
			headers: {
				...headers,
				"Content-Type": "text/html; charset=utf-8",
			},
		});
	}

	// Return JSON for API requests
	return new Response(
		JSON.stringify({
			error: "Too Many Requests",
			message: "Rate limit exceeded. Please try again later.",
			retryAfter: result.retryAfter,
		}),
		{
			status: 429,
			headers: {
				...headers,
				"Content-Type": "application/json",
			},
		},
	);
}
