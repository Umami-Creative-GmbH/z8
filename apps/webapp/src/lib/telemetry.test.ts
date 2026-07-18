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

import {
	getOrCreateTelemetryIdentity,
	type TelemetryConfigStore,
	TelemetryValidationError,
} from "@/lib/telemetry";
import {
	generateTelemetrySigningKey,
	isLowercaseUuidV4,
	parseTelemetrySigningKey,
	TelemetryProtocolError,
} from "@/lib/telemetry-protocol";

const DEPLOYMENT_ID = "123e4567-e89b-42d3-a456-426614174000";

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
