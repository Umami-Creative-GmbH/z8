import { and, desc, eq } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import {
	type ChatCredentialRevisionStatus,
	type ChatInstallationProvider,
	chatInstallation,
	chatInstallationCredentialRevision,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
	deleteOrgSecret,
	getActiveSecretStoreProvider,
	getOrgSecret,
	isSecretStoreUnavailableError,
	type SecretStoreProviderKind,
	storeOrgSecret,
} from "@/lib/vault";
import type { ChatInstallationsDb } from "./types";

const logger = createLogger("ChatCredentialRevisions");

export type CredentialRevisionRecord = typeof chatInstallationCredentialRevision.$inferSelect;

export interface CredentialRevisionRepository {
	getLatestRevisionNumber(organizationId: string, installationId: string): Promise<number>;
	insertRevision(
		input: Omit<CredentialRevisionRecord, "id" | "createdAt">,
	): Promise<CredentialRevisionRecord>;
	findRevision(
		organizationId: string,
		installationId: string,
		revisionId: string,
	): Promise<CredentialRevisionRecord | null>;
	getActiveRevisionId(organizationId: string, installationId: string): Promise<string | null>;
	updateRevisionStatus(
		organizationId: string,
		installationId: string,
		revisionId: string,
		status: ChatCredentialRevisionStatus,
	): Promise<void>;
}

export interface CredentialRevisionRuntimeDeps {
	db?: ChatInstallationsDb;
	repository?: CredentialRevisionRepository;
	storeSecret?: (organizationId: string, key: string, value: string) => Promise<void>;
	readSecret?: (organizationId: string, key: string) => Promise<string | null>;
	deleteSecret?: (organizationId: string, key: string) => Promise<void>;
	secretStoreProvider?: SecretStoreProviderKind;
}

export function buildCredentialRevisionPrefix(
	provider: ChatInstallationProvider,
	installationId: string,
	revisionNumber: number,
): string {
	return `chat/${provider}/installations/${installationId}/revisions/v${revisionNumber}`;
}

function createDrizzleRepository(db: ChatInstallationsDb): CredentialRevisionRepository {
	return {
		async getLatestRevisionNumber(organizationId, installationId) {
			const [latest] = await db
				.select({ revisionNumber: chatInstallationCredentialRevision.revisionNumber })
				.from(chatInstallationCredentialRevision)
				.where(
					and(
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
					),
				)
				.orderBy(desc(chatInstallationCredentialRevision.revisionNumber))
				.limit(1);
			return latest?.revisionNumber ?? 0;
		},

		async insertRevision(input) {
			const [inserted] = await db
				.insert(chatInstallationCredentialRevision)
				.values(input)
				.returning();
			if (!inserted) {
				throw new Error("Failed to insert credential revision metadata");
			}
			return inserted;
		},

		async findRevision(organizationId, installationId, revisionId) {
			const [row] = await db
				.select()
				.from(chatInstallationCredentialRevision)
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, revisionId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
					),
				)
				.limit(1);
			return row ?? null;
		},

		async getActiveRevisionId(organizationId, installationId) {
			const [row] = await db
				.select({ activeCredentialRevisionId: chatInstallation.activeCredentialRevisionId })
				.from(chatInstallation)
				.where(
					and(
						eq(chatInstallation.id, installationId),
						eq(chatInstallation.organizationId, organizationId),
					),
				)
				.limit(1);
			return row?.activeCredentialRevisionId ?? null;
		},

		async updateRevisionStatus(organizationId, installationId, revisionId, status) {
			await db
				.update(chatInstallationCredentialRevision)
				.set({ status })
				.where(
					and(
						eq(chatInstallationCredentialRevision.id, revisionId),
						eq(chatInstallationCredentialRevision.installationId, installationId),
						eq(chatInstallationCredentialRevision.organizationId, organizationId),
					),
				);
		},
	};
}

function resolveRepository(deps?: CredentialRevisionRuntimeDeps): CredentialRevisionRepository {
	return deps?.repository ?? createDrizzleRepository(deps?.db ?? defaultDb);
}

async function compensateWrittenKeys(
	organizationId: string,
	installationId: string,
	writtenKeys: string[],
	deleteSecret: (organizationId: string, key: string) => Promise<void>,
): Promise<void> {
	for (const fullKey of writtenKeys) {
		try {
			await deleteSecret(organizationId, fullKey);
		} catch (cleanupError) {
			// Log redacted key path only — never log raw secret material.
			logger.warn(
				{ cleanupError, organizationId, installationId, key: fullKey },
				"Failed to roll back partially written credential revision key",
			);
		}
	}
}

export interface StoreCredentialRevisionInput {
	organizationId: string;
	installationId: string;
	provider: ChatInstallationProvider;
	secrets: Record<string, string>;
	status?: Extract<ChatCredentialRevisionStatus, "staged" | "verified">;
	externalIdentityFingerprint?: string | null;
	verifiedAt?: Date | null;
	createdByUserId?: string | null;
}

/**
 * Writes an immutable, organization-scoped credential revision into the configured secret store
 * (Vault or Scaleway) under a monotonic revision prefix. Never overwrites a prior revision.
 * On partial write or metadata persistence failure, cleans up only the newly written keys.
 */
export async function storeInstallationCredentialRevision(
	input: StoreCredentialRevisionInput,
	deps?: CredentialRevisionRuntimeDeps,
): Promise<CredentialRevisionRecord> {
	const entries = Object.entries(input.secrets)
		.map(([name, value]) => [name.trim(), value] as const)
		.filter(([name, value]) => name.length > 0 && value.length > 0)
		.toSorted(([a], [b]) => a.localeCompare(b));

	if (entries.length === 0) {
		throw new Error("At least one non-empty secret entry is required for a credential revision");
	}

	const repository = resolveRepository(deps);
	const storeSecret = deps?.storeSecret ?? storeOrgSecret;
	const deleteSecret = deps?.deleteSecret ?? deleteOrgSecret;
	const secretStoreProvider = deps?.secretStoreProvider ?? getActiveSecretStoreProvider();

	const latestRevision = await repository.getLatestRevisionNumber(
		input.organizationId,
		input.installationId,
	);
	const revisionNumber = latestRevision + 1;
	const secretKeyPrefix = buildCredentialRevisionPrefix(
		input.provider,
		input.installationId,
		revisionNumber,
	);

	const writtenKeys: string[] = [];
	try {
		for (const [keyName, secretValue] of entries) {
			const fullKey = `${secretKeyPrefix}/${keyName}`;
			await storeSecret(input.organizationId, fullKey, secretValue);
			writtenKeys.push(fullKey);
		}
	} catch (writeError) {
		await compensateWrittenKeys(
			input.organizationId,
			input.installationId,
			writtenKeys,
			deleteSecret,
		);
		throw writeError;
	}

	try {
		return await repository.insertRevision({
			installationId: input.installationId,
			organizationId: input.organizationId,
			revisionNumber,
			secretStoreProvider,
			secretKeyPrefix,
			secretKeys: entries.map(([keyName]) => keyName),
			status: input.status ?? "staged",
			externalIdentityFingerprint: input.externalIdentityFingerprint ?? null,
			verifiedAt: input.verifiedAt ?? null,
			revokedAt: null,
			createdByUserId: input.createdByUserId ?? null,
		});
	} catch (dbError) {
		await compensateWrittenKeys(
			input.organizationId,
			input.installationId,
			writtenKeys,
			deleteSecret,
		);
		throw dbError;
	}
}

export type ReadCredentialRevisionResult =
	| {
			kind: "ok";
			revision: CredentialRevisionRecord;
			secrets: Record<string, string>;
	  }
	| {
			kind: "missing";
			reason: "revision_not_found" | "secret_missing";
			revision?: CredentialRevisionRecord;
			missingKeys?: string[];
	  }
	| {
			kind: "revoked";
			revision: CredentialRevisionRecord;
	  }
	| {
			kind: "unavailable";
			revision: CredentialRevisionRecord;
			error: unknown;
	  };

/**
 * Reads an organization-scoped credential revision, explicitly separating:
 * - confirmed missing revision or secret (`kind: "missing"`)
 * - revoked/cleaned revision (`kind: "revoked"`)
 * - secret-store outage (`kind: "unavailable"`)
 */
export async function readInstallationCredentialRevision(
	input: {
		organizationId: string;
		installationId: string;
		revisionId: string;
	},
	deps?: CredentialRevisionRuntimeDeps,
): Promise<ReadCredentialRevisionResult> {
	const repository = resolveRepository(deps);
	const readSecret = deps?.readSecret ?? getOrgSecret;

	const revision = await repository.findRevision(
		input.organizationId,
		input.installationId,
		input.revisionId,
	);
	if (!revision) {
		return { kind: "missing", reason: "revision_not_found" };
	}

	if (revision.status === "revoked" || revision.status === "cleaned_up") {
		return { kind: "revoked", revision };
	}

	const secrets: Record<string, string> = {};
	const missingKeys: string[] = [];

	for (const keyName of revision.secretKeys) {
		const fullKey = `${revision.secretKeyPrefix}/${keyName}`;
		try {
			const value = await readSecret(input.organizationId, fullKey);
			if (value === null) {
				missingKeys.push(keyName);
			} else {
				secrets[keyName] = value;
			}
		} catch (error) {
			if (isSecretStoreUnavailableError(error) || error instanceof Error) {
				logger.warn(
					{
						organizationId: input.organizationId,
						installationId: input.installationId,
						revisionId: revision.id,
						keyName,
					},
					"Secret store unavailable while reading installation credential revision",
				);
				return { kind: "unavailable", revision, error };
			}
			return { kind: "unavailable", revision, error };
		}
	}

	if (missingKeys.length > 0) {
		return { kind: "missing", reason: "secret_missing", revision, missingKeys };
	}

	return { kind: "ok", revision, secrets };
}

export type CleanupCredentialRevisionResult =
	| { kind: "not_found" }
	| { kind: "referenced" }
	| { kind: "already_cleaned" }
	| { kind: "cleaned_up"; deletedKeys: string[] }
	| { kind: "retryable_error"; deletedKeys: string[]; failedKeys: string[] };

/**
 * Deletes secret keys for an unreferenced credential revision.
 * Refuses to delete a revision still referenced as the installation's active credential revision.
 * On secret-store outage, records `cleanup_pending` so deletion can be retried cleanly.
 */
export async function cleanupUnreferencedCredentialRevision(
	input: {
		organizationId: string;
		installationId: string;
		revisionId: string;
	},
	deps?: CredentialRevisionRuntimeDeps,
): Promise<CleanupCredentialRevisionResult> {
	const repository = resolveRepository(deps);
	const deleteSecret = deps?.deleteSecret ?? deleteOrgSecret;

	const revision = await repository.findRevision(
		input.organizationId,
		input.installationId,
		input.revisionId,
	);
	if (!revision) {
		return { kind: "not_found" };
	}

	if (revision.status === "cleaned_up") {
		return { kind: "already_cleaned" };
	}

	const activeRevisionId = await repository.getActiveRevisionId(
		input.organizationId,
		input.installationId,
	);
	if (activeRevisionId === revision.id) {
		return { kind: "referenced" };
	}

	await repository.updateRevisionStatus(
		input.organizationId,
		input.installationId,
		revision.id,
		"cleanup_pending",
	);

	const deletedKeys: string[] = [];
	const failedKeys: string[] = [];

	for (const keyName of revision.secretKeys) {
		const fullKey = `${revision.secretKeyPrefix}/${keyName}`;
		try {
			await deleteSecret(input.organizationId, fullKey);
			deletedKeys.push(keyName);
		} catch (error) {
			logger.warn(
				{
					errorName: error instanceof Error ? error.name : "UnknownError",
					errorCode: isSecretStoreUnavailableError(error) ? error.code : "delete_failed",
					organizationId: input.organizationId,
					installationId: input.installationId,
					revisionId: revision.id,
					keyName,
				},
				"Failed to delete secret key during credential revision cleanup; leaving retryable",
			);
			failedKeys.push(keyName);
		}
	}

	if (failedKeys.length > 0) {
		return { kind: "retryable_error", deletedKeys, failedKeys };
	}

	await repository.updateRevisionStatus(
		input.organizationId,
		input.installationId,
		revision.id,
		"cleaned_up",
	);

	return { kind: "cleaned_up", deletedKeys };
}
