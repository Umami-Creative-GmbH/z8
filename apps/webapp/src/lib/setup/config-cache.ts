import { eq } from "drizzle-orm";
import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { createLogger } from "../logger";

const logger = createLogger("SetupConfigCache");

const CACHE_TAG = "platform-configured";
const CACHE_PROFILE = "default";

// In-memory flag: once the platform is configured, it never reverts.
// This avoids per-request DB queries in middleware where unstable_cache
// is not supported (Edge Runtime).
let _configuredInMemory: boolean | null = null;

/**
 * Internal function to query the database for platform admin existence.
 * This is wrapped by unstable_cache for cross-request caching.
 */
async function checkPlatformConfiguredFromDb(): Promise<boolean> {
	try {
		const [admin] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.role, "admin"))
			.limit(1);

		const configured = !!admin;
		logger.info(
			{ configured },
			"Platform configuration status checked from DB",
		);
		return configured;
	} catch (error) {
		// Check if this is a "relation does not exist" error (42P01)
		// This is expected on fresh instances before migrations are run
		// Note: Drizzle wraps pg errors, so code may be at error.code or error.cause.code
		const pgError = error as { code?: string; cause?: { code?: string } };
		const errorCode = pgError.code || pgError.cause?.code;
		if (errorCode === "42P01") {
			logger.info(
				"Database tables not yet created - assuming fresh instance needs setup",
			);
		} else {
			logger.error({ error }, "Failed to check platform configuration status");
		}
		// On error, assume not configured to allow setup
		// This prevents bricking the app on transient DB issues during startup
		return false;
	}
}

/**
 * Cached version of the platform configuration check.
 * Uses Next.js unstable_cache which works correctly across requests
 * and can be invalidated with revalidateTag.
 */
const getCachedPlatformConfigured = unstable_cache(
	checkPlatformConfiguredFromDb,
	["platform-configured"],
	{
		tags: [CACHE_TAG],
		revalidate: false, // Only revalidate on explicit tag invalidation
	},
);

/**
 * Check if the platform is configured (at least one platform admin exists).
 * Uses an in-memory flag as a fast path — once configured, the platform
 * never reverts, so we skip the DB/cache entirely. Falls through to
 * unstable_cache for the initial check (works in server components;
 * in middleware it queries the DB directly, but only until the first `true`).
 */
export async function isPlatformConfigured(): Promise<boolean> {
	if (_configuredInMemory === true) return true;

	const result = await getCachedPlatformConfigured();
	if (result) _configuredInMemory = true;
	return result;
}

/**
 * Invalidate the configuration cache.
 * Call this after creating the first platform admin.
 */
export async function invalidateConfigCache(): Promise<void> {
	revalidateTag(CACHE_TAG, CACHE_PROFILE);
	logger.info("Platform configuration cache invalidated");
}

/**
 * Force set the configuration status by invalidating the cache.
 * The next call to isPlatformConfigured will query the database.
 */
export function setConfiguredStatus(status: boolean): void {
	// In the new implementation, we just invalidate the cache
	// and let the next check query the database
	revalidateTag(CACHE_TAG, CACHE_PROFILE);
	logger.info(
		{ configured: status },
		"Platform configuration cache invalidated (status will be refreshed from DB)",
	);
}
