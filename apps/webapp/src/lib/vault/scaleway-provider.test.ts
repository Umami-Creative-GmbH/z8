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
			organizationSecretKey: { findFirst: vi.fn() },
			organizationSecret: { findFirst: vi.fn() },
		},
		insert: vi.fn(),
		delete: vi.fn(),
		transaction: vi.fn(),
		execute: vi.fn(),
	},
	drizzle: {
		and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		isNull: vi.fn((value: unknown) => ({ isNull: value })),
		sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values })),
	},
	tables: {
		organizationSecretKey: {
			organizationId: "organizationSecretKey.organizationId",
			provider: "organizationSecretKey.provider",
			disabledAt: "organizationSecretKey.disabledAt",
			scalewayKeyId: "organizationSecretKey.scalewayKeyId",
		},
		organizationSecret: {
			organizationId: "organizationSecret.organizationId",
			key: "organizationSecret.key",
			provider: "organizationSecret.provider",
			kmsKeyId: "organizationSecret.kmsKeyId",
			ciphertext: "organizationSecret.ciphertext",
		},
	},
	clientConstructor: vi.fn(),
	client: {
		getKey: vi.fn(),
		listOrganizationKeys: vi.fn(),
		createOrganizationKey: vi.fn(),
		encrypt: vi.fn(),
		decrypt: vi.fn(),
	},
	invalidateSecretStoreStatusCache: vi.fn(),
	insertValues: vi.fn(),
	onConflictDoNothing: vi.fn(),
	onConflictDoUpdate: vi.fn(),
	deleteWhere: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));

vi.mock("drizzle-orm", () => mocks.drizzle);

vi.mock("@/db", () => ({ db: mocks.db }));

vi.mock("@/db/schema", () => mocks.tables);

vi.mock("./scaleway-key-manager-client", () => ({
	ScalewayKeyManagerClient: mocks.clientConstructor,
}));

vi.mock("./status", () => ({
	invalidateSecretStoreStatusCache: mocks.invalidateSecretStoreStatusCache,
}));

const localKey = {
	organizationId: "org-1",
	provider: "scaleway",
	scalewayKeyId: "key-local",
	region: "fr-par",
	disabledAt: null,
};

const remoteKey = (id: string, state = "enabled") => ({
	id,
	state,
	usage: { symmetric_encryption: "aes_256_gcm" },
	tags: ["z8-customer-secrets", "z8-org:org-1"],
});

const incompatibleRemoteKey = (id: string) => ({
	id,
	state: "enabled",
	usage: { symmetric_encryption: "aes_128_gcm" },
	tags: ["z8-customer-secrets", "z8-org:org-1"],
});

describe("scalewaySecretProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();

		mocks.clientConstructor.mockImplementation(
			class {
				getKey = mocks.client.getKey;
				listOrganizationKeys = mocks.client.listOrganizationKeys;
				createOrganizationKey = mocks.client.createOrganizationKey;
				encrypt = mocks.client.encrypt;
				decrypt = mocks.client.decrypt;
			},
		);
		mocks.client.getKey.mockResolvedValue(remoteKey("key-local"));
		mocks.client.listOrganizationKeys.mockResolvedValue([]);
		mocks.client.createOrganizationKey.mockResolvedValue(remoteKey("key-created"));
		mocks.client.encrypt.mockResolvedValue("ciphertext-created");
		mocks.client.decrypt.mockResolvedValue("secret-value");
		mocks.invalidateSecretStoreStatusCache.mockResolvedValue(undefined);

		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(undefined);
		mocks.db.query.organizationSecret.findFirst.mockResolvedValue(undefined);
		mocks.onConflictDoNothing.mockResolvedValue(undefined);
		mocks.onConflictDoUpdate.mockResolvedValue(undefined);
		mocks.db.execute.mockResolvedValue(undefined);
		mocks.db.transaction.mockImplementation(async (callback) => callback(mocks.db));
		mocks.insertValues.mockReturnValue({
			onConflictDoNothing: mocks.onConflictDoNothing,
			onConflictDoUpdate: mocks.onConflictDoUpdate,
		});
		mocks.db.insert.mockReturnValue({ values: mocks.insertValues });
		mocks.deleteWhere.mockResolvedValue(undefined);
		mocks.db.delete.mockReturnValue({ where: mocks.deleteWhere });
	});

	test("first save creates and uses org key when no local metadata and no remote key", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.client.listOrganizationKeys).toHaveBeenCalledWith("org-1");
		expect(mocks.client.createOrganizationKey).toHaveBeenCalledWith("org-1");
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				provider: "scaleway",
				scalewayKeyId: "key-created",
				region: "fr-par",
			}),
		);
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-created",
			"secret-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
		expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({
					ciphertext: "ciphertext-created",
					kmsKeyId: "key-created",
					provider: "scaleway",
				}),
			}),
		);
	});

	test("rejects unusable created key and does not persist encrypted secret", async () => {
		mocks.client.createOrganizationKey.mockResolvedValue(remoteKey("key-created", "disabled"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(
			scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
		).rejects.toThrow("Created Scaleway organization key key-created is not enabled");
		expect(mocks.client.encrypt).not.toHaveBeenCalled();
		expect(mocks.onConflictDoUpdate).not.toHaveBeenCalled();
	});

	test.each([null, { state: "enabled" }])(
		"rejects created key responses without an id and does not throw a property access error",
		async (createdKey) => {
			mocks.client.createOrganizationKey.mockResolvedValue(createdKey);
			const { scalewaySecretProvider } = await import("./scaleway-provider");

			await expect(
				scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
			).rejects.toThrow("Created Scaleway organization key response did not include an id");
			expect(mocks.client.encrypt).not.toHaveBeenCalled();
			expect(mocks.onConflictDoUpdate).not.toHaveBeenCalled();
		},
	);

	test("shares same-process organization key provisioning for simultaneous first writes", async () => {
		let resolveCreatedKey: (value: { id: string; state: string }) => void = () => undefined;
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(undefined);
		mocks.client.createOrganizationKey.mockImplementation(
			() => new Promise((resolve) => {
				resolveCreatedKey = resolve;
			}),
		);
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		const firstStore = scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "first-value");
		const secondStore = scalewaySecretProvider.storeOrgSecret("org-1", "email/smtp_password", "second-value");

		await vi.waitFor(() => {
			expect(mocks.client.createOrganizationKey).toHaveBeenCalledTimes(1);
		});
		resolveCreatedKey(remoteKey("key-created"));
		await Promise.all([firstStore, secondStore]);

		expect(mocks.client.createOrganizationKey).toHaveBeenCalledTimes(1);
		expect(mocks.client.encrypt).toHaveBeenCalledTimes(2);
		expect(mocks.client.encrypt).toHaveBeenNthCalledWith(
			1,
			"key-created",
			"first-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
		expect(mocks.client.encrypt).toHaveBeenNthCalledWith(
			2,
			"key-created",
			"second-value",
			"organizationId=org-1;key=email/smtp_password;version=1",
		);
	});

	test("reuses local key metadata and verifies remote key", async () => {
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.client.getKey).toHaveBeenCalledWith("key-local");
		expect(mocks.client.listOrganizationKeys).not.toHaveBeenCalled();
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-local",
			"secret-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
	});

	test("discovers existing remote org key, persists metadata, and does not create another key", async () => {
		mocks.client.listOrganizationKeys.mockResolvedValue([
			remoteKey("key-disabled", "disabled"),
			remoteKey("key-remote"),
		]);
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ scalewayKeyId: "key-remote" }),
		);
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-remote",
			"secret-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
	});

	test("skips incompatible listed remote key and creates a compatible key", async () => {
		mocks.client.listOrganizationKeys.mockResolvedValue([incompatibleRemoteKey("key-wrong-usage")]);
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.client.createOrganizationKey).toHaveBeenCalledWith("org-1");
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ scalewayKeyId: "key-created" }),
		);
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-created",
			"secret-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
	});

	test("throws if local metadata references incompatible remote key and does not create another key", async () => {
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockResolvedValue(incompatibleRemoteKey("key-local"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(
			scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
		).rejects.toThrow("Scaleway organization key key-local is not compatible");
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).not.toHaveBeenCalled();
	});

	test("takes database provisioning lock and rechecks local metadata before remote provisioning", async () => {
		mocks.db.query.organizationSecretKey.findFirst
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(localKey);
		mocks.client.getKey.mockResolvedValue(remoteKey("key-local"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.db.execute).toHaveBeenCalledTimes(1);
		expect(mocks.db.query.organizationSecretKey.findFirst).toHaveBeenCalledTimes(2);
		expect(mocks.client.listOrganizationKeys).not.toHaveBeenCalled();
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-local",
			"secret-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
	});

	test("re-reads local key metadata after concurrent metadata insert conflict", async () => {
		mocks.db.query.organizationSecretKey.findFirst
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ ...localKey, scalewayKeyId: "key-concurrent" });
		mocks.client.listOrganizationKeys.mockResolvedValue([remoteKey("key-remote")]);
		mocks.onConflictDoNothing.mockRejectedValueOnce(
			Object.assign(new Error("duplicate key value violates unique constraint"), {
				code: "23505",
			}),
		);
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.db.query.organizationSecretKey.findFirst).toHaveBeenCalledTimes(3);
		expect(mocks.client.listOrganizationKeys).toHaveBeenCalledWith("org-1");
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({ scalewayKeyId: "key-remote" }),
		);
		expect(mocks.client.encrypt).toHaveBeenCalledWith(
			"key-concurrent",
			"secret-value",
			"organizationId=org-1;key=email/api_key;version=1",
		);
	});

	test("throws if local metadata references disabled key and does not create second active key", async () => {
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockResolvedValue(remoteKey("key-local", "disabled"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(
			scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
		).rejects.toThrow("Scaleway organization key key-local is not enabled");
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).not.toHaveBeenCalled();
	});

	test("throws if local metadata references missing key and does not create second active key", async () => {
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockRejectedValue(new Error("Scaleway Key Manager request failed with status 404"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(
			scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
		).rejects.toThrow("Configured Scaleway organization key key-local is not usable");
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
		expect(mocks.client.encrypt).not.toHaveBeenCalled();
	});

	test("getOrgSecret returns null for missing row", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(scalewaySecretProvider.getOrgSecret("org-1", "email/api_key")).resolves.toBeNull();
		expect(mocks.client.decrypt).not.toHaveBeenCalled();
	});

	test("getOrgSecret decrypts existing row with scoped associated data", async () => {
		mocks.db.query.organizationSecret.findFirst.mockResolvedValue({
			organizationId: "org-1",
			key: "email/api_key",
			provider: "scaleway",
			kmsKeyId: "key-local",
			ciphertext: "stored-ciphertext",
		});
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(scalewaySecretProvider.getOrgSecret("org-1", "email/api_key")).resolves.toBe(
			"secret-value",
		);
		expect(mocks.client.decrypt).toHaveBeenCalledWith(
			"key-local",
			"stored-ciphertext",
			"organizationId=org-1;key=email/api_key;version=1",
		);
	});

	test("delete one and delete all delete only encrypted PG rows, not Scaleway key", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.deleteOrgSecret("org-1", "email/api_key");
		await scalewaySecretProvider.deleteAllOrgSecrets("org-1");

		expect(mocks.db.delete).toHaveBeenCalledTimes(2);
		expect(mocks.db.delete).toHaveBeenCalledWith(mocks.tables.organizationSecret);
		expect(mocks.client.getKey).not.toHaveBeenCalled();
		expect(mocks.client.createOrganizationKey).not.toHaveBeenCalled();
	});

	test("store invalidates Scaleway status cache after a successful encrypted row upsert", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenCalledWith("org-1");
	});

	test("delete operations invalidate Scaleway status cache after successful deletes", async () => {
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.deleteOrgSecret("org-1", "email/api_key");
		await scalewaySecretProvider.deleteAllOrgSecrets("org-1");

		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenCalledTimes(2);
		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenNthCalledWith(1, "org-1");
		expect(mocks.invalidateSecretStoreStatusCache).toHaveBeenNthCalledWith(2, "org-1");
	});

	test("cache invalidation failure does not fail a successful store", async () => {
		mocks.invalidateSecretStoreStatusCache.mockRejectedValueOnce(new Error("redis unavailable"));
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await expect(
			scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "secret-value"),
		).resolves.toBeUndefined();
	});

	test("store upserts encrypted rows and does not log secret values", async () => {
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.encrypt.mockResolvedValue("ciphertext-sensitive");
		const { scalewaySecretProvider } = await import("./scaleway-provider");

		await scalewaySecretProvider.storeOrgSecret("org-1", "email/api_key", "plaintext-sensitive");

		expect(mocks.onConflictDoUpdate).toHaveBeenCalledTimes(1);
		const logged = [infoSpy, warnSpy, errorSpy, logSpy]
			.flatMap((spy) => spy.mock.calls)
			.flat()
			.map(String)
			.join("\n");
		expect(logged).not.toContain("plaintext-sensitive");
		expect(logged).not.toContain("ciphertext-sensitive");
		infoSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});
});
