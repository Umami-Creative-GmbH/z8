import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	isVaultAvailable: vi.fn(),
	initVaultSecrets: vi.fn(),
	vaultClient: {
		write: vi.fn(),
		read: vi.fn(),
		delete: vi.fn(),
		list: vi.fn(),
	},
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("./client", () => ({
	isVaultAvailable: mocks.isVaultAvailable,
	initVaultSecrets: mocks.initVaultSecrets,
	vaultClient: mocks.vaultClient,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mocks.logger,
}));

import { SecretStoreUnavailableError } from "./errors";
import { vaultSecretProvider } from "./vault-provider";

describe("vaultSecretProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isVaultAvailable.mockResolvedValue(true);
		mocks.initVaultSecrets.mockResolvedValue(undefined);
		mocks.vaultClient.write.mockResolvedValue(undefined);
		mocks.vaultClient.read.mockResolvedValue({ data: { data: { value: "secret-value" } } });
		mocks.vaultClient.delete.mockResolvedValue(undefined);
		mocks.vaultClient.list.mockResolvedValue({ data: { keys: [] } });
	});

	test("getOrgSecret returns null when Vault confirms secret is missing (404)", async () => {
		mocks.vaultClient.read.mockRejectedValueOnce(new Error("Status 404"));

		await expect(vaultSecretProvider.getOrgSecret("org-1", "slack/bot_token")).resolves.toBeNull();
	});

	test("getOrgSecret throws SecretStoreUnavailableError when Vault is unavailable", async () => {
		mocks.isVaultAvailable.mockResolvedValueOnce(false);

		await expect(
			vaultSecretProvider.getOrgSecret("org-1", "slack/bot_token"),
		).rejects.toBeInstanceOf(SecretStoreUnavailableError);
		expect(mocks.vaultClient.read).not.toHaveBeenCalled();
	});

	test("getOrgSecret throws SecretStoreUnavailableError on non-404 Vault outage", async () => {
		mocks.vaultClient.read.mockRejectedValueOnce(new Error("Status 503 sealed"));

		await expect(
			vaultSecretProvider.getOrgSecret("org-1", "slack/bot_token"),
		).rejects.toBeInstanceOf(SecretStoreUnavailableError);
	});

	test("storeOrgSecret throws SecretStoreUnavailableError when Vault is unavailable", async () => {
		mocks.isVaultAvailable.mockResolvedValueOnce(false);

		await expect(
			vaultSecretProvider.storeOrgSecret("org-1", "slack/bot_token", "xoxb-secret"),
		).rejects.toBeInstanceOf(SecretStoreUnavailableError);
		expect(mocks.vaultClient.write).not.toHaveBeenCalled();
	});

	test("deleteOrgSecret throws SecretStoreUnavailableError when Vault is unavailable instead of returning silently", async () => {
		mocks.isVaultAvailable.mockResolvedValueOnce(false);

		await expect(
			vaultSecretProvider.deleteOrgSecret("org-1", "slack/bot_token"),
		).rejects.toBeInstanceOf(SecretStoreUnavailableError);
		expect(mocks.vaultClient.delete).not.toHaveBeenCalled();
	});

	test("deleteOrgSecret treats 404 as already absent", async () => {
		mocks.vaultClient.delete.mockRejectedValueOnce(new Error("Status 404"));

		await expect(
			vaultSecretProvider.deleteOrgSecret("org-1", "slack/bot_token"),
		).resolves.toBeUndefined();
	});

	test("deleteAllOrgSecrets throws SecretStoreUnavailableError when Vault is unavailable", async () => {
		mocks.isVaultAvailable.mockResolvedValueOnce(false);

		await expect(vaultSecretProvider.deleteAllOrgSecrets("org-1")).rejects.toBeInstanceOf(
			SecretStoreUnavailableError,
		);
		expect(mocks.vaultClient.list).not.toHaveBeenCalled();
	});

	test("deleteAllOrgSecrets recursively traverses nested prefixes and deletes every leaf secret", async () => {
		mocks.vaultClient.list.mockImplementation(async (path: string) => {
			if (path === "secret/metadata/organizations/org-1") {
				return { data: { keys: ["email/", "chat/", "top_level"] } };
			}
			if (path === "secret/metadata/organizations/org-1/email") {
				return { data: { keys: ["resend_api_key"] } };
			}
			if (path === "secret/metadata/organizations/org-1/chat") {
				return { data: { keys: ["slack/"] } };
			}
			if (path === "secret/metadata/organizations/org-1/chat/slack") {
				return { data: { keys: ["installations/"] } };
			}
			if (path === "secret/metadata/organizations/org-1/chat/slack/installations") {
				return { data: { keys: ["inst-1/"] } };
			}
			if (path === "secret/metadata/organizations/org-1/chat/slack/installations/inst-1") {
				return { data: { keys: ["revisions/"] } };
			}
			if (
				path === "secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions"
			) {
				return { data: { keys: ["v1/"] } };
			}
			if (
				path === "secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions/v1"
			) {
				return { data: { keys: ["bot_token", "signing_secret"] } };
			}
			throw new Error("Status 404");
		});

		await vaultSecretProvider.deleteAllOrgSecrets("org-1");

		expect(mocks.vaultClient.delete).toHaveBeenCalledWith(
			"secret/metadata/organizations/org-1/top_level",
		);
		expect(mocks.vaultClient.delete).toHaveBeenCalledWith(
			"secret/metadata/organizations/org-1/email/resend_api_key",
		);
		expect(mocks.vaultClient.delete).toHaveBeenCalledWith(
			"secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions/v1/bot_token",
		);
		expect(mocks.vaultClient.delete).toHaveBeenCalledWith(
			"secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions/v1/signing_secret",
		);
	});

	test("deleteAllOrgSecrets throws SecretStoreUnavailableError when a nested secret deletion fails so cleanup stays retryable", async () => {
		mocks.vaultClient.list.mockImplementation(async (path: string) => {
			if (path === "secret/metadata/organizations/org-1") {
				return { data: { keys: ["slack/"] } };
			}
			if (path === "secret/metadata/organizations/org-1/slack") {
				return { data: { keys: ["bot_token", "signing_secret"] } };
			}
			throw new Error("Status 404");
		});
		mocks.vaultClient.delete.mockImplementation(async (path: string) => {
			if (path.endsWith("/signing_secret")) {
				throw new Error("Status 503 Vault sealed");
			}
		});

		await expect(vaultSecretProvider.deleteAllOrgSecrets("org-1")).rejects.toBeInstanceOf(
			SecretStoreUnavailableError,
		);
		expect(mocks.vaultClient.delete).toHaveBeenCalledWith(
			"secret/metadata/organizations/org-1/slack/bot_token",
		);
	});

	test("keeps revisioned secrets isolated across organizations and never leaks secret values in logs (#2046)", async () => {
		await vaultSecretProvider.storeOrgSecret(
			"org-1",
			"chat/slack/installations/inst-1/revisions/v1/bot_token",
			"xoxb-org1-v1-supersecret",
		);
		await vaultSecretProvider.storeOrgSecret(
			"org-1",
			"chat/slack/installations/inst-1/revisions/v2/bot_token",
			"xoxb-org1-v2-supersecret",
		);
		await vaultSecretProvider.storeOrgSecret(
			"org-2",
			"chat/slack/installations/inst-1/revisions/v1/bot_token",
			"xoxb-org2-v1-supersecret",
		);

		expect(mocks.vaultClient.write).toHaveBeenCalledWith(
			"secret/data/organizations/org-1/chat/slack/installations/inst-1/revisions/v1/bot_token",
			{ data: { value: "xoxb-org1-v1-supersecret" } },
		);
		expect(mocks.vaultClient.write).toHaveBeenCalledWith(
			"secret/data/organizations/org-1/chat/slack/installations/inst-1/revisions/v2/bot_token",
			{ data: { value: "xoxb-org1-v2-supersecret" } },
		);
		expect(mocks.vaultClient.write).toHaveBeenCalledWith(
			"secret/data/organizations/org-2/chat/slack/installations/inst-1/revisions/v1/bot_token",
			{ data: { value: "xoxb-org2-v1-supersecret" } },
		);

		// Deleting org-1 secrets only lists and deletes under org-1 prefix, never org-2
		mocks.vaultClient.list.mockImplementation(async (path: string) => {
			if (path === "secret/metadata/organizations/org-1") return { data: { keys: ["chat/"] } };
			if (path === "secret/metadata/organizations/org-1/chat")
				return { data: { keys: ["slack/"] } };
			if (path === "secret/metadata/organizations/org-1/chat/slack") {
				return { data: { keys: ["installations/"] } };
			}
			if (path === "secret/metadata/organizations/org-1/chat/slack/installations") {
				return { data: { keys: ["inst-1/"] } };
			}
			if (path === "secret/metadata/organizations/org-1/chat/slack/installations/inst-1") {
				return { data: { keys: ["revisions/"] } };
			}
			if (
				path === "secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions"
			) {
				return { data: { keys: ["v1/", "v2/"] } };
			}
			if (path.endsWith("/v1") || path.endsWith("/v2")) {
				return { data: { keys: ["bot_token", "signing_secret"] } };
			}
			throw new Error("Status 404");
		});

		await vaultSecretProvider.deleteAllOrgSecrets("org-1");

		const deletedPaths = mocks.vaultClient.delete.mock.calls.map(([p]) => String(p));
		expect(deletedPaths.every((p) => p.includes("/organizations/org-1/"))).toBe(true);
		expect(deletedPaths.some((p) => p.includes("/organizations/org-2/"))).toBe(false);
		expect(deletedPaths).toContain(
			"secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions/v1/bot_token",
		);
		expect(deletedPaths).toContain(
			"secret/metadata/organizations/org-1/chat/slack/installations/inst-1/revisions/v2/signing_secret",
		);

		const serializedLogs = JSON.stringify([
			...mocks.logger.info.mock.calls,
			...mocks.logger.warn.mock.calls,
			...mocks.logger.error.mock.calls,
		]);
		expect(serializedLogs).not.toContain("xoxb-org1-v1-supersecret");
		expect(serializedLogs).not.toContain("xoxb-org1-v2-supersecret");
		expect(serializedLogs).not.toContain("xoxb-org2-v1-supersecret");
	});
});
