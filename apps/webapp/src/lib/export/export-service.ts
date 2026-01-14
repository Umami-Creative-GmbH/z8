import { and, desc, eq } from "drizzle-orm";
import { dataExport, db } from "@/db";
import { createLogger } from "@/lib/logger";
import {
	deleteExport,
	generateExportKey,
	getPresignedUrl,
	isExportS3Configured,
	uploadExport,
} from "@/lib/storage/export-s3-client";
import { type ExportCategory, fetchExportData } from "./data-fetchers";
import { buildExportZip } from "./zip-builder";

// Import and re-export client-safe utilities from utils.ts
import { type ExportRecord, formatFileSize } from "./utils";
export { type ExportRecord, formatFileSize };

const logger = createLogger("ExportService");

export interface CreateExportParams {
	organizationId: string;
	requestedById: string;
	categories: ExportCategory[];
}

/**
 * Create a new export request (pending state)
 * This is called by the user action and creates a record for the cron job to pick up
 */
export async function createExportRequest(params: CreateExportParams): Promise<ExportRecord> {
	const { organizationId, requestedById, categories } = params;

	logger.info({ organizationId, requestedById, categories }, "Creating export request");

	// Validate S3 is configured for this organization
	const s3Configured = await isExportS3Configured(organizationId);
	if (!s3Configured) {
		throw new Error(
			"Export S3 storage is not configured. Please configure S3 settings in the Export settings page.",
		);
	}

	// Check for existing pending/processing exports for this org (rate limiting)
	const existingExport = await db.query.dataExport.findFirst({
		where: and(eq(dataExport.organizationId, organizationId), eq(dataExport.status, "pending")),
	});

	if (existingExport) {
		throw new Error(
			"An export is already pending for this organization. Please wait for it to complete.",
		);
	}

	const processingExport = await db.query.dataExport.findFirst({
		where: and(eq(dataExport.organizationId, organizationId), eq(dataExport.status, "processing")),
	});

	if (processingExport) {
		throw new Error(
			"An export is currently being processed for this organization. Please wait for it to complete.",
		);
	}

	// Create export record
	const [exportRecord] = await db
		.insert(dataExport)
		.values({
			organizationId,
			requestedById,
			categories,
			status: "pending",
		})
		.returning();

	logger.info({ exportId: exportRecord.id }, "Export request created");

	return exportRecord as ExportRecord;
}

/**
 * Get export history for an organization
 */
export async function getExportHistory(organizationId: string): Promise<ExportRecord[]> {
	const exports = await db.query.dataExport.findMany({
		where: eq(dataExport.organizationId, organizationId),
		orderBy: [desc(dataExport.createdAt)],
		limit: 50,
	});

	return exports as ExportRecord[];
}

/**
 * Get a single export by ID
 */
export async function getExportById(exportId: string): Promise<ExportRecord | null> {
	const exportRecord = await db.query.dataExport.findFirst({
		where: eq(dataExport.id, exportId),
	});

	return exportRecord as ExportRecord | null;
}

/**
 * Process a pending export
 * This is called by the cron job
 */
export async function processExport(exportId: string): Promise<void> {
	logger.info({ exportId }, "Processing export");

	// Get export record
	const exportRecord = await getExportById(exportId);
	if (!exportRecord) {
		throw new Error(`Export not found: ${exportId}`);
	}

	if (exportRecord.status !== "pending") {
		logger.warn({ exportId, status: exportRecord.status }, "Export is not in pending state");
		return;
	}

	// Mark as processing
	await db.update(dataExport).set({ status: "processing" }).where(eq(dataExport.id, exportId));

	try {
		// Fetch data for all categories
		const data = await fetchExportData(
			exportRecord.organizationId,
			exportRecord.categories as ExportCategory[],
		);

		// Build ZIP archive
		const zipBuffer = await buildExportZip(exportRecord.organizationId, data);

		// Generate S3 key
		const s3Key = generateExportKey(exportRecord.organizationId, exportId, exportRecord.createdAt);

		// Upload to S3
		await uploadExport(exportRecord.organizationId, s3Key, zipBuffer, "application/zip");

		// Calculate expiry (30 days from now)
		const expiresAt = new Date();
		expiresAt.setDate(expiresAt.getDate() + 30);

		// Update export record
		await db
			.update(dataExport)
			.set({
				status: "completed",
				s3Key,
				fileSizeBytes: zipBuffer.length,
				completedAt: new Date(),
				expiresAt,
			})
			.where(eq(dataExport.id, exportId));

		logger.info({ exportId, s3Key, sizeBytes: zipBuffer.length }, "Export completed successfully");
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ exportId, error: errorMessage }, "Export failed");

		await db
			.update(dataExport)
			.set({
				status: "failed",
				errorMessage,
				completedAt: new Date(),
			})
			.where(eq(dataExport.id, exportId));

		throw error;
	}
}

/**
 * Get pending exports that need processing
 */
export async function getPendingExports(): Promise<ExportRecord[]> {
	const exports = await db.query.dataExport.findMany({
		where: eq(dataExport.status, "pending"),
		orderBy: [dataExport.createdAt],
	});

	return exports as ExportRecord[];
}

/**
 * Generate a new presigned URL for an existing export
 */
export async function regeneratePresignedUrl(exportId: string): Promise<string> {
	const exportRecord = await getExportById(exportId);
	if (!exportRecord) {
		throw new Error(`Export not found: ${exportId}`);
	}

	if (exportRecord.status !== "completed") {
		throw new Error("Export is not completed");
	}

	if (!exportRecord.s3Key) {
		throw new Error("Export has no S3 key");
	}

	// Generate new presigned URL (24 hours)
	const url = await getPresignedUrl(exportRecord.organizationId, exportRecord.s3Key, 86400);

	logger.info({ exportId }, "Regenerated presigned URL");

	return url;
}

/**
 * Delete an export and its S3 object
 */
export async function deleteExportRecord(exportId: string, organizationId: string): Promise<void> {
	const exportRecord = await getExportById(exportId);
	if (!exportRecord) {
		throw new Error(`Export not found: ${exportId}`);
	}

	// Verify organization ownership
	if (exportRecord.organizationId !== organizationId) {
		throw new Error("Export does not belong to this organization");
	}

	// Delete from S3 if exists
	if (exportRecord.s3Key) {
		try {
			await deleteExport(organizationId, exportRecord.s3Key);
		} catch (error) {
			logger.warn({ exportId, s3Key: exportRecord.s3Key, error }, "Failed to delete S3 object");
			// Continue with database deletion
		}
	}

	// Delete from database
	await db.delete(dataExport).where(eq(dataExport.id, exportId));

	logger.info({ exportId }, "Export deleted");
}

/**
 * Clean up expired exports
 * This should be called periodically (e.g., daily cron job)
 */
export async function cleanupExpiredExports(): Promise<number> {
	const now = new Date();

	// Find expired exports
	const expiredExports = await db.query.dataExport.findMany({
		where: and(
			eq(dataExport.status, "completed"),
			// expiresAt < now
		),
	});

	const actuallyExpired = expiredExports.filter((e) => e.expiresAt && e.expiresAt < now);

	let deletedCount = 0;

	for (const exportRecord of actuallyExpired) {
		try {
			// Delete from S3
			if (exportRecord.s3Key) {
				await deleteExport(exportRecord.organizationId, exportRecord.s3Key);
			}

			// Delete from database
			await db.delete(dataExport).where(eq(dataExport.id, exportRecord.id));

			deletedCount++;
		} catch (error) {
			logger.error({ exportId: exportRecord.id, error }, "Failed to cleanup expired export");
		}
	}

	if (deletedCount > 0) {
		logger.info({ deletedCount }, "Cleaned up expired exports");
	}

	return deletedCount;
}
