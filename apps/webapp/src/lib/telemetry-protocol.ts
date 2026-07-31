import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";

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

export interface TelemetrySigningKey {
	version: 1;
	private_key_pkcs8_pem: string;
	public_key_spki_base64: string;
}

export class TelemetryProtocolError extends Error {
	override name = "TelemetryProtocolError";
}

const LOWERCASE_UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RFC3339_TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const RFC3339_UTC_TIMESTAMP =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(?:\.\d{1,9})?Z$/;
const LOWERCASE_NONCE = /^[0-9a-f]{32}$/;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const STANDARD_BASE64 =
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
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
const SIGNING_KEY_KEYS = [
	"version",
	"private_key_pkcs8_pem",
	"public_key_spki_base64",
];

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
	const requiredKeySet = new Set(requiredKeys);
	const allowedCount =
		requiredKeys.length + (optionalKey && optionalKey in value ? 1 : 0);

	return (
		keys.length === allowedCount &&
		keys.every(
			(key) =>
				typeof key === "string" &&
				Object.prototype.propertyIsEnumerable.call(value, key) &&
				(requiredKeySet.has(key) || key === optionalKey),
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

function decodeCanonicalBase64(value: string): Buffer {
	if (!value || !STANDARD_BASE64.test(value)) {
		protocolError("Telemetry public key must use canonical standard base64");
	}

	const decoded = Buffer.from(value, "base64");
	if (decoded.toString("base64") !== value) {
		protocolError("Telemetry public key must use canonical standard base64");
	}

	return decoded;
}

function validateTelemetrySigningKey(value: unknown): TelemetrySigningKey {
	if (!isRecord(value) || !hasExactKeys(value, SIGNING_KEY_KEYS)) {
		protocolError("Telemetry signing key must contain exactly the v1 fields");
	}

	const {
		version,
		private_key_pkcs8_pem: privateKeyPem,
		public_key_spki_base64: publicKeyBase64,
	} = value;
	if (
		version !== 1 ||
		typeof privateKeyPem !== "string" ||
		!privateKeyPem.startsWith("-----BEGIN PRIVATE KEY-----\n") ||
		!privateKeyPem.endsWith("\n-----END PRIVATE KEY-----\n") ||
		typeof publicKeyBase64 !== "string"
	) {
		protocolError("Telemetry signing key fields are invalid");
	}

	const publicKeyDer = decodeCanonicalBase64(publicKeyBase64);
	try {
		const privateKey = createPrivateKey(privateKeyPem);
		const publicKey = createPublicKey({
			key: publicKeyDer,
			format: "der",
			type: "spki",
		});
		if (
			privateKey.asymmetricKeyType !== "ed25519" ||
			publicKey.asymmetricKeyType !== "ed25519"
		) {
			protocolError("Telemetry signing keys must use Ed25519");
		}

		const derivedPublicKeyDer = createPublicKey(privateKeyPem).export({
			format: "der",
			type: "spki",
		});
		if (!derivedPublicKeyDer.equals(publicKeyDer)) {
			protocolError(
				"Telemetry signing key public and private keys do not match",
			);
		}
	} catch (error) {
		if (error instanceof TelemetryProtocolError) {
			throw error;
		}
		protocolError("Telemetry signing key could not be parsed");
	}

	return {
		version,
		private_key_pkcs8_pem: privateKeyPem,
		public_key_spki_base64: publicKeyBase64,
	};
}

export function generateTelemetrySigningKey(): TelemetrySigningKey {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");

	return {
		version: 1,
		private_key_pkcs8_pem: privateKey
			.export({ format: "pem", type: "pkcs8" })
			.toString(),
		public_key_spki_base64: publicKey
			.export({ format: "der", type: "spki" })
			.toString("base64"),
	};
}

export function parseTelemetrySigningKey(value: string): TelemetrySigningKey {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		protocolError("Telemetry signing key must be valid JSON");
	}

	return validateTelemetrySigningKey(parsed);
}

export function generateTelemetryNonce(): string {
	return randomBytes(16).toString("hex");
}

export function buildTelemetrySignedContent({
	deploymentId,
	signedAt,
	nonce,
	bodyHash,
}: {
	deploymentId: string;
	signedAt: string;
	nonce: string;
	bodyHash: string;
}): string {
	if (!isLowercaseUuidV4(deploymentId)) {
		protocolError("Telemetry deployment ID must be a lowercase UUID v4");
	}
	if (!RFC3339_UTC_TIMESTAMP.test(signedAt)) {
		protocolError("Telemetry signed-at timestamp must be RFC3339 UTC");
	}
	try {
		parseInstant(signedAt);
	} catch {
		protocolError("Telemetry signed-at timestamp must be valid");
	}
	if (!LOWERCASE_NONCE.test(nonce)) {
		protocolError(
			"Telemetry nonce must be 32 lowercase hexadecimal characters",
		);
	}
	if (!LOWERCASE_SHA256.test(bodyHash)) {
		protocolError(
			"Telemetry body hash must be 64 lowercase hexadecimal characters",
		);
	}

	return [
		"POST",
		"/api/telemetry",
		deploymentId,
		signedAt,
		nonce,
		bodyHash,
	].join("\n");
}

export function createTelemetryAuthHeaders({
	report,
	signingKey,
	now,
	nonce = generateTelemetryNonce(),
}: {
	report: PreparedTelemetryReport;
	signingKey: TelemetrySigningKey;
	now: Instant;
	nonce?: string;
}) {
	const validatedSigningKey = validateTelemetrySigningKey(signingKey);
	const signedAt = now.toString();
	const content = buildTelemetrySignedContent({
		deploymentId: report.deploymentId,
		signedAt,
		nonce,
		bodyHash: report.bodyHash,
	});
	let signature: Buffer;
	try {
		signature = sign(
			null,
			Buffer.from(content, "utf8"),
			validatedSigningKey.private_key_pkcs8_pem,
		);
	} catch {
		protocolError("Telemetry content could not be signed");
	}
	if (signature.byteLength !== 64) {
		protocolError("Telemetry Ed25519 signature must be 64 bytes");
	}

	return {
		"X-Z8-Deployment-Id": report.deploymentId,
		"X-Z8-Signed-At": signedAt,
		"X-Z8-Nonce": nonce,
		"X-Z8-Signature": signature.toString("base64"),
	};
}

function serializeTelemetryPayload(payload: TelemetryPayloadV2): Buffer {
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
