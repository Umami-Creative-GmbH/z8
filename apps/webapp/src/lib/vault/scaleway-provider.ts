import { db } from "@/db";
import { organizationSecret, organizationSecretKey } from "@/db/schema";
import { env } from "@/env";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";
import type { OrganizationSecretProvider } from "./types";

type ScalewayKey = {
	id?: string;
	state?: string;
	usage?: {
		symmetric_encryption?: string;
	};
	tags?: string[];
};

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

function isEnabledKey(key: unknown): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return typeof scalewayKey.id === "string" && scalewayKey.id.length > 0 && scalewayKey.state === "enabled";
}

function isCompatibleKey(key: unknown, organizationId: string): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return (
		isEnabledKey(key) &&
		scalewayKey.usage?.symmetric_encryption === "aes_256_gcm" &&
		Array.isArray(scalewayKey.tags) &&
		scalewayKey.tags.includes("z8-customer-secrets") &&
		scalewayKey.tags.includes(`z8-org:${organizationId}`)
	);
}

function isKeyWithId(key: unknown): key is ScalewayKey & { id: string } {
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
		throw new Error(`Configured Scaleway organization key ${scalewayKeyId} is not usable`, {
			cause: error,
		});
	}

	if (!isEnabledKey(remoteKey)) {
		throw new Error(`Scaleway organization key ${scalewayKeyId} is not enabled`);
	}

	if (!isCompatibleKey(remoteKey, organizationId)) {
		throw new Error(`Scaleway organization key ${scalewayKeyId} is not compatible`);
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
		const discoveredKey = remoteKeys.find((key) => isCompatibleKey(key, organizationId));
		if (discoveredKey) {
			return persistOrganizationKey(organizationId, discoveredKey.id, tx as SecretStoreDb);
		}

		const createdKey = await client.createOrganizationKey(organizationId);
		if (!isEnabledKey(createdKey)) {
			if (isKeyWithId(createdKey)) {
				throw new Error(`Created Scaleway organization key ${createdKey.id} is not enabled`);
			}
			throw new Error("Created Scaleway organization key response did not include an id");
		}
		const createdKeyId = createdKey.id;

		if (!isCompatibleKey(createdKey, organizationId)) {
			throw new Error(`Created Scaleway organization key ${createdKeyId} is not compatible`);
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

export const scalewaySecretProvider: OrganizationSecretProvider = {
	async storeOrgSecret(organizationId, key, value) {
		const scalewayKeyId = await ensureOrganizationKey(organizationId);
		const ciphertext = await client.encrypt(scalewayKeyId, value, associatedData(organizationId, key));

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
	},
	async getOrgSecret(organizationId, key) {
		const row = await db.query.organizationSecret.findFirst({
			where: and(
				eq(organizationSecret.organizationId, organizationId),
				eq(organizationSecret.key, key),
				eq(organizationSecret.provider, PROVIDER),
			),
		});

		if (!row) {
			return null;
		}

		return client.decrypt(row.kmsKeyId, row.ciphertext, associatedData(organizationId, key));
	},
	async deleteOrgSecret(organizationId, key) {
		await db
			.delete(organizationSecret)
			.where(
				and(
					eq(organizationSecret.organizationId, organizationId),
					eq(organizationSecret.key, key),
					eq(organizationSecret.provider, PROVIDER),
				),
			);
	},
	async deleteAllOrgSecrets(organizationId) {
		await db
			.delete(organizationSecret)
			.where(
				and(
					eq(organizationSecret.organizationId, organizationId),
					eq(organizationSecret.provider, PROVIDER),
				),
			);
	},
};
