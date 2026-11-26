import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizationSecret, organizationSecretKey } from "@/db/schema";
import { env } from "@/env";
import { SecretStoreUnavailableError } from "./errors";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";
import {
	isCompatibleScalewayKey,
	isEnabledScalewayKey,
	type ScalewayKey,
} from "./scaleway-key-utils";
import { invalidateSecretStoreStatusCache } from "./status";
import type { OrganizationSecretProvider } from "./types";

type SecretStoreDb = Pick<typeof db, "insert" | "query">;

const PROVIDER = "scaleway";
const provisioningByOrganization = new Map<string, Promise<string>>();

const client = new ScalewayKeyManagerClient({
	apiUrl: env.SCALEWAY_KEY_MANAGER_API_URL ?? "",
	secretKey: env.SCALEWAY_SECRET_KEY ?? "",
	projectId: env.SCALEWAY_PROJECT_ID ?? "",
	region: env.SCALEWAY_REGION ?? "",
});

function associatedData(organizationId: string, key: string) {
	return `organizationId=${organizationId};key=${key};version=1`;
}

function isKeyWithId(key: unknown): key is ScalewayKey & { id: string } {
	if (typeof key !== "object" || key === null) {
		return false;
	}

	const scalewayKey = key as ScalewayKey;
	return typeof scalewayKey.id === "string" && scalewayKey.id.length > 0;
}

async function findActiveLocalKey(organizationId: string, database: SecretStoreDb = db) {
	return database.query.organizationSecretKey.findFirst({
		where: and(
			eq(organizationSecretKey.organizationId, organizationId),
			eq(organizationSecretKey.provider, PROVIDER),
			isNull(organizationSecretKey.disabledAt),
		),
	});
}

async function persistOrganizationKey(
	organizationId: string,
	scalewayKeyId: string,
	database: SecretStoreDb = db,
) {
	try {
		await database
			.insert(organizationSecretKey)
			.values({
				organizationId,
				provider: PROVIDER,
				scalewayKeyId,
				region: env.SCALEWAY_REGION ?? "",
			})
			.onConflictDoNothing();
	} catch (error) {
		const existing = await findActiveLocalKey(organizationId, database);
		if (existing) {
			return existing.scalewayKeyId;
		}
		throw error;
	}

	const existing = await findActiveLocalKey(organizationId, database);
	return existing?.scalewayKeyId ?? scalewayKeyId;
}

async function verifyLocalKey(organizationId: string, scalewayKeyId: string) {
	let remoteKey: unknown;
	try {
		remoteKey = await client.getKey(scalewayKeyId);
	} catch (error) {
		throw new SecretStoreUnavailableError(
			`Configured Scaleway organization key ${scalewayKeyId} is not usable`,
			{ provider: "scaleway", operation: "provision", cause: error },
		);
	}

	if (!isEnabledScalewayKey(remoteKey)) {
		throw new SecretStoreUnavailableError(
			`Scaleway organization key ${scalewayKeyId} is not enabled`,
			{ provider: "scaleway", operation: "provision" },
		);
	}

	if (!isCompatibleScalewayKey(remoteKey, organizationId)) {
		throw new SecretStoreUnavailableError(
			`Scaleway organization key ${scalewayKeyId} is not compatible`,
			{ provider: "scaleway", operation: "provision" },
		);
	}

	return scalewayKeyId;
}

async function provisionOrganizationKey(organizationId: string) {
	const existing = await findActiveLocalKey(organizationId);

	if (existing) {
		return verifyLocalKey(organizationId, existing.scalewayKeyId);
	}

	return db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`);

		const lockedExisting = await findActiveLocalKey(organizationId, tx as SecretStoreDb);
		if (lockedExisting) {
			return verifyLocalKey(organizationId, lockedExisting.scalewayKeyId);
		}

		const remoteKeys = await client.listOrganizationKeys(organizationId);
		const discoveredKey = remoteKeys.find((key) => isCompatibleScalewayKey(key, organizationId));
		if (discoveredKey) {
			return persistOrganizationKey(organizationId, discoveredKey.id, tx as SecretStoreDb);
		}

		const createdKey = await client.createOrganizationKey(organizationId);
		if (!isEnabledScalewayKey(createdKey)) {
			if (isKeyWithId(createdKey)) {
				throw new SecretStoreUnavailableError(
					`Created Scaleway organization key ${createdKey.id} is not enabled`,
					{ provider: "scaleway", operation: "provision" },
				);
			}
			throw new SecretStoreUnavailableError(
				"Created Scaleway organization key response did not include an id",
				{ provider: "scaleway", operation: "provision" },
			);
		}
		const createdKeyId = createdKey.id;

		if (!isCompatibleScalewayKey(createdKey, organizationId)) {
			throw new SecretStoreUnavailableError(
				`Created Scaleway organization key ${createdKeyId} is not compatible`,
				{ provider: "scaleway", operation: "provision" },
			);
		}

		return persistOrganizationKey(organizationId, createdKeyId, tx as SecretStoreDb);
	});
}

async function ensureOrganizationKey(organizationId: string) {
	const provisioning = provisioningByOrganization.get(organizationId);
	if (provisioning) {
		return provisioning;
	}

	const provisioningPromise = provisionOrganizationKey(organizationId).finally(() => {
		provisioningByOrganization.delete(organizationId);
	});
	provisioningByOrganization.set(organizationId, provisioningPromise);
	return provisioningPromise;
}

async function invalidateStatusCache(organizationId: string) {
	try {
		await invalidateSecretStoreStatusCache(organizationId);
	} catch (error) {
		// Cache invalidation should never fail the secret mutation that already succeeded.
		console.warn("Failed to invalidate Scaleway secret store status cache", {
			error,
			organizationId,
		});
	}
}

export const scalewaySecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret(organizationId, key, value) {
		const scalewayKeyId = await ensureOrganizationKey(organizationId);
		let ciphertext: string;
		try {
			ciphertext = await client.encrypt(scalewayKeyId, value, associatedData(organizationId, key));
		} catch (error) {
			if (error instanceof SecretStoreUnavailableError) {
				throw error;
			}
			throw new SecretStoreUnavailableError("Scaleway Key Manager failed to encrypt secret", {
				provider: "scaleway",
				operation: "write",
				cause: error,
			});
		}

		try {
			await db
				.insert(organizationSecret)
				.values({
					organizationId,
					key,
					provider: PROVIDER,
					kmsKeyId: scalewayKeyId,
					ciphertext,
				})
				.onConflictDoUpdate({
					target: [organizationSecret.organizationId, organizationSecret.key],
					set: {
						provider: PROVIDER,
						kmsKeyId: scalewayKeyId,
						ciphertext,
					},
				});
		} catch (error) {
			throw new SecretStoreUnavailableError("Failed to persist encrypted organization secret", {
				provider: "scaleway",
				operation: "write",
				cause: error,
			});
		}
		await invalidateStatusCache(organizationId);
	},
	async getOrgSecret(organizationId, key) {
		let row:
			| {
					kmsKeyId: string;
					ciphertext: string;
			  }
			| undefined;
		try {
			row = await db.query.organizationSecret.findFirst({
				where: and(
					eq(organizationSecret.organizationId, organizationId),
					eq(organizationSecret.key, key),
					eq(organizationSecret.provider, PROVIDER),
				),
			});
		} catch (error) {
			throw new SecretStoreUnavailableError("Failed to read organization secret metadata", {
				provider: "scaleway",
				operation: "read",
				cause: error,
			});
		}

		if (!row) {
			return null;
		}

		try {
			return await client.decrypt(
				row.kmsKeyId,
				row.ciphertext,
				associatedData(organizationId, key),
			);
		} catch (error) {
			throw new SecretStoreUnavailableError("Scaleway Key Manager failed to decrypt secret", {
				provider: "scaleway",
				operation: "read",
				cause: error,
			});
		}
	},
	async deleteOrgSecret(organizationId, key) {
		try {
			await db
				.delete(organizationSecret)
				.where(
					and(
						eq(organizationSecret.organizationId, organizationId),
						eq(organizationSecret.key, key),
						eq(organizationSecret.provider, PROVIDER),
					),
				);
		} catch (error) {
			throw new SecretStoreUnavailableError("Failed to delete organization secret", {
				provider: "scaleway",
				operation: "delete",
				cause: error,
			});
		}
		await invalidateStatusCache(organizationId);
	},
	async deleteAllOrgSecrets(organizationId) {
		try {
			await db
				.delete(organizationSecret)
				.where(
					and(
						eq(organizationSecret.organizationId, organizationId),
						eq(organizationSecret.provider, PROVIDER),
					),
				);
		} catch (error) {
			throw new SecretStoreUnavailableError("Failed to delete organization secrets", {
				provider: "scaleway",
				operation: "delete",
				cause: error,
			});
		}
		await invalidateStatusCache(organizationId);
	},
};
