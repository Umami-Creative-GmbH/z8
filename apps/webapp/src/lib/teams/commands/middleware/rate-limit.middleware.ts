/**
 * Rate Limit Middleware for Teams Bot Commands
 *
 * Per-command rate limiting using Upstash Ratelimit with sliding window.
 * Integrates with existing Valkey/Redis infrastructure.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { createLogger } from "@/lib/logger";
import { valkey } from "@/lib/valkey";
import { isRateLimitDisabled } from "@/lib/rate-limit";
import type { BotCommandContext, BotCommandResponse } from "../../types";

const logger = createLogger("TeamsRateLimit");

// ============================================
// TYPES
// ============================================

export interface CommandRateLimitConfig {
	maxRequests: number;
	windowSeconds: number;
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Per-command rate limits
 * Format: { maxRequests, windowSeconds }
 */
export const COMMAND_RATE_LIMITS: Record<string, CommandRateLimitConfig> = {
	// Ops commands - more expensive queries
	coverage: { maxRequests: 3, windowSeconds: 60 },
	openshifts: { maxRequests: 5, windowSeconds: 60 },
	compliance: { maxRequests: 5, windowSeconds: 60 },

	// Existing commands - lighter queries
	clockedin: { maxRequests: 10, windowSeconds: 60 },
	pending: { maxRequests: 10, windowSeconds: 60 },
	"whos-out": { maxRequests: 10, windowSeconds: 60 },
	whosout: { maxRequests: 10, windowSeconds: 60 },
	help: { maxRequests: 20, windowSeconds: 60 },

	// Default for any unlisted command
	default: { maxRequests: 10, windowSeconds: 60 },
};

// ============================================
// REDIS ADAPTER
// ============================================

/**
 * Minimal Redis interface for @upstash/ratelimit
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

class NoscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NOSCRIPT";
	}

	toString(): string {
		return `NOSCRIPT: ${this.message}`;
	}
}

const redisAdapter: RatelimitRedis = {
	evalsha: async <TArgs extends unknown[], TData = unknown>(
		sha: string,
		keys: string[],
		args: TArgs,
	): Promise<TData> => {
		try {
			return (await valkey.evalsha(sha, keys.length, ...keys, ...args.map(String))) as TData;
		} catch (error) {
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

// ============================================
// LIMITER CACHE
// ============================================

const limiterCache = new Map<string, Ratelimit>();

function getLimiter(commandName: string): Ratelimit {
	const cached = limiterCache.get(commandName);
	if (cached) return cached;

	const config = COMMAND_RATE_LIMITS[commandName] || COMMAND_RATE_LIMITS.default;

	const limiter = new Ratelimit({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		redis: redisAdapter as any,
		limiter: Ratelimit.slidingWindow(config.maxRequests, `${config.windowSeconds} s`),
		prefix: `ratelimit:teams:${commandName}`,
		analytics: false,
	});

	limiterCache.set(commandName, limiter);
	return limiter;
}

// ============================================
// MIDDLEWARE
// ============================================

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	retryAfter: number;
}

/**
 * Check rate limit for a command
 */
export async function checkCommandRateLimit(
	commandName: string,
	ctx: BotCommandContext,
): Promise<RateLimitResult> {
	try {
		// Skip rate limiting if disabled
		if (isRateLimitDisabled()) {
			const config = COMMAND_RATE_LIMITS[commandName] || COMMAND_RATE_LIMITS.default;
			return {
				allowed: true,
				remaining: config.maxRequests,
				retryAfter: 0,
			};
		}

		// Check Valkey connection
		if (valkey.status !== "ready") {
			logger.warn({ commandName }, "Rate limiting unavailable - Valkey not connected");
			return {
				allowed: true,
				remaining: 100,
				retryAfter: 0,
			};
		}

		// Create unique identifier: tenant + user + command
		const identifier = `${ctx.tenant.tenantId}:${ctx.userId}:${commandName}`;
		const limiter = getLimiter(commandName);
		const result = await limiter.limit(identifier);

		if (!result.success) {
			const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
			logger.info(
				{ commandName, userId: ctx.userId, tenantId: ctx.tenant.tenantId, retryAfter },
				"Teams command rate limit exceeded",
			);
			return {
				allowed: false,
				remaining: result.remaining,
				retryAfter: Math.max(0, retryAfter),
			};
		}

		return {
			allowed: true,
			remaining: result.remaining,
			retryAfter: 0,
		};
	} catch (error) {
		// On error, allow the request but log the issue
		logger.error({ error, commandName }, "Teams rate limit check failed");
		return {
			allowed: true,
			remaining: 100,
			retryAfter: 0,
		};
	}
}

/**
 * Higher-order function that wraps a command handler with rate limiting
 */
export function withRateLimit(
	commandName: string,
	handler: (ctx: BotCommandContext) => Promise<BotCommandResponse>,
): (ctx: BotCommandContext) => Promise<BotCommandResponse> {
	return async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		const result = await checkCommandRateLimit(commandName, ctx);

		if (!result.allowed) {
			return {
				type: "text",
				text: `⏱️ Rate limit exceeded. Please wait ${result.retryAfter} seconds before using this command again.`,
			};
		}

		return handler(ctx);
	};
}
