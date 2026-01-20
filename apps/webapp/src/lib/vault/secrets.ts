/**
 * Organization Secrets Service
 *
 * Manages organization-specific secrets in HashiCorp Vault.
 * Secrets are stored at: secret/data/organizations/{orgId}/{key}
 *
 * Example paths:
 * - Email secrets:
 *   - secret/data/organizations/org_123/email/resend_api_key
 *   - secret/data/organizations/org_123/email/smtp_password
 *
 * - S3 Export Storage secrets:
 *   - secret/data/organizations/org_123/storage/access_key_id
 *   - secret/data/organizations/org_123/storage/secret_access_key
 *
 * - SSO Provider secrets:
 *   - secret/data/organizations/org_123/sso/{providerId}/client_secret
 */

import { createLogger } from "@/lib/logger";
import { initVaultSecrets, isVaultAvailable, vaultClient } from "./client";

const logger = createLogger("VaultSecrets");

// Base path for organization secrets
const ORG_SECRETS_PATH = "secret/data/organizations";

/**
 * Store a secret for an organization
 *
 * @param organizationId - The organization ID
 * @param key - The secret key (e.g., 'email/resend_api_key', 'email/smtp_password')
 * @param value - The secret value
 */
export async function storeOrgSecret(
	organizationId: string,
	key: string,
	value: string,
): Promise<void> {
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
		throw new Error(`Failed to store secret: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/**
 * Retrieve a secret for an organization
 *
 * @param organizationId - The organization ID
 * @param key - The secret key
 * @returns The secret value or null if not found
 */
export async function getOrgSecret(organizationId: string, key: string): Promise<string | null> {
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
		throw new Error(`Failed to retrieve secret: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/**
 * Delete a secret for an organization
 *
 * @param organizationId - The organization ID
 * @param key - The secret key
 */
export async function deleteOrgSecret(organizationId: string, key: string): Promise<void> {
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
		throw new Error(`Failed to delete secret: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/**
 * Delete all secrets for an organization
 * Used when an organization is deleted
 *
 * @param organizationId - The organization ID
 */
export async function deleteAllOrgSecrets(organizationId: string): Promise<void> {
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
		throw new Error(`Failed to delete secrets: ${error instanceof Error ? error.message : "Unknown error"}`);
	}
}

/**
 * Check if an organization has a specific secret stored
 *
 * @param organizationId - The organization ID
 * @param key - The secret key
 * @returns True if the secret exists
 */
export async function hasOrgSecret(organizationId: string, key: string): Promise<boolean> {
	const secret = await getOrgSecret(organizationId, key);
	return secret !== null;
}

/**
 * Store multiple secrets for an organization atomically
 *
 * @param organizationId - The organization ID
 * @param secrets - Object mapping keys to values
 */
export async function storeOrgSecrets(
	organizationId: string,
	secrets: Record<string, string>,
): Promise<void> {
	// Store each secret (Vault doesn't support atomic multi-write, so we do it sequentially)
	for (const [key, value] of Object.entries(secrets)) {
		await storeOrgSecret(organizationId, key, value);
	}
}
