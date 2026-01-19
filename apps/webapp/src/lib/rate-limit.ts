/**
 * Rate Limiting with @upstash/ratelimit
 *
 * Battle-tested rate limiting using sliding window algorithm.
 * Works with our existing Valkey/Redis connection.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { createLogger } from "@/lib/logger";
import { valkey } from "@/lib/valkey";

const logger = createLogger("RateLimit");

/**
 * Minimal Redis interface required by @upstash/ratelimit
 * Based on: Pick<Redis, "evalsha" | "get" | "set">
 */
type RatelimitRedis = {
	evalsha: <TArgs extends unknown[], TData = unknown>(
		sha: string,
		keys: string[],
		args: TArgs,
	) => Promise<TData>;
	get: <TData = string>(key: string) => Promise<TData | null>;
	set: (key: string, value: string, opts?: { ex?: number }) => Promise<string | null>;
};

/**
 * Redis adapter for @upstash/ratelimit using our existing ioredis connection
 */
const redisAdapter: RatelimitRedis = {
	evalsha: async <TArgs extends unknown[], TData = unknown>(
		sha: string,
		keys: string[],
		args: TArgs,
	): Promise<TData> => {
		return valkey.evalsha(sha, keys.length, ...keys, ...args.map(String)) as Promise<TData>;
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

const limiters = {
	/** Auth endpoints: 10 requests per 60 seconds */
	auth: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(10, "60 s"),
		prefix: "ratelimit:auth",
		analytics: false,
	}),
	/** Sign-up: 5 requests per 60 seconds (stricter) */
	signUp: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(5, "60 s"),
		prefix: "ratelimit:signup",
		analytics: false,
	}),
	/** Password reset: 3 requests per 60 seconds */
	passwordReset: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(3, "60 s"),
		prefix: "ratelimit:password-reset",
		analytics: false,
	}),
	/** API general: 100 requests per 60 seconds */
	api: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(100, "60 s"),
		prefix: "ratelimit:api",
		analytics: false,
	}),
	/** Export requests: 5 per hour */
	export: new Ratelimit({
		redis,
		limiter: Ratelimit.slidingWindow(5, "1 h"),
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

// Legacy config export for backwards compatibility
export const RATE_LIMIT_CONFIGS = {
	auth: { maxRequests: 10, windowSeconds: 60 },
	signUp: { maxRequests: 5, windowSeconds: 60 },
	passwordReset: { maxRequests: 3, windowSeconds: 60 },
	api: { maxRequests: 100, windowSeconds: 60 },
	export: { maxRequests: 5, windowSeconds: 3600 },
} as const;

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
 * Create a rate limit response with proper headers
 */
export function createRateLimitResponse(result: RateLimitResult): Response {
	return new Response(
		JSON.stringify({
			error: "Too Many Requests",
			message: "Rate limit exceeded. Please try again later.",
			retryAfter: result.retryAfter,
		}),
		{
			status: 429,
			headers: {
				"Content-Type": "application/json",
				"Retry-After": result.retryAfter.toString(),
				"X-RateLimit-Remaining": result.remaining.toString(),
				"X-RateLimit-Reset": Math.floor(result.resetAt / 1000).toString(),
			},
		},
	);
}
