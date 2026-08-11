import crypto from "node:crypto";
import { count, countDistinct, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee, systemConfig } from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	createTelemetryAuthHeaders,
	generateTelemetrySigningKey,
	isLowercaseUuidV4,
	parseTelemetrySigningKey,
	prepareTelemetryReport,
	type TelemetryLicenseType,
	type TelemetrySigningKey,
} from "@/lib/telemetry-protocol";

const logger = createLogger("telemetry");

export interface TelemetryMetrics {
	activeUsers24h: number;
	totalOrganizations: number;
	totalEmployees: number;
	sessionsCreated24h: number;
	apiRequests24h?: number;
	licenseType: TelemetryLicenseType;
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

export interface TelemetrySenderDependencies {
	createAuthHeaders: typeof createTelemetryAuthHeaders;
	fetch: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>;
	getIdentity: () => Promise<TelemetryIdentity>;
	now: () => Instant;
	sleep: (milliseconds: number) => Promise<void>;
	info: (context: Record<string, unknown>, message: string) => void;
	error: (context: Record<string, unknown>, message: string) => void;
	prepareReport: typeof prepareTelemetryReport;
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

async function persistTelemetrySigningKey(
	store: TelemetryConfigStore,
	value: string,
) {
	const inserted = await insertConfig(store, {
		key: SIGNING_KEY_KEY,
		value,
		description:
			"Ed25519 signing identity for authenticated telemetry reporting",
	});

	return {
		inserted,
		winner: await readConfig(store, SIGNING_KEY_KEY),
	};
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
	const [deploymentId, existing] = await Promise.all([
		getOrCreateDeploymentIdFromStore(store),
		readConfig(store, SIGNING_KEY_KEY),
	]);
	if (existing !== undefined) {
		return { deploymentId, signingKey: parseTelemetrySigningKey(existing) };
	}

	const candidate = generateTelemetrySigningKey();
	const serializedCandidate = JSON.stringify(candidate);
	const { inserted, winner } = await persistTelemetrySigningKey(
		store,
		serializedCandidate,
	);
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
		const twentyFourHoursAgo = telemetryCutoffDate(systemClock.nowInstant());

		const [activeUsersResult, orgsResult, employeesResult, newSessionsResult] =
			await Promise.all([
				db
					.select({ count: countDistinct(authSchema.session.userId) })
					.from(authSchema.session)
					.where(gte(authSchema.session.updatedAt, twentyFourHoursAgo)),

				db.select({ count: count() }).from(authSchema.organization),

				db
					.select({ count: count() })
					.from(employee)
					.where(eq(employee.isActive, true)),

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

export function telemetryCutoffDate(now: Instant): Date {
	return dateFromInstant(now.subtract({ hours: 24 }));
}

const TELEMETRY_ENDPOINT = "https://telemetry.z8-time.app/api/telemetry";
const MAX_ATTEMPTS = 3;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RFC3339_EXPLICIT_OFFSET =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const HTTP_DATE =
	/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;

function createTelemetryTimeoutSignal(): AbortSignal {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(
			new DOMException("Telemetry request timed out", "TimeoutError"),
		);
	}, 10_000);
	timeout.unref();
	return controller.signal;
}

const defaultSenderDependencies: TelemetrySenderDependencies = {
	createAuthHeaders: createTelemetryAuthHeaders,
	fetch: (input, init) => fetch(input, init),
	getIdentity: getOrCreateTelemetryIdentity,
	now: () => systemClock.nowInstant(),
	sleep: (milliseconds) =>
		new Promise((resolve) => {
			setTimeout(resolve, milliseconds);
		}),
	info: logger.info.bind(logger),
	error: logger.error.bind(logger),
	prepareReport: prepareTelemetryReport,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeoutError(error: unknown): error is Error {
	return (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	);
}

function receiverIdentifiers(response: Response, body: unknown) {
	const record = isRecord(body) ? body : undefined;
	return {
		code:
			typeof record?.code === "string"
				? record.code
				: "telemetry_receiver_error",
		bodyRequestId:
			typeof record?.request_id === "string" ? record.request_id : undefined,
		headerRequestId: response.headers.get("X-Request-Id") ?? undefined,
	};
}

function retryAfterMilliseconds(
	header: string | null,
	attemptInstant: Instant,
): number | undefined {
	if (header === null) return undefined;
	if (/^\d+$/.test(header)) {
		try {
			const milliseconds = BigInt(header) * BigInt(1000);
			return milliseconds <= BigInt(MAX_TIMER_DELAY_MS)
				? Number(milliseconds)
				: undefined;
		} catch {
			return undefined;
		}
	}

	if (!HTTP_DATE.test(header)) return undefined;
	const parsedDate = new Date(header);
	if (!Number.isFinite(parsedDate.getTime())) return undefined;
	const retryInstant = instantFromDate(parsedDate);
	if (compareInstants(retryInstant, attemptInstant) <= 0) return 0;
	const milliseconds = retryInstant.since(attemptInstant).total({
		unit: "milliseconds",
	});
	return Number.isSafeInteger(milliseconds) &&
		milliseconds <= MAX_TIMER_DELAY_MS
		? milliseconds
		: undefined;
}

function isValidSuccess(body: unknown, deploymentId: string): boolean {
	if (!isRecord(body)) return false;
	if (
		body.deployment_id !== deploymentId ||
		typeof body.idempotent !== "boolean" ||
		typeof body.recorded_at !== "string" ||
		!RFC3339_EXPLICIT_OFFSET.test(body.recorded_at)
	) {
		return false;
	}
	try {
		parseInstant(body.recorded_at);
		return true;
	} catch {
		return false;
	}
}

export async function sendTelemetryReportWithDependencies(
	deploymentId: string,
	metrics: TelemetryMetrics,
	dependencies: TelemetrySenderDependencies,
): Promise<boolean> {
	try {
		const identity = await dependencies.getIdentity();
		if (identity.deploymentId !== deploymentId) {
			dependencies.error(
				{ category: "identity_mismatch", deploymentId },
				"Telemetry report validation failed",
			);
			return false;
		}

		const reportInstant = dependencies.now();
		const report = dependencies.prepareReport(
			{
				version: "2.0",
				deployment_id: deploymentId,
				timestamp: reportInstant.toString(),
				metrics: {
					active_users_24h: metrics.activeUsers24h,
					total_organizations: metrics.totalOrganizations,
					total_employees: metrics.totalEmployees,
					sessions_created_24h: metrics.sessionsCreated24h,
					...(metrics.apiRequests24h === undefined
						? {}
						: { api_requests_24h: metrics.apiRequests24h }),
					license_type: metrics.licenseType,
				},
			},
			reportInstant,
		);

		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
			const attemptInstant = dependencies.now();
			const authHeaders = dependencies.createAuthHeaders({
				report,
				signingKey: identity.signingKey,
				now: attemptInstant,
			});
			let response: Response;
			try {
				response = await dependencies.fetch(TELEMETRY_ENDPOINT, {
					method: "POST",
					headers: { "Content-Type": "application/json", ...authHeaders },
					body: report.body as unknown as BodyInit,
					signal: createTelemetryTimeoutSignal(),
				});
			} catch (error) {
				dependencies.error(
					{
						attempt,
						category: isTimeoutError(error) ? "timeout" : "network",
						deploymentId,
					},
					"Telemetry request failed",
				);
				if (attempt === MAX_ATTEMPTS) return false;
				await dependencies.sleep(1000 * 2 ** (attempt - 1));
				continue;
			}

			let responseBody: unknown;
			try {
				responseBody = await response.json();
			} catch (error) {
				if (
					response.status === 200 &&
					(error instanceof TypeError || isTimeoutError(error))
				) {
					dependencies.error(
						{
							attempt,
							category: isTimeoutError(error) ? "timeout" : "network",
							deploymentId,
						},
						"Telemetry response body failed",
					);
					if (attempt === MAX_ATTEMPTS) return false;
					await dependencies.sleep(1000 * 2 ** (attempt - 1));
					continue;
				}
				responseBody = undefined;
			}

			if (response.status === 200) {
				if (!isValidSuccess(responseBody, deploymentId)) {
					dependencies.error(
						{
							attempt,
							category: "invalid_success_response",
							deploymentId,
							status: response.status,
							...receiverIdentifiers(response, responseBody),
						},
						"Telemetry receiver response validation failed",
					);
					return false;
				}
				dependencies.info(
					{ attempt, deploymentId },
					"Telemetry sent successfully",
				);
				return true;
			}

			const identifiers = receiverIdentifiers(response, responseBody);
			dependencies.error(
				{
					attempt,
					category: "receiver",
					deploymentId,
					status: response.status,
					...identifiers,
				},
				"Telemetry receiver rejected report",
			);
			if (
				(response.status !== 429 && response.status !== 503) ||
				attempt === MAX_ATTEMPTS
			) {
				return false;
			}
			const fallback = 1000 * 2 ** (attempt - 1);
			const delay =
				response.status === 429
					? (retryAfterMilliseconds(
							response.headers.get("Retry-After"),
							HTTP_DATE.test(response.headers.get("Retry-After") ?? "")
								? dependencies.now()
								: attemptInstant,
						) ?? fallback)
					: fallback;
			await dependencies.sleep(delay);
		}
	} catch (error) {
		dependencies.error(
			{
				category: "validation_or_key",
				deploymentId,
				errorType: error instanceof Error ? error.name : typeof error,
			},
			"Telemetry report preparation failed",
		);
		return false;
	}
	return false;
}

/** Send one signed telemetry report, retrying only transient transport failures. */
export async function sendTelemetryReport(
	deploymentId: string,
	metrics: TelemetryMetrics,
): Promise<boolean> {
	return sendTelemetryReportWithDependencies(
		deploymentId,
		metrics,
		defaultSenderDependencies,
	);
}
