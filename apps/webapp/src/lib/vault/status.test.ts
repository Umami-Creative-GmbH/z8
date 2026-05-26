import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: { SECRET_STORE_PROVIDER: "vault" },
	db: {
		query: {
			organizationSecretKey: { findFirst: vi.fn() },
		},
	},
	drizzle: {
		and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		isNull: vi.fn((value: unknown) => ({ isNull: value })),
	},
	tables: {
		organizationSecretKey: {
			organizationId: "organizationSecretKey.organizationId",
			provider: "organizationSecretKey.provider",
			disabledAt: "organizationSecretKey.disabledAt",
			scalewayKeyId: "organizationSecretKey.scalewayKeyId",
		},
	},
	vault: {
		getVaultStatus: vi.fn(),
	},
	redis: {
		get: vi.fn(),
		set: vi.fn(),
		delete: vi.fn(),
	},
	clientConstructor: vi.fn(),
	client: {
		getKey: vi.fn(),
	},
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/db/schema", () => mocks.tables);
vi.mock("drizzle-orm", () => mocks.drizzle);
vi.mock("@/lib/redis", () => ({ secondaryStorage: mocks.redis }));
vi.mock("./client", () => ({ getVaultStatus: mocks.vault.getVaultStatus }));
vi.mock("./scaleway-key-manager-client", () => ({
	ScalewayKeyManagerClient: mocks.clientConstructor,
}));

const localKey = {
	organizationId: "org-1",
	provider: "scaleway",
	scalewayKeyId: "key-local",
	region: "fr-par",
	disabledAt: null,
};

const compatibleRemoteKey = {
	id: "key-local",
	state: "enabled",
	usage: { symmetric_encryption: "aes_256_gcm" },
	tags: ["z8-customer-secrets", "z8-org:org-1"],
};

describe("secret store status", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.env.SECRET_STORE_PROVIDER = "vault";
		mocks.vault.getVaultStatus.mockResolvedValue({
			available: true,
			initialized: true,
			sealed: false,
			address: "http://vault.test:8200",
		});
		mocks.redis.get.mockResolvedValue(null);
		mocks.redis.set.mockResolvedValue(undefined);
		mocks.redis.delete.mockResolvedValue(undefined);
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(undefined);
		mocks.client.getKey.mockResolvedValue(compatibleRemoteKey);
		mocks.clientConstructor.mockImplementation(
			class {
				getKey = mocks.client.getKey;
			},
		);
	});

	test("vault mode maps the existing Vault status", async () => {
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "vault",
			available: true,
			initialized: true,
			sealed: false,
			address: "http://vault.test:8200",
			reason: "available",
		});
		expect(mocks.vault.getVaultStatus).toHaveBeenCalledTimes(1);
		expect(mocks.redis.get).not.toHaveBeenCalled();
	});

	test("vault mode preserves raw availability when Vault is sealed", async () => {
		mocks.vault.getVaultStatus.mockResolvedValue({
			available: true,
			initialized: true,
			sealed: true,
			address: "http://vault.test:8200",
		});
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "vault",
			available: true,
			initialized: true,
			sealed: true,
			address: "http://vault.test:8200",
			reason: "sealed",
		});
	});

	test("scaleway mode returns unavailable when no organization key metadata exists", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: false,
			reason: "missing-key",
		});
		expect(mocks.client.getKey).not.toHaveBeenCalled();
		expect(mocks.redis.set).toHaveBeenCalledWith(
			"secret-store-status:scaleway:org-1",
			JSON.stringify({ provider: "scaleway", available: false, reason: "missing-key" }),
			86400,
		);
	});

	test("scaleway mode returns available when the local key is remotely compatible", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: true,
			reason: "available",
			scalewayKeyId: "key-local",
		});
		expect(mocks.client.getKey).toHaveBeenCalledWith("key-local");
	});

	test("scaleway mode returns unavailable when the remote key is incompatible", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockResolvedValue({
			...compatibleRemoteKey,
			usage: { symmetric_encryption: "aes_128_gcm" },
		});
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: false,
			reason: "invalid-key",
			scalewayKeyId: "key-local",
		});
	});

	test("scaleway mode returns unavailable when Key Manager lookup fails", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		mocks.client.getKey.mockRejectedValue(new Error("not found"));
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: false,
			reason: "unreachable",
			scalewayKeyId: "key-local",
		});
	});

	test("scaleway mode uses cached status without database or Key Manager calls", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.redis.get.mockResolvedValue(
			JSON.stringify({
				provider: "scaleway",
				available: true,
				reason: "available",
				scalewayKeyId: "key-cached",
			}),
		);
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toEqual({
			provider: "scaleway",
			available: true,
			reason: "available",
			scalewayKeyId: "key-cached",
		});
		expect(mocks.db.query.organizationSecretKey.findFirst).not.toHaveBeenCalled();
		expect(mocks.client.getKey).not.toHaveBeenCalled();
	});

	test("invalid cached JSON falls back to a live Scaleway check", async () => {
		mocks.env.SECRET_STORE_PROVIDER = "scaleway";
		mocks.redis.get.mockResolvedValue("not-json");
		mocks.db.query.organizationSecretKey.findFirst.mockResolvedValue(localKey);
		const { getSecretStoreStatus } = await import("./status");

		await expect(getSecretStoreStatus("org-1")).resolves.toMatchObject({
			provider: "scaleway",
			available: true,
			reason: "available",
		});
		expect(mocks.client.getKey).toHaveBeenCalledWith("key-local");
	});

	test("cache invalidation deletes the organization scoped Scaleway status key", async () => {
		const { invalidateSecretStoreStatusCache } = await import("./status");

		await invalidateSecretStoreStatusCache("org-1");

		expect(mocks.redis.delete).toHaveBeenCalledWith("secret-store-status:scaleway:org-1");
	});
});
