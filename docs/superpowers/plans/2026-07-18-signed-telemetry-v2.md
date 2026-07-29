# Z8 Signed Telemetry Protocol v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send deployment telemetry as byte-exact, Ed25519-authenticated protocol v2 reports with safe persistent keys and protocol-aware retries.

**Architecture:** Add a focused protocol module for validation, serialization, hashing, key handling, and signing. Keep database identity management, metric collection, HTTP retries, and logging in the existing telemetry application module, preserving its boolean sender contract. Activate the existing cron placeholder on a daily UTC schedule.

**Tech Stack:** TypeScript, Node.js `crypto`, Temporal polyfill, Drizzle ORM, Vitest, native `fetch`

---

## File Map

- Create `apps/webapp/src/lib/telemetry-protocol.ts`: pure protocol v2 types, validation, exact serialization, hashing, key parsing/generation, canonical content, and signing.
- Create `apps/webapp/src/lib/telemetry-protocol.test.ts`: protocol boundary and cryptographic tests.
- Modify `apps/webapp/src/lib/telemetry.ts`: persistent deployment identity/key management, metric mapping, HTTP transport, response/error parsing, and retries.
- Create `apps/webapp/src/lib/telemetry.test.ts`: persistence and sender retry tests with mocked database/network boundaries.
- Modify `apps/webapp/src/lib/cron/registry.ts`: daily schedule and real telemetry processor.
- Modify `apps/webapp/src/lib/cron/registry.test.ts`: cron schedule and processor coverage.
- Modify `deploy/README.md`: document the daily telemetry schedule.
- Modify `FairUsagePolicy.md`: update the documented payload version, optional metric, endpoint, and request signing.

### Task 1: Validate And Prepare The Exact V2 Payload

**Files:**
- Create: `apps/webapp/src/lib/telemetry-protocol.ts`
- Create: `apps/webapp/src/lib/telemetry-protocol.test.ts`

- [ ] **Step 1: Write failing payload preparation tests**

Create `apps/webapp/src/lib/telemetry-protocol.test.ts` with the payload cases below. The test deliberately decodes the retained bytes only for assertions; production code must never decode and reserialize them.

```ts
import { describe, expect, it } from "vitest";
import { Temporal } from "temporal-polyfill";
import {
	MAX_TELEMETRY_BODY_BYTES,
	TelemetryProtocolError,
	prepareTelemetryReport,
} from "./telemetry-protocol";

const now = Temporal.Instant.from("2026-07-18T12:00:00Z");
const deploymentId = "123e4567-e89b-42d3-a456-426614174000";

function validPayload() {
	return {
		version: "2.0" as const,
		deployment_id: deploymentId,
		timestamp: "2026-07-18T12:00:00Z",
		metrics: {
			active_users_24h: 4,
			total_organizations: 2,
			total_employees: 8,
			sessions_created_24h: 6,
			license_type: "community" as const,
		},
	};
}

describe("prepareTelemetryReport", () => {
	it("serializes the v2 body once and retains its exact UTF-8 bytes", () => {
		const payload = validPayload();
		const report = prepareTelemetryReport(payload, now);
		const expectedJson = JSON.stringify(payload);

		expect(report.body.equals(Buffer.from(expectedJson, "utf8"))).toBe(true);
		expect(report.bodyHash).toMatch(/^[0-9a-f]{64}$/);
		expect(report.deploymentId).toBe(deploymentId);
	});

	it.each([
		[-1],
		[1.5],
		[2_147_483_648],
		[Number.NaN],
	])("rejects an invalid numeric metric value %s", (value) => {
		const payload = validPayload();
		payload.metrics.active_users_24h = value;
		expect(() => prepareTelemetryReport(payload, now)).toThrow(TelemetryProtocolError);
	});

	it("accepts the optional api request metric at its maximum", () => {
		const payload = {
			...validPayload(),
			metrics: { ...validPayload().metrics, api_requests_24h: 2_147_483_647 },
		};
		expect(prepareTelemetryReport(payload, now).body.byteLength).toBeGreaterThan(0);
	});

	it.each([
		["1.0", "version"],
		["123e4567-e89b-12d3-a456-426614174000", "deployment_id"],
		["123E4567-E89B-42D3-A456-426614174000", "deployment_id"],
		["2026-07-16T11:59:59Z", "timestamp"],
		["2026-07-18T12:05:01Z", "timestamp"],
	])("rejects invalid %s input", (value, field) => {
		const payload = validPayload() as Record<string, unknown>;
		payload[field] = value;
		expect(() => prepareTelemetryReport(payload, now)).toThrow(TelemetryProtocolError);
	});

	it("rejects a non-protocol license value", () => {
		const payload = {
			...validPayload(),
			metrics: { ...validPayload().metrics, license_type: "trial" },
		};
		expect(() => prepareTelemetryReport(payload, now)).toThrow(TelemetryProtocolError);
	});

	it("enforces the raw UTF-8 body limit", () => {
		const payload = validPayload() as ReturnType<typeof validPayload> & {
			padding?: string;
		};
		payload.padding = "x".repeat(MAX_TELEMETRY_BODY_BYTES);
		expect(() => prepareTelemetryReport(payload, now)).toThrow("65,536 bytes");
	});
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry-protocol.test.ts
```

Expected: FAIL because `./telemetry-protocol` does not exist.

- [ ] **Step 3: Implement wire types, strict validation, one-time serialization, and hashing**

Create `apps/webapp/src/lib/telemetry-protocol.ts` with these public contracts and behavior:

```ts
import crypto from "node:crypto";
import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";
import { parseInstant } from "@/lib/datetime/temporal-core";

export const MAX_TELEMETRY_BODY_BYTES = 65_536;
const MAX_METRIC_VALUE = 2_147_483_647;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
	constructor(message: string) {
		super(message);
		this.name = "TelemetryProtocolError";
	}
}

export function isLowercaseUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4.test(value);
}

function assertMetric(name: string, value: unknown): asserts value is number {
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_METRIC_VALUE) {
		throw new TelemetryProtocolError(`${name} must be an integer from 0 to ${MAX_METRIC_VALUE}`);
	}
}

function assertPayload(payload: unknown, now: Instant): asserts payload is TelemetryPayloadV2 {
	if (!payload || typeof payload !== "object") {
		throw new TelemetryProtocolError("Telemetry payload must be an object");
	}

	const candidate = payload as Record<string, unknown>;
	if (candidate.version !== "2.0") {
		throw new TelemetryProtocolError('Telemetry version must be exactly "2.0"');
	}
	if (!isLowercaseUuidV4(candidate.deployment_id)) {
		throw new TelemetryProtocolError("deployment_id must be a lowercase UUID v4");
	}
	if (typeof candidate.timestamp !== "string") {
		throw new TelemetryProtocolError("timestamp must be an RFC 3339 instant with offset");
	}

	let timestamp: Instant;
	try {
		timestamp = parseInstant(candidate.timestamp);
	} catch {
		throw new TelemetryProtocolError("timestamp must be an RFC 3339 instant with offset");
	}
	if (Temporal.Instant.compare(timestamp, now.subtract({ hours: 48 })) < 0) {
		throw new TelemetryProtocolError("timestamp must be no more than 48 hours old");
	}
	if (Temporal.Instant.compare(timestamp, now.add({ minutes: 5 })) > 0) {
		throw new TelemetryProtocolError("timestamp must be no more than five minutes in the future");
	}

	if (!candidate.metrics || typeof candidate.metrics !== "object") {
		throw new TelemetryProtocolError("metrics must be an object");
	}
	const metrics = candidate.metrics as Record<string, unknown>;
	assertMetric("active_users_24h", metrics.active_users_24h);
	assertMetric("total_organizations", metrics.total_organizations);
	assertMetric("total_employees", metrics.total_employees);
	assertMetric("sessions_created_24h", metrics.sessions_created_24h);
	if (metrics.api_requests_24h !== undefined) {
		assertMetric("api_requests_24h", metrics.api_requests_24h);
	}
	if (metrics.license_type !== "community" && metrics.license_type !== "enterprise") {
		throw new TelemetryProtocolError("license_type must be community or enterprise");
	}
}

export function prepareTelemetryReport(payload: unknown, now: Instant): PreparedTelemetryReport {
	assertPayload(payload, now);
	const serialized = JSON.stringify(payload);
	const body = Buffer.from(serialized, "utf8");
	if (body.byteLength > MAX_TELEMETRY_BODY_BYTES) {
		throw new TelemetryProtocolError("Telemetry body must not exceed 65,536 bytes");
	}

	return {
		deploymentId: payload.deployment_id,
		timestamp: payload.timestamp,
		body,
		bodyHash: crypto.createHash("sha256").update(body).digest("hex"),
	};
}
```

Do not add a generic JSON canonicalizer. Protocol v2 signs the hash of the sender's exact serialized bytes, not a canonical JSON representation.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry-protocol.test.ts
```

Expected: PASS for all payload preparation cases.

- [ ] **Step 5: Commit payload preparation**

```bash
git add apps/webapp/src/lib/telemetry-protocol.ts apps/webapp/src/lib/telemetry-protocol.test.ts
git commit -m "feat: prepare telemetry v2 payloads"
```

### Task 2: Generate Keys And Sign Canonical Requests

**Files:**
- Modify: `apps/webapp/src/lib/telemetry-protocol.ts`
- Modify: `apps/webapp/src/lib/telemetry-protocol.test.ts`

- [ ] **Step 1: Add failing signing and key-validation tests**

Append these imports and cases to `apps/webapp/src/lib/telemetry-protocol.test.ts`:

```ts
import crypto from "node:crypto";
import {
	buildTelemetrySignedContent,
	createTelemetryAuthHeaders,
	generateTelemetryNonce,
	generateTelemetrySigningKey,
	parseTelemetrySigningKey,
} from "./telemetry-protocol";

describe("telemetry request signing", () => {
	it("builds exactly six LF-separated lines without a trailing newline", () => {
		const content = buildTelemetrySignedContent({
			deploymentId,
			signedAt: "2026-07-18T12:00:00Z",
			nonce: "0123456789abcdef0123456789abcdef",
			bodyHash: "a".repeat(64),
		});
		expect(content).toBe(
			`POST\n/api/telemetry\n${deploymentId}\n2026-07-18T12:00:00Z\n0123456789abcdef0123456789abcdef\n${"a".repeat(64)}`,
		);
		expect(content.endsWith("\n")).toBe(false);
	});

	it("generates a fresh 32-character lowercase hexadecimal nonce", () => {
		const first = generateTelemetryNonce();
		const second = generateTelemetryNonce();
		expect(first).toMatch(/^[0-9a-f]{32}$/);
		expect(second).toMatch(/^[0-9a-f]{32}$/);
		expect(second).not.toBe(first);
	});

	it("stores canonical SPKI and creates a verifiable 64-byte Ed25519 signature", () => {
		const signingKey = generateTelemetrySigningKey();
		const report = prepareTelemetryReport(validPayload(), now);
		const headers = createTelemetryAuthHeaders({
			report,
			signingKey,
			now,
			nonce: "0123456789abcdef0123456789abcdef",
		});
		const signature = Buffer.from(headers["X-Z8-Signature"], "base64");
		const publicKey = crypto.createPublicKey({
			key: Buffer.from(signingKey.public_key_spki_base64, "base64"),
			format: "der",
			type: "spki",
		});
		const content = buildTelemetrySignedContent({
			deploymentId,
			signedAt: headers["X-Z8-Signed-At"],
			nonce: headers["X-Z8-Nonce"],
			bodyHash: report.bodyHash,
		});

		expect(signature).toHaveLength(64);
		expect(signature.toString("base64")).toBe(headers["X-Z8-Signature"]);
		expect(crypto.verify(null, Buffer.from(content, "utf8"), publicKey, signature)).toBe(true);
		expect(headers["X-Z8-Deployment-Id"]).toBe(deploymentId);
		expect(headers["X-Z8-Signed-At"]).toMatch(/Z$/);
	});

	it("rejects malformed or mismatched persisted key material", () => {
		const key = generateTelemetrySigningKey();
		const other = generateTelemetrySigningKey();
		expect(() =>
			parseTelemetrySigningKey(
				JSON.stringify({ ...key, public_key_spki_base64: other.public_key_spki_base64 }),
			),
		).toThrow("does not match");
		expect(() => parseTelemetrySigningKey("not-json")).toThrow(TelemetryProtocolError);
		expect(() => parseTelemetrySigningKey(JSON.stringify({ ...key, extra: true }))).toThrow(
			"invalid shape",
		);
	});
});
```

- [ ] **Step 2: Run the focused test and verify the new cases fail**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry-protocol.test.ts
```

Expected: FAIL because the key and signing exports do not exist.

- [ ] **Step 3: Implement atomic key material, canonical content, and Ed25519 signing**

Append this implementation to `apps/webapp/src/lib/telemetry-protocol.ts`:

```ts
const LOWERCASE_NONCE = /^[0-9a-f]{32}$/;
const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;

export interface TelemetrySigningKey {
	version: 1;
	private_key_pkcs8_pem: string;
	public_key_spki_base64: string;
}

interface SignedContentInput {
	deploymentId: string;
	signedAt: string;
	nonce: string;
	bodyHash: string;
}

interface AuthHeaderInput {
	report: PreparedTelemetryReport;
	signingKey: TelemetrySigningKey;
	now: Instant;
	nonce?: string;
}

export interface TelemetryAuthHeaders {
	"X-Z8-Deployment-Id": string;
	"X-Z8-Signed-At": string;
	"X-Z8-Nonce": string;
	"X-Z8-Signature": string;
}

function canonicalBase64(value: string): Buffer {
	const decoded = Buffer.from(value, "base64");
	if (decoded.byteLength === 0 || decoded.toString("base64") !== value) {
		throw new TelemetryProtocolError("Telemetry public key must use canonical standard base64");
	}
	return decoded;
}

export function generateTelemetrySigningKey(): TelemetrySigningKey {
	const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
	return {
		version: 1,
		private_key_pkcs8_pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		public_key_spki_base64: publicKey
			.export({ type: "spki", format: "der" })
			.toString("base64"),
	};
}

export function parseTelemetrySigningKey(value: string): TelemetrySigningKey {
	let candidate: unknown;
	try {
		candidate = JSON.parse(value);
	} catch {
		throw new TelemetryProtocolError("Stored telemetry signing key is not valid JSON");
	}
	if (!candidate || typeof candidate !== "object") {
		throw new TelemetryProtocolError("Stored telemetry signing key must be an object");
	}
	const key = candidate as Record<string, unknown>;
	const keys = Object.keys(key).sort();
	if (
		keys.join(",") !== "private_key_pkcs8_pem,public_key_spki_base64,version" ||
		key.version !== 1 ||
		typeof key.private_key_pkcs8_pem !== "string" ||
		typeof key.public_key_spki_base64 !== "string"
	) {
		throw new TelemetryProtocolError("Stored telemetry signing key has an invalid shape");
	}

	try {
		const privateKey = crypto.createPrivateKey({
			key: key.private_key_pkcs8_pem,
			format: "pem",
		});
		if (privateKey.asymmetricKeyType !== "ed25519") {
			throw new Error("wrong key type");
		}
		const storedPublicDer = canonicalBase64(key.public_key_spki_base64);
		const publicKey = crypto.createPublicKey({ key: storedPublicDer, format: "der", type: "spki" });
		if (publicKey.asymmetricKeyType !== "ed25519") {
			throw new Error("wrong key type");
		}
		const derived = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
		if (!Buffer.from(derived).equals(storedPublicDer)) {
			throw new TelemetryProtocolError("Stored telemetry public key does not match private key");
		}
	} catch (error) {
		if (error instanceof TelemetryProtocolError) throw error;
		throw new TelemetryProtocolError("Stored telemetry signing key is not valid Ed25519 material");
	}

	return {
		version: 1,
		private_key_pkcs8_pem: key.private_key_pkcs8_pem,
		public_key_spki_base64: key.public_key_spki_base64,
	};
}

export function generateTelemetryNonce(): string {
	return crypto.randomBytes(16).toString("hex");
}

export function buildTelemetrySignedContent(input: SignedContentInput): string {
	if (!isLowercaseUuidV4(input.deploymentId)) {
		throw new TelemetryProtocolError("Signed deployment ID must be a lowercase UUID v4");
	}
	if (!input.signedAt.endsWith("Z")) {
		throw new TelemetryProtocolError("Signed-at timestamp must be UTC and end in Z");
	}
	try {
		parseInstant(input.signedAt);
	} catch {
		throw new TelemetryProtocolError("Signed-at timestamp must be valid RFC 3339 UTC");
	}
	if (!LOWERCASE_NONCE.test(input.nonce)) {
		throw new TelemetryProtocolError("Telemetry nonce must be 32 lowercase hex characters");
	}
	if (!LOWERCASE_SHA256.test(input.bodyHash)) {
		throw new TelemetryProtocolError("Telemetry body hash must be lowercase SHA-256 hex");
	}
	return [
		"POST",
		"/api/telemetry",
		input.deploymentId,
		input.signedAt,
		input.nonce,
		input.bodyHash,
	].join("\n");
}

export function createTelemetryAuthHeaders(input: AuthHeaderInput): TelemetryAuthHeaders {
	const nonce = input.nonce ?? generateTelemetryNonce();
	const signedAt = input.now.toString({ smallestUnit: "millisecond" });
	const content = buildTelemetrySignedContent({
		deploymentId: input.report.deploymentId,
		signedAt,
		nonce,
		bodyHash: input.report.bodyHash,
	});
	const parsedKey = parseTelemetrySigningKey(JSON.stringify(input.signingKey));
	const privateKey = crypto.createPrivateKey({
		key: parsedKey.private_key_pkcs8_pem,
		format: "pem",
	});
	const signature = crypto.sign(null, Buffer.from(content, "utf8"), privateKey);
	if (signature.byteLength !== 64) {
		throw new TelemetryProtocolError("Ed25519 signature must be exactly 64 bytes");
	}
	return {
		"X-Z8-Deployment-Id": input.report.deploymentId,
		"X-Z8-Signed-At": signedAt,
		"X-Z8-Nonce": nonce,
		"X-Z8-Signature": signature.toString("base64"),
	};
}
```

- [ ] **Step 4: Run protocol tests**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry-protocol.test.ts
```

Expected: protocol tests PASS. Task 6 runs the authoritative repository typecheck with the project configuration.

- [ ] **Step 5: Commit request signing**

```bash
git add apps/webapp/src/lib/telemetry-protocol.ts apps/webapp/src/lib/telemetry-protocol.test.ts
git commit -m "feat: sign telemetry v2 requests"
```

### Task 3: Persist Deployment Identity And Signing Keys Safely

**Files:**
- Modify: `apps/webapp/src/lib/telemetry.ts:1-86`
- Create: `apps/webapp/src/lib/telemetry.test.ts`

- [ ] **Step 1: Write failing identity persistence tests**

Create `apps/webapp/src/lib/telemetry.test.ts`. Model the system configuration boundary as an atomic insert-if-absent store; production adapts this interface to Drizzle, while tests can prove race behavior without reproducing query-builder internals.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryConfigStore } from "./telemetry";
import { getOrCreateDeploymentId, getOrCreateTelemetryIdentity } from "./telemetry";

const mocks = vi.hoisted(() => ({
	loggerDebug: vi.fn(),
	loggerError: vi.fn(),
	loggerInfo: vi.fn(),
	loggerWarn: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		debug: mocks.loggerDebug,
		error: mocks.loggerError,
		info: mocks.loggerInfo,
		warn: mocks.loggerWarn,
	}),
}));

function memoryStore(initial: Record<string, string> = {}): TelemetryConfigStore {
	const values = new Map(Object.entries(initial));
	return {
		read: vi.fn(async (key: string) => values.get(key)),
		insertIfAbsent: vi.fn(async (entry) => {
			if (values.has(entry.key)) return false;
			values.set(entry.key, entry.value);
			return true;
		}),
	};
}

describe("telemetry identity", () => {
	beforeEach(() => vi.clearAllMocks());

	it("preserves an existing valid deployment ID and adds signing material", async () => {
		const deploymentId = "123e4567-e89b-42d3-a456-426614174000";
		const store = memoryStore({ deployment_id: deploymentId });
		const identity = await getOrCreateTelemetryIdentity({ store });

		expect(identity.deploymentId).toBe(deploymentId);
		expect(identity.signingKey.public_key_spki_base64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
		expect(store.insertIfAbsent).toHaveBeenCalledWith(
			expect.objectContaining({ key: "telemetry_signing_key" }),
		);
	});

	it("concurrent initialization converges on one deployment ID and one key pair", async () => {
		const store = memoryStore();
		const info = vi.fn();
		const [first, second] = await Promise.all([
			getOrCreateTelemetryIdentity({ store, info }),
			getOrCreateTelemetryIdentity({ store, info }),
		]);
		expect(second).toEqual(first);
		expect(info).toHaveBeenCalledOnce();
	});

	it("logs only the public key when this process inserts the key pair", async () => {
		const info = vi.fn();
		const identity = await getOrCreateTelemetryIdentity({ store: memoryStore(), info });
		const serializedLogs = JSON.stringify(info.mock.calls);
		expect(serializedLogs).toContain(identity.signingKey.public_key_spki_base64);
		expect(serializedLogs).not.toContain(identity.signingKey.private_key_pkcs8_pem);
	});

	it("fails closed for an invalid stored deployment ID", async () => {
		const store = memoryStore({ deployment_id: "not-a-uuid" });
		await expect(getOrCreateDeploymentId(store)).rejects.toThrow("UUID v4");
		expect(store.insertIfAbsent).not.toHaveBeenCalled();
	});

	it("fails closed for malformed stored signing material", async () => {
		const store = memoryStore({
			deployment_id: "123e4567-e89b-42d3-a456-426614174000",
			telemetry_signing_key: "not-json",
		});
		await expect(getOrCreateTelemetryIdentity({ store })).rejects.toThrow("valid JSON");
	});
});
```

- [ ] **Step 2: Run the identity tests and verify they fail**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry.test.ts
```

Expected: FAIL because `TelemetryConfigStore` and `getOrCreateTelemetryIdentity` do not exist.

- [ ] **Step 3: Replace deployment initialization with insert-if-absent identity management**

In `apps/webapp/src/lib/telemetry.ts`:

1. Import `inArray` or retain `eq` as needed, and import `generateTelemetrySigningKey`, `isLowercaseUuidV4`, `parseTelemetrySigningKey`, and `TelemetrySigningKey` from `@/lib/telemetry-protocol`.
2. Add the interfaces and default Drizzle adapter below.
3. Replace the current conflict-update deployment ID logic. Never rotate an invalid existing ID.

```ts
export interface TelemetryConfigStore {
	read(key: string): Promise<string | undefined>;
	insertIfAbsent(entry: {
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
	info?: (context: Record<string, unknown>, message: string) => void;
}

const databaseTelemetryConfigStore: TelemetryConfigStore = {
	async read(key) {
		const rows = await db
			.select({ value: systemConfig.value })
			.from(systemConfig)
			.where(eq(systemConfig.key, key))
			.limit(1);
		return rows[0]?.value;
	},
	async insertIfAbsent(entry) {
		const inserted = await db
			.insert(systemConfig)
			.values(entry)
			.onConflictDoNothing({ target: systemConfig.key })
			.returning({ key: systemConfig.key });
		return inserted.length === 1;
	},
};

async function readRequiredConfig(store: TelemetryConfigStore, key: string): Promise<string> {
	const value = await store.read(key);
	if (!value) throw new TelemetryValidationError(`Failed to persist ${key}`);
	return value;
}

export async function getOrCreateDeploymentId(
	store: TelemetryConfigStore = databaseTelemetryConfigStore,
): Promise<string> {
	try {
		const existing = await store.read("deployment_id");
		if (existing !== undefined) {
			if (!isLowercaseUuidV4(existing)) {
				throw new TelemetryValidationError("Stored deployment_id must be a lowercase UUID v4");
			}
			return existing;
		}

		const candidate = crypto.randomUUID().toLowerCase();
		await store.insertIfAbsent({
			key: "deployment_id",
			value: candidate,
			description: "Unique identifier for this deployment, used for telemetry reporting",
		});
		const stored = await readRequiredConfig(store, "deployment_id");
		if (!isLowercaseUuidV4(stored)) {
			throw new TelemetryValidationError("Stored deployment_id must be a lowercase UUID v4");
		}
		return stored;
	} catch (error) {
		logger.error({ error }, "Failed to get or create deployment ID");
		if (error instanceof TelemetryValidationError) throw error;
		throw new TelemetryValidationError("Failed to get or create deployment ID");
	}
}

export async function getOrCreateTelemetryIdentity(
	options: TelemetryIdentityOptions = {},
): Promise<TelemetryIdentity> {
	const store = options.store ?? databaseTelemetryConfigStore;
	const info = options.info ?? ((context, message) => logger.info(context, message));
	const deploymentId = await getOrCreateDeploymentId(store);
	let serializedKey = await store.read("telemetry_signing_key");

	if (serializedKey === undefined) {
		const candidate = generateTelemetrySigningKey();
		const candidateJson = JSON.stringify(candidate);
		const inserted = await store.insertIfAbsent({
			key: "telemetry_signing_key",
			value: candidateJson,
			description: "Versioned Ed25519 key pair used to sign telemetry reports",
		});
		serializedKey = await readRequiredConfig(store, "telemetry_signing_key");
		if (inserted) {
			info(
				{ deploymentId, publicKeySpkiBase64: candidate.public_key_spki_base64 },
				"Generated telemetry signing key; register this public key with the receiver",
			);
		}
	}

	return { deploymentId, signingKey: parseTelemetrySigningKey(serializedKey) };
}
```

Keep `getOrCreateDeploymentId()` exported because platform diagnostics already depends on it. Do not edit `src/db/auth-schema.ts` and do not add a migration; `system_config` already accepts arbitrary keys.

- [ ] **Step 4: Run identity and platform diagnostics tests**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry.test.ts src/lib/platform-diagnostics/collector.test.ts
```

Expected: PASS. The platform diagnostics test confirms it still delegates deployment ID creation to the telemetry helper.

- [ ] **Step 5: Commit identity persistence**

```bash
git add apps/webapp/src/lib/telemetry.ts apps/webapp/src/lib/telemetry.test.ts
git commit -m "feat: persist telemetry signing identity"
```

### Task 4: Send Exact Bytes With Protocol-Aware Retries

**Files:**
- Modify: `apps/webapp/src/lib/telemetry.ts:11-24,91-202`
- Modify: `apps/webapp/src/lib/telemetry.test.ts`

- [ ] **Step 1: Add failing sender tests for exact retries and terminal errors**

Append sender tests to `apps/webapp/src/lib/telemetry.test.ts`. Generate a real key through the protocol helper so each captured signature can be verified rather than merely pattern-matched.

```ts
import crypto from "node:crypto";
import { Temporal } from "temporal-polyfill";
import {
	buildTelemetrySignedContent,
	generateTelemetrySigningKey,
} from "./telemetry-protocol";
import {
	sendTelemetryReportWithDependencies,
	type TelemetryMetrics,
} from "./telemetry";

const deploymentId = "123e4567-e89b-42d3-a456-426614174000";
const metrics: TelemetryMetrics = {
	activeUsers24h: 4,
	totalOrganizations: 2,
	totalEmployees: 8,
	sessionsCreated24h: 6,
	licenseType: "community",
};

function success(idempotent = false) {
	return new Response(
		JSON.stringify({
			deployment_id: deploymentId,
			idempotent,
			recorded_at: "2026-07-18T12:00:01Z",
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

describe("sendTelemetryReportWithDependencies", () => {
	beforeEach(() => vi.clearAllMocks());

	it("reuses exact body bytes and report timestamp but signs each retry with a fresh nonce", async () => {
		const requests: Array<{ url: string; body: Buffer; headers: Headers }> = [];
		const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			requests.push({
				url: String(url),
				body: Buffer.from(init?.body as Buffer),
				headers: new Headers(init?.headers),
			});
			return requests.length === 1
				? new Response(JSON.stringify({ code: "TELEMETRY_DEPENDENCY_UNAVAILABLE", error: "retry", request_id: "req-1" }), { status: 503 })
				: success(true);
		});
		const times = [
			Temporal.Instant.from("2026-07-18T12:00:00Z"),
			Temporal.Instant.from("2026-07-18T12:00:01Z"),
			Temporal.Instant.from("2026-07-18T12:00:02Z"),
		];
		const sleep = vi.fn(async () => undefined);
		const signingKey = generateTelemetrySigningKey();

		const result = await sendTelemetryReportWithDependencies(
			{ deploymentId, signingKey },
			metrics,
			{ fetch: fetchImpl as typeof fetch, now: () => times.shift()!, sleep },
		);

		expect(result).toBe(true);
		expect(requests).toHaveLength(2);
		expect(requests.map((request) => request.url)).toEqual([
			"https://telemetry.z8-time.app/api/telemetry",
			"https://telemetry.z8-time.app/api/telemetry",
		]);
		expect(requests[1].body.equals(requests[0].body)).toBe(true);
		expect(JSON.parse(requests[0].body.toString("utf8")).timestamp).toBe(
			JSON.parse(requests[1].body.toString("utf8")).timestamp,
		);
		expect(requests[1].headers.get("X-Z8-Nonce")).not.toBe(
			requests[0].headers.get("X-Z8-Nonce"),
		);
		expect(requests[1].headers.get("X-Z8-Signature")).not.toBe(
			requests[0].headers.get("X-Z8-Signature"),
		);
		expect(sleep).toHaveBeenCalledWith(1000);

		const publicKey = crypto.createPublicKey({
			key: Buffer.from(signingKey.public_key_spki_base64, "base64"),
			format: "der",
			type: "spki",
		});
		for (const request of requests) {
			const bodyHash = crypto.createHash("sha256").update(request.body).digest("hex");
			const content = buildTelemetrySignedContent({
				deploymentId,
				signedAt: request.headers.get("X-Z8-Signed-At")!,
				nonce: request.headers.get("X-Z8-Nonce")!,
				bodyHash,
			});
			expect(
				crypto.verify(
					null,
					Buffer.from(content),
					publicKey,
					Buffer.from(request.headers.get("X-Z8-Signature")!, "base64"),
				),
			).toBe(true);
		}
	});

	it.each([400, 401, 409, 413])("does not retry terminal HTTP %s", async (status) => {
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify({ code: "INVALID_TELEMETRY_INPUT", error: "terminal", request_id: "req-2" }),
				{ status, headers: { "X-Request-Id": "header-2" } },
			),
		);
		const sleep = vi.fn(async () => undefined);
		const result = await sendTelemetryReportWithDependencies(
			{ deploymentId, signingKey: generateTelemetrySigningKey() },
			metrics,
			{
				fetch: fetchImpl as typeof fetch,
				now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
				sleep,
			},
		);
		expect(result).toBe(false);
		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(sleep).not.toHaveBeenCalled();
	});

	it("respects delta-seconds Retry-After on 429", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "17" } }))
			.mockResolvedValueOnce(success());
		const sleep = vi.fn(async () => undefined);
		const result = await sendTelemetryReportWithDependencies(
			{ deploymentId, signingKey: generateTelemetrySigningKey() },
			metrics,
			{
				fetch: fetchImpl as typeof fetch,
				now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
				sleep,
			},
		);
		expect(result).toBe(true);
		expect(sleep).toHaveBeenCalledWith(17_000);
	});

	it("uses an HTTP-date Retry-After relative to the attempt instant", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response("rate limited", {
					status: 429,
					headers: { "Retry-After": "Sat, 18 Jul 2026 12:00:30 GMT" },
				}),
			)
			.mockResolvedValueOnce(success());
		const sleep = vi.fn(async () => undefined);
		await sendTelemetryReportWithDependencies(
			{ deploymentId, signingKey: generateTelemetrySigningKey() },
			metrics,
			{
				fetch: fetchImpl as typeof fetch,
				now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
				sleep,
			},
		);
		expect(sleep).toHaveBeenCalledWith(30_000);
	});

	it("rejects malformed or mismatched HTTP 200 responses", async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ deployment_id: crypto.randomUUID(), idempotent: false }), {
				status: 200,
			}),
		);
		const result = await sendTelemetryReportWithDependencies(
			{ deploymentId, signingKey: generateTelemetrySigningKey() },
			metrics,
			{
				fetch: fetchImpl as typeof fetch,
				now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
				sleep: vi.fn(async () => undefined),
			},
		);
		expect(result).toBe(false);
	});

	it("rejects a valid-looking success body returned with a non-200 2xx status", async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(
				JSON.stringify({
					deployment_id: deploymentId,
					idempotent: false,
					recorded_at: "2026-07-18T12:00:01Z",
				}),
				{ status: 202 },
			),
		);
		const result = await sendTelemetryReportWithDependencies(
			{ deploymentId, signingKey: generateTelemetrySigningKey() },
			metrics,
			{
				fetch: fetchImpl as typeof fetch,
				now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
				sleep: vi.fn(async () => undefined),
			},
		);
		expect(result).toBe(false);
		expect(fetchImpl).toHaveBeenCalledOnce();
	});
});
```

Add two more focused cases in the same describe block:

```ts
it("retries a fetch rejection and an AbortError at most three total attempts", async () => {
	const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
	const fetchImpl = vi
		.fn()
		.mockRejectedValueOnce(new TypeError("fetch failed"))
		.mockRejectedValueOnce(abort)
		.mockResolvedValueOnce(success());
	const result = await sendTelemetryReportWithDependencies(
		{ deploymentId, signingKey: generateTelemetrySigningKey() },
		metrics,
		{
			fetch: fetchImpl as typeof fetch,
			now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
			sleep: vi.fn(async () => undefined),
		},
	);
	expect(result).toBe(true);
	expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it("omits api_requests_24h when no aggregate is available", async () => {
	let body = Buffer.alloc(0);
	const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
		body = Buffer.from(init?.body as Buffer);
		return success();
	});
	await sendTelemetryReportWithDependencies(
		{ deploymentId, signingKey: generateTelemetrySigningKey() },
		metrics,
		{
			fetch: fetchImpl as typeof fetch,
			now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
			sleep: vi.fn(async () => undefined),
		},
	);
	expect(JSON.parse(body.toString("utf8")).metrics).not.toHaveProperty("api_requests_24h");
});
```

- [ ] **Step 2: Run sender tests and verify they fail**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry.test.ts
```

Expected: FAIL because `sendTelemetryReportWithDependencies` does not exist and the current sender emits v1 camelCase JSON.

- [ ] **Step 3: Implement the v2 sender and retry loop**

In `apps/webapp/src/lib/telemetry.ts`:

1. Remove `Effect`, `pipe`, and `Schedule`; a direct async loop makes per-attempt nonce generation and `Retry-After` behavior explicit.
2. Delete the obsolete v1 `TelemetryPayload` interface, restrict `licenseType` to `TelemetryLicenseType`, and add optional `apiRequests24h`.
3. Import `systemClock`, `parseInstant`, `dateFromInstant`, and protocol preparation/signing helpers.
4. Change the 24-hour database cutoff in `calculateTelemetryMetrics` to `dateFromInstant(systemClock.nowInstant().subtract({ hours: 24 }))`; the resulting native `Date` exists only at the Drizzle boundary.
5. Add the following transport boundaries and helpers.

```ts
import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";
import { dateFromInstant, parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	createTelemetryAuthHeaders,
	isLowercaseUuidV4,
	prepareTelemetryReport,
	type TelemetryLicenseType,
} from "@/lib/telemetry-protocol";

const TELEMETRY_URL = "https://telemetry.z8-time.app/api/telemetry";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const FALLBACK_RETRY_MS = [1_000, 2_000] as const;

export interface TelemetryMetrics {
	activeUsers24h: number;
	totalOrganizations: number;
	totalEmployees: number;
	sessionsCreated24h: number;
	apiRequests24h?: number;
	licenseType: TelemetryLicenseType;
}

interface TelemetrySenderDependencies {
	fetch: typeof fetch;
	now: () => Instant;
	sleep: (milliseconds: number) => Promise<void>;
}

const defaultSenderDependencies: TelemetrySenderDependencies = {
	fetch,
	now: () => systemClock.nowInstant(),
	sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

interface ReceiverErrorBody {
	code?: string;
	error?: string;
	request_id?: string;
}

async function parseJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return undefined;
	}
}

function isValidSuccess(value: unknown, deploymentId: string): boolean {
	if (!value || typeof value !== "object") return false;
	const body = value as Record<string, unknown>;
	if (
		body.deployment_id !== deploymentId ||
		typeof body.idempotent !== "boolean" ||
		typeof body.recorded_at !== "string"
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

function retryAfterMilliseconds(value: string | null, now: Instant): number | undefined {
	if (!value) return undefined;
	if (/^\d+$/.test(value)) return Number(value) * 1_000;
	const epochMilliseconds = Date.parse(value);
	if (!Number.isFinite(epochMilliseconds)) return undefined;
	const retryAt = Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
	return Math.max(0, retryAt.epochMilliseconds - now.epochMilliseconds);
}

function logReceiverFailure(
	response: Response,
	body: unknown,
	deploymentId: string,
	attempt: number,
): void {
	const errorBody = body && typeof body === "object" ? (body as ReceiverErrorBody) : {};
	logger.error(
		{
			status: response.status,
			code: errorBody.code,
			requestId: errorBody.request_id,
			responseRequestId: response.headers.get("X-Request-Id") ?? undefined,
			deploymentId,
			attempt,
		},
		"Telemetry receiver rejected report",
	);
}

export async function sendTelemetryReportWithDependencies(
	identity: TelemetryIdentity,
	metrics: TelemetryMetrics,
	dependencies: TelemetrySenderDependencies,
): Promise<boolean> {
	const reportInstant = dependencies.now();
	const payload = {
		version: "2.0" as const,
		deployment_id: identity.deploymentId,
		timestamp: reportInstant.toString({ smallestUnit: "millisecond" }),
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
	};
	const report = prepareTelemetryReport(payload, reportInstant);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
		const attemptInstant = dependencies.now();
		const fallbackDelay = FALLBACK_RETRY_MS[attempt - 1] ?? FALLBACK_RETRY_MS.at(-1)!;
		const authHeaders = createTelemetryAuthHeaders({
			report,
			signingKey: identity.signingKey,
			now: attemptInstant,
		});
		let response: Response;
		try {
			response = await dependencies.fetch(TELEMETRY_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json", ...authHeaders },
				body: report.body,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			if (attempt === MAX_ATTEMPTS) {
				logger.error(
					{ error: error instanceof Error ? error.message : String(error), deploymentId: identity.deploymentId, attempt },
					"Telemetry request failed after retries",
				);
				return false;
			}
			await dependencies.sleep(fallbackDelay);
			continue;
		}

		const responseBody = await parseJson(response);
		if (response.status === 200) {
			if (!isValidSuccess(responseBody, identity.deploymentId)) {
				logger.error({ status: response.status, deploymentId: identity.deploymentId, attempt }, "Telemetry receiver returned an invalid success response");
				return false;
			}
			logger.info(
				{ deploymentId: identity.deploymentId, idempotent: (responseBody as { idempotent: boolean }).idempotent },
				"Telemetry sent successfully",
			);
			return true;
		}

		logReceiverFailure(response, responseBody, identity.deploymentId, attempt);
		const retryable = response.status === 429 || response.status === 503;
		if (!retryable || attempt === MAX_ATTEMPTS) return false;
		const delay =
			response.status === 429
				? retryAfterMilliseconds(response.headers.get("Retry-After"), attemptInstant) ??
					fallbackDelay
				: fallbackDelay;
		await dependencies.sleep(delay);
	}

	return false;
}

export async function sendTelemetryReport(
	deploymentId: string,
	metrics: TelemetryMetrics,
): Promise<boolean> {
	try {
		const identity = await getOrCreateTelemetryIdentity();
		if (!isLowercaseUuidV4(deploymentId) || identity.deploymentId !== deploymentId) {
			throw new TelemetryValidationError("Telemetry deployment ID does not match stored identity");
		}
		return await sendTelemetryReportWithDependencies(identity, metrics, defaultSenderDependencies);
	} catch (error) {
		logger.error(
			{ error: error instanceof Error ? error.message : String(error), deploymentId },
			"Failed to send telemetry",
		);
		return false;
	}
}
```

Important implementation details:

- Pass the retained `Buffer` directly to every `fetch` call.
- Call `prepareTelemetryReport` once before the loop.
- Call `createTelemetryAuthHeaders` inside the loop.
- Never include nonce, signature, signed content, private key, or body in logs.
- Keep receiver error fields limited to `code`, `request_id`, status, and request header ID. Do not log the receiver's free-form `error` string if it could echo input.
- Reject invalid HTTP 200 bodies and reject every other 2xx status because protocol success is specifically HTTP 200.

- [ ] **Step 4: Run sender tests and address deterministic clock consumption**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry.test.ts
```

Expected: PASS. If a retry test exhausts its `times` array, add exactly one instant for each call: one report instant plus one signed-at instant per attempted request. Do not move report timestamp creation into the retry loop.

- [ ] **Step 5: Add explicit structured logging assertions**

Use the hoisted logger spies established in Task 3 and add this complete runtime assertion:

```ts
it("logs stable receiver identifiers without request authentication material", async () => {
	const fetchImpl = vi.fn(async () =>
		new Response(
			JSON.stringify({
				code: "TELEMETRY_CONFLICT",
				error: "payload differs",
				request_id: "body-3",
			}),
			{ status: 409, headers: { "X-Request-Id": "header-3" } },
		),
	);
	const identity = { deploymentId, signingKey: generateTelemetrySigningKey() };
	const result = await sendTelemetryReportWithDependencies(identity, metrics, {
		fetch: fetchImpl as typeof fetch,
		now: () => Temporal.Instant.from("2026-07-18T12:00:00Z"),
		sleep: vi.fn(async () => undefined),
	});

	expect(result).toBe(false);
	const serialized = JSON.stringify(mocks.loggerError.mock.calls);
	expect(serialized).toContain("TELEMETRY_CONFLICT");
	expect(serialized).toContain("body-3");
	expect(serialized).toContain("header-3");
	expect(serialized).not.toContain("payload differs");
	expect(serialized).not.toContain("X-Z8-Signature");
	expect(serialized).not.toContain("PRIVATE KEY");
});
```

Keep this as a runtime assertion against structured logger arguments; do not weaken it into a source-string assertion.

- [ ] **Step 6: Run telemetry tests and commit transport changes**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry-protocol.test.ts src/lib/telemetry.test.ts
```

Expected: PASS.

```bash
git add apps/webapp/src/lib/telemetry.ts apps/webapp/src/lib/telemetry.test.ts
git commit -m "feat: send signed telemetry v2 reports"
```

### Task 5: Activate Daily Telemetry Collection

**Files:**
- Modify: `apps/webapp/src/lib/cron/registry.test.ts`
- Modify: `apps/webapp/src/lib/cron/registry.ts:309-317`
- Modify: `deploy/README.md:213`
- Modify: `FairUsagePolicy.md:84-118`

- [ ] **Step 1: Add failing cron schedule and processor tests**

At the top of `apps/webapp/src/lib/cron/registry.test.ts`, replace the non-hoisted billing mock setup with one hoisted mock object that also contains telemetry functions:

```ts
const mocks = vi.hoisted(() => ({
	runBillingSeatReconciliation: vi.fn(async () => ({
		success: true,
		billingEnabled: true,
		processed: 0,
		synced: 0,
		skipped: 0,
		errors: [],
	})),
	getOrCreateDeploymentId: vi.fn(async () => "123e4567-e89b-42d3-a456-426614174000"),
	calculateTelemetryMetrics: vi.fn(async () => ({
		activeUsers24h: 1,
		totalOrganizations: 1,
		totalEmployees: 2,
		sessionsCreated24h: 1,
		licenseType: "community" as const,
	})),
	sendTelemetryReport: vi.fn(async () => true),
}));

vi.mock("@/lib/jobs/billing-seat-reconciliation", () => ({
	runBillingSeatReconciliation: mocks.runBillingSeatReconciliation,
}));

vi.mock("@/lib/telemetry", () => ({
	getOrCreateDeploymentId: mocks.getOrCreateDeploymentId,
	calculateTelemetryMetrics: mocks.calculateTelemetryMetrics,
	sendTelemetryReport: mocks.sendTelemetryReport,
}));
```

Update the existing billing assertion to use `mocks.runBillingSeatReconciliation`, then append:

```ts
describe("CRON_JOBS telemetry", () => {
	it("runs telemetry once daily at UTC midnight", async () => {
		expect(CRON_JOBS["cron:telemetry"]).toMatchObject({
			schedule: "0 0 * * *",
			defaultJobOptions: { attempts: 1, priority: 9 },
		});

		const result = await CRON_JOBS["cron:telemetry"].processor({
			triggeredAt: "2026-07-18T00:00:00Z",
		});
		expect(mocks.getOrCreateDeploymentId).toHaveBeenCalledOnce();
		expect(mocks.calculateTelemetryMetrics).toHaveBeenCalledOnce();
		expect(mocks.sendTelemetryReport).toHaveBeenCalledWith(
			"123e4567-e89b-42d3-a456-426614174000",
			expect.objectContaining({ licenseType: "community" }),
		);
		expect(result).toEqual({ success: true, message: "Telemetry sent" });
	});

	it("returns an unsuccessful cron result when the sender fails", async () => {
		mocks.sendTelemetryReport.mockResolvedValueOnce(false);
		const result = await CRON_JOBS["cron:telemetry"].processor({
			triggeredAt: "2026-07-18T00:00:00Z",
		});
		expect(result).toEqual({ success: false, message: "Telemetry send failed" });
	});
});
```

- [ ] **Step 2: Run the cron registry test and verify it fails**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/cron/registry.test.ts
```

Expected: FAIL because telemetry remains scheduled every 15 minutes and returns its placeholder result.

- [ ] **Step 3: Implement the daily telemetry processor**

Replace the telemetry registry entry in `apps/webapp/src/lib/cron/registry.ts` with:

```ts
"cron:telemetry": {
	schedule: "0 0 * * *", // Daily at UTC midnight
	description: "Collect and export telemetry data",
	processor: async (): Promise<TelemetryResult> => {
		const {
			calculateTelemetryMetrics,
			getOrCreateDeploymentId,
			sendTelemetryReport,
		} = await import("@/lib/telemetry");
		const deploymentId = await getOrCreateDeploymentId();
		const metrics = await calculateTelemetryMetrics();
		const success = await sendTelemetryReport(deploymentId, metrics);
		return {
			success,
			message: success ? "Telemetry sent" : "Telemetry send failed",
		};
	},
	defaultJobOptions: { attempts: 1, priority: 9 },
},
```

Do not add BullMQ retries. The sender owns its three-attempt nonce-aware retry policy, and an outer job retry could create another report timestamp/body.

- [ ] **Step 4: Update deployment schedule documentation**

In `deploy/README.md`, change the telemetry row to:

```md
| `cron:telemetry` | Daily at 00:00 UTC | Telemetry collection |
```

In `FairUsagePolicy.md`, change the sample version to `2.0`, remove `api_requests_24h` from the example because it is not currently collected, and replace the endpoint bullet with:

```md
- Telemetry is sent via signed **HTTPS POST** requests to `https://telemetry.z8-time.app/api/telemetry`
- Every request uses a fresh nonce and an Ed25519 signature from the deployment signing key
```

- [ ] **Step 5: Run cron and worker regression tests**

Run:

```bash
pnpm --dir apps/webapp test -- src/lib/cron/registry.test.ts src/worker.test.ts
```

Expected: PASS. The worker tests continue treating telemetry like any other registered cron processor.

- [ ] **Step 6: Commit cron activation**

```bash
git add apps/webapp/src/lib/cron/registry.ts apps/webapp/src/lib/cron/registry.test.ts deploy/README.md FairUsagePolicy.md
git commit -m "feat: schedule signed telemetry daily"
```

### Task 6: Verify Protocol And Repository Integration

**Files:**
- Verify only; modify preceding files only if checks expose defects.

- [ ] **Step 1: Run all focused telemetry tests**

```bash
pnpm --dir apps/webapp test -- src/lib/telemetry-protocol.test.ts src/lib/telemetry.test.ts src/lib/cron/registry.test.ts src/lib/platform-diagnostics/collector.test.ts src/worker.test.ts
```

Expected: PASS with no unhandled promise rejection and no real network access.

- [ ] **Step 2: Run the webapp typecheck**

```bash
pnpm --dir apps/webapp typecheck
```

Expected: PASS. Fix type errors in telemetry files without weakening types or adding casts around malformed receiver input.

- [ ] **Step 3: Run Biome on the touched source and test files**

```bash
pnpm exec biome check apps/webapp/src/lib/telemetry-protocol.ts apps/webapp/src/lib/telemetry-protocol.test.ts apps/webapp/src/lib/telemetry.ts apps/webapp/src/lib/telemetry.test.ts apps/webapp/src/lib/cron/registry.ts apps/webapp/src/lib/cron/registry.test.ts
```

Expected: PASS. If formatting is required, run the same command with `--write`, inspect the diff, and rerun without `--write`.

- [ ] **Step 4: Run the complete webapp test suite**

```bash
pnpm --dir apps/webapp test
```

Expected: PASS. If unrelated concurrent changes fail, record the exact failing files and verify all focused telemetry tests still pass.

- [ ] **Step 5: Inspect the final diff for protocol invariants and secret handling**

```bash
git diff --check
```

Confirm from the diff:

- The body is serialized once before retries.
- The same `Buffer` is sent on every attempt.
- Nonce/signature creation occurs inside the retry loop.
- Signed content contains exactly the specified six lines and no trailing LF.
- The endpoint path in both signing and fetch is `/api/telemetry`.
- Private key, body, signature, nonce, and signed content never enter logs.
- Stored public key is canonical base64 DER SPKI and matches the PKCS#8 private key.
- No `system_config` upsert can rotate an existing deployment identity.
- Telemetry cron is daily UTC, not every 15 minutes.

- [ ] **Step 6: Commit any verification fixes**

If verification required changes:

```bash
git add apps/webapp/src/lib/telemetry-protocol.ts apps/webapp/src/lib/telemetry-protocol.test.ts apps/webapp/src/lib/telemetry.ts apps/webapp/src/lib/telemetry.test.ts apps/webapp/src/lib/cron/registry.ts apps/webapp/src/lib/cron/registry.test.ts deploy/README.md FairUsagePolicy.md
git commit -m "fix: harden signed telemetry v2"
```

If no files changed, do not create an empty commit.
