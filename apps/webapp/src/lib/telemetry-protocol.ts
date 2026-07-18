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

function isMetric(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		typeof value === "number" &&
		value >= 0 &&
		value <= MAX_METRIC_VALUE
	);
}

function protocolError(message: string): never {
	throw new TelemetryProtocolError(message);
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
	if (typeof timestamp !== "string") {
		protocolError("Telemetry timestamp must be an RFC3339 string");
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
	for (const key of [
		"active_users_24h",
		"total_organizations",
		"total_employees",
		"sessions_created_24h",
	] as const) {
		if (!isMetric(metrics[key])) {
			protocolError(`Telemetry metric ${key} must be a non-negative integer`);
		}
	}
	if (
		OPTIONAL_METRIC_KEY in metrics &&
		!isMetric(metrics[OPTIONAL_METRIC_KEY])
	) {
		protocolError(
			`Telemetry metric ${OPTIONAL_METRIC_KEY} must be a non-negative integer`,
		);
	}
	if (
		metrics.license_type !== "community" &&
		metrics.license_type !== "enterprise"
	) {
		protocolError("Telemetry license_type is unsupported");
	}

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

	return {
		deploymentId,
		timestamp,
		body,
		bodyHash: createHash("sha256").update(body).digest("hex"),
	};
}
