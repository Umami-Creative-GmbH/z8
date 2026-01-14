import crypto from "node:crypto";
import { count, eq, gte } from "drizzle-orm";
import { Effect, pipe, Schedule } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, systemConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";

const logger = createLogger("telemetry");

export interface TelemetryMetrics {
	activeUsers24h: number;
	totalOrganizations: number;
	totalEmployees: number;
	sessionsCreated24h: number;
	licenseType: string;
}

export interface TelemetryPayload {
	version: string;
	deploymentId: string;
	metrics: TelemetryMetrics;
	timestamp: string;
}

export class TelemetryNetworkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TelemetryNetworkError";
	}
}

export class TelemetryTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TelemetryTimeoutError";
	}
}

export class TelemetryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TelemetryValidationError";
	}
}

/**
 * Get or create a persistent deployment ID
 */
export async function getOrCreateDeploymentId(): Promise<string> {
	try {
		const existing = await db
			.select({ value: systemConfig.value })
			.from(systemConfig)
			.where(eq(systemConfig.key, "deployment_id"))
			.limit(1);

		if (existing.length > 0 && existing[0].value) {
			logger.debug("Using existing deployment ID");
			return existing[0].value;
		}

		const newId = crypto.randomUUID();
		logger.info({ deploymentId: newId }, "Generated new deployment ID");

		await db
			.insert(systemConfig)
			.values({
				key: "deployment_id",
				value: newId,
				description: "Unique identifier for this deployment, used for telemetry reporting",
			})
			.onConflictDoUpdate({
				target: systemConfig.key,
				set: {
					value: newId,
					updatedAt: new Date(),
				},
			});

		return newId;
	} catch (err) {
		logger.error({ error: err }, "Failed to get or create deployment ID");
		throw new TelemetryValidationError("Failed to get or create deployment ID");
	}
}

/**
 * Calculate anonymous aggregated metrics from the database
 */
export async function calculateTelemetryMetrics(): Promise<TelemetryMetrics> {
	try {
		const now = new Date();
		const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

		const [activeUsersResult, orgsResult, employeesResult, newSessionsResult] = await Promise.all([
			db
				.select({ count: count() })
				.from(authSchema.session)
				.where(gte(authSchema.session.updatedAt, twentyFourHoursAgo)),

			db.select({ count: count() }).from(authSchema.organization),

			db.select({ count: count() }).from(employee).where(eq(employee.isActive, true)),

			db
				.select({ count: count() })
				.from(authSchema.session)
				.where(gte(authSchema.session.createdAt, twentyFourHoursAgo)),
		]);

		const activeUsers24h = activeUsersResult[0]?.count || 0;
		const totalOrganizations = orgsResult[0]?.count || 0;
		const totalEmployees = employeesResult[0]?.count || 0;
		const sessionsCreated24h = newSessionsResult[0]?.count || 0;

		const metrics: TelemetryMetrics = {
			activeUsers24h,
			totalOrganizations,
			totalEmployees,
			sessionsCreated24h,
			licenseType: "community",
		};

		logger.info({ metrics }, "Calculated telemetry metrics");

		return metrics;
	} catch (err) {
		logger.error({ error: err }, "Failed to calculate telemetry metrics");
		throw new TelemetryValidationError("Failed to calculate metrics");
	}
}

/**
 * Send report with exponential backoff retry logic
 */
export async function sendTelemetryReport(
	deploymentId: string,
	metrics: TelemetryMetrics,
): Promise<boolean> {
	const payload: TelemetryPayload = {
		version: "1.0",
		deploymentId,
		metrics,
		timestamp: new Date().toISOString(),
	};

	const effect = pipe(
		Effect.tryPromise({
			try: async () => {
				const response = await fetch("https://z8-time.app/telemetry", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(10000),
				});

				if (!response.ok) {
					throw new TelemetryNetworkError(
						`Telemetry server returned ${response.status}: ${response.statusText}`,
					);
				}

				return true;
			},
			catch: (error) => {
				if (error instanceof TypeError && error.message.includes("fetch failed")) {
					return new TelemetryNetworkError("Failed to connect to telemetry server");
				}
				if (error instanceof Error && error.name === "AbortError") {
					return new TelemetryTimeoutError("Telemetry request timeout");
				}
				return new TelemetryNetworkError("Failed to send telemetry");
			},
		}),
		Effect.retry(pipe(Schedule.exponential("1 second"), Schedule.compose(Schedule.recurs(2)))),
		Effect.tap(() =>
			Effect.sync(() => {
				logger.info({ deploymentId }, "Telemetry sent successfully");
			}),
		),
		Effect.tapError((error) =>
			Effect.sync(() => {
				logger.error(
					{
						error: error instanceof Error ? error.message : String(error),
						errorType: error instanceof Error ? error.name : typeof error,
						deploymentId,
					},
					"Failed to send telemetry after retries",
				);
			}),
		),
		Effect.orElseSucceed(() => false),
	);

	try {
		return Effect.runSync(effect);
	} catch {
		return false;
	}
}
