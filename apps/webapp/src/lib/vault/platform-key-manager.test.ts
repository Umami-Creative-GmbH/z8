import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		SCALEWAY_KEY_MANAGER_API_URL: "https://key-manager.test",
		SCALEWAY_SECRET_KEY: "test-secret-key",
		SCALEWAY_PROJECT_ID: "project-123",
		SCALEWAY_REGION: "fr-par",
	},
	db: {
		query: {
			systemConfig: { findFirst: vi.fn() },
		},
		insert: vi.fn(),
		transaction: vi.fn(),
		execute: vi.fn(),
	},
	drizzle: {
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values })),
	},
	tables: {
		systemConfig: {
			key: "systemConfig.key",
			value: "systemConfig.value",
			description: "systemConfig.description",
		},
	},
	clientConstructor: vi.fn(),
	client: {
		getKey: vi.fn(),
		createPlatformKey: vi.fn(),
		encrypt: vi.fn(),
		decrypt: vi.fn(),
	},
	nanoid: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoUpdate: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));

vi.mock("@/db", () => ({ db: mocks.db }));

vi.mock("@/db/schema", () => mocks.tables);

vi.mock("drizzle-orm", () => mocks.drizzle);

vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));

vi.mock("server-only", () => ({}));

vi.mock("./scaleway-key-manager-client", () => ({
	ScalewayKeyManagerClient: mocks.clientConstructor,
}));

const platformKey = (id: string, state = "enabled") => ({
	id,
	state,
	usage: { symmetric_encryption: "aes_256_gcm" },
	tags: ["z8-platform-secrets"],
});

describe("testPlatformKeyManagerEncryption", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();

		mocks.clientConstructor.mockImplementation(
			class {
				getKey = mocks.client.getKey;
				createPlatformKey = mocks.client.createPlatformKey;
				encrypt = mocks.client.encrypt;
				decrypt = mocks.client.decrypt;
			},
		);
		mocks.client.getKey.mockResolvedValue(platformKey("key-stored"));
		mocks.client.createPlatformKey.mockResolvedValue(platformKey("key-created"));
		mocks.client.encrypt.mockResolvedValue("ciphertext-created");
		mocks.client.decrypt.mockResolvedValue("diagnostic-value");
		mocks.nanoid.mockReturnValue("abc123def4");

		mocks.db.query.systemConfig.findFirst.mockResolvedValue(undefined);
		mocks.db.transaction.mockImplementation(async (callback) => callback(mocks.db));
		mocks.db.execute.mockResolvedValue(undefined);
		mocks.onConflictDoUpdate.mockResolvedValue(undefined);
		mocks.insertValues.mockReturnValue({ onConflictDoUpdate: mocks.onConflictDoUpdate });
		mocks.db.insert.mockReturnValue({ values: mocks.insertValues });
	});

	test("no stored key creates a platform key and persists returned ID", async () => {
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		const result = await testPlatformKeyManagerEncryption("diagnostic-value");

		expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.db.execute).toHaveBeenCalledTimes(1);
		expect(mocks.db.query.systemConfig.findFirst).toHaveBeenCalledTimes(2);
		expect(mocks.client.createPlatformKey).toHaveBeenCalledWith("z8-platform-abc123def4");
		expect(mocks.insertValues).toHaveBeenCalledWith({
			key: "platform_scaleway_key_id",
			value: "key-created",
			description: "Scaleway Key Manager key ID for platform-scoped secrets.",
		});
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-created",
			"diagnostic-value",
			"scope=platform;purpose=diagnostics;version=1",
		);
		expect(mocks.client.decrypt).toHaveBeenCalledWith(
			"key-created",
			"ciphertext-created",
			"scope=platform;purpose=diagnostics;version=1",
		);
		expect(result).toEqual({
			input: "diagnostic-value",
			output: "diagnostic-value",
			matches: true,
			ciphertextPreview: "ciphertext-created",
			platformKeyId: "key-created",
			keyStatus: "created",
		});
	});

	test("stored key ID is verified and reused", async () => {
		mocks.db.query.systemConfig.findFirst.mockResolvedValue({
			key: "platform_scaleway_key_id",
			value: "key-stored",
		});
		mocks.client.encrypt.mockResolvedValue("x".repeat(100));
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		const result = await testPlatformKeyManagerEncryption("diagnostic-value");

		expect(mocks.client.getKey).toHaveBeenCalledWith("key-stored");
		expect(mocks.client.createPlatformKey).not.toHaveBeenCalled();
		expect(result.platformKeyId).toBe("key-stored");
		expect(result.keyStatus).toBe("reused");
		expect(result.ciphertextPreview).toBe(`${"x".repeat(48)}...${"x".repeat(24)}`);
	});

	test("unusable stored key reports error and does not create replacement", async () => {
		mocks.db.query.systemConfig.findFirst.mockResolvedValue({
			key: "platform_scaleway_key_id",
			value: "key-stored",
		});
		mocks.client.getKey.mockResolvedValue(platformKey("key-stored", "disabled"));
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		await expect(testPlatformKeyManagerEncryption("diagnostic-value")).rejects.toThrow(
			"Scaleway platform key key-stored is not enabled or compatible",
		);
		expect(mocks.client.createPlatformKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).not.toHaveBeenCalled();
	});

	test("decrypt mismatch returns matches false", async () => {
		mocks.db.query.systemConfig.findFirst.mockResolvedValue({
			key: "platform_scaleway_key_id",
			value: "key-stored",
		});
		mocks.client.decrypt.mockResolvedValue("different-value");
		const { testPlatformKeyManagerEncryption } = await import("./platform-key-manager");

		const result = await testPlatformKeyManagerEncryption("diagnostic-value");

		expect(result).toMatchObject({
			input: "diagnostic-value",
			output: "different-value",
			matches: false,
			platformKeyId: "key-stored",
			keyStatus: "reused",
		});
	});
});
