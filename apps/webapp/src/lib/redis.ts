import Redis from "ioredis";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { createRedisConnectionOptions } from "@/lib/redis-config";

const logger = createLogger("Redis");
const redisCommandTimeoutMs = Number(env.REDIS_COMMAND_TIMEOUT_MS);
const redisMaxReconnectAttempts = Number(env.REDIS_MAX_RECONNECT_ATTEMPTS);
const redisLogThrottleMs = Number(env.REDIS_LOG_THROTTLE_MS);
const redisMaxRetriesPerRequest = Number(env.REDIS_MAX_RETRIES_PER_REQUEST);
const redisReconnectBaseDelayMs = Number(env.REDIS_RECONNECT_BASE_DELAY_MS);
const redisReconnectMaxDelayMs = Number(env.REDIS_RECONNECT_MAX_DELAY_MS);
const hasRedisConfig = Boolean(env.REDIS_HOST);
const shouldDisableRedisDuringBuild =
	(!hasRedisConfig && env.NODE_ENV === "production") ||
	env.NEXT_PHASE === "phase-production-build" ||
	env.npm_lifecycle_event === "build" ||
	(env.CI === "true" && !hasRedisConfig);

const incrementWithInitialExpiryScript = `
local existed = redis.call("EXISTS", KEYS[1])
local value = redis.call("INCR", KEYS[1])
if existed == 0 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return value
`;

const getAndDeleteScript = `
local value = redis.call("GET", KEYS[1])
if value then
  redis.call("DEL", KEYS[1])
end
return value
`;

const noopRedisClient = {
	status: "end",
	get: async () => null,
	set: async () => "OK",
	del: async () => 0,
	publish: async () => 0,
	ping: async () => "PONG",
	eval: async () => null,
	evalsha: async () => null,
	on: () => noopRedisClient,
} as unknown as Redis;

// Singleton pattern for Redis connection
const globalForRedis = globalThis as unknown as {
	redis: Redis | undefined;
};

type RedisStatus = Redis["status"];

let lastErrorLogAt = 0;
let lastReconnectLogAt = 0;

const activeStatuses = new Set<RedisStatus>(["ready", "connect", "connecting"]);

function shouldLogRedisEvent(lastLogAt: number): boolean {
	return Date.now() - lastLogAt >= redisLogThrottleMs;
}

function isAlreadyConnectingError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("already connecting") || error.message.includes("Connection is closed"))
	);
}

function createRedisClient(): Redis {
	const redisConnectionOptions = createRedisConnectionOptions(env);

	const client = new Redis({
		...redisConnectionOptions,
		connectTimeout: redisCommandTimeoutMs,
		commandTimeout: redisCommandTimeoutMs,
		maxRetriesPerRequest: redisMaxRetriesPerRequest,
		retryStrategy(times) {
			if (times > redisMaxReconnectAttempts) {
				return null;
			}

			return Math.min(
				redisReconnectBaseDelayMs * 2 ** (times - 1),
				redisReconnectMaxDelayMs,
			);
		},
		lazyConnect: true,
		enableReadyCheck: true,
		enableOfflineQueue: true,
		// Reconnect automatically on connection loss
		reconnectOnError(err) {
			const targetErrors = ["READONLY", "ECONNRESET", "EPIPE"];
			return targetErrors.some((e) => err.message.includes(e));
		},
	});

	client.on("error", (err) => {
		if (!shouldLogRedisEvent(lastErrorLogAt)) {
			return;
		}

		lastErrorLogAt = Date.now();
		logger.error({ error: err }, "Redis connection error");
	});

	client.on("connect", () => {
		logger.info(
			{ host: redisConnectionOptions.host, port: redisConnectionOptions.port },
			"Connected to Redis",
		);
	});

	client.on("reconnecting", (delay: number) => {
		if (!shouldLogRedisEvent(lastReconnectLogAt)) {
			return;
		}

		lastReconnectLogAt = Date.now();
		logger.warn({ delay }, "Reconnecting to Redis");
	});

	return client;
}

export const redis = shouldDisableRedisDuringBuild
	? noopRedisClient
	: (() => {
			if (!globalForRedis.redis) {
				globalForRedis.redis = createRedisClient();
			}

			return globalForRedis.redis;
		})();

export async function ensureRedisReady(): Promise<boolean> {
	if (shouldDisableRedisDuringBuild) {
		return false;
	}

	if (activeStatuses.has(redis.status)) {
		return true;
	}

	if (redis.status === "wait" || redis.status === "end") {
		try {
			await redis.connect();
		} catch (error) {
			if (!isAlreadyConnectingError(error)) {
				logger.warn({ error, status: redis.status }, "Failed to start Redis connection");
			}
		}
	}

	try {
		await redis.ping();
		return true;
	} catch (error) {
		logger.warn({ error, status: redis.status }, "Redis readiness check failed");
		return false;
	}
}

/**
 * Secondary storage adapter for Better Auth
 * Uses Redis for session caching and rate limiting
 */
export const secondaryStorage = {
	increment: async (key: string, ttl: number): Promise<number> => {
		if (shouldDisableRedisDuringBuild) {
			return 0;
		}

		try {
			const result = await redis.eval(
				incrementWithInitialExpiryScript,
				1,
				key,
				ttl,
			);
			const value = Number(result);
			return Number.isFinite(value) ? value : 0;
		} catch (error) {
			logger.error({ error, key }, "Failed to increment in Redis");
			return 0;
		}
	},
	getAndDelete: async (key: string): Promise<string | null> => {
		if (shouldDisableRedisDuringBuild) {
			return null;
		}

		try {
			const result = await redis.eval(getAndDeleteScript, 1, key);
			return typeof result === "string" ? result : null;
		} catch (error) {
			logger.error({ error, key }, "Failed to get and delete from Redis");
			return null;
		}
	},
	get: async (key: string): Promise<string | null> => {
		if (shouldDisableRedisDuringBuild) {
			return null;
		}

		try {
			return await redis.get(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to get from Redis");
			return null;
		}
	},
	set: async (key: string, value: string, ttl?: number): Promise<void> => {
		if (shouldDisableRedisDuringBuild) {
			return;
		}

		try {
			if (ttl) {
				await redis.set(key, value, "EX", ttl);
			} else {
				await redis.set(key, value);
			}
		} catch (error) {
			logger.error({ error, key }, "Failed to set in Redis");
		}
	},
	delete: async (key: string): Promise<void> => {
		if (shouldDisableRedisDuringBuild) {
			return;
		}

		try {
			await redis.del(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to delete from Redis");
		}
	},
	deleteOrThrow: async (key: string): Promise<void> => {
		if (shouldDisableRedisDuringBuild) {
			return;
		}

		try {
			await redis.del(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to strictly delete from Redis");
			throw error;
		}
	},
};
