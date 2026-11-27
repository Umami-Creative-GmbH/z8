/**
 * HashiCorp Vault-backed organization secret provider.
 *
 * Secrets are stored at: secret/data/organizations/{orgId}/{key}
 */

import { createLogger } from "@/lib/logger";
import { initVaultSecrets, isVaultAvailable, vaultClient } from "./client";
import { SecretStoreUnavailableError } from "./errors";
import type { OrganizationSecretProvider } from "./types";

const logger = createLogger("VaultSecrets");

// Base paths for organization secrets
const ORG_SECRETS_DATA_PATH = "secret/data/organizations";
const ORG_SECRETS_METADATA_PATH = "secret/metadata/organizations";

function isVaultNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}
	const statusCode = (error as { response?: { statusCode?: number } }).response?.statusCode;
	if (statusCode === 404) {
		return true;
	}
	return error instanceof Error && error.message.includes("404");
}

function unavailableError(
	operation: "read" | "write" | "delete" | "list",
	message: string,
	cause?: unknown,
): SecretStoreUnavailableError {
	return new SecretStoreUnavailableError(message, {
		provider: "vault",
		operation,
		cause,
	});
}

async function deletePrefixRecursively(
	organizationId: string,
	relativePrefix: string,
	failedKeys: string[],
): Promise<void> {
	const cleanPrefix = relativePrefix.replace(/^\/+|\/+$/g, "");
	const listPath = cleanPrefix
		? `${ORG_SECRETS_METADATA_PATH}/${organizationId}/${cleanPrefix}`
		: `${ORG_SECRETS_METADATA_PATH}/${organizationId}`;

	let result: { data?: { keys?: string[] } } | undefined;
	try {
		result = await vaultClient.list(listPath);
	} catch (error: unknown) {
		if (isVaultNotFoundError(error)) {
			return;
		}
		throw unavailableError(
			"list",
			`Failed to list organization secrets in Vault: ${error instanceof Error ? error.message : "Unknown error"}`,
			error,
		);
	}

	const entries = (result?.data?.keys || []) as string[];
	for (const entry of entries) {
		const isFolder = entry.endsWith("/");
		const entryName = entry.replace(/\/+$/, "");
		const childRelativePath = cleanPrefix ? `${cleanPrefix}/${entryName}` : entryName;

		if (isFolder) {
			await deletePrefixRecursively(organizationId, childRelativePath, failedKeys);
			continue;
		}

		const leafMetadataPath = `${ORG_SECRETS_METADATA_PATH}/${organizationId}/${childRelativePath}`;
		try {
			await vaultClient.delete(leafMetadataPath);
		} catch (error: unknown) {
			if (isVaultNotFoundError(error)) {
				continue;
			}
			logger.warn(
				{ error, organizationId, key: childRelativePath },
				"Failed to delete individual organization secret from Vault",
			);
			failedKeys.push(childRelativePath);
		}
	}
}

export const vaultSecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret(organizationId, key, value) {
		if (!(await isVaultAvailable())) {
			throw unavailableError(
				"write",
				"Vault is not available. Please ensure Vault is running and configured.",
			);
		}

		try {
			await initVaultSecrets();
		} catch (error: unknown) {
			throw unavailableError(
				"write",
				`Failed to initialize Vault: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}

		const path = `${ORG_SECRETS_DATA_PATH}/${organizationId}/${key}`;

		try {
			await vaultClient.write(path, { data: { value } });
			logger.info({ organizationId, key }, "Stored organization secret");
		} catch (error: unknown) {
			logger.error({ error, organizationId, key }, "Failed to store organization secret");
			throw unavailableError(
				"write",
				`Failed to store secret: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}
	},

	async getOrgSecret(organizationId, key) {
		if (!(await isVaultAvailable())) {
			logger.warn({ organizationId, key }, "Vault is unavailable while reading secret");
			throw unavailableError("read", "Vault is not available.");
		}

		try {
			await initVaultSecrets();
		} catch (error: unknown) {
			throw unavailableError(
				"read",
				`Failed to initialize Vault: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}

		const path = `${ORG_SECRETS_DATA_PATH}/${organizationId}/${key}`;

		try {
			const result = await vaultClient.read(path);
			const value = result?.data?.data?.value;
			return typeof value === "string" ? value : null;
		} catch (error: unknown) {
			// 404 means Vault confirmed the secret does not exist
			if (isVaultNotFoundError(error)) {
				return null;
			}
			logger.error({ error, organizationId, key }, "Failed to retrieve organization secret");
			throw unavailableError(
				"read",
				`Failed to retrieve secret: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}
	},

	async deleteOrgSecret(organizationId, key) {
		if (!(await isVaultAvailable())) {
			logger.warn({ organizationId, key }, "Vault is unavailable while deleting secret");
			throw unavailableError("delete", "Vault is not available.");
		}

		try {
			await initVaultSecrets();
		} catch (error: unknown) {
			throw unavailableError(
				"delete",
				`Failed to initialize Vault: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}

		// For KV v2, use the metadata path for permanent deletion
		const metadataPath = `${ORG_SECRETS_METADATA_PATH}/${organizationId}/${key}`;

		try {
			await vaultClient.delete(metadataPath);
			logger.info({ organizationId, key }, "Deleted organization secret");
		} catch (error: unknown) {
			// Ignore 404 errors (secret doesn't exist)
			if (isVaultNotFoundError(error)) {
				return;
			}
			logger.error({ error, organizationId, key }, "Failed to delete organization secret");
			throw unavailableError(
				"delete",
				`Failed to delete secret: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}
	},

	async deleteAllOrgSecrets(organizationId) {
		if (!(await isVaultAvailable())) {
			logger.warn(
				{ organizationId },
				"Vault is unavailable while deleting all organization secrets",
			);
			throw unavailableError("delete", "Vault is not available.");
		}

		try {
			await initVaultSecrets();
		} catch (error: unknown) {
			throw unavailableError(
				"delete",
				`Failed to initialize Vault: ${error instanceof Error ? error.message : "Unknown error"}`,
				error,
			);
		}

		const failedKeys: string[] = [];
		await deletePrefixRecursively(organizationId, "", failedKeys);

		if (failedKeys.length > 0) {
			throw unavailableError(
				"delete",
				`Failed to delete ${failedKeys.length} organization secret(s) from Vault`,
			);
		}

		logger.info({ organizationId }, "Deleted all organization secrets");
	},
};
