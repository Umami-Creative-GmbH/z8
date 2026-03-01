import Redis from "ioredis";
import { createLogger } from "@/lib/logger";
import { env } from "@/env";

const logger = createLogger("Valkey");
const hasValkeyConfig = Boolean(env.VALKEY_HOST || env.REDIS_HOST);
const shouldDisableValkeyDuringBuild =
	(!hasValkeyConfig && env.NODE_ENV === "production") ||
	process.env.NEXT_PHASE === "phase-production-build" ||
	process.env.npm_lifecycle_event === "build" ||
	(process.env.CI === "true" && !hasValkeyConfig);

const noopValkeyClient = {
	status: "end",
	get: async () => null,
	set: async () => "OK",
	del: async () => 0,
	publish: async () => 0,
	ping: async () => "PONG",
	eval: async () => null,
	evalsha: async () => null,
	on: () => noopValkeyClient,
} as unknown as Redis;

// Singleton pattern for Valkey connection
const globalForValkey = globalThis as unknown as {
	valkey: Redis | undefined;
	valkeyPub: Redis | undefined;
};

function createValkeyClient(): Redis {
	const host = env.VALKEY_HOST || env.REDIS_HOST || "localhost";
	const port = Number(env.VALKEY_PORT || env.REDIS_PORT || 6379);
	const password = env.VALKEY_PASSWORD || env.REDIS_PASSWORD;

	const client = new Redis({
		host,
		port,
		password: password || undefined,
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
		logger.error({ error: err }, "Valkey connection error");
	});

	client.on("connect", () => {
		logger.info({ host, port }, "Connected to Valkey");
	});

	client.on("reconnecting", (delay: number) => {
		logger.warn({ delay }, "Reconnecting to Valkey");
	});

	return client;
}

export const valkey = shouldDisableValkeyDuringBuild
	? noopValkeyClient
	: globalForValkey.valkey ?? createValkeyClient();

// Dedicated publisher client for pub/sub (pub/sub clients can't be used for regular commands)
export const valkeyPub = shouldDisableValkeyDuringBuild
	? noopValkeyClient
	: globalForValkey.valkeyPub ?? createValkeyClient();

if (env.NODE_ENV !== "production") {
	globalForValkey.valkey = valkey;
	globalForValkey.valkeyPub = valkeyPub;
}

/**
 * Create a new subscriber client for pub/sub
 * Each SSE connection needs its own subscriber client
 */
export function createValkeySubscriber(): Redis {
	if (shouldDisableValkeyDuringBuild) {
		return noopValkeyClient;
	}

	return createValkeyClient();
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
		await valkeyPub.publish(channel, message);
	} catch (error) {
		logger.error({ error, userId, event }, "Failed to publish notification event");
	}
}

/**
 * Secondary storage adapter for Better Auth
 * Uses Valkey/Redis for session caching and rate limiting
 */
export const secondaryStorage = {
	get: async (key: string): Promise<string | null> => {
		if (shouldDisableValkeyDuringBuild) {
			return null;
		}

		try {
			return await valkey.get(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to get from Valkey");
			return null;
		}
	},
	set: async (key: string, value: string, ttl?: number): Promise<void> => {
		if (shouldDisableValkeyDuringBuild) {
			return;
		}

		try {
			if (ttl) {
				await valkey.set(key, value, "EX", ttl);
			} else {
				await valkey.set(key, value);
			}
		} catch (error) {
			logger.error({ error, key }, "Failed to set in Valkey");
		}
	},
	delete: async (key: string): Promise<void> => {
		if (shouldDisableValkeyDuringBuild) {
			return;
		}

		try {
			await valkey.del(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to delete from Valkey");
		}
	},
};
