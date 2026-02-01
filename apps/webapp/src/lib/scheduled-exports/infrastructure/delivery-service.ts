/**
 * Delivery Service
 *
 * Handles S3 upload and email notification delivery for scheduled exports.
 */
import { DateTime } from "luxon";
import { createLogger } from "@/lib/logger";
import { sendEmail } from "@/lib/email/email-service";
import { getPresignedUrl, uploadExport } from "@/lib/storage/export-s3-client";
import type {
	CalculatedDateRange,
	DeliveryConfig,
	DeliveryResult,
	ExecutionResult,
} from "../domain/types";

const logger = createLogger("ScheduledExportDeliveryService");

/**
 * HTML escape function to prevent XSS in email templates
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Delivery parameters
 */
export interface DeliveryParams {
	organizationId: string;
	scheduleName: string;
	dateRange: CalculatedDateRange;
	deliveryConfig: DeliveryConfig;
	exportResult: ExecutionResult;
}

/**
 * Email template data
 */
interface EmailTemplateData {
	scheduleName: string;
	dateRangeStart: string;
	dateRangeEnd: string;
	downloadUrl?: string;
	recordCount?: number;
	expiresAt: string;
}

/**
 * Delivery Service
 *
 * Handles S3 upload and email notifications for completed scheduled exports.
 */
export class DeliveryService {
	/**
	 * Deliver export results via configured method (S3, email, or both)
	 */
	async deliver(params: DeliveryParams): Promise<DeliveryResult> {
		const { organizationId, scheduleName, dateRange, deliveryConfig, exportResult } = params;

		const result: DeliveryResult = {
			emailsSent: 0,
			emailsFailed: 0,
			emailErrors: [],
		};

		try {
			// Determine S3 key and URL
			let s3Key = exportResult.s3Key;
			let s3Url = exportResult.s3Url;

			// If export result doesn't have S3 info but we need it, generate it
			if (
				(deliveryConfig.method === "s3_only" || deliveryConfig.method === "s3_and_email") &&
				!s3Url &&
				s3Key
			) {
				// Generate presigned URL with 7-day expiry
				s3Url = await getPresignedUrl(organizationId, s3Key, 604800);
			}

			result.s3Key = s3Key;
			result.s3Url = s3Url;

			// Send emails if configured
			if (
				deliveryConfig.method === "email_only" ||
				deliveryConfig.method === "s3_and_email"
			) {
				const emailResult = await this.sendNotificationEmails({
					organizationId,
					scheduleName,
					dateRange,
					recipients: deliveryConfig.emailRecipients,
					downloadUrl: s3Url,
					recordCount: exportResult.recordCount,
					subjectTemplate: deliveryConfig.emailSubjectTemplate,
				});

				result.emailsSent = emailResult.sent;
				result.emailsFailed = emailResult.failed;
				result.emailErrors = emailResult.errors;
			}

			return result;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			logger.error({ error: errorMessage, organizationId, scheduleName }, "Delivery failed");
			throw error;
		}
	}

	/**
	 * Send notification emails to all recipients
	 */
	private async sendNotificationEmails(params: {
		organizationId: string;
		scheduleName: string;
		dateRange: CalculatedDateRange;
		recipients: string[];
		downloadUrl?: string;
		recordCount?: number;
		subjectTemplate?: string;
	}): Promise<{
		sent: number;
		failed: number;
		errors: Array<{ recipient: string; error: string; timestamp: string }>;
	}> {
		const { organizationId, scheduleName, dateRange, recipients, downloadUrl, recordCount, subjectTemplate } = params;

		const result = {
			sent: 0,
			failed: 0,
			errors: [] as Array<{ recipient: string; error: string; timestamp: string }>,
		};

		// Generate email content
		const subject = this.renderSubject(subjectTemplate, {
			scheduleName,
			dateRange: `${dateRange.start.toISODate()} - ${dateRange.end.toISODate()}`,
		});

		const expiresAt = DateTime.utc().plus({ days: 7 }).toFormat("LLLL d, yyyy 'at' h:mm a");

		const templateData: EmailTemplateData = {
			scheduleName,
			dateRangeStart: dateRange.start.toFormat("LLLL d, yyyy"),
			dateRangeEnd: dateRange.end.toFormat("LLLL d, yyyy"),
			downloadUrl,
			recordCount,
			expiresAt,
		};

		const html = this.renderEmailHtml(templateData);

		// Send to each recipient
		for (const recipient of recipients) {
			try {
				await sendEmail({
					to: recipient,
					subject,
					html,
					organizationId,
				});
				result.sent++;
				logger.info({ recipient, scheduleName }, "Notification email sent");
			} catch (error) {
				result.failed++;
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				result.errors.push({ recipient, error: errorMessage, timestamp: DateTime.utc().toISO()! });
				logger.error({ recipient, error: errorMessage, scheduleName }, "Email sending failed");
			}
		}

		return result;
	}

	/**
	 * Render email subject from template
	 */
	private renderSubject(
		template: string | undefined,
		variables: Record<string, string>,
	): string {
		const defaultTemplate = "Scheduled Export: {scheduleName} ({dateRange})";
		const finalTemplate = template || defaultTemplate;

		return Object.entries(variables).reduce(
			(result, [key, value]) => result.replace(`{${key}}`, value),
			finalTemplate,
		);
	}

	/**
	 * Render email HTML content
	 */
	private renderEmailHtml(data: EmailTemplateData): string {
		const { scheduleName, dateRangeStart, dateRangeEnd, downloadUrl, recordCount, expiresAt } = data;

		// Escape user-controlled data to prevent XSS
		const safeScheduleName = escapeHtml(scheduleName);
		const safeDateRangeStart = escapeHtml(dateRangeStart);
		const safeDateRangeEnd = escapeHtml(dateRangeEnd);
		const safeExpiresAt = escapeHtml(expiresAt);

		return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 8px 0; font-size: 24px; color: #1a1a1a; }
    .info-row { margin: 12px 0; }
    .info-label { color: #666; font-size: 14px; }
    .info-value { font-weight: 500; color: #1a1a1a; }
    .button { display: inline-block; background: #2563eb; color: #fff !important; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; margin: 20px 0; }
    .button:hover { background: #1d4ed8; }
    .expiry { color: #666; font-size: 13px; margin-top: 8px; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Scheduled Export Ready</h1>
    <p>Your scheduled export <strong>${safeScheduleName}</strong> has completed successfully.</p>
  </div>

  <div class="info-row">
    <div class="info-label">Date Range</div>
    <div class="info-value">${safeDateRangeStart} to ${safeDateRangeEnd}</div>
  </div>

  ${recordCount !== undefined ? `
  <div class="info-row">
    <div class="info-label">Records</div>
    <div class="info-value">${recordCount.toLocaleString()}</div>
  </div>
  ` : ''}

  ${downloadUrl ? `
  <a href="${escapeHtml(downloadUrl)}" class="button">Download Export</a>
  <p class="expiry">This download link will expire on ${safeExpiresAt}.</p>
  ` : ''}

  <div class="footer">
    This is an automated email from your scheduled export configuration.
  </div>
</body>
</html>
`.trim();
	}
}
