/**
 * Rate Limiting Utility
 *
 * Uses Valkey/Redis for distributed rate limiting.
 * Implements sliding window algorithm for accurate rate limiting.
 */

import { valkey } from "@/lib/valkey";
import { createLogger } from "@/lib/logger";

const logger = createLogger("RateLimit");

export interface RateLimitConfig {
	/** Maximum number of requests allowed in the window */
	maxRequests: number;
	/** Time window in seconds */
	windowSeconds: number;
}

export interface RateLimitResult {
	/** Whether the request is allowed */
	allowed: boolean;
	/** Number of remaining requests in the window */
	remaining: number;
	/** Timestamp when the rate limit resets (Unix epoch in seconds) */
	resetAt: number;
	/** Number of seconds until reset */
	retryAfter: number;
}

// Default configurations for different endpoints
export const RATE_LIMIT_CONFIGS = {
	/** Auth endpoints: 10 requests per minute */
	auth: { maxRequests: 10, windowSeconds: 60 },
	/** Sign-up: 5 requests per minute (stricter) */
	signUp: { maxRequests: 5, windowSeconds: 60 },
	/** Password reset: 3 requests per minute */
	passwordReset: { maxRequests: 3, windowSeconds: 60 },
	/** API general: 100 requests per minute */
	api: { maxRequests: 100, windowSeconds: 60 },
	/** Export requests: 5 per hour */
	export: { maxRequests: 5, windowSeconds: 3600 },
} as const;

/**
 * Check if a request is allowed under the rate limit
 * Uses sliding window counter algorithm in Valkey
 *
 * @param identifier - Unique identifier (e.g., IP address, user ID)
 * @param endpoint - Endpoint name for the rate limit key
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimit(
	identifier: string,
	endpoint: string,
	config: RateLimitConfig,
): Promise<RateLimitResult> {
	const key = `ratelimit:${endpoint}:${identifier}`;
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - config.windowSeconds;

	try {
		// Check if Valkey is available
		if (valkey.status !== "ready") {
			// Valkey not available - allow request but log warning
			logger.warn({ identifier, endpoint }, "Rate limiting unavailable - Valkey not connected");
			return {
				allowed: true,
				remaining: config.maxRequests,
				resetAt: now + config.windowSeconds,
				retryAfter: 0,
			};
		}

		// Use a Lua script for atomic operations
		// This implements a sliding window counter using a sorted set
		const luaScript = `
			local key = KEYS[1]
			local now = tonumber(ARGV[1])
			local window_start = tonumber(ARGV[2])
			local max_requests = tonumber(ARGV[3])
			local window_seconds = tonumber(ARGV[4])

			-- Remove old entries outside the window
			redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

			-- Count current requests in window
			local current_count = redis.call('ZCARD', key)

			if current_count < max_requests then
				-- Add current request
				redis.call('ZADD', key, now, now .. ':' .. math.random())
				-- Set expiry on the key
				redis.call('EXPIRE', key, window_seconds)
				return {1, max_requests - current_count - 1}
			else
				-- Get the oldest entry to calculate retry time
				local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
				local retry_after = 0
				if #oldest >= 2 then
					retry_after = tonumber(oldest[2]) + window_seconds - now
				end
				return {0, 0, retry_after}
			end
		`;

		const result = (await valkey.eval(
			luaScript,
			1,
			key,
			now.toString(),
			windowStart.toString(),
			config.maxRequests.toString(),
			config.windowSeconds.toString(),
		)) as [number, number, number?];

		const allowed = result[0] === 1;
		const remaining = result[1];
		const retryAfter = result[2] || 0;

		if (!allowed) {
			logger.info(
				{ identifier, endpoint, retryAfter },
				"Rate limit exceeded",
			);
		}

		return {
			allowed,
			remaining: Math.max(0, remaining),
			resetAt: now + config.windowSeconds,
			retryAfter: Math.ceil(retryAfter),
		};
	} catch (error) {
		// On error, allow the request but log the issue
		logger.error({ error, identifier, endpoint }, "Rate limit check failed");
		return {
			allowed: true,
			remaining: config.maxRequests,
			resetAt: now + config.windowSeconds,
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
				"X-RateLimit-Limit": "10",
				"X-RateLimit-Remaining": result.remaining.toString(),
				"X-RateLimit-Reset": result.resetAt.toString(),
			},
		},
	);
}
