import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const vaultSecretProvider = {
		storeOrgSecret: vi.fn(),
		getOrgSecret: vi.fn(),
		deleteOrgSecret: vi.fn(),
		deleteAllOrgSecrets: vi.fn(),
	};
	const scalewaySecretProvider = {
		storeOrgSecret: vi.fn(),
		getOrgSecret: vi.fn(),
		deleteOrgSecret: vi.fn(),
		deleteAllOrgSecrets: vi.fn(),
	};

	return {
		env: { SECRET_STORE_PROVIDER: "vault" },
		vaultSecretProvider,
		scalewaySecretProvider,
	};
});

vi.mock("@/env", () => ({
	env: mockState.env,
}));

vi.mock("./vault-provider", () => ({
	vaultSecretProvider: mockState.vaultSecretProvider,
}));

vi.mock("./scaleway-provider", () => ({
	scalewaySecretProvider: mockState.scalewaySecretProvider,
}));

describe("organization secret provider selection", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mockState.env.SECRET_STORE_PROVIDER = "vault";
	});

	test("default vault uses Vault provider for get", async () => {
		mockState.vaultSecretProvider.getOrgSecret.mockResolvedValue("stored-value");
		const { getOrgSecret } = await import("./secrets");

		const secret = await getOrgSecret("org-1", "email/api_key");

		expect(secret).toBe("stored-value");
		expect(mockState.vaultSecretProvider.getOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/api_key",
		);
		expect(mockState.scalewaySecretProvider.getOrgSecret).not.toHaveBeenCalled();
	});

	test("SECRET_STORE_PROVIDER=scaleway uses Scaleway provider for store", async () => {
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		const { storeOrgSecret } = await import("./secrets");

		await storeOrgSecret("org-1", "email/api_key", "secret-value");

		expect(mockState.scalewaySecretProvider.storeOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/api_key",
			"secret-value",
		);
		expect(mockState.vaultSecretProvider.storeOrgSecret).not.toHaveBeenCalled();
	});

	test("storeOrgSecrets sends each secret through selected provider", async () => {
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		const { storeOrgSecrets } = await import("./secrets");

		await storeOrgSecrets("org-1", {
			"email/api_key": "first-secret",
			"email/smtp_password": "second-secret",
		});

		expect(mockState.scalewaySecretProvider.storeOrgSecret).toHaveBeenCalledTimes(2);
		expect(mockState.scalewaySecretProvider.storeOrgSecret).toHaveBeenNthCalledWith(
			1,
			"org-1",
			"email/api_key",
			"first-secret",
		);
		expect(mockState.scalewaySecretProvider.storeOrgSecret).toHaveBeenNthCalledWith(
			2,
			"org-1",
			"email/smtp_password",
			"second-secret",
		);
		expect(mockState.vaultSecretProvider.storeOrgSecret).not.toHaveBeenCalled();
	});

	test("deleteOrgSecret routes through selected Scaleway provider", async () => {
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		const { deleteOrgSecret } = await import("./secrets");

		await deleteOrgSecret("org-1", "email/api_key");

		expect(mockState.scalewaySecretProvider.deleteOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/api_key",
		);
		expect(mockState.vaultSecretProvider.deleteOrgSecret).not.toHaveBeenCalled();
	});

	test("deleteAllOrgSecrets routes through selected Scaleway provider", async () => {
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		const { deleteAllOrgSecrets } = await import("./secrets");

		await deleteAllOrgSecrets("org-1");

		expect(mockState.scalewaySecretProvider.deleteAllOrgSecrets).toHaveBeenCalledWith("org-1");
		expect(mockState.vaultSecretProvider.deleteAllOrgSecrets).not.toHaveBeenCalled();
	});

	test("hasOrgSecret returns true when getOrgSecret returns a value", async () => {
		mockState.scalewaySecretProvider.getOrgSecret.mockResolvedValue("stored-value");
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		const { hasOrgSecret } = await import("./secrets");

		const hasSecret = await hasOrgSecret("org-1", "email/api_key");

		expect(hasSecret).toBe(true);
		expect(mockState.scalewaySecretProvider.getOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/api_key",
		);
		expect(mockState.vaultSecretProvider.getOrgSecret).not.toHaveBeenCalled();
	});

	test("hasOrgSecret returns false when getOrgSecret returns null", async () => {
		mockState.scalewaySecretProvider.getOrgSecret.mockResolvedValue(null);
		mockState.env.SECRET_STORE_PROVIDER = "scaleway";
		const { hasOrgSecret } = await import("./secrets");

		const hasSecret = await hasOrgSecret("org-1", "email/api_key");

		expect(hasSecret).toBe(false);
		expect(mockState.scalewaySecretProvider.getOrgSecret).toHaveBeenCalledWith(
			"org-1",
			"email/api_key",
		);
		expect(mockState.vaultSecretProvider.getOrgSecret).not.toHaveBeenCalled();
	});
});
