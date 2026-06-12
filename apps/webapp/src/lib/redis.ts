import Redis from "ioredis";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { createRedisConnectionOptions } from "@/lib/redis-config";

const logger = createLogger("Redis");
const REDIS_COMMAND_TIMEOUT_MS = 1_000;
const REDIS_MAX_RECONNECT_ATTEMPTS = 8;
const REDIS_LOG_THROTTLE_MS = 30_000;
const hasRedisConfig = Boolean(env.REDIS_HOST);
const shouldDisableRedisDuringBuild =
	(!hasRedisConfig && env.NODE_ENV === "production") ||
	env.NEXT_PHASE === "phase-production-build" ||
	env.npm_lifecycle_event === "build" ||
	(env.CI === "true" && !hasRedisConfig);

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
	return Date.now() - lastLogAt >= REDIS_LOG_THROTTLE_MS;
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
		connectTimeout: REDIS_COMMAND_TIMEOUT_MS,
		commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
		maxRetriesPerRequest: 1,
		retryStrategy(times) {
			if (times > REDIS_MAX_RECONNECT_ATTEMPTS) {
				return null;
			}

			return Math.min(100 * 2 ** (times - 1), 2_000);
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
};
