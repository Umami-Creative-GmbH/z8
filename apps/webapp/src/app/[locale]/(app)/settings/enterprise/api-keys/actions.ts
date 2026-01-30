"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	type ApiKeyResponse,
	type ApiKeyScope,
	type CreateApiKeyData,
	type CreateApiKeyResponse,
	createApiKeySchema,
	MAX_API_KEYS_PER_ORG,
	type UpdateApiKeyData,
	updateApiKeySchema,
} from "@/lib/validations/api-key";

const logger = createLogger("ApiKeyActions");

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse metadata safely from Better Auth API response
 */
function parseMetadata(metadata: unknown): Record<string, unknown> {
	if (!metadata) return {};
	if (typeof metadata === "string") {
		try {
			return JSON.parse(metadata);
		} catch {
			return {};
		}
	}
	if (typeof metadata === "object") {
		return metadata as Record<string, unknown>;
	}
	return {};
}

/**
 * Convert a date value to ISO string for serialization
 */
function toISOString(value: unknown): string | null {
	if (!value) return null;
	if (typeof value === "string") {
		return DateTime.fromISO(value).isValid ? value : null;
	}
	if (value instanceof Date) {
		return DateTime.fromJSDate(value).toISO();
	}
	return null;
}

/**
 * Verify that the current user has admin/owner permissions for the organization
 * Returns session and member record if authorized
 */
function verifyApiKeyPermission(
	organizationId: string,
	action: "list" | "create" | "update" | "delete",
) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Check user's role in the organization
		const memberRecord = yield* _(
			dbService.query("getCurrentMember", async () => {
				return await db.query.member.findFirst({
					where: and(
						eq(authSchema.member.userId, session.user.id),
						eq(authSchema.member.organizationId, organizationId),
					),
				});
			}),
			Effect.flatMap((member) =>
				member
					? Effect.succeed(member)
					: Effect.fail(
							new NotFoundError({
								message: "You are not a member of this organization",
								entityType: "member",
							}),
						),
			),
		);

		// Verify admin/owner role
		if (memberRecord.role !== "admin" && memberRecord.role !== "owner") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: `Only admins and owners can ${action} API keys`,
						userId: session.user.id,
						resource: "apiKey",
						action,
					}),
				),
			);
		}

		return { session, memberRecord };
	});
}

/**
 * Fetch an API key and verify it belongs to the organization
 */
function getAndVerifyApiKey(
	keyId: string,
	organizationId: string,
	userId: string,
	action: "update" | "delete",
) {
	return Effect.gen(function* (_) {
		const existingKey = yield* _(
			Effect.tryPromise({
				try: async () => {
					const result = await auth.api.getApiKey({
						query: { id: keyId },
						headers: await headers(),
					});
					return result;
				},
				catch: () => {
					return new NotFoundError({
						message: "API key not found",
						entityType: "apiKey",
						entityId: keyId,
					});
				},
			}),
		);

		// Verify the key belongs to this organization
		const keyMeta = parseMetadata((existingKey as Record<string, unknown>)?.metadata);
		if (keyMeta.organizationId !== organizationId) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "API key does not belong to this organization",
						userId,
						resource: "apiKey",
						action,
					}),
				),
			);
		}

		return { existingKey, keyMeta };
	});
}

/**
 * Filter API keys by organization and transform to response format
 */
function transformApiKeysResponse(apiKeys: unknown[], organizationId: string): ApiKeyResponse[] {
	return (apiKeys as Record<string, unknown>[])
		.filter((key) => {
			const meta = parseMetadata(key.metadata);
			return meta.organizationId === organizationId;
		})
		.map((key) => {
			const meta = parseMetadata(key.metadata);
			return {
				id: key.id as string,
				name: (meta.displayName as string) || (key.name as string) || "Unnamed Key",
				prefix: (key.start as string) || null,
				organizationId: (meta.organizationId as string) || organizationId,
				createdBy: (meta.createdBy as string) || null,
				createdAt: toISOString(key.createdAt) || DateTime.now().toISO(),
				updatedAt: toISOString(key.updatedAt) || DateTime.now().toISO(),
				expiresAt: toISOString(key.expiresAt),
				lastRequest: toISOString(key.lastRequest),
				enabled: (key.enabled as boolean) ?? true,
				scopes: meta.scopes ? (meta.scopes as ApiKeyScope[]) : [],
				rateLimitEnabled: (key.rateLimitEnabled as boolean) ?? true,
				rateLimitMax: (key.rateLimitMax as number) || null,
				rateLimitTimeWindow: (key.rateLimitTimeWindow as number) || null,
				requestCount: (key.requestCount as number) || null,
			};
		});
}

// =============================================================================
// List API Keys
// =============================================================================

/**
 * List all API keys for the current organization
 * Requires admin or owner role
 */
export async function listApiKeys(
	organizationId: string,
): Promise<ServerActionResult<ApiKeyResponse[]>> {
	const tracer = trace.getTracer("api-keys");

	const effect = tracer.startActiveSpan(
		"listApiKeys",
		{ attributes: { "organization.id": organizationId } },
		(span) => {
			return Effect.gen(function* (_) {
				// Verify permissions
				yield* _(verifyApiKeyPermission(organizationId, "list"));

				// Fetch API keys using Better Auth's API
				const apiKeys = yield* _(
					Effect.tryPromise({
						try: async () => {
							const result = await auth.api.listApiKeys({
								headers: await headers(),
							});
							return result || [];
						},
						catch: (error) => {
							logger.error({ error }, "Failed to list API keys via auth API");
							return new ValidationError({
								message: "Failed to fetch API keys",
								field: "apiKeys",
							});
						},
					}),
				);

				// Filter and transform to response format
				const orgKeys = transformApiKeysResponse(apiKeys as unknown[], organizationId);

				logger.info(
					{ organizationId, keyCount: orgKeys.length },
					"Listed API keys for organization",
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return orgKeys;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as unknown as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to list API keys");
						return yield* _(Effect.fail(error as unknown as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// Create API Key
// =============================================================================

/**
 * Create a new API key for the organization
 * Requires admin or owner role
 * Returns the full key (shown only once!)
 */
export async function createApiKey(
	organizationId: string,
	data: CreateApiKeyData,
): Promise<ServerActionResult<CreateApiKeyResponse>> {
	const tracer = trace.getTracer("api-keys");

	const effect = tracer.startActiveSpan(
		"createApiKey",
		{ attributes: { "organization.id": organizationId, "apiKey.name": data.name } },
		(span) => {
			return Effect.gen(function* (_) {
				// Verify permissions
				const { session } = yield* _(verifyApiKeyPermission(organizationId, "create"));

				// Validate input
				const validationResult = createApiKeySchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Check key limit for organization
				// IMPORTANT: This check is not atomic - there's a small race condition window
				// A proper fix would use database-level constraints or transactions
				const existingKeys = yield* _(
					Effect.tryPromise({
						try: async () => {
							const result = await auth.api.listApiKeys({
								headers: await headers(),
							});
							return transformApiKeysResponse((result || []) as unknown[], organizationId);
						},
						catch: (error) => {
							logger.error({ error, organizationId }, "Failed to check existing API keys");
							return new ValidationError({
								message: "Failed to verify API key limit. Please try again.",
								field: "apiKeys",
							});
						},
					}),
				);

				if (existingKeys.length >= MAX_API_KEYS_PER_ORG) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: `Organization has reached the maximum of ${MAX_API_KEYS_PER_ORG} API keys`,
								field: "apiKeys",
							}),
						),
					);
				}

				// Calculate expiration in seconds if specified
				const expiresIn = validatedData.expiresInDays
					? validatedData.expiresInDays * 24 * 60 * 60
					: undefined;

				// Create the API key via Better Auth
				const result = yield* _(
					Effect.tryPromise({
						try: async () => {
							const createResult = await auth.api.createApiKey({
								body: {
									name: validatedData.name,
									expiresIn,
									prefix: "z8_org",
									metadata: {
										organizationId,
										displayName: validatedData.name,
										scopes: validatedData.scopes,
										createdBy: session.user.id,
										rateLimitEnabled: validatedData.rateLimitEnabled,
										rateLimitMax: validatedData.rateLimitMax,
										rateLimitTimeWindow: validatedData.rateLimitTimeWindow,
									},
								},
								headers: await headers(),
							});
							return createResult;
						},
						catch: (error) => {
							logger.error({ error }, "Failed to create API key via auth API");
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to create API key",
								field: "apiKey",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						keyId: result?.id,
						keyName: validatedData.name,
						createdBy: session.user.id,
					},
					"API key created successfully",
				);

				revalidatePath("/settings/enterprise/api-keys");
				span.setStatus({ code: SpanStatusCode.OK });

				return {
					id: result?.id || "",
					key: result?.key || "",
					name: validatedData.name,
					prefix: result?.key?.substring(0, 12) || null,
					expiresAt: result?.expiresAt ? toISOString(result.expiresAt) : null,
				};
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as unknown as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId }, "Failed to create API key");
						return yield* _(Effect.fail(error as unknown as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// Update API Key
// =============================================================================

/**
 * Update an existing API key
 * Requires admin or owner role
 */
export async function updateApiKey(
	organizationId: string,
	keyId: string,
	data: UpdateApiKeyData,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("api-keys");

	const effect = tracer.startActiveSpan(
		"updateApiKey",
		{ attributes: { "organization.id": organizationId, "apiKey.id": keyId } },
		(span) => {
			return Effect.gen(function* (_) {
				// Verify permissions
				const { session } = yield* _(verifyApiKeyPermission(organizationId, "update"));

				// Validate input
				const validationResult = updateApiKeySchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Get and verify the API key belongs to this organization
				const { keyMeta } = yield* _(
					getAndVerifyApiKey(keyId, organizationId, session.user.id, "update"),
				);

				// Update the API key via Better Auth
				yield* _(
					Effect.tryPromise({
						try: async () => {
							// Build updated metadata
							const updatedMetadata = {
								...keyMeta,
								...(validatedData.name && { displayName: validatedData.name }),
								...(validatedData.scopes && { scopes: validatedData.scopes }),
								...(validatedData.rateLimitEnabled !== undefined && {
									rateLimitEnabled: validatedData.rateLimitEnabled,
								}),
								...(validatedData.rateLimitMax !== undefined && {
									rateLimitMax: validatedData.rateLimitMax,
								}),
							};

							await auth.api.updateApiKey({
								body: {
									keyId,
									...(validatedData.name && { name: validatedData.name }),
									...(validatedData.enabled !== undefined && {
										enabled: validatedData.enabled,
									}),
									...(validatedData.rateLimitEnabled !== undefined && {
										rateLimitEnabled: validatedData.rateLimitEnabled,
									}),
									...(validatedData.rateLimitMax !== undefined && {
										rateLimitMax: validatedData.rateLimitMax,
									}),
									metadata: updatedMetadata,
								},
								headers: await headers(),
							});
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to update API key",
								field: "apiKey",
							});
						},
					}),
				);

				logger.info(
					{ organizationId, keyId, updatedBy: session.user.id },
					"API key updated successfully",
				);

				revalidatePath("/settings/enterprise/api-keys");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as unknown as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId, keyId }, "Failed to update API key");
						return yield* _(Effect.fail(error as unknown as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

// =============================================================================
// Delete API Key
// =============================================================================

/**
 * Delete an API key
 * Requires admin or owner role
 */
export async function deleteApiKey(
	organizationId: string,
	keyId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("api-keys");

	const effect = tracer.startActiveSpan(
		"deleteApiKey",
		{ attributes: { "organization.id": organizationId, "apiKey.id": keyId } },
		(span) => {
			return Effect.gen(function* (_) {
				// Verify permissions
				const { session } = yield* _(verifyApiKeyPermission(organizationId, "delete"));

				// Get and verify the API key belongs to this organization
				yield* _(getAndVerifyApiKey(keyId, organizationId, session.user.id, "delete"));

				// Delete the API key via Better Auth
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.deleteApiKey({
								body: { keyId },
								headers: await headers(),
							});
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to delete API key",
								field: "apiKey",
							});
						},
					}),
				);

				logger.info(
					{ organizationId, keyId, deletedBy: session.user.id },
					"API key deleted successfully",
				);

				revalidatePath("/settings/enterprise/api-keys");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as unknown as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error({ error, organizationId, keyId }, "Failed to delete API key");
						return yield* _(Effect.fail(error as unknown as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
