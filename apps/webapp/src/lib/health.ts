import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { createLogger } from "@/lib/logger";
import { isQueueHealthy } from "@/lib/queue";
import { s3Client, S3_BUCKET } from "@/lib/storage/s3-client";
import { valkey } from "@/lib/valkey";

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
		storage: ServiceHealth;
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
 * Check S3 storage connectivity (critical service)
 */
export async function checkStorage(): Promise<ServiceHealth> {
	const start = performance.now();
	try {
		await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
		return {
			status: "healthy",
			latencyMs: Math.round(performance.now() - start),
			details: { bucket: S3_BUCKET },
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return {
			status: "unhealthy",
			latencyMs: Math.round(performance.now() - start),
			error: message,
			details: { bucket: S3_BUCKET },
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
	const [database, cache, storage, queue] = await Promise.all([
		checkDatabase(),
		checkCache(),
		checkStorage(),
		checkQueue(),
	]);

	// Overall status: unhealthy if DB or storage is down, degraded if cache/queue is down
	let status: ServiceStatus = "healthy";
	if (database.status === "unhealthy" || storage.status === "unhealthy") {
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
			storage,
			queue,
		},
	};
}

/**
 * Run startup health checks with logging
 * Returns true if critical services (database, storage) are available
 */
export async function runStartupChecks(): Promise<boolean> {
	logger.info("Running startup health checks...");

	const result = await checkHealth();

	// Log database status (critical)
	if (result.services.database.status === "healthy") {
		logger.info({ latencyMs: result.services.database.latencyMs }, "Database connection verified");
	} else {
		logger.error({ error: result.services.database.error }, "Database connection failed");
	}

	// Log storage status (critical)
	if (result.services.storage.status === "healthy") {
		logger.info(
			{
				latencyMs: result.services.storage.latencyMs,
				bucket: result.services.storage.details?.bucket,
			},
			"S3 storage verified",
		);
	} else {
		logger.error(
			{
				error: result.services.storage.error,
				bucket: result.services.storage.details?.bucket,
			},
			"S3 storage connection failed",
		);
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

	// Return true only if database AND storage are healthy (cache is optional)
	const success =
		result.services.database.status === "healthy" &&
		result.services.storage.status === "healthy";

	if (success) {
		logger.info({ status: result.status }, "Startup checks completed");
	} else {
		logger.error({ status: result.status }, "Startup checks failed");
	}

	return success;
}
