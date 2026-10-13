/**
 * Export Processor Job
 *
 * Handles processing pending data exports:
 * 1. Fetches pending export records
 * 2. Processes each export (fetch data, zip, upload to S3)
 * 3. Sends notification emails on completion/failure
 */

import { and, eq } from "drizzle-orm";
import { dataExport, db, employee, organization } from "@/db";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type EmailTranslate,
	type EmailTranslator,
	loadEmailTranslator,
} from "@/lib/email/email-i18n";
import { sendEmail } from "@/lib/email/email-service";
import { renderExportFailed, renderExportReady } from "@/lib/email/render";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import {
	cleanupExpiredExports,
	type ExportRecord,
	formatFileSize,
	getPendingExports,
	processExport,
} from "@/lib/export/export-service";
import { type ExportCategory, exportHistoryPath } from "@/lib/export/types";
import { createLogger } from "@/lib/logger";
import {
	formatNotificationParam,
	notificationParam,
} from "@/lib/notifications/notification-params";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";

const logger = createLogger("ExportProcessorJob");

function maskEmailAddress(email: string): string {
	return `${email.slice(0, 3)}***`;
}

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
	userId: string;
	email: string;
	name: string;
	organizationName: string;
	organizationTimezone: string;
} | null> {
	try {
		// Get employee who requested the export
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.id, exportRecord.requestedById),
				eq(employee.organizationId, exportRecord.organizationId),
			),
			with: {
				user: {
					columns: {
						id: true,
						firstName: true,
						lastName: true,
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
				timezone: true,
			},
		});

		return {
			userId: emp.user.id,
			email: emp.user.email,
			name: buildAuthUserDisplayName(emp.user) || "Admin",
			organizationName: org?.name || "Your Organization",
			organizationTimezone: resolveOrganizationTimezone(org?.timezone ?? undefined).timezone,
		};
	} catch (error) {
		logger.error({ exportId: exportRecord.id, error }, "Failed to get requester details");
		return null;
	}
}

/** The `emails` translator in the requester's recipient language. */
async function requesterTranslator(
	exportRecord: ExportRecord,
	userId: string,
): Promise<EmailTranslator> {
	return loadEmailTranslator(
		await resolveRecipientNotificationLocale({
			userId,
			organizationId: exportRecord.organizationId,
		}),
	);
}

/** The exported data categories in the recipient language. */
function exportCategoryLabels(t: EmailTranslate, categories: readonly string[]): string[] {
	return categories.map((category) => {
		switch (category as ExportCategory) {
			case "employees":
				return t("emails.export.categories.employees", "Employees");
			case "teams":
				return t("emails.export.categories.teams", "Teams");
			case "time_entries":
				return t("emails.export.categories.timeEntries", "Time Tracking");
			case "work_periods":
				return t("emails.export.categories.workPeriods", "Work Periods");
			case "absences":
				return t("emails.export.categories.absences", "Absences");
			case "balance_adjustments":
				return t("emails.export.categories.balanceAdjustments", "Work Balance Adjustments");
			case "holidays":
				return t("emails.export.categories.holidays", "Holidays");
			case "vacation":
				return t("emails.export.categories.vacation", "Vacation Policies");
			case "schedules":
				return t("emails.export.categories.schedules", "Work Schedules");
			case "shifts":
				return t("emails.export.categories.shifts", "Shifts");
			case "audit_logs":
				return t("emails.export.categories.auditLogs", "Audit Logs");
			case "projects":
				return t("emails.export.categories.projects", "Projects");
			case "customers":
				return t("emails.export.categories.customers", "Customers");
			default:
				return category;
		}
	});
}

/**
 * Send success notification email
 */
async function sendSuccessEmail(exportRecord: ExportRecord): Promise<void> {
	const requester = await getRequesterDetails(exportRecord);
	if (!requester) return;

	if (!exportRecord.expiresAt) {
		logger.error({ exportId: exportRecord.id }, "Completed export has no expiry");
		return;
	}

	try {
		// A presigned URL would expire long before the email is read, so the
		// email links to the export history, which signs a fresh URL per download.
		// The path names the export's organization so a multi-org admin is not
		// shown the history of whichever organization is active.
		const translator = await requesterTranslator(exportRecord, requester.userId);
		const { locale, t } = translator;
		const downloadUrl = `${getDefaultAppBaseUrl()}/${locale}${exportHistoryPath(exportRecord.organizationId)}`;

		// The file itself stays available until the export expires: shown in the
		// organization timezone with the zone printed.
		const expiresAt = formatNotificationParam(
			notificationParam.zonedInstant(
				instantFromDate(exportRecord.expiresAt),
				requester.organizationTimezone,
			),
			{ locale },
		);

		const data = {
			recipientName: requester.name,
			organizationName: requester.organizationName,
			categories: exportCategoryLabels(t, exportRecord.categories),
			fileSize: formatFileSize(exportRecord.fileSizeBytes),
			downloadUrl,
			expiresAt,
		};
		const rendered = await renderOrganizationEmailTemplate({
			organizationId: exportRecord.organizationId,
			templateKey: "export-ready",
			data,
			subjectOverride: t(
				"emails.subjects.exportReady",
				"Your data export is ready - {organizationName}",
				{ organizationName: requester.organizationName },
			),
			renderDefaultHtml: () => renderExportReady(data, translator),
		});

		await sendEmail({
			to: requester.email,
			subject: rendered.subject,
			html: rendered.html,
			organizationId: exportRecord.organizationId,
		});

		logger.info(
			{ exportId: exportRecord.id, email: maskEmailAddress(requester.email) },
			"Sent export success email",
		);
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
		const translator = await requesterTranslator(exportRecord, requester.userId);
		const { t } = translator;

		const data = {
			recipientName: requester.name,
			organizationName: requester.organizationName,
			categories: exportCategoryLabels(t, exportRecord.categories),
			errorMessage:
				exportRecord.errorMessage || t("emails.exportFailed.unknownError", "Unknown error"),
			// Build retry URL (settings page)
			retryUrl: `${getDefaultAppBaseUrl()}/settings/export`,
		};
		const rendered = await renderOrganizationEmailTemplate({
			organizationId: exportRecord.organizationId,
			templateKey: "export-failed",
			data,
			subjectOverride: t(
				"emails.subjects.exportFailed",
				"Data export failed - {organizationName}",
				{
					organizationName: requester.organizationName,
				},
			),
			renderDefaultHtml: () => renderExportFailed(data, translator),
		});

		await sendEmail({
			to: requester.email,
			subject: rendered.subject,
			html: rendered.html,
			organizationId: exportRecord.organizationId,
		});

		logger.info(
			{ exportId: exportRecord.id, email: maskEmailAddress(requester.email) },
			"Sent export failure email",
		);
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

		// Process each independent export concurrently, then aggregate the outcomes.
		const processResults = await Promise.all(
			pendingExports.map(async (exportRecord) => ({
				exportRecord,
				processResult: await processSingleExport(exportRecord),
			})),
		);

		for (const { exportRecord, processResult } of processResults) {
			result.exportsProcessed++;
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
