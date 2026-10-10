import "server-only";

import { defaultKeyHasher } from "@better-auth/api-key";
import { and, eq } from "drizzle-orm";
import { apikey } from "@/db/auth-schema";
import { type ApiKeyScope, scopesOfPermissions } from "@/lib/public-api/scopes";
import {
	API_KEY_CONFIG_ID,
	type ApiKeyReader,
	creatorOfMetadata,
	parseStoredJson,
} from "./key-store";

/**
 * Who a Public API request acts as (ADR 0001): the key's organization, limited
 * to the key's scopes. The key creator is carried for attribution only and is
 * never used to authorize anything.
 */
export interface ApiKeyPrincipal {
	organizationId: string;
	apiKeyId: string;
	scopes: readonly ApiKeyScope[];
	creatorUserId: string | null;
}

export function principalOfKeyRow(row: {
	id: string;
	referenceId: string;
	permissions: unknown;
	metadata: unknown;
}): ApiKeyPrincipal {
	const permissions =
		typeof row.permissions === "string" ? parseStoredJson(row.permissions) : row.permissions;
	const metadata = typeof row.metadata === "string" ? parseStoredJson(row.metadata) : row.metadata;
	return {
		organizationId: row.referenceId,
		apiKeyId: row.id,
		scopes: scopesOfPermissions(permissions),
		creatorUserId: creatorOfMetadata(metadata),
	};
}

/** A key's own rate limit as stored, before the current request is counted. */
export interface StoredKeyRateLimit {
	rateLimitEnabled: boolean | null;
	rateLimitMax: number | null;
	rateLimitTimeWindow: number | null;
	requestCount: number | null;
	lastRequest: Date | null;
}

export interface IdentifiedApiKey {
	principal: ApiKeyPrincipal;
	rateLimit: StoredKeyRateLimit;
}

/**
 * Finds the stored key a presented key string belongs to, without verifying
 * or counting it. Used to attribute a request to its key (and organization)
 * even when verification then refuses it.
 */
export async function identifyApiKey(
	reader: ApiKeyReader,
	presentedKey: string,
): Promise<IdentifiedApiKey | null> {
	if (presentedKey.length === 0 || presentedKey.length > 512) return null;
	const hashed = await defaultKeyHasher(presentedKey);
	const [row] = await reader
		.select({
			id: apikey.id,
			referenceId: apikey.referenceId,
			permissions: apikey.permissions,
			metadata: apikey.metadata,
			rateLimitEnabled: apikey.rateLimitEnabled,
			rateLimitMax: apikey.rateLimitMax,
			rateLimitTimeWindow: apikey.rateLimitTimeWindow,
			requestCount: apikey.requestCount,
			lastRequest: apikey.lastRequest,
		})
		.from(apikey)
		.where(and(eq(apikey.key, hashed), eq(apikey.configId, API_KEY_CONFIG_ID)))
		.limit(1);
	if (!row) return null;
	const { rateLimitEnabled, rateLimitMax, rateLimitTimeWindow, requestCount, lastRequest } = row;
	return {
		principal: principalOfKeyRow(row),
		rateLimit: { rateLimitEnabled, rateLimitMax, rateLimitTimeWindow, requestCount, lastRequest },
	};
}
