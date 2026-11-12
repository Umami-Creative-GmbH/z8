"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { KeyRequestChannel } from "@/db/schema/public-api";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	type ApiKeyView,
	createOrganizationApiKey,
	getOrganizationApiKey,
	listOrganizationApiKeys,
	revokeOrganizationApiKey,
	updateOrganizationApiKey,
} from "@/lib/public-api/keys/key-store";
import { listRecentKeyRequests } from "@/lib/public-api/request-log";
import {
	type ApiKeyResponse,
	type CreateApiKeyResponse,
	createApiKeySchema,
	MAX_API_KEYS_PER_ORG,
	updateApiKeySchema,
} from "@/lib/validations/api-key";

const logger = createLogger("ApiKeyActions");
const API_KEYS_PATH = "/settings/enterprise/api-keys";

const keyNotFound = (keyId: string) =>
	new NotFoundError({ message: "API key not found", entityType: "apiKey", entityId: keyId });

function toResponse(view: ApiKeyView): ApiKeyResponse {
	return {
		id: view.id,
		name: view.name || "Unnamed Key",
		prefix: view.start,
		organizationId: view.organizationId,
		createdBy: view.creator?.userId ?? null,
		creator: view.creator,
		createdAt: view.createdAt.toISOString(),
		updatedAt: view.updatedAt.toISOString(),
		expiresAt: view.expiresAt?.toISOString() ?? null,
		lastRequest: view.lastRequest?.toISOString() ?? null,
		enabled: view.enabled,
		scopes: view.scopes,
		rateLimitEnabled: view.rateLimitEnabled,
		rateLimitMax: view.rateLimitMax,
		rateLimitTimeWindow: view.rateLimitTimeWindow,
		requestCount: view.requestCount,
	};
}

const keyIdSchema = z.string().min(1).max(255);

// Every org admin manages all of the organization's keys (ADR 0001).

/** All API keys of the organization, whichever admin created them. Org admins only. */
export const listApiKeys = organizationAction(
	{ name: "apiKeys.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const keys = yield* dbService.query("apiKeys.list", () =>
				listOrganizationApiKeys(dbService.db, organizationId),
			);
			return keys.map(toResponse);
		}),
);

export interface ApiKeyDetail {
	key: ApiKeyResponse;
	/** The key's most recent requests from the key request log, newest first. */
	requests: {
		id: string;
		/** `api` for the Public API, `mcp` for an MCP tool call (#795). */
		channel: KeyRequestChannel;
		method: string;
		route: string;
		status: number;
		rowCount: number | null;
		ipAddress: string | null;
		/** ISO date string */
		requestedAt: string;
	}[];
}

/** One API key of the organization with its recent requests. Org admins only. */
export const getApiKeyDetail = organizationAction(
	{ name: "apiKeys.detail", requires: "orgAdmin", schema: z.strictObject({ keyId: keyIdSchema }) },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const detail = yield* dbService.query("apiKeys.detail", async () => {
				const key = await getOrganizationApiKey(dbService.db, organizationId, input.keyId);
				if (!key) return null;
				const requests = await listRecentKeyRequests(dbService.db, {
					organizationId,
					apiKeyId: key.id,
				});
				return { key, requests };
			});
			if (!detail) return yield* Effect.fail(keyNotFound(input.keyId));
			return {
				key: toResponse(detail.key),
				requests: detail.requests.map((request) => ({
					...request,
					requestedAt: request.requestedAt.toISOString(),
				})),
			} satisfies ApiKeyDetail;
		}),
);

/**
 * Creates a new API key for the organization. Org admins only. Returns the
 * full key (shown only once!).
 */
export const createApiKey = organizationAction(
	{ name: "apiKeys.create", requires: "orgAdmin", schema: createApiKeySchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const expiresAt = input.expiresInDays
				? dateFromInstant(systemClock.nowInstant().add({ hours: input.expiresInDays * 24 }))
				: null;
			const outcome = yield* dbService.query("apiKeys.create", () =>
				createOrganizationApiKey(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					name: input.name,
					scopes: input.scopes,
					rateLimitEnabled: input.rateLimitEnabled,
					rateLimitMax: input.rateLimitMax,
					rateLimitTimeWindow: input.rateLimitTimeWindow,
					expiresAt,
				}),
			);
			if (!outcome.ok) {
				return yield* Effect.fail(
					new ValidationError({
						message: `Organization has reached the maximum of ${MAX_API_KEYS_PER_ORG} API keys`,
						field: "apiKeys",
					}),
				);
			}

			logger.info(
				{ organizationId, keyId: outcome.key.id, createdBy: actor.userId },
				"API key created",
			);
			revalidatePath(API_KEYS_PATH);
			return {
				id: outcome.key.id,
				key: outcome.key.key,
				name: outcome.key.name,
				prefix: outcome.key.start,
				expiresAt: outcome.key.expiresAt?.toISOString() ?? null,
			} satisfies CreateApiKeyResponse;
		}),
);

/** Updates an existing API key of the organization. Org admins only. */
export const updateApiKey = organizationAction(
	{
		name: "apiKeys.update",
		requires: "orgAdmin",
		schema: updateApiKeySchema.extend({ keyId: keyIdSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { keyId, ...change } = input;
			const dbService = yield* DatabaseService;

			const outcome = yield* dbService.query("apiKeys.update", () =>
				updateOrganizationApiKey(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					keyId,
					change,
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(keyNotFound(keyId));

			logger.info({ organizationId, keyId, updatedBy: actor.userId }, "API key updated");
			revalidatePath(API_KEYS_PATH);
		}),
);

/**
 * Revokes (deletes) an API key of the organization. Any application using it
 * loses access at once. Org admins only.
 */
export const deleteApiKey = organizationAction(
	{ name: "apiKeys.revoke", requires: "orgAdmin", schema: z.strictObject({ keyId: keyIdSchema }) },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const outcome = yield* dbService.query("apiKeys.revoke", () =>
				revokeOrganizationApiKey(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					keyId: input.keyId,
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(keyNotFound(input.keyId));

			logger.info(
				{ organizationId, keyId: input.keyId, revokedBy: actor.userId },
				"API key revoked",
			);
			revalidatePath(API_KEYS_PATH);
		}),
);
