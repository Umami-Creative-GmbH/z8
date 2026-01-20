/**
 * HashiCorp Vault Client
 *
 * Provides a configured Vault client for secrets management.
 * In dev mode, Vault auto-unseals with the root token.
 * For production, use AppRole auth or other secure methods.
 */

import Vault from "node-vault";
import { createLogger } from "@/lib/logger";

const logger = createLogger("VaultClient");

// Vault configuration from environment
const VAULT_ADDR = process.env.VAULT_ADDR || "http://localhost:8200";
const VAULT_TOKEN = process.env.VAULT_TOKEN;

// Create Vault client instance
export const vaultClient = Vault({
	endpoint: VAULT_ADDR,
	token: VAULT_TOKEN,
});

// Track initialization state
let isInitialized = false;
let initializationPromise: Promise<void> | null = null;

/**
 * Initialize Vault secrets engine for organization secrets
 * Enables KV v2 secrets engine at 'secret/organizations' path
 */
export async function initVaultSecrets(): Promise<void> {
	// Return existing promise if already initializing
	if (initializationPromise) {
		return initializationPromise;
	}

	// Skip if already initialized
	if (isInitialized) {
		return;
	}

	initializationPromise = (async () => {
		try {
			if (!VAULT_TOKEN) {
				logger.warn("VAULT_TOKEN not set - Vault integration disabled");
				return;
			}

			// Check if Vault is healthy
			const health = await vaultClient.health();
			if (!health.initialized) {
				logger.warn("Vault is not initialized");
				return;
			}

			// Check if KV secrets engine is already mounted at 'secret/'
			// In dev mode, this is already enabled by default
			const mounts = await vaultClient.mounts();
			if (!mounts.data || !mounts.data["secret/"]) {
				// Enable KV v2 secrets engine
				try {
					await vaultClient.mount({
						mount_point: "secret",
						type: "kv",
						options: { version: "2" },
					});
					logger.info("Enabled KV v2 secrets engine at 'secret/'");
				} catch (error: unknown) {
					// Mount might already exist in dev mode
					if (error instanceof Error && error.message?.includes("path is already in use")) {
						logger.debug("KV secrets engine already mounted at 'secret/'");
					} else {
						throw error;
					}
				}
			}

			isInitialized = true;
			logger.info("Vault secrets engine initialized successfully");
		} catch (error) {
			logger.error({ error }, "Failed to initialize Vault secrets engine");
			throw error;
		} finally {
			initializationPromise = null;
		}
	})();

	return initializationPromise;
}

/**
 * Check if Vault is available and configured
 */
export async function isVaultAvailable(): Promise<boolean> {
	if (!VAULT_TOKEN) {
		return false;
	}

	try {
		const health = await vaultClient.health();
		return health.initialized && !health.sealed;
	} catch {
		return false;
	}
}

/**
 * Get Vault connection status for UI display
 */
export async function getVaultStatus(): Promise<{
	available: boolean;
	initialized: boolean;
	sealed: boolean;
	address: string;
}> {
	try {
		if (!VAULT_TOKEN) {
			return {
				available: false,
				initialized: false,
				sealed: true,
				address: VAULT_ADDR,
			};
		}

		const health = await vaultClient.health();
		return {
			available: true,
			initialized: health.initialized ?? false,
			sealed: health.sealed ?? true,
			address: VAULT_ADDR,
		};
	} catch {
		return {
			available: false,
			initialized: false,
			sealed: true,
			address: VAULT_ADDR,
		};
	}
}
