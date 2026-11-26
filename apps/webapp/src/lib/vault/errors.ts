export type SecretStoreProviderKind = "vault" | "scaleway";
export type SecretStoreOperation = "read" | "write" | "delete" | "list" | "provision";

/**
 * Thrown when the configured secret store (HashiCorp Vault or Scaleway Key Manager / DB)
 * cannot be reached or fails an operation. Always distinct from a confirmed missing secret.
 */
export class SecretStoreUnavailableError extends Error {
	readonly code = "SECRET_STORE_UNAVAILABLE" as const;
	readonly provider: SecretStoreProviderKind;
	readonly operation: SecretStoreOperation;

	constructor(
		message: string,
		options: {
			provider: SecretStoreProviderKind;
			operation: SecretStoreOperation;
			cause?: unknown;
		},
	) {
		super(message, { cause: options.cause });
		this.name = "SecretStoreUnavailableError";
		this.provider = options.provider;
		this.operation = options.operation;
	}
}

/**
 * Thrown when the secret store is reachable and confirms that the requested secret does not exist.
 */
export class SecretNotFoundError extends Error {
	readonly code = "SECRET_NOT_FOUND" as const;
	readonly provider: SecretStoreProviderKind;
	readonly key: string;

	constructor(
		message: string,
		options: {
			provider: SecretStoreProviderKind;
			key: string;
		},
	) {
		super(message);
		this.name = "SecretNotFoundError";
		this.provider = options.provider;
		this.key = options.key;
	}
}

export function isSecretStoreUnavailableError(
	error: unknown,
): error is SecretStoreUnavailableError {
	return error instanceof SecretStoreUnavailableError;
}

export function isSecretNotFoundError(error: unknown): error is SecretNotFoundError {
	return error instanceof SecretNotFoundError;
}
