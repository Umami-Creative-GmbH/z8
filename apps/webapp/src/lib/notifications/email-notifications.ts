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
import { systemClock } from "@/lib/datetime/temporal-core";
import { type EmailTranslate, loadEmailTranslator } from "@/lib/email/email-i18n";
import { type SendEmailParams, sendEmail } from "@/lib/email/email-service";
import { renderNotificationEmail, renderSecurityAlert } from "@/lib/email/render";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import type { SecurityAlertData, SecurityEventType } from "@/lib/email/templates/security-alert";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { notificationEmailRoute } from "./email-routes";
import {
	formatNotificationParam,
	hasTypedNotificationParams,
	notificationParam,
	withFormattedTypedParams,
} from "./notification-params";
import {
	localizeOutboundNotification,
	resolveOutboundNotificationLocale,
} from "./outbound-localization";
import type { NotificationType } from "./types";

const logger = createLogger("EmailNotifications");

interface LocalizedEmailContent {
	title: string;
	message: string;
}

interface EmailNotificationParams {
	actionUrl?: string;
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

/**
 * Get user email by ID
 */
async function getUserEmail(userId: string, throwOnError = false): Promise<string | null> {
	try {
		const userRecord = await db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: { email: true },
		});
		return userRecord?.email || null;
	} catch (error) {
		logger.error({ error, userId }, "Failed to get user email");
		if (throwOnError) throw error;
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

function securityAlertSubject(t: EmailTranslate, eventType: SecurityEventType): string {
	switch (eventType) {
		case "password_changed":
			return t("emails.subjects.passwordChanged", "Security Alert: Password Changed");
		case "two_factor_enabled":
			return t(
				"emails.subjects.twoFactorEnabled",
				"Security Alert: Two-Factor Authentication Enabled",
			);
		case "two_factor_disabled":
			return t(
				"emails.subjects.twoFactorDisabled",
				"Security Alert: Two-Factor Authentication Disabled",
			);
	}
}

/**
 * When the security event happened (the alert goes out as it happens), in the
 * organization timezone with the zone printed; UTC without an organization.
 */
async function securityAlertTime(
	organizationId: string | undefined,
	locale: string,
): Promise<string> {
	let timeZone = "UTC";
	if (organizationId) {
		try {
			timeZone = await loadOrganizationTimezone(db, organizationId);
		} catch (error) {
			logger.warn({ error, organizationId }, "Failed to load organization timezone");
		}
	}
	return formatNotificationParam(
		notificationParam.zonedInstant(systemClock.nowInstant(), timeZone),
		{ locale },
	);
}

/**
 * Send email notification based on notification type
 */
export async function sendEmailNotification(
	params: EmailNotificationParams,
	options: { throwOnError?: boolean } = {},
): Promise<boolean> {
	const { userId, type, organizationId } = params;
	let metadata = params.metadata;
	const sendNotificationEmail = options.throwOnError
		? (message: SendEmailParams) => sendEmail(message, { durable: true })
		: sendEmail;

	const route = notificationEmailRoute(type);
	if (route.kind === "none") {
		logger.debug({ type }, "Notification type is email-free");
		return false;
	}

	try {
		const email = await getUserEmail(userId, options.throwOnError);
		if (!email) {
			logger.warn({ userId, type }, "No email found for user, skipping email notification");
			return false;
		}

		const userName = await getUserName(userId);
		const appUrl = await getOrganizationBaseUrl(organizationId);
		const i18nMetadata = getI18nMetadata(metadata);
		const hasI18nTitle = typeof i18nMetadata?.titleKey === "string";
		const hasI18nMessage = typeof i18nMetadata?.messageKey === "string";
		if (route.kind === "layout") {
			// The layout chrome follows the language the title and message were written in.
			const localized = organizationId
				? await localizeOutboundNotification({ ...params, organizationId })
				: {
						...params,
						locale: await resolveOutboundNotificationLocale({ userId, organizationId }),
					};
			const { locale, t } = await loadEmailTranslator(localized.locale);
			const target = params.actionUrl;
			const link =
				target && route.linkPrefixes.some((prefix) => target.startsWith(prefix))
					? new URL(target, appUrl).toString()
					: appUrl;
			const result = await sendNotificationEmail({
				to: email,
				subject: localized.title,
				html: await renderNotificationEmail({
					locale,
					t,
					title: localized.title,
					message: localized.message,
					actionUrl: link,
				}),
				organizationId,
			});
			if (result.unavailable) return false;
			if (!result.success && options.throwOnError) throw new Error("email_delivery_failed");
			return result.success;
		}

		// Override `{{variables}}` read typed params as text in the recipient language (#1149).
		const i18nParams = getI18nParamsMetadata(metadata);
		let recipientLocale: string | undefined;
		if (metadata && i18nParams && hasTypedNotificationParams(i18nParams)) {
			recipientLocale = await resolveOutboundNotificationLocale({ userId, organizationId });
			metadata = {
				...metadata,
				i18n: {
					...getI18nMetadata(metadata),
					params: withFormattedTypedParams(i18nParams, { locale: recipientLocale }),
				},
			};
		}

		let templateKey: EmailTemplateKey | null = null;
		let templateData: Record<string, unknown> | null = null;
		// The type's default subject in the recipient language (`emails` namespace).
		let subject: (t: EmailTranslate) => string = () => params.title;
		// Where the shared layout's button leads.
		let actionUrl = appUrl;
		// The security alert's dedicated template data (ADR 0001).
		let securityAlert: SecurityAlertData | null = null;

		// Generate email content based on notification type
		switch (type) {
			case "absence_request_submitted":
				if (metadata) {
					const dateRange = getMetadataString(metadata, "dateRange");
					templateKey = "absence-request-submitted";
					subject = (t) =>
						t("emails.subjects.absenceRequestSubmitted", "Absence Request Submitted");
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
						subject = (t) => t("emails.subjects.absenceRecordedByManager", "Absence Recorded");
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
						subject = (t) =>
							t("emails.subjects.absenceRequestApproved", "Absence Request Approved");
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
					subject = (t) => t("emails.subjects.absenceRequestRejected", "Absence Request Rejected");
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
					subject = (t) =>
						t("emails.subjects.approvalRequestSubmitted", "New Absence Request Pending Approval");
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
					actionUrl = `${appUrl}/approvals/inbox`;
				}
				break;

			case "time_correction_submitted":
				// This is for managers
				if (metadata) {
					templateKey = "time-correction-pending-approval";
					subject = (t) =>
						t("emails.subjects.timeCorrectionSubmitted", "New Time Correction Pending Approval");
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
					actionUrl = `${appUrl}/approvals/inbox`;
				}
				break;

			case "time_correction_approved":
				if (metadata) {
					templateKey = "time-correction-approved";
					subject = (t) => t("emails.subjects.timeCorrectionApproved", "Time Correction Approved");
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
					subject = (t) => t("emails.subjects.timeCorrectionRejected", "Time Correction Rejected");
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
					const teamUrl = `${appUrl}/settings/teams/${getMetadataString(metadata, "teamId")}`;
					templateKey = "team-member-added";
					subject = (t) =>
						t("emails.subjects.teamMemberAdded", "You've been added to {teamName}", {
							teamName,
						});
					templateData = {
						memberName: userName,
						teamName,
						addedByName: getMetadataString(metadata, ["addedByName", "performedByName"]),
						teamUrl,
						appUrl,
					};
					actionUrl = teamUrl;
				}
				break;

			case "team_member_removed":
				if (metadata) {
					const teamName = getMetadataString(metadata, "teamName");
					templateKey = "team-member-removed";
					subject = (t) =>
						t("emails.subjects.teamMemberRemoved", "You've been removed from {teamName}", {
							teamName,
						});
					templateData = {
						memberName: userName,
						teamName,
						removedByName: getMetadataString(metadata, ["removedByName", "performedByName"]),
						appUrl,
					};
				}
				break;

			case "password_changed":
			case "two_factor_enabled":
			case "two_factor_disabled":
				templateKey = "security-alert";
				subject = (t) => securityAlertSubject(t, type);
				// The time is filled in the recipient language below.
				securityAlert = {
					userName,
					eventType: type,
					timestamp: "",
					ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
					userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
					securitySettingsUrl: `${appUrl}/settings/security`,
					appUrl,
				};
				templateData = { ...securityAlert };
				break;

			default:
				// `notificationEmailRoute` sends every other type through the layout or not at all.
				logger.warn({ type }, "No email template for notification type");
				return false;
		}

		if (!templateKey || !templateData) {
			logger.debug({ type }, "No email content generated");
			return false;
		}

		// One recipient language for the subject, body, layout chrome and override variables.
		recipientLocale ??= await resolveOutboundNotificationLocale({ userId, organizationId });
		const translator = await loadEmailTranslator(recipientLocale);
		const { locale, t } = translator;
		if (securityAlert) {
			securityAlert.timestamp = await securityAlertTime(organizationId, locale);
			templateData = { ...securityAlert };
		}
		let subjectOverride = subject(t);
		let content: LocalizedEmailContent = { title: params.title, message: params.message };
		if (organizationId && (hasI18nTitle || hasI18nMessage)) {
			const localized = await localizeOutboundNotification({
				userId,
				organizationId,
				title: params.title,
				message: params.message,
				metadata,
				locale: recipientLocale,
			});
			content = { title: localized.title, message: localized.message };
			if (hasI18nTitle) {
				subjectOverride = localized.title;
			}
		}

		// An enabled override wins and is sent as written; otherwise the shared layout
		// (the security alert keeps its dedicated template, ADR 0001).
		const rendered = await renderOrganizationEmailTemplate({
			organizationId,
			templateKey,
			data: templateData,
			subjectOverride,
			renderDefaultHtml: () => {
				const alert = securityAlert;
				return alert
					? renderSecurityAlert(alert, translator)
					: renderNotificationEmail({
							locale,
							t,
							title: content.title,
							message: content.message,
							actionUrl,
						});
			},
		});

		const result = await sendNotificationEmail({
			to: email,
			subject: rendered.subject,
			html: rendered.html,
			organizationId, // Use org-specific email config if available
		});

		if (result.unavailable) return false;
		if (result.success) {
			logger.info({ userId, type, email: `${email.slice(0, 3)}***` }, "Email notification sent");
			return true;
		}

		logger.error({ userId, type, error: result.error }, "Failed to send email notification");
		if (options.throwOnError) throw new Error("email_delivery_failed");
		return false;
	} catch (error) {
		logger.error({ error, userId, type }, "Error sending email notification");
		if (options.throwOnError) throw error;
		return false;
	}
}
