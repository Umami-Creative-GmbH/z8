/**
 * Email Notification Service
 *
 * Handles sending email notifications based on notification type and user preferences.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import type { EmailTemplateKey } from "@/db/schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/email-service";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import { createLogger } from "@/lib/logger";
import { localizeOutboundNotification } from "./outbound-localization";
import type { NotificationType } from "./types";

const logger = createLogger("EmailNotifications");

interface LocalizedEmailContent {
	title: string;
	message: string;
}

interface EmailNotificationParams {
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	metadata?: Record<string, unknown>;
	organizationId?: string; // Optional org ID to use org-specific email config
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getI18nMetadata(
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
	if (!metadata || !isRecord(metadata.i18n)) return null;
	return metadata.i18n;
}

function getI18nParamsMetadata(
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
	const i18nMetadata = getI18nMetadata(metadata);
	if (!isRecord(i18nMetadata?.params)) return null;
	return i18nMetadata.params;
}

function getMetadataValue(
	metadata: Record<string, unknown> | undefined,
	keys: string | string[],
): unknown {
	const lookupKeys = Array.isArray(keys) ? keys : [keys];

	for (const key of lookupKeys) {
		const value = metadata?.[key];
		if (value !== undefined && value !== null && value !== "") return value;
	}

	const i18nParams = getI18nParamsMetadata(metadata);
	for (const key of lookupKeys) {
		const value = i18nParams?.[key];
		if (value !== undefined && value !== null && value !== "") return value;
	}

	return undefined;
}

function getMetadataString(
	metadata: Record<string, unknown> | undefined,
	keys: string | string[],
	fallback = "",
): string {
	const value = getMetadataValue(metadata, keys);
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}

function getMetadataNumber(
	metadata: Record<string, unknown> | undefined,
	keys: string | string[],
	fallback = 0,
): number {
	const value = getMetadataValue(metadata, keys);
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function renderLocalizedDefaultEmailHtml(content: LocalizedEmailContent, appUrl: string): string {
	const escapedTitle = escapeHtml(content.title);
	const escapedMessage = escapeHtml(content.message).replace(/\n/g, "<br />");
	const actionLink = appUrl
		? `<p style="margin: 24px 0 0;"><a href="${escapeHtml(appUrl)}">Open Z8</a></p>`
		: "";

	return `<div><h1>${escapedTitle}</h1><p>${escapedMessage}</p>${actionLink}</div>`;
}

/**
 * Get user email by ID
 */
async function getUserEmail(userId: string): Promise<string | null> {
	try {
		const userRecord = await db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: { email: true },
		});
		return userRecord?.email || null;
	} catch (error) {
		logger.error({ error, userId }, "Failed to get user email");
		return null;
	}
}

/**
 * Get user name by ID
 */
async function getUserName(userId: string): Promise<string> {
	try {
		const userRecord = await db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: { name: true },
		});
		return userRecord?.name || "User";
	} catch (error) {
		logger.error({ error, userId }, "Failed to get user name");
		return "User";
	}
}

/**
 * Send email notification based on notification type
 */
export async function sendEmailNotification(params: EmailNotificationParams): Promise<boolean> {
	const { userId, type, metadata, organizationId } = params;

	try {
		const email = await getUserEmail(userId);
		if (!email) {
			logger.warn({ userId, type }, "No email found for user, skipping email notification");
			return false;
		}

		const userName = await getUserName(userId);
		const appUrl = await getOrganizationBaseUrl(organizationId);
		const i18nMetadata = getI18nMetadata(metadata);
		const hasI18nTitle = typeof i18nMetadata?.titleKey === "string";
		const hasI18nMessage = typeof i18nMetadata?.messageKey === "string";

		let templateKey: EmailTemplateKey | null = null;
		let templateData: Record<string, unknown> | null = null;
		let subjectOverride = params.title;

		// Generate email content based on notification type
		switch (type) {
			case "absence_request_submitted":
				if (metadata) {
					const dateRange = getMetadataString(metadata, "dateRange");
					templateKey = "absence-request-submitted";
					subjectOverride = "Absence Request Submitted";
					templateData = {
						employeeName: userName,
						startDate: getMetadataString(metadata, "startDate", dateRange),
						endDate: getMetadataString(metadata, "endDate", dateRange),
						absenceType: getMetadataString(metadata, ["absenceType", "categoryName"]),
						days: getMetadataNumber(metadata, "days"),
						managerName: getMetadataString(metadata, "managerName", "your manager"),
						appUrl,
					};
				}
				break;

			case "absence_request_approved":
				if (metadata) {
					if (metadata.managerRecorded === true) {
						templateKey = "absence-recorded-by-manager";
						subjectOverride = "Absence Recorded";
						templateData = {
							employeeName: userName,
							managerName: String(metadata.managerName || ""),
							startDate: String(metadata.startDate || ""),
							endDate: String(metadata.endDate || ""),
							absenceType: String(metadata.absenceType || ""),
							days: Number(metadata.days || 0),
							appUrl,
						};
					} else {
						templateKey = "absence-request-approved";
						subjectOverride = "Absence Request Approved";
						templateData = {
							employeeName: userName,
							approverName: String(metadata.approverName || ""),
							startDate: String(metadata.startDate || ""),
							endDate: String(metadata.endDate || ""),
							absenceType: String(metadata.absenceType || ""),
							days: Number(metadata.days || 0),
							appUrl,
						};
					}
				}
				break;

			case "absence_request_rejected":
				if (metadata) {
					templateKey = "absence-request-rejected";
					subjectOverride = "Absence Request Rejected";
					templateData = {
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						rejectionReason: String(metadata.rejectionReason || "No reason provided"),
						appUrl,
					};
				}
				break;

			case "approval_request_submitted":
				// This is for managers - use pending approval template
				if (metadata) {
					templateKey = "absence-request-pending-approval";
					subjectOverride = "New Absence Request Pending Approval";
					templateData = {
						managerName: userName,
						employeeName: String(metadata.employeeName || ""),
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						notes: metadata.notes ? String(metadata.notes) : undefined,
						approvalUrl: `${appUrl}/approvals/inbox`,
					};
				}
				break;

			case "time_correction_submitted":
				// This is for managers
				if (metadata) {
					templateKey = "time-correction-pending-approval";
					subjectOverride = "New Time Correction Pending Approval";
					templateData = {
						managerName: userName,
						employeeName: String(metadata.employeeName || ""),
						date: String(metadata.date || ""),
						originalClockIn: String(metadata.originalClockIn || ""),
						originalClockOut: String(metadata.originalClockOut || ""),
						correctedClockIn: String(metadata.correctedClockIn || ""),
						correctedClockOut: String(metadata.correctedClockOut || ""),
						reason: String(metadata.reason || ""),
						approvalUrl: `${appUrl}/approvals/inbox`,
					};
				}
				break;

			case "time_correction_approved":
				if (metadata) {
					templateKey = "time-correction-approved";
					subjectOverride = "Time Correction Approved";
					templateData = {
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						date: String(metadata.date || ""),
						correctedClockIn: String(metadata.correctedClockIn || ""),
						correctedClockOut: String(metadata.correctedClockOut || ""),
						appUrl,
					};
				}
				break;

			case "time_correction_rejected":
				if (metadata) {
					templateKey = "time-correction-rejected";
					subjectOverride = "Time Correction Rejected";
					templateData = {
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						date: String(metadata.date || ""),
						correctedClockIn: String(metadata.correctedClockIn || ""),
						correctedClockOut: String(metadata.correctedClockOut || ""),
						rejectionReason: String(metadata.rejectionReason || "No reason provided"),
						appUrl,
					};
				}
				break;

			case "team_member_added":
				if (metadata) {
					const teamName = getMetadataString(metadata, "teamName");
					templateKey = "team-member-added";
					subjectOverride = `You've been added to ${teamName}`;
					templateData = {
						memberName: userName,
						teamName,
						addedByName: getMetadataString(metadata, ["addedByName", "performedByName"]),
						teamUrl: `${appUrl}/settings/teams/${getMetadataString(metadata, "teamId")}`,
						appUrl,
					};
				}
				break;

			case "team_member_removed":
				if (metadata) {
					const teamName = getMetadataString(metadata, "teamName");
					templateKey = "team-member-removed";
					subjectOverride = `You've been removed from ${teamName}`;
					templateData = {
						memberName: userName,
						teamName,
						removedByName: getMetadataString(metadata, ["removedByName", "performedByName"]),
						appUrl,
					};
				}
				break;

			case "password_changed":
				templateKey = "security-alert";
				subjectOverride = "Security Alert: Password Changed";
				templateData = {
					userName,
					eventType: "password_changed",
					timestamp: new Date().toLocaleString(),
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				};
				break;

			case "two_factor_enabled":
				templateKey = "security-alert";
				subjectOverride = "Security Alert: Two-Factor Authentication Enabled";
				templateData = {
					userName,
					eventType: "two_factor_enabled",
					timestamp: new Date().toLocaleString(),
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				};
				break;

			case "two_factor_disabled":
				templateKey = "security-alert";
				subjectOverride = "Security Alert: Two-Factor Authentication Disabled";
				templateData = {
					userName,
					eventType: "two_factor_disabled",
					timestamp: new Date().toLocaleString(),
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				};
				break;

			// These don't have specific email templates - use generic approach
			case "approval_request_approved":
			case "approval_request_rejected":
			case "birthday_reminder":
			case "vacation_balance_alert":
				// Skip email for these - they use in-app/push only
				// or could use a generic template in the future
				logger.debug({ type }, "No email template for notification type");
				return false;

			default:
				logger.warn({ type }, "Unknown notification type for email");
				return false;
		}

		if (!templateKey || !templateData) {
			logger.debug({ type }, "No email content generated");
			return false;
		}

		let localizedEmailContent: LocalizedEmailContent | null = null;

		if (organizationId && (hasI18nTitle || hasI18nMessage)) {
			const localized = await localizeOutboundNotification({
				userId,
				organizationId,
				title: params.title,
				message: params.message,
				metadata,
			});
			localizedEmailContent = { title: localized.title, message: localized.message };
			if (hasI18nTitle) {
				subjectOverride = localized.title;
			}
		}

		const rendered = await renderOrganizationEmailTemplate({
			organizationId,
			templateKey,
			data: templateData,
			subjectOverride,
		});

		const html =
			!rendered.usedOverride && localizedEmailContent
				? renderLocalizedDefaultEmailHtml(localizedEmailContent, appUrl)
				: rendered.html;

		const result = await sendEmail({
			to: email,
			subject: rendered.subject,
			html,
			organizationId, // Use org-specific email config if available
		});

		if (result.success) {
			logger.info({ userId, type, email: `${email.slice(0, 3)}***` }, "Email notification sent");
			return true;
		}

		logger.error({ userId, type, error: result.error }, "Failed to send email notification");
		return false;
	} catch (error) {
		logger.error({ error, userId, type }, "Error sending email notification");
		return false;
	}
}
