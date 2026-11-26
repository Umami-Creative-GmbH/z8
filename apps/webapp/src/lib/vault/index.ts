/**
 * Vault module exports
 */

export { getVaultStatus, initVaultSecrets, isVaultAvailable, vaultClient } from "./client";

export {
	isSecretNotFoundError,
	isSecretStoreUnavailableError,
	SecretNotFoundError,
	type SecretStoreOperation,
	type SecretStoreProviderKind,
	SecretStoreUnavailableError,
} from "./errors";

export {
	deleteAllOrgSecrets,
	deleteOrgSecret,
	getActiveSecretStoreProvider,
	getOrgSecret,
	getRequiredOrgSecret,
	hasOrgSecret,
	storeOrgSecret,
	storeOrgSecrets,
} from "./secrets";
export type { SecretStoreStatus } from "./status";
export { getSecretStoreStatus, invalidateSecretStoreStatusCache } from "./status";
