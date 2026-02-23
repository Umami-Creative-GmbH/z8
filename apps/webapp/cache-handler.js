/**
 * Custom Cache Handler for Next.js 16
 *
 * This handler uses Valkey/Redis for distributed caching across Next.js instances.
 * Connection is configured from environment variables:
 *   - VALKEY_HOST (required) - Valkey server hostname
 *   - VALKEY_PORT (optional) - Valkey server port (default: 6379)
 *   - VALKEY_PASSWORD (optional) - Valkey authentication password
 */

const Redis = require("ioredis");

const host = process.env.VALKEY_HOST || "localhost";
const port = Number(process.env.VALKEY_PORT || "6379");
const password = process.env.VALKEY_PASSWORD;
const isCi = process.env.CI === "true";

let hasLoggedConnectionError = false;

const redis = new Redis({
	host,
	port,
	password: password || undefined,
	maxRetriesPerRequest: 3,
	lazyConnect: false,
	enableReadyCheck: false,
	enableOfflineQueue: true,
});

redis.on("error", (err) => {
	if (isCi) {
		if (!hasLoggedConnectionError) {
			hasLoggedConnectionError = true;
			console.warn("[CacheHandler] Redis unavailable during CI build; using cache misses.");
		}
		return;
	}

	console.error("[CacheHandler] Redis connection error:", err);
});

const CACHE_PREFIX = "nextjs:cache:";
const TAG_PREFIX = "nextjs:tag:";

class CacheHandler {
	constructor() {
		console.log(`[CacheHandler] Initialized with ioredis client -> ${host}:${port}`);
	}

	async get(key) {
		try {
			const data = await redis.get(CACHE_PREFIX + key);
			if (!data) return null;

			const entry = JSON.parse(data);

			if (entry.expireAt && Date.now() > entry.expireAt) {
				await this.delete(key);
				return null;
			}

			return entry;
		} catch (error) {
			console.error("[CacheHandler] Get error:", error);
			return null;
		}
	}

	async set(key, value, options) {
		try {
			const entry = {
				value,
				tags: options?.tags || [],
				expireAt: options?.ttl ? Date.now() + options.ttl * 1000 : undefined,
			};

			const serialized = JSON.stringify(entry);

			if (options?.ttl) {
				await redis.set(CACHE_PREFIX + key, serialized, "EX", options.ttl);
			} else {
				await redis.set(CACHE_PREFIX + key, serialized);
			}

			if (options?.tags) {
				for (const tag of options.tags) {
					await redis.sadd(TAG_PREFIX + tag, key);
				}
			}
		} catch (error) {
			console.error("[CacheHandler] Set error:", error);
		}
	}

	async delete(key) {
		try {
			const data = await redis.get(CACHE_PREFIX + key);
			if (data) {
				const entry = JSON.parse(data);
				for (const tag of entry.tags) {
					await redis.srem(TAG_PREFIX + tag, key);
				}
			}
			await redis.del(CACHE_PREFIX + key);
		} catch (error) {
			console.error("[CacheHandler] Delete error:", error);
		}
	}

	async revalidateTag(tag) {
		try {
			const keys = await redis.smembers(TAG_PREFIX + tag);

			for (const key of keys) {
				await redis.del(CACHE_PREFIX + key);
			}

			await redis.del(TAG_PREFIX + tag);

			console.log(`[CacheHandler] Revalidated tag: ${tag}, cleared ${keys.length} entries`);
		} catch (error) {
			console.error("[CacheHandler] RevalidateTag error:", error);
		}
	}
}

module.exports = CacheHandler;
