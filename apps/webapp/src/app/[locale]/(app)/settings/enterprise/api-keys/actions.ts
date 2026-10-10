"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	type ApiKeyView,
	createOrganizationApiKey,
	listOrganizationApiKeys,
	revokeOrganizationApiKey,
	updateOrganizationApiKey,
} from "@/lib/public-api/keys/key-store";
import {
	type ApiKeyResponse,
	type CreateApiKeyData,
	type CreateApiKeyResponse,
	createApiKeySchema,
	MAX_API_KEYS_PER_ORG,
	type UpdateApiKeyData,
	updateApiKeySchema,
} from "@/lib/validations/api-key";

const logger = createLogger("ApiKeyActions");
const API_KEYS_PATH = "/settings/enterprise/api-keys";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Verify that the current user has admin/owner permissions for the organization.
 * Every org admin manages all of the organization's keys (ADR 0001).
 */
function verifyApiKeyPermission(
	organizationId: string,
	action: "list" | "create" | "update" | "delete",
) {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const { membership: memberRecord } = yield* requireActiveOrganizationActionActor({
			userId: session.user.id,
			organizationId,
			requiredRole: "admin",
			message: `Only active approved admins and owners can ${action} API keys`,
			resource: "apiKey",
			action,
		});

		return { session, memberRecord };
	});
}

function parseInput<T>(result: z.ZodSafeParseResult<T>) {
	if (result.success) return Effect.succeed(result.data);
	const issue = result.error.issues[0];
	return Effect.fail(
		new ValidationError({
			message: issue?.message || "Invalid input",
			field: issue?.path.map(String).join(".") || "data",
		}),
	);
}

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

// =============================================================================
// List API Keys
// =============================================================================

/**
 * List all API keys of the organization, whichever admin created them.
 * Requires admin or owner role.
 */
export async function listApiKeys(
	organizationId: string,
): Promise<ServerActionResult<ApiKeyResponse[]>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			yield* verifyApiKeyPermission(organizationId, "list");
			const dbService = yield* DatabaseService;
			const keys = yield* dbService.query("apiKeys.list", () =>
				listOrganizationApiKeys(dbService.db, organizationId),
			);
			return keys.map(toResponse);
		}),
	);
}

// =============================================================================
// Create API Key
// =============================================================================

/**
 * Create a new API key for the organization.
 * Requires admin or owner role. Returns the full key (shown only once!).
 */
export async function createApiKey(
	organizationId: string,
	data: CreateApiKeyData,
): Promise<ServerActionResult<CreateApiKeyResponse>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const { session } = yield* verifyApiKeyPermission(organizationId, "create");
			const input = yield* parseInput(createApiKeySchema.safeParse(data));
			const dbService = yield* DatabaseService;

			const expiresAt = input.expiresInDays
				? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
				: null;
			const outcome = yield* dbService.query("apiKeys.create", () =>
				createOrganizationApiKey(dbService.db, {
					organizationId,
					actorUserId: session.user.id,
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
				{ organizationId, keyId: outcome.key.id, createdBy: session.user.id },
				"API key created",
			);
			revalidatePath(API_KEYS_PATH);
			return {
				id: outcome.key.id,
				key: outcome.key.key,
				name: outcome.key.name,
				prefix: outcome.key.start,
				expiresAt: outcome.key.expiresAt?.toISOString() ?? null,
			};
		}),
	);
}

// =============================================================================
// Update API Key
// =============================================================================

/**
 * Update an existing API key of the organization.
 * Requires admin or owner role.
 */
export async function updateApiKey(
	organizationId: string,
	keyId: string,
	data: UpdateApiKeyData,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const { session } = yield* verifyApiKeyPermission(organizationId, "update");
			const change = yield* parseInput(updateApiKeySchema.safeParse(data));
			const dbService = yield* DatabaseService;

			const outcome = yield* dbService.query("apiKeys.update", () =>
				updateOrganizationApiKey(dbService.db, {
					organizationId,
					actorUserId: session.user.id,
					keyId,
					change,
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(keyNotFound(keyId));

			logger.info({ organizationId, keyId, updatedBy: session.user.id }, "API key updated");
			revalidatePath(API_KEYS_PATH);
		}),
	);
}

// =============================================================================
// Delete API Key
// =============================================================================

/**
 * Revoke (delete) an API key of the organization. Any application using it
 * loses access at once. Requires admin or owner role.
 */
export async function deleteApiKey(
	organizationId: string,
	keyId: string,
): Promise<ServerActionResult<void>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const { session } = yield* verifyApiKeyPermission(organizationId, "delete");
			const dbService = yield* DatabaseService;

			const outcome = yield* dbService.query("apiKeys.revoke", () =>
				revokeOrganizationApiKey(dbService.db, {
					organizationId,
					actorUserId: session.user.id,
					keyId,
				}),
			);
			if (!outcome.ok) return yield* Effect.fail(keyNotFound(keyId));

			logger.info({ organizationId, keyId, revokedBy: session.user.id }, "API key revoked");
			revalidatePath(API_KEYS_PATH);
		}),
	);
}
