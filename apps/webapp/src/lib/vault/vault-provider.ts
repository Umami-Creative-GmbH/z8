/**
 * HashiCorp Vault-backed organization secret provider.
 *
 * Secrets are stored at: secret/data/organizations/{orgId}/{key}
 */

import { createLogger } from "@/lib/logger";
import { initVaultSecrets, isVaultAvailable, vaultClient } from "./client";
import type { OrganizationSecretProvider } from "./types";

const logger = createLogger("VaultSecrets");

// Base path for organization secrets
const ORG_SECRETS_PATH = "secret/data/organizations";

export const vaultSecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret(organizationId, key, value) {
		if (!(await isVaultAvailable())) {
			throw new Error("Vault is not available. Please ensure Vault is running and configured.");
		}

		await initVaultSecrets();

		const path = `${ORG_SECRETS_PATH}/${organizationId}/${key}`;

		try {
			await vaultClient.write(path, { data: { value } });
			logger.info({ organizationId, key }, "Stored organization secret");
		} catch (error) {
			logger.error({ error, organizationId, key }, "Failed to store organization secret");
			throw new Error(
				`Failed to store secret: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	},

	async getOrgSecret(organizationId, key) {
		if (!(await isVaultAvailable())) {
			logger.warn("Vault not available, returning null for secret");
			return null;
		}

		await initVaultSecrets();

		const path = `${ORG_SECRETS_PATH}/${organizationId}/${key}`;

		try {
			const result = await vaultClient.read(path);
			return result?.data?.data?.value ?? null;
		} catch (error: unknown) {
			// 404 means secret doesn't exist
			if (error instanceof Error && error.message?.includes("404")) {
				return null;
			}
			logger.error({ error, organizationId, key }, "Failed to retrieve organization secret");
			throw new Error(
				`Failed to retrieve secret: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	},

	async deleteOrgSecret(organizationId, key) {
		if (!(await isVaultAvailable())) {
			logger.warn("Vault not available, skipping secret deletion");
			return;
		}

		await initVaultSecrets();

		// For KV v2, we need to use the metadata path for permanent deletion
		const metadataPath = `secret/metadata/organizations/${organizationId}/${key}`;

		try {
			await vaultClient.delete(metadataPath);
			logger.info({ organizationId, key }, "Deleted organization secret");
		} catch (error: unknown) {
			// Ignore 404 errors (secret doesn't exist)
			if (error instanceof Error && error.message?.includes("404")) {
				return;
			}
			logger.error({ error, organizationId, key }, "Failed to delete organization secret");
			throw new Error(
				`Failed to delete secret: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	},

	async deleteAllOrgSecrets(organizationId) {
		if (!(await isVaultAvailable())) {
			logger.warn("Vault not available, skipping all secrets deletion");
			return;
		}

		await initVaultSecrets();

		const metadataPath = `secret/metadata/organizations/${organizationId}`;

		try {
			// List all secrets under the organization path
			const listPath = metadataPath;
			const result = await vaultClient.list(listPath);
			const keys = result?.data?.keys || [];

			// Delete each secret
			for (const key of keys) {
				const secretPath = `${metadataPath}/${key}`;
				try {
					await vaultClient.delete(secretPath);
				} catch {
					// Continue deleting other secrets even if one fails
					logger.warn({ organizationId, key }, "Failed to delete individual secret");
				}
			}

			// Delete the organization folder itself
			try {
				await vaultClient.delete(metadataPath);
			} catch {
				// Folder might already be empty/deleted
			}

			logger.info({ organizationId }, "Deleted all organization secrets");
		} catch (error: unknown) {
			// Ignore 404 errors (no secrets exist)
			if (error instanceof Error && error.message?.includes("404")) {
				return;
			}
			logger.error({ error, organizationId }, "Failed to delete all organization secrets");
			throw new Error(
				`Failed to delete secrets: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}
	},
};
