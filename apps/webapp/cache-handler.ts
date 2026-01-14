/**
 * Custom Cache Handler for Next.js 16 cacheComponents using Bun's native Redis client
 *
 * This handler uses Valkey/Redis for distributed caching across Next.js instances.
 * Connection is configured from environment variables:
 *   - VALKEY_HOST (required) - Valkey server hostname
 *   - VALKEY_PORT (optional) - Valkey server port (default: 6379)
 *   - VALKEY_PASSWORD (optional) - Valkey authentication password
 */

// Build connection URL from environment variables
const host = process.env.VALKEY_HOST || "localhost";
const port = process.env.VALKEY_PORT || "6379";
const password = process.env.VALKEY_PASSWORD;

const connectionUrl = password
	? `valkey://:${encodeURIComponent(password)}@${host}:${port}`
	: `valkey://${host}:${port}`;

// Set the URL for Bun's auto-detection
process.env.VALKEY_URL = connectionUrl;

// Use Bun's native Redis client - faster than ioredis
const redis = Bun.redis;

const CACHE_PREFIX = "nextjs:cache:";
const TAG_PREFIX = "nextjs:tag:";

interface CacheEntry {
	value: unknown;
	tags: string[];
	expireAt?: number;
}

export default class CacheHandler {
	constructor() {
		console.log(`[CacheHandler] Initialized with Bun native Redis client → ${host}:${port}`);
	}

	async get(key: string): Promise<CacheEntry | null> {
		try {
			const data = await redis.get(CACHE_PREFIX + key);
			if (!data) return null;

			const entry: CacheEntry = JSON.parse(data);

			// Check if expired
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

	async set(key: string, value: unknown, options?: { tags?: string[]; ttl?: number }): Promise<void> {
		try {
			const entry: CacheEntry = {
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

			// Store key references for each tag (for tag-based invalidation)
			if (options?.tags) {
				for (const tag of options.tags) {
					await redis.sadd(TAG_PREFIX + tag, key);
				}
			}
		} catch (error) {
			console.error("[CacheHandler] Set error:", error);
		}
	}

	async delete(key: string): Promise<void> {
		try {
			// Get entry to find its tags
			const data = await redis.get(CACHE_PREFIX + key);
			if (data) {
				const entry: CacheEntry = JSON.parse(data);
				// Remove key from tag sets
				for (const tag of entry.tags) {
					await redis.srem(TAG_PREFIX + tag, key);
				}
			}
			await redis.del(CACHE_PREFIX + key);
		} catch (error) {
			console.error("[CacheHandler] Delete error:", error);
		}
	}

	async revalidateTag(tag: string): Promise<void> {
		try {
			// Get all keys associated with this tag
			const keys = await redis.smembers(TAG_PREFIX + tag);

			// Delete all cached entries with this tag
			for (const key of keys) {
				await redis.del(CACHE_PREFIX + key);
			}

			// Clear the tag set
			await redis.del(TAG_PREFIX + tag);

			console.log(`[CacheHandler] Revalidated tag: ${tag}, cleared ${keys.length} entries`);
		} catch (error) {
			console.error("[CacheHandler] RevalidateTag error:", error);
		}
	}
}
