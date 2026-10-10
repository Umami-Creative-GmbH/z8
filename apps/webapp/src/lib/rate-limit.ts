/**
 * Rate Limiting with @upstash/ratelimit
 *
 * Battle-tested rate limiting using sliding window algorithm.
 * Works with our existing Redis connection.
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
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { createRatelimitRedisAdapter } from "@/lib/rate-limit-redis";
import { ensureRedisReady, redis as redisClient } from "@/lib/redis";

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
function parseRateLimitEnv(
	envValue: string | undefined,
	defaultRequests: number,
	defaultSeconds: number,
): { requests: number; seconds: number } {
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
	if (
		Number.isNaN(requests) ||
		Number.isNaN(seconds) ||
		requests <= 0 ||
		seconds <= 0
	) {
		logger.warn({ envValue }, "Invalid rate limit values, using defaults");
		return { requests: defaultRequests, seconds: defaultSeconds };
	}
	return { requests, seconds };
}

const logger = createLogger("RateLimit");

/** Script loading is handled by Upstash's EVALSHA/NOSCRIPT fallback. */
export async function ensureRateLimitRedisReady(): Promise<boolean> {
	return ensureRedisReady();
}

export const RATE_LIMIT_RESPONSE_COPY = {
	title: { key: "common:rateLimit.title", fallback: "Too Many Requests" },
	message: {
		key: "common:rateLimit.message",
		fallback: "You've made too many requests. Please wait before trying again.",
	},
	jsonMessage: {
		key: "common:rateLimit.jsonMessage",
		fallback: "Rate limit exceeded. Please try again later.",
	},
	countdownLabel: {
		key: "common:rateLimit.countdownLabel",
		fallback: "seconds until you can retry",
	},
	waitingButton: {
		key: "common:rateLimit.waitingButton",
		fallback: "Please wait...",
	},
	retryButton: { key: "common:rateLimit.retryButton", fallback: "Try Again" },
	retryingButton: {
		key: "common:rateLimit.retryingButton",
		fallback: "Retrying...",
	},
} as const;

type RateLimitResponseMessages = {
	title?: string;
	message?: string;
	jsonMessage?: string;
	countdownLabel?: string;
	waitingButton?: string;
	retryButton?: string;
	retryingButton?: string;
};

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeJsString(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

const redisAdapter = createRatelimitRedisAdapter(redisClient);

// Rate limiters for different endpoints
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const redis = redisAdapter as any;

// Parse rate limits from env vars with defaults
const authConfig = parseRateLimitEnv(env.RATE_LIMIT_AUTH, 10, 60);
const signUpConfig = parseRateLimitEnv(env.RATE_LIMIT_SIGNUP, 5, 60);
const passwordResetConfig = parseRateLimitEnv(
	env.RATE_LIMIT_PASSWORD_RESET,
	3,
	60,
);
const apiConfig = parseRateLimitEnv(env.RATE_LIMIT_API, 100, 60);
const exportConfig = parseRateLimitEnv(env.RATE_LIMIT_EXPORT, 5, 3600);
// ICS feeds (#991): calendar apps poll about hourly, and one team feed URL may be
// subscribed by many people. Hits are counted per feed, not per IP, because
// Google and Microsoft fetch every subscriber's feed from shared addresses.
const icsFeedConfig = { requests: 120, seconds: 3600 };
// Unknown feed secrets are counted per client IP.
const icsFeedMissConfig = { requests: 30, seconds: 600 };

const limiters = {
	/** Auth endpoints: configurable via RATE_LIMIT_AUTH (default: 10 requests per 60 seconds) */
	auth: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			authConfig.requests,
			`${authConfig.seconds} s`,
		),
		prefix: "ratelimit:auth",
		analytics: false,
	}),
	/** Sign-up: configurable via RATE_LIMIT_SIGNUP (default: 5 requests per 60 seconds) */
	signUp: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			signUpConfig.requests,
			`${signUpConfig.seconds} s`,
		),
		prefix: "ratelimit:signup",
		analytics: false,
	}),
	/** Password reset: configurable via RATE_LIMIT_PASSWORD_RESET (default: 3 requests per 60 seconds) */
	passwordReset: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			passwordResetConfig.requests,
			`${passwordResetConfig.seconds} s`,
		),
		prefix: "ratelimit:password-reset",
		analytics: false,
	}),
	/** API general: configurable via RATE_LIMIT_API (default: 100 requests per 60 seconds) */
	api: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			apiConfig.requests,
			`${apiConfig.seconds} s`,
		),
		prefix: "ratelimit:api",
		analytics: false,
	}),
	/** Export requests: configurable via RATE_LIMIT_EXPORT (default: 5 per hour) */
	export: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			exportConfig.requests,
			`${exportConfig.seconds} s`,
		),
		prefix: "ratelimit:export",
		analytics: false,
	}),
	/** ICS feed fetches, keyed by feed id (120 per hour) */
	icsFeed: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			icsFeedConfig.requests,
			`${icsFeedConfig.seconds} s`,
		),
		prefix: "ratelimit:ics-feed",
		analytics: false,
	}),
	/** ICS feed fetches with an unknown secret, keyed by client IP (30 per 10 minutes) */
	icsFeedMiss: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(
			icsFeedMissConfig.requests,
			`${icsFeedMissConfig.seconds} s`,
		),
		prefix: "ratelimit:ics-feed-miss",
		analytics: false,
	}),
};

export type RateLimitEndpoint = keyof typeof limiters;

export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Requests allowed per window, when known */
	limit?: number;
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
	signUp: {
		maxRequests: signUpConfig.requests,
		windowSeconds: signUpConfig.seconds,
	},
	passwordReset: {
		maxRequests: passwordResetConfig.requests,
		windowSeconds: passwordResetConfig.seconds,
	},
	api: { maxRequests: apiConfig.requests, windowSeconds: apiConfig.seconds },
	export: {
		maxRequests: exportConfig.requests,
		windowSeconds: exportConfig.seconds,
	},
	icsFeed: {
		maxRequests: icsFeedConfig.requests,
		windowSeconds: icsFeedConfig.seconds,
	},
	icsFeedMiss: {
		maxRequests: icsFeedMissConfig.requests,
		windowSeconds: icsFeedMissConfig.seconds,
	},
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

		// Check if Redis is available
		if (!(await ensureRateLimitRedisReady())) {
			logger.warn(
				{ identifier, endpoint },
				"Rate limiting unavailable - Redis not connected",
			);
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
				limit: result.limit,
				remaining: result.remaining,
				resetAt: result.reset,
				retryAfter: Math.max(0, retryAfter),
			};
		}

		return {
			allowed: true,
			limit: result.limit,
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
function generateRateLimitHtml(
	retryAfter: number,
	messages: RateLimitResponseMessages = {},
): string {
	const title = escapeHtml(
		messages.title ?? RATE_LIMIT_RESPONSE_COPY.title.fallback,
	);
	const message = escapeHtml(
		messages.message ?? RATE_LIMIT_RESPONSE_COPY.message.fallback,
	);
	const countdownLabel = escapeHtml(
		messages.countdownLabel ?? RATE_LIMIT_RESPONSE_COPY.countdownLabel.fallback,
	);
	const waitingButton = escapeHtml(
		messages.waitingButton ?? RATE_LIMIT_RESPONSE_COPY.waitingButton.fallback,
	);
	const retryButton = escapeJsString(
		messages.retryButton ?? RATE_LIMIT_RESPONSE_COPY.retryButton.fallback,
	);
	const retryingButton = escapeJsString(
		messages.retryingButton ?? RATE_LIMIT_RESPONSE_COPY.retryingButton.fallback,
	);

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${title}</title>
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
		<h1>${title}</h1>
		<p class="message">${message}</p>
		<div class="countdown-box">
			<div class="countdown" id="countdown">${retryAfter}</div>
			<div class="countdown-label">${countdownLabel}</div>
		</div>
		<button class="btn" id="retryBtn" disabled>
			<svg id="btnIcon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
			<span id="btnText">${waitingButton}</span>
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
					btnText.textContent = '${retryButton}';
					return;
				}
				countdown.textContent = remaining;
				remaining--;
				setTimeout(update, 1000);
			}

			btn.addEventListener('click', function() {
				btnText.textContent = '${retryingButton}';
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
export function createRateLimitResponse(
	result: RateLimitResult,
	request?: Request,
	messages: RateLimitResponseMessages = {},
): Response {
	const headers: Record<string, string> = {
		"Retry-After": result.retryAfter.toString(),
		...(result.limit === undefined
			? {}
			: { "X-RateLimit-Limit": result.limit.toString() }),
		"X-RateLimit-Remaining": result.remaining.toString(),
		"X-RateLimit-Reset": Math.floor(result.resetAt / 1000).toString(),
	};

	// Check if request accepts HTML (browser navigation)
	const acceptHeader = request?.headers.get("accept") || "";
	const wantsHtml = acceptHeader.includes("text/html");

	if (wantsHtml) {
		return new Response(generateRateLimitHtml(result.retryAfter, messages), {
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
			error: messages.title ?? RATE_LIMIT_RESPONSE_COPY.title.fallback,
			message:
				messages.jsonMessage ?? RATE_LIMIT_RESPONSE_COPY.jsonMessage.fallback,
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
