/**
 * Organization Secrets Service
 *
 * Selects the configured organization secret provider while preserving the
 * public secret helper API used throughout the application.
 */

import { env } from "@/env";
import { scalewaySecretProvider } from "./scaleway-provider";
import type { OrganizationSecretProvider } from "./types";
import { vaultSecretProvider } from "./vault-provider";

function getSecretProvider(): OrganizationSecretProvider {
	return env.SECRET_STORE_PROVIDER === "scaleway" ? scalewaySecretProvider : vaultSecretProvider;
}

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
	await getSecretProvider().storeOrgSecret(organizationId, key, value);
}

/**
 * Retrieve a secret for an organization
 *
 * @param organizationId - The organization ID
 * @param key - The secret key
 * @returns The secret value or null if not found
 */
export async function getOrgSecret(organizationId: string, key: string): Promise<string | null> {
	return getSecretProvider().getOrgSecret(organizationId, key);
}

/**
 * Delete a secret for an organization
 *
 * @param organizationId - The organization ID
 * @param key - The secret key
 */
export async function deleteOrgSecret(organizationId: string, key: string): Promise<void> {
	await getSecretProvider().deleteOrgSecret(organizationId, key);
}

/**
 * Delete all secrets for an organization
 * Used when an organization is deleted
 *
 * @param organizationId - The organization ID
 */
export async function deleteAllOrgSecrets(organizationId: string): Promise<void> {
	await getSecretProvider().deleteAllOrgSecrets(organizationId);
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
	// Store each secret sequentially because providers may not support atomic multi-write.
	for (const [key, value] of Object.entries(secrets)) {
		await storeOrgSecret(organizationId, key, value);
	}
}
