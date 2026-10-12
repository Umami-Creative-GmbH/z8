/**
 * Shared setup for the Public API PostgreSQL suites (#763): real key
 * verification with production plugin options, an unlimited organization
 * ceiling and billing disabled. Import it only from `*.integration.test.ts`.
 */
import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import type { z } from "zod";
import { db } from "@/db";
import { authDatabaseSchema } from "@/lib/auth-database-schema";
import { createPublicApiDependencies } from "../dependencies";
import type { PublicApiEndpoint } from "../endpoint";
import { createOrganizationApiKey } from "../keys/key-store";
import { API_KEY_PLUGIN_OPTIONS } from "../keys/plugin-config";
import { handlePublicApiRequest } from "../pipeline";
import type { ApiKeyScope } from "../scopes";

const auth = betterAuth({
	baseURL: "https://app.example.test",
	secret: "t763-public-api-fixture-secret-with-enough-entropy",
	database: drizzleAdapter(db, { provider: "pg", schema: authDatabaseSchema }),
	plugins: [apiKey(API_KEY_PLUGIN_OPTIONS)],
});

const dependencies = createPublicApiDependencies({
	database: db,
	verifyApiKey: (key) => auth.api.verifyApiKey({ body: { key } }),
	checkOrganizationLimit: async () => ({
		allowed: true,
		limit: 1_000_000,
		remaining: 1_000_000,
		resetAt: Date.now() + 60_000,
		retryAfterSeconds: 1,
	}),
	billingEnabled: () => false,
	clientIp: () => null,
	onError: (error) => {
		throw error;
	},
});

/** Creates a key of the organization and returns the full key string. */
export async function createTestKey(
	organizationId: string,
	actorUserId: string,
	scopes: ApiKeyScope[],
): Promise<string> {
	const outcome = await createOrganizationApiKey(db, {
		organizationId,
		actorUserId,
		name: "Suite key",
		scopes,
		rateLimitEnabled: false,
		rateLimitMax: 10_000,
		rateLimitTimeWindow: 60_000,
		expiresAt: null,
	});
	if (!outcome.ok) throw new Error(outcome.reason);
	return outcome.key.key;
}

/** Runs one GET through the full pipeline. */
export async function callPublicApi<Query extends z.ZodObject, Response extends z.ZodType>(
	endpoint: PublicApiEndpoint<Query, Response>,
	key: string,
	query = "",
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await handlePublicApiRequest(
		dependencies,
		endpoint,
		new Request(`https://app.example.test${endpoint.path}${query}`, {
			headers: { authorization: `Bearer ${key}` },
		}),
	);
	return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Every row of a list, walking its cursor with small pages. */
export async function walkPublicApi<Query extends z.ZodObject, Response extends z.ZodType>(
	endpoint: PublicApiEndpoint<Query, Response>,
	key: string,
	query: string,
	pageSize = 2,
): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];
	let cursor: string | null = null;
	for (let page = 0; page < 1000; page++) {
		const separator = query ? "&" : "?";
		const suffix: string = cursor ? `&cursor=${cursor}` : "";
		const { status, body } = await callPublicApi(
			endpoint,
			key,
			`${query}${separator}limit=${pageSize}${suffix}`,
		);
		if (status !== 200) throw new Error(`page ${page}: ${status} ${JSON.stringify(body)}`);
		rows.push(...(body.data as Record<string, unknown>[]));
		cursor = body.nextCursor as string | null;
		if (!cursor) return rows;
	}
	throw new Error("cursor never ended");
}
