import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { valkey } from "@/lib/valkey";
import { isQueueHealthy } from "@/lib/queue";

const logger = createLogger("Health");

export type ServiceStatus = "healthy" | "degraded" | "unhealthy";

export interface ServiceHealth {
	status: ServiceStatus;
	latencyMs?: number;
	error?: string;
	details?: Record<string, unknown>;
}

export interface HealthCheckResult {
	status: ServiceStatus;
	timestamp: string;
	version?: string;
	uptime?: number;
	services: {
		database: ServiceHealth;
		cache: ServiceHealth;
		queue?: ServiceHealth;
	};
}

/**
 * Check PostgreSQL database connectivity
 */
export async function checkDatabase(): Promise<ServiceHealth> {
	const start = performance.now();
	try {
		await db.execute(sql`SELECT 1`);
		return {
			status: "healthy",
			latencyMs: Math.round(performance.now() - start),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return {
			status: "unhealthy",
			latencyMs: Math.round(performance.now() - start),
			error: message,
		};
	}
}

/**
 * Check Valkey/Redis connectivity (optional service)
 */
export async function checkCache(): Promise<ServiceHealth> {
	const start = performance.now();
	try {
		// Attempt to connect if not already connected (lazyConnect is enabled)
		if (valkey.status !== "ready") {
			await valkey.connect();
		}
		await valkey.ping();
		return {
			status: "healthy",
			latencyMs: Math.round(performance.now() - start),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return {
			status: "degraded", // Cache is optional, so degraded not unhealthy
			latencyMs: Math.round(performance.now() - start),
			error: message,
		};
	}
}

/**
 * Check BullMQ queue connectivity (optional service)
 */
export async function checkQueue(): Promise<ServiceHealth> {
	const start = performance.now();
	try {
		const healthy = await isQueueHealthy();
		if (healthy) {
			return {
				status: "healthy",
				latencyMs: Math.round(performance.now() - start),
			};
		}
		return {
			status: "degraded",
			latencyMs: Math.round(performance.now() - start),
			error: "Queue connection unavailable",
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return {
			status: "degraded", // Queue is optional
			latencyMs: Math.round(performance.now() - start),
			error: message,
		};
	}
}

/**
 * Run all health checks and return aggregated result
 */
export async function checkHealth(): Promise<HealthCheckResult> {
	const [database, cache, queue] = await Promise.all([
		checkDatabase(),
		checkCache(),
		checkQueue(),
	]);

	// Overall status: unhealthy if DB is down, degraded if cache/queue is down
	let status: ServiceStatus = "healthy";
	if (database.status === "unhealthy") {
		status = "unhealthy";
	} else if (
		cache.status === "degraded" ||
		cache.status === "unhealthy" ||
		queue.status === "degraded" ||
		queue.status === "unhealthy"
	) {
		status = "degraded";
	}

	return {
		status,
		timestamp: new Date().toISOString(),
		version: process.env.npm_package_version || "unknown",
		uptime: process.uptime(),
		services: {
			database,
			cache,
			queue,
		},
	};
}

/**
 * Run startup health checks with logging
 * Returns true if critical services (database) are available
 */
export async function runStartupChecks(): Promise<boolean> {
	logger.info("Running startup health checks...");

	const result = await checkHealth();

	// Log database status
	if (result.services.database.status === "healthy") {
		logger.info({ latencyMs: result.services.database.latencyMs }, "Database connection verified");
	} else {
		logger.error({ error: result.services.database.error }, "Database connection failed");
	}

	// Log cache status (optional service)
	if (result.services.cache.status === "healthy") {
		logger.info({ latencyMs: result.services.cache.latencyMs }, "Cache connection verified");
	} else {
		logger.warn(
			{ error: result.services.cache.error },
			"Cache unavailable - sessions will use database only",
		);
	}

	// Return true only if database is healthy (cache is optional)
	const success = result.services.database.status === "healthy";

	if (success) {
		logger.info({ status: result.status }, "Startup checks completed");
	} else {
		logger.error({ status: result.status }, "Startup checks failed");
	}

	return success;
}
