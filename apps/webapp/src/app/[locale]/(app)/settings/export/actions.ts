"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { exportStorageConfig } from "@/db";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { EXPORT_CATEGORIES, type ExportCategory } from "@/lib/export/types";
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
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { deleteOrgSecret, storeOrgSecret } from "@/lib/vault";

export interface StartExportInput {
	categories: ExportCategory[];
}

const startExportSchema = z.strictObject({
	// Unknown categories are dropped; at least one known category must remain.
	categories: z
		.array(z.string())
		.transform((categories) =>
			categories.filter((category): category is ExportCategory =>
				EXPORT_CATEGORIES.includes(category as ExportCategory),
			),
		)
		.refine(
			(categories) => categories.length > 0,
			"At least one valid export category must be selected",
		),
});

const exportIdSchema = z.strictObject({
	exportId: z.string().min(1, "Export is required"),
});

/**
 * Start a new export request
 */
export const startExportAction = organizationAction(
	{ name: "dataExport.start", requires: "orgAdmin", schema: startExportSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			if (!actor.employee) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				);
			}
			const requestedById = actor.employee.id;

			return yield* Effect.promise(
				(): Promise<ExportRecord> =>
					createExportRequest({
						organizationId,
						requestedById,
						categories: input.categories,
					}),
			);
		}),
);

/**
 * Get export history for the organization
 */
export const getExportHistoryAction = organizationAction(
	{ name: "dataExport.history", requires: "orgAdmin", schema: noInput },
	({ organizationId }) => Effect.promise(() => getExportHistory(organizationId)),
);

/**
 * Regenerate a presigned download URL for an export
 */
export const regenerateDownloadUrlAction = organizationAction(
	{ name: "dataExport.regenerateDownloadUrl", requires: "orgAdmin", schema: exportIdSchema },
	({ organizationId, input }) =>
		Effect.promise(() => regeneratePresignedUrl(input.exportId, organizationId)),
);

/**
 * Delete an export record and its S3 object
 */
export const deleteExportAction = organizationAction(
	{ name: "dataExport.delete", requires: "orgAdmin", schema: exportIdSchema },
	({ organizationId, input }) =>
		Effect.promise(() => deleteExportRecord(input.exportId, organizationId)),
);

// ============================================================
// S3 Storage Configuration Actions
// ============================================================

export interface StorageConfigInput {
	bucket: string;
	accessKeyId?: string;
	secretAccessKey?: string;
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

const storageConfigSchema = z.strictObject({
	bucket: z.string(),
	accessKeyId: z.string().optional(),
	secretAccessKey: z.string().optional(),
	region: z.string(),
	endpoint: z.string().optional(),
}) satisfies z.ZodType<StorageConfigInput>;

const testStorageConnectionSchema = z.strictObject({
	testConfig: storageConfigSchema.partial().optional(),
});

function maskedStorageConfig(config: typeof exportStorageConfig.$inferSelect): StorageConfigResult {
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
}

function findStorageConfig(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("dataExport.findStorageConfig", () =>
			dbService.db.query.exportStorageConfig.findFirst({
				where: eq(exportStorageConfig.organizationId, organizationId),
			}),
		);
	});
}

/**
 * Get S3 storage configuration for an organization (masks sensitive data)
 */
export const getStorageConfigAction = organizationAction(
	{ name: "dataExport.getStorageConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const config = yield* findStorageConfig(organizationId);
			return config ? maskedStorageConfig(config) : null;
		}),
);

/**
 * Save S3 storage configuration for an organization
 * Non-secret fields stored in database, secrets stored in Vault
 */
export const saveStorageConfigAction = organizationAction(
	{ name: "dataExport.saveStorageConfig", requires: "orgAdmin", schema: storageConfigSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const existing = yield* findStorageConfig(organizationId);
			const hasAccessKey = Boolean(input.accessKeyId);
			const hasSecretKey = Boolean(input.secretAccessKey);
			if (hasAccessKey !== hasSecretKey || (!existing && !hasAccessKey)) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Both storage credentials are required when replacing credentials",
					}),
				);
			}

			// Store only explicitly replaced secrets in Vault.
			const { accessKeyId, secretAccessKey } = input;
			if (accessKeyId && secretAccessKey) {
				yield* Effect.promise(() =>
					Promise.all([
						storeOrgSecret(organizationId, "storage/access_key_id", accessKeyId),
						storeOrgSecret(organizationId, "storage/secret_access_key", secretAccessKey),
					]),
				);
			}

			// Save or update the non-secret config in the database.
			const config = yield* dbService.query("dataExport.saveStorageConfig", async () => {
				if (existing) {
					const [updated] = await dbService.db
						.update(exportStorageConfig)
						.set({
							bucket: input.bucket,
							region: input.region,
							endpoint: input.endpoint || null,
							isVerified: false, // Reset verification on update
							lastVerifiedAt: null,
						})
						.where(eq(exportStorageConfig.id, existing.id))
						.returning();
					return updated;
				}

				const [inserted] = await dbService.db
					.insert(exportStorageConfig)
					.values({
						organizationId,
						bucket: input.bucket,
						region: input.region,
						endpoint: input.endpoint || null,
						createdBy: actor.userId,
						updatedAt: new Date(),
					})
					.returning();
				return inserted;
			});

			return maskedStorageConfig(config);
		}),
);

/**
 * Test S3 connection with stored or provided credentials
 * When testing with new credentials, they are passed directly.
 * When testing stored config, secrets are fetched from Vault.
 */
export const testStorageConnectionAction = organizationAction(
	{
		name: "dataExport.testStorageConnection",
		requires: "orgAdmin",
		schema: testStorageConnectionSchema,
	},
	({ organizationId, input: { testConfig } }) =>
		Effect.gen(function* () {
			let config: S3StorageConfig;
			// If full test config provided (new credentials being tested), use it directly
			if (
				testConfig?.bucket &&
				testConfig.accessKeyId &&
				testConfig.secretAccessKey &&
				testConfig.region
			) {
				config = {
					bucket: testConfig.bucket,
					accessKeyId: testConfig.accessKeyId,
					secretAccessKey: testConfig.secretAccessKey,
					region: testConfig.region,
					endpoint: testConfig.endpoint || null,
				};
			} else {
				// Otherwise get from database + Vault
				const storedConfig = yield* Effect.promise(() => getStorageConfig(organizationId));
				if (!storedConfig) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "No storage configuration found. Please save your configuration first.",
							entityType: "export_storage_config",
						}),
					);
				}

				// Merge with any provided overrides (except secrets)
				config = {
					...storedConfig,
					bucket: testConfig?.bucket || storedConfig.bucket,
					region: testConfig?.region || storedConfig.region,
					endpoint:
						testConfig?.endpoint !== undefined
							? testConfig.endpoint || null
							: storedConfig.endpoint,
				};
			}

			const result = yield* Effect.promise(() => testS3Connection(config));

			// If successful, update verification status
			if (result.success) {
				const dbService = yield* DatabaseService;
				yield* dbService.query("dataExport.markStorageVerified", () =>
					dbService.db
						.update(exportStorageConfig)
						.set({ isVerified: true, lastVerifiedAt: new Date() })
						.where(eq(exportStorageConfig.organizationId, organizationId)),
				);
			}

			return result;
		}),
);

/**
 * Delete S3 storage configuration for an organization
 * Removes both database config and Vault secrets
 */
export const deleteStorageConfigAction = organizationAction(
	{ name: "dataExport.deleteStorageConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			yield* Effect.promise(() =>
				Promise.all([
					deleteOrgSecret(organizationId, "storage/access_key_id"),
					deleteOrgSecret(organizationId, "storage/secret_access_key"),
				]),
			);

			const dbService = yield* DatabaseService;
			yield* dbService.query("dataExport.deleteStorageConfig", () =>
				dbService.db
					.delete(exportStorageConfig)
					.where(eq(exportStorageConfig.organizationId, organizationId)),
			);
		}),
);
