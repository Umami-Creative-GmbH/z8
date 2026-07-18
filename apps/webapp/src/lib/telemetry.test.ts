import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	}),
}));

import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	getOrCreateTelemetryIdentity,
	sendTelemetryReport,
	sendTelemetryReportWithDependencies,
	type TelemetryConfigStore,
	type TelemetryMetrics,
	TelemetryValidationError,
	telemetryCutoffDate,
} from "@/lib/telemetry";
import * as telemetryProtocol from "@/lib/telemetry-protocol";
import {
	buildTelemetrySignedContent,
	createTelemetryAuthHeaders,
	generateTelemetrySigningKey,
	isLowercaseUuidV4,
	parseTelemetrySigningKey,
	prepareTelemetryReport,
	TelemetryProtocolError,
} from "@/lib/telemetry-protocol";

const DEPLOYMENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const METRICS: TelemetryMetrics = {
	activeUsers24h: 4,
	totalOrganizations: 2,
	totalEmployees: 8,
	sessionsCreated24h: 6,
	licenseType: "community",
};

class MemoryTelemetryConfigStore implements TelemetryConfigStore {
	readonly insertAttempts: Array<{
		key: string;
		value: string;
		description: string;
	}> = [];
	readonly values: Map<string, string>;

	constructor(initial: Record<string, string> = {}) {
		this.values = new Map(Object.entries(initial));
	}

	async read(key: string): Promise<string | undefined> {
		return this.values.get(key);
	}

	async insertIfAbsent(input: {
		key: string;
		value: string;
		description: string;
	}): Promise<boolean> {
		this.insertAttempts.push(input);
		if (this.values.has(input.key)) return false;
		this.values.set(input.key, input.value);
		return true;
	}
}

describe("getOrCreateTelemetryIdentity", () => {
	beforeEach(() => vi.clearAllMocks());

	it("retains an existing deployment ID and adds a missing signing key", async () => {
		const store = new MemoryTelemetryConfigStore({
			deployment_id: DEPLOYMENT_ID,
		});

		const identity = await getOrCreateTelemetryIdentity({
			store,
			info: vi.fn(),
		});
		const storedSigningKey = store.values.get("telemetry_signing_key");

		expect(identity.deploymentId).toBe(DEPLOYMENT_ID);
		expect(storedSigningKey).toBe(JSON.stringify(identity.signingKey));
		expect(parseTelemetrySigningKey(storedSigningKey ?? "")).toEqual(
			identity.signingKey,
		);
		expect(store.insertAttempts.map(({ key }) => key)).toEqual([
			"telemetry_signing_key",
		]);
	});

	it("returns an existing identity without inserting, generating, or logging", async () => {
		const signingKey = generateTelemetrySigningKey();
		const serializedSigningKey = JSON.stringify(signingKey);
		const initialValues = {
			deployment_id: DEPLOYMENT_ID,
			telemetry_signing_key: serializedSigningKey,
		};
		const store = new MemoryTelemetryConfigStore(initialValues);
		const insertIfAbsent = vi.spyOn(store, "insertIfAbsent");
		const generateSigningKey = vi.spyOn(
			telemetryProtocol,
			"generateTelemetrySigningKey",
		);
		const info = vi.fn();

		const identity = await getOrCreateTelemetryIdentity({ store, info });

		expect(identity).toEqual({ deploymentId: DEPLOYMENT_ID, signingKey });
		expect(insertIfAbsent).not.toHaveBeenCalled();
		expect(generateSigningKey).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
		expect(Object.fromEntries(store.values)).toEqual(initialValues);
	});

	it("generates and validates an absent identity", async () => {
		const store = new MemoryTelemetryConfigStore();

		const identity = await getOrCreateTelemetryIdentity({
			store,
			info: vi.fn(),
		});

		expect(isLowercaseUuidV4(identity.deploymentId)).toBe(true);
		expect(
			parseTelemetrySigningKey(JSON.stringify(identity.signingKey)),
		).toEqual(identity.signingKey);
	});

	it("concurrent initializations converge and log the public key once", async () => {
		const store = new MemoryTelemetryConfigStore();
		const info = vi.fn();

		const [first, second] = await Promise.all([
			getOrCreateTelemetryIdentity({ store, info }),
			getOrCreateTelemetryIdentity({ store, info }),
		]);

		expect(second).toEqual(first);
		expect(info).toHaveBeenCalledOnce();
		expect(info).toHaveBeenCalledWith(
			{
				deploymentId: first.deploymentId,
				publicKeySpkiBase64: first.signingKey.public_key_spki_base64,
			},
			"Generated telemetry signing identity",
		);
	});

	it("logs the winner public key without exposing private material", async () => {
		const store = new MemoryTelemetryConfigStore();
		const info = vi.fn();

		const identity = await getOrCreateTelemetryIdentity({ store, info });
		const serializedLogs = JSON.stringify(info.mock.calls);

		expect(serializedLogs).toContain(
			identity.signingKey.public_key_spki_base64,
		);
		expect(serializedLogs).not.toContain(
			identity.signingKey.private_key_pkcs8_pem,
		);
		expect(serializedLogs).not.toContain("PRIVATE KEY");
	});

	it("fails closed for a malformed deployment ID without replacing it", async () => {
		const store = new MemoryTelemetryConfigStore({ deployment_id: "INVALID" });

		await expect(
			getOrCreateTelemetryIdentity({ store, info: vi.fn() }),
		).rejects.toBeInstanceOf(TelemetryValidationError);
		expect(store.insertAttempts).toHaveLength(0);
		expect(store.values.get("deployment_id")).toBe("INVALID");
	});

	it.each([
		["malformed", "not-json"],
		[
			"mismatched",
			JSON.stringify({
				...generateTelemetrySigningKey(),
				public_key_spki_base64:
					generateTelemetrySigningKey().public_key_spki_base64,
			}),
		],
	])("fails closed for %s stored signing material", async (_name, storedKey) => {
		const store = new MemoryTelemetryConfigStore({
			deployment_id: DEPLOYMENT_ID,
			telemetry_signing_key: storedKey,
		});

		await expect(
			getOrCreateTelemetryIdentity({ store, info: vi.fn() }),
		).rejects.toBeInstanceOf(TelemetryProtocolError);
		expect(store.insertAttempts).toHaveLength(0);
		expect(store.values.get("telemetry_signing_key")).toBe(storedKey);
	});

	it("re-reads and returns winners after losing insertion races", async () => {
		const winnerKey = generateTelemetrySigningKey();
		const winners = new Map([
			["deployment_id", DEPLOYMENT_ID],
			["telemetry_signing_key", JSON.stringify(winnerKey)],
		]);
		const store: TelemetryConfigStore = {
			read: vi.fn(async (key) => winners.get(key)),
			insertIfAbsent: vi.fn(async () => false),
		};
		vi.mocked(store.read)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(DEPLOYMENT_ID)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(JSON.stringify(winnerKey));

		const identity = await getOrCreateTelemetryIdentity({
			store,
			info: vi.fn(),
		});

		expect(identity).toEqual({
			deploymentId: DEPLOYMENT_ID,
			signingKey: winnerKey,
		});
	});

	it("uses insert-only production persistence with a returned winner flag", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./telemetry.ts", import.meta.url)),
			"utf8",
		);

		expect(source).toContain(
			".onConflictDoNothing({ target: systemConfig.key })",
		);
		expect(source).toContain(".returning({ key: systemConfig.key })");
		expect(source).not.toContain(".onConflictDoUpdate(");
	});
});

function jsonResponse(status: number, body: unknown, headers?: HeadersInit) {
	return new Response(status === 204 ? null : JSON.stringify(body), {
		status,
		headers,
	});
}

function successBody(overrides: Record<string, unknown> = {}) {
	return {
		deployment_id: DEPLOYMENT_ID,
		idempotent: false,
		recorded_at: "2026-07-18T10:00:01Z",
		...overrides,
	};
}

function senderHarness(
	responses: Array<Response | Error>,
	nowValues = [
		"2026-07-18T10:00:00Z",
		"2026-07-18T10:00:01Z",
		"2026-07-18T10:00:02Z",
		"2026-07-18T10:00:03Z",
	],
) {
	const signingKey = generateTelemetrySigningKey();
	const requests: Array<{ url: string; init: RequestInit }> = [];
	const sleep = vi.fn(async (_milliseconds: number) => undefined);
	const error = vi.fn();
	let nowIndex = 0;
	const fetch = vi.fn(
		async (url: string | URL | Request, init?: RequestInit) => {
			requests.push({ url: String(url), init: init ?? {} });
			const next = responses.shift();
			if (next instanceof Error) throw next;
			if (!next) throw new Error("missing test response");
			return next;
		},
	);
	const now = vi.fn(() =>
		parseInstant(nowValues[Math.min(nowIndex++, nowValues.length - 1)] ?? ""),
	);
	const prepareReport = vi.fn(prepareTelemetryReport);
	const createAuthHeaders = vi.fn(createTelemetryAuthHeaders);

	return {
		signingKey,
		requests,
		sleep,
		error,
		fetch,
		now,
		dependencies: {
			fetch,
			sleep,
			now,
			error,
			info: vi.fn(),
			getIdentity: vi.fn(async () => ({
				deploymentId: DEPLOYMENT_ID,
				signingKey,
			})),
			prepareReport,
			createAuthHeaders,
		},
	};
}

describe("signed telemetry v2 sender", () => {
	it("sends exact v2 bytes and fresh, verifiable authentication on retry", async () => {
		const harness = senderHarness([
			jsonResponse(503, { code: "unavailable" }),
			jsonResponse(200, successBody({ idempotent: true })),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(true);
		expect(harness.sleep).toHaveBeenCalledWith(1000);
		expect(harness.dependencies.prepareReport).toHaveBeenCalledOnce();
		expect(harness.dependencies.createAuthHeaders).toHaveBeenCalledTimes(2);
		expect(harness.requests).toHaveLength(2);

		const [first, second] = harness.requests;
		expect(first?.url).toBe("https://telemetry.z8-time.app/api/telemetry");
		expect(first?.init.method).toBe("POST");
		expect(first?.init.body).toBeInstanceOf(Buffer);
		expect(second?.init.body).toBe(first?.init.body);
		const body = first?.init.body as Buffer;
		expect(JSON.parse(body.toString("utf8"))).toEqual({
			version: "2.0",
			deployment_id: DEPLOYMENT_ID,
			timestamp: "2026-07-18T10:00:00Z",
			metrics: {
				active_users_24h: 4,
				total_organizations: 2,
				total_employees: 8,
				sessions_created_24h: 6,
				license_type: "community",
			},
		});
		const bodyHashes = harness.requests.map(({ init }) =>
			createHash("sha256")
				.update(init.body as Buffer)
				.digest("hex"),
		);
		expect(new Set(bodyHashes).size).toBe(1);
		const [bodyHash = ""] = bodyHashes;
		const publicKey = createPublicKey({
			key: Buffer.from(harness.signingKey.public_key_spki_base64, "base64"),
			format: "der",
			type: "spki",
		});
		const capturedHeaders = harness.requests.map(
			({ init }) => new Headers(init.headers),
		);
		for (const headers of capturedHeaders) {
			expect([...headers.keys()].sort()).toEqual([
				"content-type",
				"x-z8-deployment-id",
				"x-z8-nonce",
				"x-z8-signature",
				"x-z8-signed-at",
			]);
			expect(headers.get("content-type")).toBe("application/json");
			const signedContent = buildTelemetrySignedContent({
				deploymentId: DEPLOYMENT_ID,
				signedAt: headers.get("x-z8-signed-at") ?? "",
				nonce: headers.get("x-z8-nonce") ?? "",
				bodyHash,
			});
			expect(
				verify(
					null,
					Buffer.from(signedContent),
					publicKey,
					Buffer.from(headers.get("x-z8-signature") ?? "", "base64"),
				),
			).toBe(true);
		}
		expect(capturedHeaders[0]?.get("x-z8-nonce")).not.toBe(
			capturedHeaders[1]?.get("x-z8-nonce"),
		);
		expect(capturedHeaders[0]?.get("x-z8-signature")).not.toBe(
			capturedHeaders[1]?.get("x-z8-signature"),
		);
		expect(capturedHeaders[0]?.get("x-z8-signed-at")).toBe(
			"2026-07-18T10:00:01Z",
		);
		expect(capturedHeaders[1]?.get("x-z8-signed-at")).toBe(
			"2026-07-18T10:00:02Z",
		);
	});

	it.each([
		["delta seconds", "5", "2026-07-18T10:00:00Z", 5000],
		["invalid", "tomorrow-ish", "2026-07-18T10:00:00Z", 1000],
		["non-HTTP date", "2026-07-18T10:00:07Z", "2026-07-18T10:00:00Z", 1000],
		["missing", null, "2026-07-18T10:00:00Z", 1000],
		["overflow", "999999999999999999999", "2026-07-18T10:00:00Z", 1000],
	])("respects %s Retry-After", async (_name, retryAfter, attemptNow, expectedDelay) => {
		const headers =
			retryAfter === null ? undefined : { "Retry-After": retryAfter };
		const harness = senderHarness(
			[
				jsonResponse(429, { code: "rate_limited" }, headers),
				jsonResponse(200, successBody()),
			],
			["2026-07-18T09:59:59Z", attemptNow, "2026-07-18T10:00:08Z"],
		);

		await sendTelemetryReportWithDependencies(
			DEPLOYMENT_ID,
			METRICS,
			harness.dependencies,
		);

		expect(harness.sleep).toHaveBeenCalledWith(expectedDelay);
	});

	it("calculates an HTTP-date Retry-After from the response processing instant", async () => {
		const harness = senderHarness(
			[
				jsonResponse(
					429,
					{ code: "rate_limited" },
					{ "Retry-After": "Sat, 18 Jul 2026 10:00:07 GMT" },
				),
				jsonResponse(200, successBody()),
			],
			[
				"2026-07-18T09:59:59Z",
				"2026-07-18T10:00:00Z",
				"2026-07-18T10:00:03Z",
				"2026-07-18T10:00:08Z",
			],
		);

		await sendTelemetryReportWithDependencies(
			DEPLOYMENT_ID,
			METRICS,
			harness.dependencies,
		);

		expect(harness.sleep).toHaveBeenCalledWith(4000);
		const sentHeaders = harness.requests.map(
			({ init }) => new Headers(init.headers),
		);
		expect(sentHeaders[0]?.get("x-z8-signed-at")).toBe("2026-07-18T10:00:00Z");
		expect(sentHeaders[1]?.get("x-z8-signed-at")).toBe("2026-07-18T10:00:08Z");
	});

	it.each([
		["network rejection", new TypeError("fetch failed")],
		[
			"AbortError",
			Object.assign(new Error("timed out"), { name: "AbortError" }),
		],
	])("retries %s at most three total attempts", async (_name, failure) => {
		const harness = senderHarness([
			failure,
			failure,
			failure,
			jsonResponse(200, successBody()),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(false);
		expect(harness.fetch).toHaveBeenCalledTimes(3);
		expect(harness.sleep.mock.calls).toEqual([[1000], [2000]]);
	});

	it("classifies a fetch TimeoutError as a retryable timeout", async () => {
		const harness = senderHarness([
			Object.assign(new Error("timed out"), { name: "TimeoutError" }),
			jsonResponse(200, successBody()),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(true);
		expect(harness.error).toHaveBeenCalledWith(
			expect.objectContaining({ category: "timeout" }),
			"Telemetry request failed",
		);
		expect(harness.fetch).toHaveBeenCalledTimes(2);
	});

	it("retries an AbortError while reading the response body", async () => {
		const abortedResponse = jsonResponse(200, successBody());
		vi.spyOn(abortedResponse, "json").mockRejectedValue(
			Object.assign(new Error("timed out"), { name: "AbortError" }),
		);
		const harness = senderHarness([
			abortedResponse,
			jsonResponse(200, successBody()),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(true);
		expect(harness.fetch).toHaveBeenCalledTimes(2);
		expect(harness.sleep).toHaveBeenCalledWith(1000);
	});

	it("retries a status 200 body TimeoutError with the exact retained body", async () => {
		const timedOutResponse = jsonResponse(200, successBody());
		vi.spyOn(timedOutResponse, "json").mockRejectedValue(
			Object.assign(new Error("timed out"), { name: "TimeoutError" }),
		);
		const harness = senderHarness([
			timedOutResponse,
			jsonResponse(200, successBody()),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(true);
		expect(harness.fetch).toHaveBeenCalledTimes(2);
		expect(harness.sleep).toHaveBeenCalledWith(1000);
		const [firstBody, secondBody] = harness.requests.map(
			({ init }) => init.body as Buffer,
		);
		expect(secondBody).toBe(firstBody);
		expect(secondBody?.equals(firstBody ?? Buffer.alloc(0))).toBe(true);
	});

	it("does not retry a terminal status when reading its body aborts", async () => {
		const abortedResponse = jsonResponse(401, { code: "unauthorized" });
		vi.spyOn(abortedResponse, "json").mockRejectedValue(
			Object.assign(new Error("timed out"), { name: "AbortError" }),
		);
		const harness = senderHarness([
			abortedResponse,
			jsonResponse(200, successBody()),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(false);
		expect(harness.fetch).toHaveBeenCalledOnce();
		expect(harness.sleep).not.toHaveBeenCalled();
	});

	it.each([
		400, 401, 409, 413, 201, 204,
	])("treats HTTP %s as terminal", async (status) => {
		const harness = senderHarness([
			jsonResponse(status, { code: "terminal" }),
			jsonResponse(200, successBody()),
		]);

		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(false);
		expect(harness.fetch).toHaveBeenCalledOnce();
		expect(harness.sleep).not.toHaveBeenCalled();
	});

	it.each([
		["new report", successBody()],
		["idempotent report", successBody({ idempotent: true })],
	])("accepts a valid %s success", async (_name, body) => {
		const harness = senderHarness([jsonResponse(200, body)]);
		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(true);
	});

	it.each([
		["malformed JSON", new Response("not-json", { status: 200 })],
		[
			"mismatched ID",
			jsonResponse(
				200,
				successBody({ deployment_id: "223e4567-e89b-42d3-a456-426614174000" }),
			),
		],
		[
			"missing recorded_at",
			jsonResponse(200, successBody({ recorded_at: undefined })),
		],
		[
			"invalid recorded_at",
			jsonResponse(200, successBody({ recorded_at: "2026-07-18" })),
		],
		[
			"missing idempotent",
			jsonResponse(200, successBody({ idempotent: undefined })),
		],
	])("rejects a 200 response with %s", async (_name, response) => {
		const harness = senderHarness([response]);
		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			),
		).resolves.toBe(false);
	});

	it("logs status 200 for a malformed success response", async () => {
		const harness = senderHarness([new Response("not-json", { status: 200 })]);

		await sendTelemetryReportWithDependencies(
			DEPLOYMENT_ID,
			METRICS,
			harness.dependencies,
		);

		expect(harness.error).toHaveBeenCalledWith(
			expect.objectContaining({
				category: "invalid_success_response",
				status: 200,
			}),
			"Telemetry receiver response validation failed",
		);
	});

	it("passes a fresh signal per attempt that aborts at exactly ten seconds", async () => {
		vi.useFakeTimers();
		try {
			const harness = senderHarness([
				jsonResponse(503, { code: "unavailable" }),
				jsonResponse(200, successBody()),
			]);

			await sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				harness.dependencies,
			);

			const signals = harness.requests.map(({ init }) => init.signal);
			expect(signals).toHaveLength(2);
			for (const signal of signals) {
				expect(signal).toBeInstanceOf(AbortSignal);
				expect(signal?.aborted).toBe(false);
			}
			await vi.advanceTimersByTimeAsync(9999);
			for (const signal of signals) expect(signal?.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			for (const signal of signals) expect(signal?.aborted).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("logs stable receiver identifiers without free-form errors or secret material", async () => {
		const harness = senderHarness([
			jsonResponse(
				401,
				{
					code: "bad_signature",
					error: "echoed secret input",
					request_id: "body-request",
				},
				{ "X-Request-Id": "header-request" },
			),
		]);

		await sendTelemetryReportWithDependencies(
			DEPLOYMENT_ID,
			METRICS,
			harness.dependencies,
		);

		const logs = JSON.stringify(harness.error.mock.calls);
		expect(logs).toContain("bad_signature");
		expect(logs).toContain("body-request");
		expect(logs).toContain("header-request");
		expect(logs).not.toContain("echoed secret input");
		expect(logs).not.toContain(harness.signingKey.private_key_pkcs8_pem);
		expect(logs).not.toContain(harness.signingKey.public_key_spki_base64);
		expect(logs).not.toContain("X-Z8-Signature");
	});

	it("fails before fetch for identity mismatch and invalid numeric metrics", async () => {
		const mismatch = senderHarness([jsonResponse(200, successBody())]);
		mismatch.dependencies.getIdentity.mockResolvedValue({
			deploymentId: "223e4567-e89b-42d3-a456-426614174000",
			signingKey: mismatch.signingKey,
		});
		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				METRICS,
				mismatch.dependencies,
			),
		).resolves.toBe(false);
		expect(mismatch.fetch).not.toHaveBeenCalled();

		const invalid = senderHarness([jsonResponse(200, successBody())]);
		await expect(
			sendTelemetryReportWithDependencies(
				DEPLOYMENT_ID,
				{ ...METRICS, totalEmployees: Number.NaN },
				invalid.dependencies,
			),
		).resolves.toBe(false);
		expect(invalid.fetch).not.toHaveBeenCalled();
	});

	it("has a public wrapper that rejects a stored deployment ID mismatch", async () => {
		const signingKey = generateTelemetrySigningKey();
		const select = vi
			.fn()
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ value: DEPLOYMENT_ID }],
					}),
				}),
			})
			.mockReturnValueOnce({
				from: () => ({
					where: () => ({
						limit: async () => [{ value: JSON.stringify(signingKey) }],
					}),
				}),
			});
		Object.assign(db, { select });
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		await expect(
			sendTelemetryReport("223e4567-e89b-42d3-a456-426614174000", METRICS),
		).resolves.toBe(false);
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("uses Temporal arithmetic for the 24-hour database cutoff", () => {
		expect(
			telemetryCutoffDate(parseInstant("2026-03-29T00:30:00Z")).toISOString(),
		).toBe("2026-03-28T00:30:00.000Z");
	});
});
