import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";

import {
	isLowercaseUuidV4,
	MAX_TELEMETRY_BODY_BYTES,
	prepareTelemetryReport,
	type TelemetryPayloadV2,
	TelemetryProtocolError,
} from "@/lib/telemetry-protocol";

const NOW = Temporal.Instant.from("2026-07-18T12:00:00Z");
const DEPLOYMENT_ID = "123e4567-e89b-42d3-a456-426614174000";

function validPayload(): TelemetryPayloadV2 {
	return {
		version: "2.0",
		deployment_id: DEPLOYMENT_ID,
		timestamp: "2026-07-18T12:00:00Z",
		metrics: {
			active_users_24h: 7,
			total_organizations: 2,
			total_employees: 11,
			sessions_created_24h: 19,
			license_type: "community",
		},
	};
}

function expectProtocolError(payload: unknown) {
	expect(() => prepareTelemetryReport(payload, NOW)).toThrow(
		TelemetryProtocolError,
	);
}

describe("isLowercaseUuidV4", () => {
	it("accepts a lowercase UUID v4", () => {
		expect(isLowercaseUuidV4("123e4567-e89b-42d3-a456-426614174000")).toBe(
			true,
		);
	});

	it("rejects non-v4 and uppercase UUIDs", () => {
		expect(isLowercaseUuidV4("123e4567-e89b-12d3-a456-426614174000")).toBe(
			false,
		);
		expect(isLowercaseUuidV4("123E4567-E89B-42D3-A456-426614174000")).toBe(
			false,
		);
	});
});

describe("prepareTelemetryReport", () => {
	it("retains the exact JSON.stringify bytes and hashes those bytes", () => {
		const payload = validPayload();
		const expectedBody = Buffer.from(JSON.stringify(payload), "utf8");

		const prepared = prepareTelemetryReport(payload, NOW);

		expect(prepared).toEqual({
			deploymentId: DEPLOYMENT_ID,
			timestamp: "2026-07-18T12:00:00Z",
			body: expectedBody,
			bodyHash:
				"f0c01ddce626b60e0a52821466e7f14f6ceef02add31d7f1cbad94bcc633409e",
		});
		expect(prepared.body).toBeInstanceOf(Buffer);
		expect(prepared.bodyHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("serializes the validated payload exactly once", () => {
		const payload = validPayload();
		let versionReads = 0;
		Object.defineProperty(payload, "version", {
			enumerable: true,
			get: () => {
				versionReads += 1;
				return "2.0";
			},
		});

		prepareTelemetryReport(payload, NOW);

		expect(versionReads).toBe(2);
	});

	it("requires an object payload with only v2 wire fields", () => {
		expectProtocolError(null);
		expectProtocolError("payload");
		expectProtocolError({ ...validPayload(), unexpected: true });
		expectProtocolError({
			...validPayload(),
			metrics: { ...validPayload().metrics, unexpected: true },
		});

		const nonEnumerableField = validPayload();
		Object.defineProperty(nonEnumerableField, "deployment_id", {
			enumerable: false,
			value: DEPLOYMENT_ID,
		});
		expectProtocolError(nonEnumerableField);
	});

	it("rejects version 1.0", () => {
		expectProtocolError({ ...validPayload(), version: "1.0" });
	});

	it("rejects non-v4 and uppercase deployment IDs", () => {
		expectProtocolError({
			...validPayload(),
			deployment_id: "123e4567-e89b-12d3-a456-426614174000",
		});
		expectProtocolError({
			...validPayload(),
			deployment_id: DEPLOYMENT_ID.toUpperCase(),
		});
	});

	it.each([
		-1,
		1.5,
		2_147_483_648,
		Number.NaN,
	])("rejects invalid numeric metric value %s", (value) => {
		for (const metric of [
			"active_users_24h",
			"total_organizations",
			"total_employees",
			"sessions_created_24h",
			"api_requests_24h",
		] as const) {
			expectProtocolError({
				...validPayload(),
				metrics: { ...validPayload().metrics, [metric]: value },
			});
		}
	});

	it("accepts the maximum optional API request count", () => {
		const payload = validPayload();
		payload.metrics.api_requests_24h = 2_147_483_647;

		expect(prepareTelemetryReport(payload, NOW).body).toEqual(
			Buffer.from(JSON.stringify(payload), "utf8"),
		);
	});

	it("rejects timestamps outside the age and future windows", () => {
		expectProtocolError({
			...validPayload(),
			timestamp: "2026-07-16T11:59:59.999999999Z",
		});
		expectProtocolError({
			...validPayload(),
			timestamp: "2026-07-18T12:05:00.000000001Z",
		});
	});

	it("accepts timestamps exactly 48 hours old and 5 minutes future", () => {
		for (const timestamp of ["2026-07-16T12:00:00Z", "2026-07-18T12:05:00Z"]) {
			expect(
				prepareTelemetryReport({ ...validPayload(), timestamp }, NOW).timestamp,
			).toBe(timestamp);
		}
	});

	it("requires an RFC3339 timestamp with an explicit offset", () => {
		expectProtocolError({
			...validPayload(),
			timestamp: "2026-07-18T12:00:00",
		});
		expect(
			prepareTelemetryReport(
				{ ...validPayload(), timestamp: "2026-07-18T14:00:00+02:00" },
				NOW,
			).timestamp,
		).toBe("2026-07-18T14:00:00+02:00");
	});

	it("rejects RFC3339 timestamps without seconds", () => {
		expectProtocolError({
			...validPayload(),
			timestamp: "2026-07-18T12:00Z",
		});
	});

	it("rejects unsupported license types", () => {
		expectProtocolError({
			...validPayload(),
			metrics: { ...validPayload().metrics, license_type: "trial" },
		});
	});

	it("enforces the UTF-8 byte limit on the raw serialized body", () => {
		const payload = validPayload();
		let timestampReads = 0;
		Object.defineProperty(payload, "timestamp", {
			enumerable: true,
			get: () => {
				timestampReads += 1;
				return timestampReads === 1
					? "2026-07-18T12:00:00Z"
					: "é".repeat(MAX_TELEMETRY_BODY_BYTES / 2);
			},
		});

		expectProtocolError(payload);
	});
});
