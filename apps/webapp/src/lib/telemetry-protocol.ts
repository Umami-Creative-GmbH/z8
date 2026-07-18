import { createHash } from "node:crypto";

import {
	compareInstants,
	type Instant,
	parseInstant,
} from "@/lib/datetime/temporal-core";

export const MAX_TELEMETRY_BODY_BYTES = 65_536;

export type TelemetryLicenseType = "community" | "enterprise";

export interface TelemetryWireMetrics {
	active_users_24h: number;
	total_organizations: number;
	total_employees: number;
	sessions_created_24h: number;
	api_requests_24h?: number;
	license_type: TelemetryLicenseType;
}

export interface TelemetryPayloadV2 {
	version: "2.0";
	deployment_id: string;
	timestamp: string;
	metrics: TelemetryWireMetrics;
}

export interface PreparedTelemetryReport {
	deploymentId: string;
	timestamp: string;
	body: Buffer;
	bodyHash: string;
}

export class TelemetryProtocolError extends Error {
	override name = "TelemetryProtocolError";
}

const LOWERCASE_UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339_TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_METRIC_VALUE = 2_147_483_647;
const PAYLOAD_KEYS = ["version", "deployment_id", "timestamp", "metrics"];
const REQUIRED_METRIC_KEYS = [
	"active_users_24h",
	"total_organizations",
	"total_employees",
	"sessions_created_24h",
	"license_type",
];
const OPTIONAL_METRIC_KEY = "api_requests_24h";

export function isLowercaseUuidV4(value: unknown): value is string {
	return typeof value === "string" && LOWERCASE_UUID_V4.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
	value: Record<string, unknown>,
	requiredKeys: string[],
	optionalKey?: string,
): boolean {
	const keys = Reflect.ownKeys(value);
	const allowedCount =
		requiredKeys.length + (optionalKey && optionalKey in value ? 1 : 0);

	return (
		keys.length === allowedCount &&
		keys.every(
			(key) =>
				typeof key === "string" &&
				Object.prototype.propertyIsEnumerable.call(value, key) &&
				(requiredKeys.includes(key) || key === optionalKey),
		)
	);
}

function validateMetric(value: unknown, key: string): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > MAX_METRIC_VALUE
	) {
		protocolError(`Telemetry metric ${key} must be a non-negative integer`);
	}

	return value;
}

function protocolError(message: string): never {
	throw new TelemetryProtocolError(message);
}

export function serializeTelemetryPayload(payload: TelemetryPayloadV2): Buffer {
	let serialized: string;
	try {
		serialized = JSON.stringify(payload);
	} catch {
		protocolError("Telemetry payload could not be serialized");
	}
	const body = Buffer.from(serialized, "utf8");
	if (body.byteLength > MAX_TELEMETRY_BODY_BYTES) {
		protocolError("Telemetry payload exceeds the maximum body size");
	}

	return body;
}

export function prepareTelemetryReport(
	payload: unknown,
	now: Instant,
): PreparedTelemetryReport {
	if (!isRecord(payload) || !hasExactKeys(payload, PAYLOAD_KEYS)) {
		protocolError("Telemetry payload must contain exactly the v2 wire fields");
	}

	const { version, deployment_id: deploymentId, timestamp, metrics } = payload;
	if (version !== "2.0") {
		protocolError("Telemetry payload version must be 2.0");
	}
	if (!isLowercaseUuidV4(deploymentId)) {
		protocolError("Telemetry deployment_id must be a lowercase UUID v4");
	}
	if (typeof timestamp !== "string" || !RFC3339_TIMESTAMP.test(timestamp)) {
		protocolError("Telemetry timestamp must use RFC3339 full-time syntax");
	}

	let timestampInstant: Instant;
	try {
		timestampInstant = parseInstant(timestamp);
	} catch {
		protocolError(
			"Telemetry timestamp must be RFC3339 with an explicit offset",
		);
	}
	if (compareInstants(timestampInstant, now.subtract({ hours: 48 })) < 0) {
		protocolError("Telemetry timestamp is more than 48 hours old");
	}
	if (compareInstants(timestampInstant, now.add({ minutes: 5 })) > 0) {
		protocolError("Telemetry timestamp is more than 5 minutes in the future");
	}

	if (
		!isRecord(metrics) ||
		!hasExactKeys(metrics, REQUIRED_METRIC_KEYS, OPTIONAL_METRIC_KEY)
	) {
		protocolError("Telemetry metrics must contain exactly the v2 wire fields");
	}
	const {
		active_users_24h: activeUsers24h,
		total_organizations: totalOrganizations,
		total_employees: totalEmployees,
		sessions_created_24h: sessionsCreated24h,
		api_requests_24h: apiRequests24h,
		license_type: licenseType,
	} = metrics;
	const hasApiRequests24h = Object.hasOwn(metrics, OPTIONAL_METRIC_KEY);
	const validatedActiveUsers24h = validateMetric(
		activeUsers24h,
		"active_users_24h",
	);
	const validatedTotalOrganizations = validateMetric(
		totalOrganizations,
		"total_organizations",
	);
	const validatedTotalEmployees = validateMetric(
		totalEmployees,
		"total_employees",
	);
	const validatedSessionsCreated24h = validateMetric(
		sessionsCreated24h,
		"sessions_created_24h",
	);
	const validatedApiRequests24h = hasApiRequests24h
		? validateMetric(apiRequests24h, OPTIONAL_METRIC_KEY)
		: undefined;
	if (licenseType !== "community" && licenseType !== "enterprise") {
		protocolError("Telemetry license_type is unsupported");
	}

	const normalizedPayload: TelemetryPayloadV2 = {
		version,
		deployment_id: deploymentId,
		timestamp,
		metrics: {
			active_users_24h: validatedActiveUsers24h,
			total_organizations: validatedTotalOrganizations,
			total_employees: validatedTotalEmployees,
			sessions_created_24h: validatedSessionsCreated24h,
			...(hasApiRequests24h
				? { api_requests_24h: validatedApiRequests24h }
				: {}),
			license_type: licenseType,
		},
	};
	const body = serializeTelemetryPayload(normalizedPayload);

	return {
		deploymentId,
		timestamp,
		body,
		bodyHash: createHash("sha256").update(body).digest("hex"),
	};
}
