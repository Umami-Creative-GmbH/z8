"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { db, exportStorageConfig } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { EXPORT_CATEGORIES, type ExportCategory } from "@/lib/export/data-fetchers";
import {
	createExportRequest,
	deleteExportRecord,
	type ExportRecord,
	getExportHistory,
	regeneratePresignedUrl,
} from "@/lib/export/export-service";
import {
	getStorageConfig,
	type S3StorageConfig,
	testS3Connection,
} from "@/lib/storage/export-s3-client";

/**
 * Check if user is org admin or owner
 */
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
	});

	return membership?.role === "admin" || membership?.role === "owner";
}

export interface StartExportInput {
	organizationId: string;
	categories: ExportCategory[];
}

/**
 * Start a new export request
 */
export async function startExportAction(
	input: StartExportInput,
): Promise<ServerActionResult<ExportRecord>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Get current employee
		const dbService = yield* _(DatabaseService);
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, input.organizationId),
					),
				});

				if (!emp) {
					throw new Error("Employee not found");
				}

				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Step 3: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "data_export",
						action: "create",
					}),
				),
			);
		}

		// Step 4: Validate categories
		const validCategories = input.categories.filter((cat) => EXPORT_CATEGORIES.includes(cat));

		if (validCategories.length === 0) {
			throw new Error("At least one valid export category must be selected");
		}

		// Step 5: Create export request
		const exportRecord = yield* _(
			Effect.promise(() =>
				createExportRequest({
					organizationId: input.organizationId,
					requestedById: currentEmployee.id,
					categories: validCategories,
				}),
			),
		);

		return exportRecord;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get export history for the organization
 */
export async function getExportHistoryAction(
	organizationId: string,
): Promise<ServerActionResult<ExportRecord[]>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user belongs to org
		const dbService = yield* _(DatabaseService);
		yield* _(
			dbService.query("verifyOrgMembership", async () => {
				const emp = await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, organizationId),
					),
				});

				if (!emp) {
					throw new Error("Not a member of this organization");
				}

				return emp;
			}),
			Effect.mapError(
				() =>
					new AuthorizationError({
						message: "Not authorized to access this organization",
						userId: session.user.id,
						resource: "data_export",
						action: "read",
					}),
			),
		);

		// Step 3: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "data_export",
						action: "read",
					}),
				),
			);
		}

		// Step 4: Get export history
		const exports = yield* _(Effect.promise(() => getExportHistory(organizationId)));

		return exports;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Regenerate a presigned download URL for an export
 */
export async function regenerateDownloadUrlAction(
	exportId: string,
	organizationId: string,
): Promise<ServerActionResult<string>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "data_export",
						action: "regenerate_url",
					}),
				),
			);
		}

		// Step 3: Regenerate URL
		const url = yield* _(Effect.promise(() => regeneratePresignedUrl(exportId)));

		return url;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete an export record and its S3 object
 */
export async function deleteExportAction(
	exportId: string,
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "data_export",
						action: "delete",
					}),
				),
			);
		}

		// Step 3: Delete export
		yield* _(Effect.promise(() => deleteExportRecord(exportId, organizationId)));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================================
// S3 Storage Configuration Actions
// ============================================================

export interface StorageConfigInput {
	organizationId: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	endpoint?: string;
}

export interface StorageConfigResult {
	id: string;
	bucket: string;
	region: string;
	endpoint: string | null;
	isVerified: boolean;
	lastVerifiedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

/**
 * Get S3 storage configuration for an organization (masks sensitive data)
 */
export async function getStorageConfigAction(
	organizationId: string,
): Promise<ServerActionResult<StorageConfigResult | null>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "storage_config",
						action: "read",
					}),
				),
			);
		}

		// Step 3: Get storage config
		const config = yield* _(
			Effect.promise(async () => {
				const result = await db.query.exportStorageConfig.findFirst({
					where: eq(exportStorageConfig.organizationId, organizationId),
				});

				if (!result) return null;

				// Return masked config (no secrets)
				return {
					id: result.id,
					bucket: result.bucket,
					region: result.region,
					endpoint: result.endpoint,
					isVerified: result.isVerified,
					lastVerifiedAt: result.lastVerifiedAt,
					createdAt: result.createdAt,
					updatedAt: result.updatedAt,
				};
			}),
		);

		return config;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Save S3 storage configuration for an organization
 */
export async function saveStorageConfigAction(
	input: StorageConfigInput,
): Promise<ServerActionResult<StorageConfigResult>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, input.organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "storage_config",
						action: "create",
					}),
				),
			);
		}

		// Step 3: Save or update storage config
		const config = yield* _(
			Effect.promise(async () => {
				// Check if config exists
				const existing = await db.query.exportStorageConfig.findFirst({
					where: eq(exportStorageConfig.organizationId, input.organizationId),
				});

				if (existing) {
					// Update existing
					const [updated] = await db
						.update(exportStorageConfig)
						.set({
							bucket: input.bucket,
							accessKeyId: input.accessKeyId,
							secretAccessKey: input.secretAccessKey,
							region: input.region,
							endpoint: input.endpoint || null,
							isVerified: false, // Reset verification on update
							lastVerifiedAt: null,
						})
						.where(eq(exportStorageConfig.id, existing.id))
						.returning();

					return updated;
				} else {
					// Insert new
					const [inserted] = await db
						.insert(exportStorageConfig)
						.values({
							organizationId: input.organizationId,
							bucket: input.bucket,
							accessKeyId: input.accessKeyId,
							secretAccessKey: input.secretAccessKey,
							region: input.region,
							endpoint: input.endpoint || null,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning();

					return inserted;
				}
			}),
		);

		// Return masked config
		return {
			id: config.id,
			bucket: config.bucket,
			region: config.region,
			endpoint: config.endpoint,
			isVerified: config.isVerified,
			lastVerifiedAt: config.lastVerifiedAt,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		};
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Test S3 connection with stored or provided credentials
 */
export async function testStorageConnectionAction(
	organizationId: string,
	testConfig?: Partial<StorageConfigInput>,
): Promise<ServerActionResult<{ success: boolean; message: string }>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "storage_config",
						action: "test",
					}),
				),
			);
		}

		// Step 3: Get full config (merge stored with test input)
		const config = yield* _(
			Effect.promise(async (): Promise<S3StorageConfig> => {
				// If full test config provided, use it
				if (
					testConfig?.bucket &&
					testConfig?.accessKeyId &&
					testConfig?.secretAccessKey &&
					testConfig?.region
				) {
					return {
						bucket: testConfig.bucket,
						accessKeyId: testConfig.accessKeyId,
						secretAccessKey: testConfig.secretAccessKey,
						region: testConfig.region,
						endpoint: testConfig.endpoint || null,
					};
				}

				// Otherwise get from database
				const storedConfig = await getStorageConfig(organizationId);
				if (!storedConfig) {
					throw new Error("No storage configuration found. Please save your configuration first.");
				}

				// Merge with any provided overrides (except secrets)
				return {
					...storedConfig,
					bucket: testConfig?.bucket || storedConfig.bucket,
					region: testConfig?.region || storedConfig.region,
					endpoint:
						testConfig?.endpoint !== undefined
							? testConfig.endpoint || null
							: storedConfig.endpoint,
				};
			}),
		);

		// Step 4: Test connection
		const result = yield* _(Effect.promise(() => testS3Connection(config)));

		// Step 5: If successful, update verification status
		if (result.success) {
			yield* _(
				Effect.promise(async () => {
					await db
						.update(exportStorageConfig)
						.set({
							isVerified: true,
							lastVerifiedAt: new Date(),
						})
						.where(eq(exportStorageConfig.organizationId, organizationId));
				}),
			);
		}

		return result;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete S3 storage configuration for an organization
 */
export async function deleteStorageConfigAction(
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		// Step 1: Get session via AuthService
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		// Step 2: Verify user is org admin
		const hasPermission = yield* _(
			Effect.promise(() => isOrgAdmin(session.user.id, organizationId)),
		);

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "storage_config",
						action: "delete",
					}),
				),
			);
		}

		// Step 3: Delete storage config
		yield* _(
			Effect.promise(async () => {
				await db
					.delete(exportStorageConfig)
					.where(eq(exportStorageConfig.organizationId, organizationId));
			}),
		);
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
