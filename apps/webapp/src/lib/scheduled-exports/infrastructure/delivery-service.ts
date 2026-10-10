/**
 * Delivery Service
 *
 * Handles S3 upload and email notification delivery for scheduled exports.
 */
import { DateTime } from "luxon";
import type { Instant } from "@/lib/datetime/temporal-core";
import { sendEmail } from "@/lib/email/email-service";
import { createLogger } from "@/lib/logger";
import {
	type CalculatedDateRange,
	type DeliveryConfig,
	type DeliveryResult,
	deliversByEmail,
	type ExecutionResult,
	type SignedFileUrl,
} from "../domain/types";

const logger = createLogger("ScheduledExportDeliveryService");

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** "October 10, 2026 at 2:15 PM UTC" */
function formatExpiry(expiresAt: Instant): string {
	const utc = expiresAt.toZonedDateTimeISO("UTC");
	const hour = utc.hour % 12 || 12;
	const minute = String(utc.minute).padStart(2, "0");
	const meridiem = utc.hour < 12 ? "AM" : "PM";
	return `${MONTHS[utc.month - 1]} ${utc.day}, ${utc.year} at ${hour}:${minute} ${meridiem} UTC`;
}

/** "15 minutes", "7 days", "1 hour 30 minutes" */
function formatLifetime(totalSeconds: number): string {
	const units: Array<[number, string]> = [
		[Math.floor(totalSeconds / 86400), "day"],
		[Math.floor((totalSeconds % 86400) / 3600), "hour"],
		[Math.floor((totalSeconds % 3600) / 60), "minute"],
		[totalSeconds % 60, "second"],
	];
	return units
		.filter(([count]) => count > 0)
		.map(([count, unit]) => `${count} ${unit}${count === 1 ? "" : "s"}`)
		.join(" ");
}

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
	fileUrl?: SignedFileUrl;
	recordCount?: number;
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
			// The executor signs the URL of each file it stores, with its lifetime (#1008).
			const { s3Key, fileUrl } = exportResult;

			if (!s3Key) {
				logger.warn(
					{ organizationId, scheduleName, underlyingJobId: exportResult.underlyingJobId },
					"Scheduled export produced no file",
				);
			}

			result.s3Key = s3Key;
			result.s3Url = fileUrl?.url;

			// Send emails if configured
			if (deliversByEmail(deliveryConfig.method)) {
				const emailResult = await this.sendNotificationEmails({
					organizationId,
					scheduleName,
					dateRange,
					recipients: deliveryConfig.emailRecipients,
					fileUrl,
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
		fileUrl?: SignedFileUrl;
		recordCount?: number;
		subjectTemplate?: string;
	}): Promise<{
		sent: number;
		failed: number;
		errors: Array<{ recipient: string; error: string; timestamp: string }>;
	}> {
		const {
			organizationId,
			scheduleName,
			dateRange,
			recipients,
			fileUrl,
			recordCount,
			subjectTemplate,
		} = params;

		// Generate email content
		const subject = this.renderSubject(subjectTemplate, {
			scheduleName,
			dateRange: `${dateRange.start.toISODate()} - ${dateRange.end.toISODate()}`,
		});

		const templateData: EmailTemplateData = {
			scheduleName,
			dateRangeStart: dateRange.start.toFormat("LLLL d, yyyy"),
			dateRangeEnd: dateRange.end.toFormat("LLLL d, yyyy"),
			fileUrl,
			recordCount,
		};

		const html = this.renderEmailHtml(templateData);

		const deliveryResults = await Promise.all(
			recipients.map(async (recipient) => {
				try {
					await sendEmail({
						to: recipient,
						subject,
						html,
						organizationId,
					});
					logger.info({ recipient, scheduleName }, "Notification email sent");
					return { recipient, success: true as const };
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error";
					logger.error({ recipient, error: errorMessage, scheduleName }, "Email sending failed");
					return {
						recipient,
						success: false as const,
						error: errorMessage,
						timestamp: DateTime.utc().toISO()!,
					};
				}
			}),
		);

		const errors = deliveryResults.flatMap((deliveryResult) =>
			deliveryResult.success
				? []
				: [
						{
							recipient: deliveryResult.recipient,
							error: deliveryResult.error,
							timestamp: deliveryResult.timestamp,
						},
					],
		);

		return {
			sent: deliveryResults.length - errors.length,
			failed: errors.length,
			errors,
		};
	}

	/**
	 * Render email subject from template
	 */
	private renderSubject(template: string | undefined, variables: Record<string, string>): string {
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
		const { scheduleName, dateRangeStart, dateRangeEnd, fileUrl, recordCount } = data;

		// Escape user-controlled data to prevent XSS
		const safeScheduleName = escapeHtml(scheduleName);
		const safeDateRangeStart = escapeHtml(dateRangeStart);
		const safeDateRangeEnd = escapeHtml(dateRangeEnd);

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
    ${
			fileUrl
				? `<h1>Scheduled Export Ready</h1>
    <p>Your scheduled export <strong>${safeScheduleName}</strong> has completed successfully.</p>`
				: `<h1>Scheduled Export Finished</h1>
    <p>Your scheduled export <strong>${safeScheduleName}</strong> ran, but there is nothing to download.</p>`
		}
  </div>

  <div class="info-row">
    <div class="info-label">Date Range</div>
    <div class="info-value">${safeDateRangeStart} to ${safeDateRangeEnd}</div>
  </div>

  ${
		recordCount !== undefined
			? `
  <div class="info-row">
    <div class="info-label">Records</div>
    <div class="info-value">${recordCount.toLocaleString()}</div>
  </div>
  `
			: ""
	}

  ${
		fileUrl
			? `
  <a href="${escapeHtml(fileUrl.url)}" class="button">Download Export</a>
  <p class="expiry">This download link is valid for ${formatLifetime(fileUrl.lifetimeSeconds)} and expires on ${formatExpiry(fileUrl.expiresAt)}.</p>
  `
			: `
  <p>No file was produced for this run.</p>
  `
	}

  <div class="footer">
    This is an automated email from your scheduled export configuration.
  </div>
</body>
</html>
`.trim();
	}
}
