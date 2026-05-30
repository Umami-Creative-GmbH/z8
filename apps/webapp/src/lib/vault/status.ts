import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { organizationSecretKey } from "@/db/schema";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import { secondaryStorage } from "@/lib/redis";
import { getVaultStatus } from "./client";
import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";
import { isCompatibleScalewayKey } from "./scaleway-key-utils";

const logger = createLogger("SecretStoreStatus");
const SCALEWAY_STATUS_CACHE_TTL_SECONDS = 86_400;
const PROVIDER_SCALEWAY = "scaleway";

export type VaultSecretStoreStatus = {
	provider: "vault";
	available: boolean;
	initialized: boolean;
	sealed: boolean;
	address: string;
	reason: "available" | "unavailable" | "sealed";
};

export type ScalewaySecretStoreStatus = {
	provider: "scaleway";
	available: boolean;
	reason: "available" | "missing-key" | "invalid-key" | "unreachable";
	scalewayKeyId?: string;
};

export type SecretStoreStatus = VaultSecretStoreStatus | ScalewaySecretStoreStatus;

const scalewayClient = new ScalewayKeyManagerClient({
	apiUrl: env.SCALEWAY_KEY_MANAGER_API_URL ?? "",
	secretKey: env.SCALEWAY_SECRET_KEY ?? "",
	projectId: env.SCALEWAY_PROJECT_ID ?? "",
	region: env.SCALEWAY_REGION ?? "",
});

function scalewayStatusCacheKey(organizationId: string) {
	return `secret-store-status:scaleway:${organizationId}`;
}

function isScalewayStatusReason(reason: unknown): reason is ScalewaySecretStoreStatus["reason"] {
	return (
		reason === "available" ||
		reason === "missing-key" ||
		reason === "invalid-key" ||
		reason === "unreachable"
	);
}

function parseCachedScalewayStatus(value: string | null): ScalewaySecretStoreStatus | null {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as Partial<ScalewaySecretStoreStatus>;
		if (
			parsed.provider === "scaleway" &&
			typeof parsed.available === "boolean" &&
			isScalewayStatusReason(parsed.reason)
		) {
			return {
				provider: "scaleway",
				available: parsed.available,
				reason: parsed.reason,
				...(typeof parsed.scalewayKeyId === "string"
					? { scalewayKeyId: parsed.scalewayKeyId }
					: {}),
			};
		}
	} catch (error) {
		logger.warn({ error }, "Ignoring invalid Scaleway status cache entry");
	}

	return null;
}

async function getVaultSecretStoreStatus(): Promise<VaultSecretStoreStatus> {
	const status = await getVaultStatus();

	return {
		provider: "vault",
		available: status.available,
		initialized: status.initialized,
		sealed: status.sealed,
		address: status.address,
		reason: status.available ? (status.sealed ? "sealed" : "available") : "unavailable",
	};
}

async function computeScalewaySecretStoreStatus(
	organizationId: string,
): Promise<ScalewaySecretStoreStatus> {
	const localKey = await db.query.organizationSecretKey.findFirst({
		where: and(
			eq(organizationSecretKey.organizationId, organizationId),
			eq(organizationSecretKey.provider, PROVIDER_SCALEWAY),
			isNull(organizationSecretKey.disabledAt),
		),
	});

	if (!localKey) {
		return { provider: "scaleway", available: false, reason: "missing-key" };
	}

	try {
		const remoteKey = await scalewayClient.getKey(localKey.scalewayKeyId);
		if (!isCompatibleScalewayKey(remoteKey, organizationId)) {
			return {
				provider: "scaleway",
				available: false,
				reason: "invalid-key",
				scalewayKeyId: localKey.scalewayKeyId,
			};
		}

		return {
			provider: "scaleway",
			available: true,
			reason: "available",
			scalewayKeyId: localKey.scalewayKeyId,
		};
	} catch (error) {
		logger.warn(
			{ error, organizationId, scalewayKeyId: localKey.scalewayKeyId },
			"Failed to verify Scaleway organization key status",
		);
		return {
			provider: "scaleway",
			available: false,
			reason: "unreachable",
			scalewayKeyId: localKey.scalewayKeyId,
		};
	}
}

async function getScalewaySecretStoreStatus(organizationId: string) {
	const cached = parseCachedScalewayStatus(
		await secondaryStorage.get(scalewayStatusCacheKey(organizationId)),
	);
	if (cached) {
		return cached;
	}

	const status = await computeScalewaySecretStoreStatus(organizationId);
	await secondaryStorage.set(
		scalewayStatusCacheKey(organizationId),
		JSON.stringify(status),
		SCALEWAY_STATUS_CACHE_TTL_SECONDS,
	);
	return status;
}

export async function getSecretStoreStatus(organizationId: string): Promise<SecretStoreStatus> {
	if (env.SECRET_STORE_PROVIDER === "scaleway") {
		return getScalewaySecretStoreStatus(organizationId);
	}

	return getVaultSecretStoreStatus();
}

export async function invalidateSecretStoreStatusCache(organizationId: string): Promise<void> {
	await secondaryStorage.delete(scalewayStatusCacheKey(organizationId));
}
