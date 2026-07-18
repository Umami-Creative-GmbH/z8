import crypto from "node:crypto";
import { count, eq, gte } from "drizzle-orm";
import { Effect, pipe, Schedule } from "effect";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, systemConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
	generateTelemetrySigningKey,
	isLowercaseUuidV4,
	parseTelemetrySigningKey,
	type TelemetrySigningKey,
} from "@/lib/telemetry-protocol";

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

export interface TelemetryConfigStore {
	read(key: string): Promise<string | undefined>;
	insertIfAbsent(input: {
		key: string;
		value: string;
		description: string;
	}): Promise<boolean>;
}

export interface TelemetryIdentity {
	deploymentId: string;
	signingKey: TelemetrySigningKey;
}

interface TelemetryIdentityOptions {
	store?: TelemetryConfigStore;
	info?: (context: Record<string, string>, message: string) => void;
}

const DEPLOYMENT_ID_KEY = "deployment_id";
const SIGNING_KEY_KEY = "telemetry_signing_key";

const databaseTelemetryConfigStore: TelemetryConfigStore = {
	async read(key) {
		const existing = await db
			.select({ value: systemConfig.value })
			.from(systemConfig)
			.where(eq(systemConfig.key, key))
			.limit(1);

		return existing[0]?.value ?? undefined;
	},
	async insertIfAbsent({ key, value, description }) {
		const inserted = await db
			.insert(systemConfig)
			.values({ key, value, description })
			.onConflictDoNothing({ target: systemConfig.key })
			.returning({ key: systemConfig.key });

		return inserted.length > 0;
	},
};

function storageFailure(operation: string, error: unknown): never {
	logger.error(
		{
			operation,
			errorType: error instanceof Error ? error.name : typeof error,
		},
		"Failed to persist telemetry identity",
	);
	throw new TelemetryValidationError(`Failed to ${operation}`);
}

async function readConfig(
	store: TelemetryConfigStore,
	key: string,
): Promise<string | undefined> {
	try {
		return await store.read(key);
	} catch (error) {
		storageFailure(`read ${key}`, error);
	}
}

async function insertConfig(
	store: TelemetryConfigStore,
	input: { key: string; value: string; description: string },
): Promise<boolean> {
	try {
		return await store.insertIfAbsent(input);
	} catch (error) {
		storageFailure(`insert ${input.key}`, error);
	}
}

async function getOrCreateDeploymentIdFromStore(
	store: TelemetryConfigStore,
): Promise<string> {
	const existing = await readConfig(store, DEPLOYMENT_ID_KEY);
	if (existing !== undefined) {
		if (!isLowercaseUuidV4(existing)) {
			throw new TelemetryValidationError(
				"Stored deployment ID must be a lowercase UUID v4",
			);
		}
		return existing;
	}

	const candidate = crypto.randomUUID().toLowerCase();
	await insertConfig(store, {
		key: DEPLOYMENT_ID_KEY,
		value: candidate,
		description:
			"Unique identifier for this deployment, used for telemetry reporting",
	});
	const winner = await readConfig(store, DEPLOYMENT_ID_KEY);
	if (!isLowercaseUuidV4(winner)) {
		throw new TelemetryValidationError(
			"Stored deployment ID must be a lowercase UUID v4",
		);
	}

	return winner;
}

/** Get or create the persistent deployment ID used by telemetry and diagnostics. */
export async function getOrCreateDeploymentId(): Promise<string> {
	return getOrCreateDeploymentIdFromStore(databaseTelemetryConfigStore);
}

export async function getOrCreateTelemetryIdentity(
	options: TelemetryIdentityOptions = {},
): Promise<TelemetryIdentity> {
	const store = options.store ?? databaseTelemetryConfigStore;
	const info = options.info ?? logger.info.bind(logger);
	const deploymentId = await getOrCreateDeploymentIdFromStore(store);
	const existing = await readConfig(store, SIGNING_KEY_KEY);
	if (existing !== undefined) {
		return { deploymentId, signingKey: parseTelemetrySigningKey(existing) };
	}

	const candidate = generateTelemetrySigningKey();
	const serializedCandidate = JSON.stringify(candidate);
	const inserted = await insertConfig(store, {
		key: SIGNING_KEY_KEY,
		value: serializedCandidate,
		description:
			"Ed25519 signing identity for authenticated telemetry reporting",
	});
	const winner = await readConfig(store, SIGNING_KEY_KEY);
	if (winner === undefined) {
		throw new TelemetryValidationError(
			"Telemetry signing key was not persisted",
		);
	}
	const signingKey = parseTelemetrySigningKey(winner);

	if (inserted) {
		info(
			{
				deploymentId,
				publicKeySpkiBase64: signingKey.public_key_spki_base64,
			},
			"Generated telemetry signing identity",
		);
	}

	return { deploymentId, signingKey };
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
				const response = await fetch("https://telemetry.z8-time.app", {
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
