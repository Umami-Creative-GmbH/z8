/**
 * Export Processor Job
 *
 * Handles processing pending data exports:
 * 1. Fetches pending export records
 * 2. Processes each export (fetch data, zip, upload to S3)
 * 3. Sends notification emails on completion/failure
 */

import { eq } from "drizzle-orm";
import { dataExport, db, employee, organization, user } from "@/db";
import { sendEmail } from "@/lib/email/email-service";
import { renderExportFailed, renderExportReady } from "@/lib/email/render";
import { CATEGORY_LABELS, type ExportCategory } from "@/lib/export/data-fetchers";
import {
	cleanupExpiredExports,
	type ExportRecord,
	formatFileSize,
	getPendingExports,
	processExport,
	regeneratePresignedUrl,
} from "@/lib/export/export-service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("ExportProcessorJob");

export interface ExportJobResult {
	success: boolean;
	exportsProcessed: number;
	exportsSucceeded: number;
	exportsFailed: number;
	expiredExportsCleaned: number;
	errors: Array<{ exportId: string; error: string }>;
}

/**
 * Get requester details for sending email
 */
async function getRequesterDetails(exportRecord: ExportRecord): Promise<{
	email: string;
	name: string;
	organizationName: string;
} | null> {
	try {
		// Get employee who requested the export
		const emp = await db.query.employee.findFirst({
			where: eq(employee.id, exportRecord.requestedById),
			with: {
				user: {
					columns: {
						email: true,
						name: true,
					},
				},
			},
		});

		if (!emp?.user?.email) {
			logger.warn({ exportId: exportRecord.id }, "Could not find requester email");
			return null;
		}

		// Get organization name
		const org = await db.query.organization.findFirst({
			where: eq(organization.id, exportRecord.organizationId),
			columns: {
				name: true,
			},
		});

		return {
			email: emp.user.email,
			name: emp.user.name || emp.firstName || "Admin",
			organizationName: org?.name || "Your Organization",
		};
	} catch (error) {
		logger.error({ exportId: exportRecord.id, error }, "Failed to get requester details");
		return null;
	}
}

/**
 * Send success notification email
 */
async function sendSuccessEmail(exportRecord: ExportRecord): Promise<void> {
	const requester = await getRequesterDetails(exportRecord);
	if (!requester) return;

	try {
		// Generate presigned URL
		const downloadUrl = await regeneratePresignedUrl(exportRecord.id);

		// Format categories for display
		const categoryNames = exportRecord.categories.map(
			(cat) => CATEGORY_LABELS[cat as ExportCategory] || cat,
		);

		// Format expiry date
		const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString("en-US", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});

		const html = await renderExportReady({
			recipientName: requester.name,
			organizationName: requester.organizationName,
			categories: categoryNames,
			fileSize: formatFileSize(exportRecord.fileSizeBytes),
			downloadUrl,
			expiresAt,
		});

		await sendEmail({
			to: requester.email,
			subject: `Your data export is ready - ${requester.organizationName}`,
			html,
		});

		logger.info({ exportId: exportRecord.id, email: requester.email }, "Sent export success email");
	} catch (error) {
		logger.error({ exportId: exportRecord.id, error }, "Failed to send success email");
	}
}

/**
 * Send failure notification email
 */
async function sendFailureEmail(exportRecord: ExportRecord): Promise<void> {
	const requester = await getRequesterDetails(exportRecord);
	if (!requester) return;

	try {
		// Format categories for display
		const categoryNames = exportRecord.categories.map(
			(cat) => CATEGORY_LABELS[cat as ExportCategory] || cat,
		);

		// Build retry URL (settings page)
		const retryUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/settings/export`;

		const html = await renderExportFailed({
			recipientName: requester.name,
			organizationName: requester.organizationName,
			categories: categoryNames,
			errorMessage: exportRecord.errorMessage || "Unknown error",
			retryUrl,
		});

		await sendEmail({
			to: requester.email,
			subject: `Data export failed - ${requester.organizationName}`,
			html,
		});

		logger.info({ exportId: exportRecord.id, email: requester.email }, "Sent export failure email");
	} catch (error) {
		logger.error({ exportId: exportRecord.id, error }, "Failed to send failure email");
	}
}

/**
 * Process a single export with error handling
 */
async function processSingleExport(
	exportRecord: ExportRecord,
): Promise<{ success: boolean; error?: string }> {
	try {
		logger.info({ exportId: exportRecord.id }, "Processing export");

		await processExport(exportRecord.id);

		// Get updated record for email
		const updatedRecord = await db.query.dataExport.findFirst({
			where: eq(dataExport.id, exportRecord.id),
		});

		if (updatedRecord && updatedRecord.status === "completed") {
			await sendSuccessEmail(updatedRecord as ExportRecord);
		}

		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ exportId: exportRecord.id, error: errorMessage }, "Export processing failed");

		// Get updated record for email
		const updatedRecord = await db.query.dataExport.findFirst({
			where: eq(dataExport.id, exportRecord.id),
		});

		if (updatedRecord) {
			await sendFailureEmail(updatedRecord as ExportRecord);
		}

		return { success: false, error: errorMessage };
	}
}

/**
 * Run the export processing job
 */
export async function runExportProcessor(): Promise<ExportJobResult> {
	logger.info("Starting export processor job");

	const result: ExportJobResult = {
		success: true,
		exportsProcessed: 0,
		exportsSucceeded: 0,
		exportsFailed: 0,
		expiredExportsCleaned: 0,
		errors: [],
	};

	try {
		// Get all pending exports
		const pendingExports = await getPendingExports();

		logger.info({ count: pendingExports.length }, "Found pending exports");

		// Process each export
		for (const exportRecord of pendingExports) {
			result.exportsProcessed++;

			const processResult = await processSingleExport(exportRecord);

			if (processResult.success) {
				result.exportsSucceeded++;
			} else {
				result.exportsFailed++;
				result.errors.push({
					exportId: exportRecord.id,
					error: processResult.error || "Unknown error",
				});
			}
		}

		// Clean up expired exports
		result.expiredExportsCleaned = await cleanupExpiredExports();

		// Set overall success based on whether any exports failed
		result.success = result.exportsFailed === 0;

		logger.info(
			{
				processed: result.exportsProcessed,
				succeeded: result.exportsSucceeded,
				failed: result.exportsFailed,
				cleaned: result.expiredExportsCleaned,
			},
			"Export processor job completed",
		);

		return result;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		logger.error({ error: errorMessage }, "Export processor job failed");

		return {
			...result,
			success: false,
			errors: [...result.errors, { exportId: "job", error: errorMessage }],
		};
	}
}
