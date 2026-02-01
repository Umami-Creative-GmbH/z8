import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../logger";

const logger = createLogger("SetupConfigCache");

/**
 * In-memory cache for "is platform configured" status.
 * This avoids a database query on every request after initial load.
 *
 * The cache is:
 * - null = not yet loaded (will query DB on first check)
 * - true = platform admin exists (app is configured)
 * - false = no platform admin (app needs setup)
 */
let configuredStatus: boolean | null = null;

/**
 * Check if the platform is configured (at least one platform admin exists).
 * Uses in-memory cache after first check for performance.
 */
export async function isPlatformConfigured(): Promise<boolean> {
	// Return cached value if available
	if (configuredStatus !== null) {
		return configuredStatus;
	}

	try {
		// Query database to check if any platform admin exists
		const [admin] = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.role, "admin"))
			.limit(1);

		configuredStatus = !!admin;
		logger.info(
			{ configured: configuredStatus },
			"Platform configuration status loaded",
		);

		return configuredStatus;
	} catch (error) {
		logger.error({ error }, "Failed to check platform configuration status");
		// On error, assume not configured to allow setup
		// This prevents bricking the app on transient DB issues during startup
		return false;
	}
}

/**
 * Invalidate the configuration cache.
 * Call this after creating the first platform admin.
 */
export async function invalidateConfigCache(): Promise<void> {
	configuredStatus = null;
	// Immediately reload the status
	await isPlatformConfigured();
}

/**
 * Force set the configuration status.
 * Used after successful admin creation without needing a DB query.
 */
export function setConfiguredStatus(status: boolean): void {
	configuredStatus = status;
	logger.info({ configured: status }, "Platform configuration status set");
}
