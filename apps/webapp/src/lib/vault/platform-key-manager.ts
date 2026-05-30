import "server-only";

import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { systemConfig } from "@/db/schema";
import { env } from "@/env";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";
import { isCompatibleScalewayPlatformKey } from "./scaleway-key-utils";

export type PlatformKeyManagerEncryptionResult = {
	input: string;
	output: string;
	matches: boolean;
	ciphertextPreview: string;
	platformKeyId: string;
	keyStatus: "created" | "reused";
};

type SystemConfigDb = Pick<typeof db, "insert" | "query" | "execute">;

const PLATFORM_KEY_CONFIG_KEY = "platform_scaleway_key_id";
const PLATFORM_KEY_DESCRIPTION = "Scaleway Key Manager key ID for platform-scoped secrets.";
const ASSOCIATED_DATA = "scope=platform;purpose=diagnostics;version=1";

const client = new ScalewayKeyManagerClient({
	apiUrl: env.SCALEWAY_KEY_MANAGER_API_URL ?? "",
	secretKey: env.SCALEWAY_SECRET_KEY ?? "",
	projectId: env.SCALEWAY_PROJECT_ID ?? "",
	region: env.SCALEWAY_REGION ?? "",
});

async function findStoredPlatformKeyId(database: Pick<SystemConfigDb, "query"> = db) {
	const row = await database.query.systemConfig.findFirst({
		where: eq(systemConfig.key, PLATFORM_KEY_CONFIG_KEY),
	});
	return row?.value;
}

async function verifyStoredPlatformKey(platformKeyId: string) {
	let remoteKey: unknown;
	try {
		remoteKey = await client.getKey(platformKeyId);
	} catch (error) {
		throw new Error(`Configured Scaleway platform key ${platformKeyId} is not usable`, {
			cause: error,
		});
	}

	if (!isCompatibleScalewayPlatformKey(remoteKey)) {
		throw new Error(`Scaleway platform key ${platformKeyId} is not enabled or compatible`);
	}

	return platformKeyId;
}

async function persistPlatformKeyId(
	platformKeyId: string,
	database: Pick<SystemConfigDb, "insert"> = db,
) {
	await database
		.insert(systemConfig)
		.values({
			key: PLATFORM_KEY_CONFIG_KEY,
			value: platformKeyId,
			description: PLATFORM_KEY_DESCRIPTION,
		})
		.onConflictDoUpdate({
			target: systemConfig.key,
			set: {
				value: platformKeyId,
				description: PLATFORM_KEY_DESCRIPTION,
			},
		});
}

async function ensurePlatformKey() {
	const storedPlatformKeyId = await findStoredPlatformKeyId();
	if (storedPlatformKeyId) {
		return {
			platformKeyId: await verifyStoredPlatformKey(storedPlatformKeyId),
			keyStatus: "reused" as const,
		};
	}

	return db.transaction(async (tx) => {
		const database = tx as SystemConfigDb;
		await database.execute(
			sql`SELECT pg_advisory_xact_lock(hashtextextended(${PLATFORM_KEY_CONFIG_KEY}, 0))`,
		);

		const lockedPlatformKeyId = await findStoredPlatformKeyId(database);
		if (lockedPlatformKeyId) {
			return {
				platformKeyId: await verifyStoredPlatformKey(lockedPlatformKeyId),
				keyStatus: "reused" as const,
			};
		}

		const createdKey = await client.createPlatformKey(`z8-platform-${nanoid(10)}`);
		if (!isCompatibleScalewayPlatformKey(createdKey)) {
			throw new Error("Created Scaleway platform key is not enabled or compatible");
		}

		await persistPlatformKeyId(createdKey.id, database);
		return { platformKeyId: createdKey.id, keyStatus: "created" as const };
	});
}

function previewCiphertext(ciphertext: string) {
	if (ciphertext.length <= 96) {
		return ciphertext;
	}
	return `${ciphertext.slice(0, 48)}...${ciphertext.slice(-24)}`;
}

export async function testPlatformKeyManagerEncryption(
	value: string,
): Promise<PlatformKeyManagerEncryptionResult> {
	const { platformKeyId, keyStatus } = await ensurePlatformKey();
	const ciphertext = await client.encrypt(platformKeyId, value, ASSOCIATED_DATA);
	const output = await client.decrypt(platformKeyId, ciphertext, ASSOCIATED_DATA);

	return {
		input: value,
		output,
		matches: output === value,
		ciphertextPreview: previewCiphertext(ciphertext),
		platformKeyId,
		keyStatus,
	};
}
