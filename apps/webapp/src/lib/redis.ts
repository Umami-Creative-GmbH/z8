import Redis from "ioredis";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { createRedisConnectionOptions } from "@/lib/redis-config";

const logger = createLogger("Redis");
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
	redisPub: Redis | undefined;
};

type RedisStatus = Redis["status"];

const activeStatuses = new Set<RedisStatus>(["ready", "connect", "connecting"]);

function isAlreadyConnectingError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.includes("already connecting") ||
			error.message.includes("Connection is closed"))
	);
}

function createRedisClient(): Redis {
	const redisConnectionOptions = createRedisConnectionOptions(env);

	const client = new Redis({
		...redisConnectionOptions,
		maxRetriesPerRequest: 20,
		retryStrategy(times) {
			// Exponential backoff: 50ms, 100ms, 200ms... capped at 2s
			return Math.min(times * 50, 2000);
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
		logger.error({ error: err }, "Redis connection error");
	});

	client.on("connect", () => {
		logger.info(
			{ host: redisConnectionOptions.host, port: redisConnectionOptions.port },
			"Connected to Redis",
		);
	});

	client.on("reconnecting", (delay: number) => {
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

// Dedicated publisher client for pub/sub (pub/sub clients can't be used for regular commands)
export const redisPub = shouldDisableRedisDuringBuild
	? noopRedisClient
	: (() => {
			if (!globalForRedis.redisPub) {
				globalForRedis.redisPub = createRedisClient();
			}

			return globalForRedis.redisPub;
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
 * Create a new subscriber client for pub/sub
 * Each SSE connection needs its own subscriber client
 */
export function createRedisSubscriber(): Redis {
	if (shouldDisableRedisDuringBuild) {
		return noopRedisClient;
	}

	return createRedisClient();
}

/**
 * Publish a notification event to a user's notification channel
 * @param userId - The user ID to publish to
 * @param event - The event type (new_notification, count_update)
 * @param data - The event data
 */
export async function publishNotificationEvent(
	userId: string,
	event: "new_notification" | "count_update",
	data: unknown,
): Promise<void> {
	try {
		const channel = `notifications:${userId}`;
		const message = JSON.stringify({ event, data });
		await redisPub.publish(channel, message);
	} catch (error) {
		logger.error({ error, userId, event }, "Failed to publish notification event");
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
