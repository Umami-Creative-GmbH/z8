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
import type { NotificationType } from "./types";

const logger = createLogger("EmailNotifications");

interface EmailNotificationParams {
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	metadata?: Record<string, unknown>;
	organizationId?: string; // Optional org ID to use org-specific email config
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
	const { userId, type, title, metadata, organizationId } = params;

	try {
		const email = await getUserEmail(userId);
		if (!email) {
			logger.warn({ userId, type }, "No email found for user, skipping email notification");
			return false;
		}

		const userName = await getUserName(userId);
		const appUrl = await getOrganizationBaseUrl(organizationId);

		let templateKey: EmailTemplateKey | null = null;
		let templateData: Record<string, unknown> | null = null;
		let subjectOverride = title;

		// Generate email content based on notification type
		switch (type) {
			case "absence_request_submitted":
				if (metadata) {
					templateKey = "absence-request-submitted";
					subjectOverride = "Absence Request Submitted";
					templateData = {
						employeeName: userName,
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						managerName: String(metadata.managerName || "your manager"),
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
					templateKey = "team-member-added";
					subjectOverride = `You've been added to ${metadata.teamName}`;
					templateData = {
						memberName: userName,
						teamName: String(metadata.teamName || ""),
						addedByName: String(metadata.addedByName || ""),
						teamUrl: `${appUrl}/settings/teams/${metadata.teamId || ""}`,
						appUrl,
					};
				}
				break;

			case "team_member_removed":
				if (metadata) {
					templateKey = "team-member-removed";
					subjectOverride = `You've been removed from ${metadata.teamName}`;
					templateData = {
						memberName: userName,
						teamName: String(metadata.teamName || ""),
						removedByName: String(metadata.removedByName || ""),
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

		const rendered = await renderOrganizationEmailTemplate({
			organizationId,
			templateKey,
			data: templateData,
			subjectOverride,
		});

		const result = await sendEmail({
			to: email,
			subject: rendered.subject,
			html: rendered.html,
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
