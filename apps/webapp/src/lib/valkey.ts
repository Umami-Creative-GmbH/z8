import Redis from "ioredis";
import { createLogger } from "@/lib/logger";

const logger = createLogger("Valkey");

// Singleton pattern for Valkey connection
const globalForValkey = globalThis as unknown as {
	valkey: Redis | undefined;
};

function createValkeyClient(): Redis {
	const host = process.env.VALKEY_HOST || process.env.REDIS_HOST || "localhost";
	const port = Number(process.env.VALKEY_PORT || process.env.REDIS_PORT || 6379);
	const password = process.env.VALKEY_PASSWORD || process.env.REDIS_PASSWORD;

	const client = new Redis({
		host,
		port,
		password: password || undefined,
		maxRetriesPerRequest: 3,
		lazyConnect: true,
		// Performance optimizations
		enableReadyCheck: false,
		enableOfflineQueue: true,
	});

	client.on("error", (err) => {
		logger.error({ error: err }, "Valkey connection error");
	});

	client.on("connect", () => {
		logger.info({ host, port }, "Connected to Valkey");
	});

	return client;
}

export const valkey = globalForValkey.valkey ?? createValkeyClient();

if (process.env.NODE_ENV !== "production") {
	globalForValkey.valkey = valkey;
}

/**
 * Secondary storage adapter for Better Auth
 * Uses Valkey/Redis for session caching and rate limiting
 */
export const secondaryStorage = {
	get: async (key: string): Promise<string | null> => {
		try {
			return await valkey.get(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to get from Valkey");
			return null;
		}
	},
	set: async (key: string, value: string, ttl?: number): Promise<void> => {
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
		try {
			await valkey.del(key);
		} catch (error) {
			logger.error({ error, key }, "Failed to delete from Valkey");
		}
	},
};
