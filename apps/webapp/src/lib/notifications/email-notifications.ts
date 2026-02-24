/**
 * Email Notification Service
 *
 * Handles sending email notifications based on notification type and user preferences.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email/email-service";
import {
	renderAbsenceRequestApproved,
	renderAbsenceRequestPendingApproval,
	renderAbsenceRequestRejected,
	renderAbsenceRequestSubmitted,
	renderSecurityAlert,
	renderTeamMemberAdded,
	renderTeamMemberRemoved,
	renderTimeCorrectionApproved,
	renderTimeCorrectionPendingApproval,
	renderTimeCorrectionRejected,
} from "@/lib/email/render";
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

		let html: string | null = null;
		let subject = title;

		// Generate email content based on notification type
		switch (type) {
			case "absence_request_submitted":
				if (metadata) {
					html = await renderAbsenceRequestSubmitted({
						employeeName: userName,
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						managerName: String(metadata.managerName || "your manager"),
						appUrl,
					});
					subject = "Absence Request Submitted";
				}
				break;

			case "absence_request_approved":
				if (metadata) {
					html = await renderAbsenceRequestApproved({
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						appUrl,
					});
					subject = "Absence Request Approved";
				}
				break;

			case "absence_request_rejected":
				if (metadata) {
					html = await renderAbsenceRequestRejected({
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						rejectionReason: String(metadata.rejectionReason || "No reason provided"),
						appUrl,
					});
					subject = "Absence Request Rejected";
				}
				break;

			case "approval_request_submitted":
				// This is for managers - use pending approval template
				if (metadata) {
					html = await renderAbsenceRequestPendingApproval({
						managerName: userName,
						employeeName: String(metadata.employeeName || ""),
						startDate: String(metadata.startDate || ""),
						endDate: String(metadata.endDate || ""),
						absenceType: String(metadata.absenceType || ""),
						days: Number(metadata.days || 0),
						notes: metadata.notes ? String(metadata.notes) : undefined,
						approvalUrl: `${appUrl}/approvals`,
					});
					subject = "New Absence Request Pending Approval";
				}
				break;

			case "time_correction_submitted":
				// This is for managers
				if (metadata) {
					html = await renderTimeCorrectionPendingApproval({
						managerName: userName,
						employeeName: String(metadata.employeeName || ""),
						date: String(metadata.date || ""),
						originalClockIn: String(metadata.originalClockIn || ""),
						originalClockOut: String(metadata.originalClockOut || ""),
						correctedClockIn: String(metadata.correctedClockIn || ""),
						correctedClockOut: String(metadata.correctedClockOut || ""),
						reason: String(metadata.reason || ""),
						approvalUrl: `${appUrl}/approvals`,
					});
					subject = "New Time Correction Pending Approval";
				}
				break;

			case "time_correction_approved":
				if (metadata) {
					html = await renderTimeCorrectionApproved({
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						date: String(metadata.date || ""),
						correctedClockIn: String(metadata.correctedClockIn || ""),
						correctedClockOut: String(metadata.correctedClockOut || ""),
						appUrl,
					});
					subject = "Time Correction Approved";
				}
				break;

			case "time_correction_rejected":
				if (metadata) {
					html = await renderTimeCorrectionRejected({
						employeeName: userName,
						approverName: String(metadata.approverName || ""),
						date: String(metadata.date || ""),
						correctedClockIn: String(metadata.correctedClockIn || ""),
						correctedClockOut: String(metadata.correctedClockOut || ""),
						rejectionReason: String(metadata.rejectionReason || "No reason provided"),
						appUrl,
					});
					subject = "Time Correction Rejected";
				}
				break;

			case "team_member_added":
				if (metadata) {
					html = await renderTeamMemberAdded({
						memberName: userName,
						teamName: String(metadata.teamName || ""),
						addedByName: String(metadata.addedByName || ""),
						teamUrl: `${appUrl}/settings/teams/${metadata.teamId || ""}`,
						appUrl,
					});
					subject = `You've been added to ${metadata.teamName}`;
				}
				break;

			case "team_member_removed":
				if (metadata) {
					html = await renderTeamMemberRemoved({
						memberName: userName,
						teamName: String(metadata.teamName || ""),
						removedByName: String(metadata.removedByName || ""),
						appUrl,
					});
					subject = `You've been removed from ${metadata.teamName}`;
				}
				break;

			case "password_changed":
				html = await renderSecurityAlert({
					userName,
					eventType: "password_changed",
					timestamp: new Date().toLocaleString(),
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				});
				subject = "Security Alert: Password Changed";
				break;

			case "two_factor_enabled":
				html = await renderSecurityAlert({
					userName,
					eventType: "two_factor_enabled",
					timestamp: new Date().toLocaleString(),
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				});
				subject = "Security Alert: Two-Factor Authentication Enabled";
				break;

			case "two_factor_disabled":
				html = await renderSecurityAlert({
					userName,
					eventType: "two_factor_disabled",
					timestamp: new Date().toLocaleString(),
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				});
				subject = "Security Alert: Two-Factor Authentication Disabled";
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

		if (!html) {
			logger.debug({ type }, "No email content generated");
			return false;
		}

		const result = await sendEmail({
			to: email,
			subject,
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
