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
import {
	type EmailTranslate,
	type EmailTranslator,
	loadEmailTranslator,
} from "@/lib/email/email-i18n";
import { type SendEmailParams, sendEmail } from "@/lib/email/email-service";
import type { EmailDetailRow } from "@/lib/email/layout/email-layout";
import { renderNotificationEmail, renderSecurityAlert } from "@/lib/email/render";
import { renderOrganizationEmailTemplate } from "@/lib/email/template-renderer";
import {
	type SecurityAlertData,
	type SecurityEventType,
	securityAlertSubject,
} from "@/lib/email/templates/security-alert";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { notificationEmailRoute, type TemplateNotificationEmail } from "./email-routes";
import {
	formatNotificationParam,
	hasTypedNotificationParams,
	isRecord,
	type NotificationParamFormatContext,
	notificationParam,
	withFormattedTypedParams,
} from "./notification-params";
import {
	localizeOutboundNotification,
	resolveOutboundNotificationPreferences,
} from "./outbound-localization";
import type { NotificationType } from "./types";

const logger = createLogger("EmailNotifications");

interface EmailNotificationParams {
	actionUrl?: string;
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	metadata?: Record<string, unknown>;
	organizationId?: string; // Optional org ID to use org-specific email config
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

/** A metadata value as text; empty when the notification has none. */
function getMetadataString(
	metadata: Record<string, unknown> | undefined,
	keys: string | string[],
): string {
	const value = getMetadataValue(metadata, keys);
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return "";
}

function getMetadataNumber(metadata: Record<string, unknown> | undefined, keys: string): number {
	const value = getMetadataValue(metadata, keys);
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return 0;
}

/**
 * The notification's metadata with its typed params as text in the recipient
 * language, so override `{{variables}}` and ICU never see a raw value (#1149).
 */
function withTypedParamsAsText(
	metadata: Record<string, unknown> | undefined,
	context: NotificationParamFormatContext,
): Record<string, unknown> | undefined {
	const i18nParams = getI18nParamsMetadata(metadata);
	if (!metadata || !i18nParams || !hasTypedNotificationParams(i18nParams)) return metadata;
	return {
		...metadata,
		i18n: { ...getI18nMetadata(metadata), params: withFormattedTypedParams(i18nParams, context) },
	};
}

/** What a template or dedicated email builder works from. */
interface EmailContext {
	/** The notification's metadata, typed params already text in the recipient language. */
	metadata: Record<string, unknown> | undefined;
	userName: string;
	appUrl: string;
	/** The `emails` translator in the recipient language. */
	translator: EmailTranslator;
	format: NotificationParamFormatContext;
	organizationId?: string;
}

/** An overridable email: its override key and `{{variables}}`, and its default copy. */
interface NotificationEmailContent {
	templateKey: EmailTemplateKey;
	/** The override's `{{variables}}`. */
	data: Record<string, unknown>;
	/** The default subject in the recipient language. */
	subject: string;
	/** The shared layout's detail rows, in the recipient language. */
	details?: EmailDetailRow[];
	/** Where the shared layout's button leads; the app's start page otherwise. */
	actionUrl?: string;
	/** A dedicated template's default body; the shared layout otherwise. */
	renderDefaultHtml?: () => Promise<string>;
}

type TemplateEmailBuilder = (context: EmailContext) => NotificationEmailContent | null;

/** A value missing from the notification, in the recipient language. */
const missing = {
	manager: (t: EmailTranslate) => t("emails.variables.yourManager", "your manager"),
	reason: (t: EmailTranslate) => t("emails.variables.noReason", "No reason provided"),
	time: (t: EmailTranslate) => t("emails.variables.noTime", "-"),
};

/** "start – end", or the one value when both ends are the same or one is missing. */
function rangeText(t: EmailTranslate, start: string, end: string): string {
	if (!start || !end || start === end) return start || end;
	return t("emails.details.range", "{start} – {end}", { start, end });
}

interface AbsenceFacts {
	startDate: string;
	endDate: string;
	absenceType: string;
	days: number;
	notes?: string;
	reason?: string;
}

/** An absence's detail rows: dates, days, category, then notes or reason when given. */
function absenceDetails({ t, locale }: EmailTranslator, absence: AbsenceFacts): EmailDetailRow[] {
	const rows: EmailDetailRow[] = [];
	const dates = rangeText(t, absence.startDate, absence.endDate);
	if (dates) rows.push({ label: t("emails.details.dates", "Dates"), value: dates });
	if (absence.days > 0) {
		rows.push({
			label: t("emails.details.days", "Days"),
			value: new Intl.NumberFormat(locale).format(absence.days),
		});
	}
	if (absence.absenceType) {
		rows.push({ label: t("emails.details.category", "Category"), value: absence.absenceType });
	}
	if (absence.notes) rows.push({ label: t("emails.details.notes", "Notes"), value: absence.notes });
	if (absence.reason) {
		rows.push({ label: t("emails.details.reason", "Reason"), value: absence.reason });
	}
	return rows;
}

function absenceFacts(metadata: Record<string, unknown>): AbsenceFacts {
	return {
		startDate: getMetadataString(metadata, "startDate"),
		endDate: getMetadataString(metadata, "endDate"),
		absenceType: getMetadataString(metadata, ["absenceType", "categoryName"]),
		days: getMetadataNumber(metadata, "days"),
	};
}

interface TimeCorrectionFacts {
	date: string;
	originalClockIn?: string;
	originalClockOut?: string;
	correctedClockIn: string;
	correctedClockOut: string;
	reason?: string;
}

/** A time correction's detail rows: date, original and corrected times, reason. */
function timeCorrectionDetails(
	t: EmailTranslate,
	correction: TimeCorrectionFacts,
): EmailDetailRow[] {
	const times = (clockIn = "", clockOut = "") =>
		clockIn || clockOut
			? t("emails.details.range", "{start} – {end}", {
					start: clockIn || missing.time(t),
					end: clockOut || missing.time(t),
				})
			: "";
	const rows: EmailDetailRow[] = [];
	if (correction.date) {
		rows.push({ label: t("emails.details.date", "Date"), value: correction.date });
	}
	const original = times(correction.originalClockIn, correction.originalClockOut);
	if (original) {
		rows.push({ label: t("emails.details.originalTimes", "Original times"), value: original });
	}
	const corrected = times(correction.correctedClockIn, correction.correctedClockOut);
	if (corrected) {
		rows.push({ label: t("emails.details.correctedTimes", "Corrected times"), value: corrected });
	}
	if (correction.reason) {
		rows.push({ label: t("emails.details.reason", "Reason"), value: correction.reason });
	}
	return rows;
}

/** A time-correction decision's facts (`time-correction-approved`/`-rejected`). */
function timeCorrectionDecisionFacts(metadata: Record<string, unknown>): TimeCorrectionFacts {
	return {
		date: getMetadataString(metadata, "date"),
		correctedClockIn: getMetadataString(metadata, "correctedClockIn"),
		correctedClockOut: getMetadataString(metadata, "correctedClockOut"),
	};
}

/** A decision's override variables: its facts, with missing times named. */
function timeCorrectionDecisionData(
	t: EmailTranslate,
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const facts = timeCorrectionDecisionFacts(metadata);
	return {
		approverName: getMetadataString(metadata, "approverName"),
		date: facts.date,
		correctedClockIn: facts.correctedClockIn || missing.time(t),
		correctedClockOut: facts.correctedClockOut || missing.time(t),
	};
}

/** The approver's "pending approval" email; which one depends on what waits. */
function approvalPendingEmail({
	metadata,
	userName,
	appUrl,
	translator,
}: EmailContext): NotificationEmailContent | null {
	const { t } = translator;
	const approvalUrl = `${appUrl}/approvals/inbox`;
	if (metadata?.approvalSubject === "absence") {
		const absence = { ...absenceFacts(metadata), notes: getMetadataString(metadata, "notes") };
		return {
			templateKey: "absence-request-pending-approval",
			subject: t(
				"emails.subjects.approvalRequestSubmitted",
				"New Absence Request Pending Approval",
			),
			data: {
				managerName: userName,
				employeeName: getMetadataString(metadata, "employeeName"),
				startDate: absence.startDate,
				endDate: absence.endDate,
				absenceType: absence.absenceType,
				days: absence.days,
				notes: absence.notes || undefined,
				approvalUrl,
			},
			details: absenceDetails(translator, absence),
			actionUrl: approvalUrl,
		};
	}
	if (metadata?.approvalSubject === "time_correction") {
		const correction: TimeCorrectionFacts = {
			date: getMetadataString(metadata, "date"),
			originalClockIn: getMetadataString(metadata, "originalClockIn"),
			originalClockOut: getMetadataString(metadata, "originalClockOut"),
			correctedClockIn: getMetadataString(metadata, "correctedClockIn"),
			correctedClockOut: getMetadataString(metadata, "correctedClockOut"),
			reason: getMetadataString(metadata, "reason"),
		};
		return {
			templateKey: "time-correction-pending-approval",
			subject: t("emails.subjects.timeCorrectionSubmitted", "New Time Correction Pending Approval"),
			data: {
				managerName: userName,
				employeeName: getMetadataString(metadata, "employeeName"),
				date: correction.date,
				originalClockIn: correction.originalClockIn || missing.time(t),
				originalClockOut: correction.originalClockOut || missing.time(t),
				correctedClockIn: correction.correctedClockIn || missing.time(t),
				correctedClockOut: correction.correctedClockOut || missing.time(t),
				reason: correction.reason,
				approvalUrl,
			},
			details: timeCorrectionDetails(t, correction),
			actionUrl: approvalUrl,
		};
	}
	return null;
}

/** Each overridable email's builder; `email-routes.ts` decides which type uses which. */
const TEMPLATE_EMAILS: Readonly<Record<TemplateNotificationEmail, TemplateEmailBuilder>> = {
	absenceRequestSubmitted: ({ metadata, userName, appUrl, translator }) => {
		if (!metadata) return null;
		const { t } = translator;
		const dateRange = getMetadataString(metadata, "dateRange");
		const absence = {
			...absenceFacts(metadata),
			startDate: getMetadataString(metadata, "startDate") || dateRange,
			endDate: getMetadataString(metadata, "endDate") || dateRange,
		};
		return {
			templateKey: "absence-request-submitted",
			subject: t("emails.subjects.absenceRequestSubmitted", "Absence Request Submitted"),
			data: {
				employeeName: userName,
				startDate: absence.startDate,
				endDate: absence.endDate,
				absenceType: absence.absenceType,
				days: absence.days,
				managerName: getMetadataString(metadata, "managerName") || missing.manager(t),
				appUrl,
			},
			details: absenceDetails(translator, absence),
		};
	},

	absenceRequestApproved: ({ metadata, userName, appUrl, translator }) => {
		if (!metadata) return null;
		const { t } = translator;
		const absence = absenceFacts(metadata);
		const details = absenceDetails(translator, absence);
		if (metadata.managerRecorded === true) {
			return {
				templateKey: "absence-recorded-by-manager",
				subject: t("emails.subjects.absenceRecordedByManager", "Absence Recorded"),
				data: {
					employeeName: userName,
					managerName: getMetadataString(metadata, "managerName"),
					...absence,
					appUrl,
				},
				details,
			};
		}
		return {
			templateKey: "absence-request-approved",
			subject: t("emails.subjects.absenceRequestApproved", "Absence Request Approved"),
			data: {
				employeeName: userName,
				approverName: getMetadataString(metadata, "approverName"),
				...absence,
				appUrl,
			},
			details,
		};
	},

	absenceRequestRejected: ({ metadata, userName, appUrl, translator }) => {
		if (!metadata) return null;
		const { t } = translator;
		const absence = absenceFacts(metadata);
		const reason = getMetadataString(metadata, "rejectionReason");
		return {
			templateKey: "absence-request-rejected",
			subject: t("emails.subjects.absenceRequestRejected", "Absence Request Rejected"),
			data: {
				employeeName: userName,
				approverName: getMetadataString(metadata, "approverName"),
				...absence,
				rejectionReason: reason || missing.reason(t),
				appUrl,
			},
			details: absenceDetails(translator, { ...absence, reason }),
		};
	},

	approvalRequestSubmitted: approvalPendingEmail,

	timeCorrectionApproved: ({ metadata, userName, appUrl, translator }) => {
		if (!metadata) return null;
		const { t } = translator;
		return {
			templateKey: "time-correction-approved",
			subject: t("emails.subjects.timeCorrectionApproved", "Time Correction Approved"),
			data: { employeeName: userName, ...timeCorrectionDecisionData(t, metadata), appUrl },
			details: timeCorrectionDetails(t, timeCorrectionDecisionFacts(metadata)),
		};
	},

	timeCorrectionRejected: ({ metadata, userName, appUrl, translator }) => {
		if (!metadata) return null;
		const { t } = translator;
		const reason = getMetadataString(metadata, "rejectionReason");
		return {
			templateKey: "time-correction-rejected",
			subject: t("emails.subjects.timeCorrectionRejected", "Time Correction Rejected"),
			data: {
				employeeName: userName,
				...timeCorrectionDecisionData(t, metadata),
				rejectionReason: reason || missing.reason(t),
				appUrl,
			},
			details: timeCorrectionDetails(t, { ...timeCorrectionDecisionFacts(metadata), reason }),
		};
	},

	teamMemberAdded: ({ metadata, userName, appUrl, translator: { t } }) => {
		if (!metadata) return null;
		const teamName = getMetadataString(metadata, "teamName");
		const teamUrl = `${appUrl}/settings/teams/${getMetadataString(metadata, "teamId")}`;
		return {
			templateKey: "team-member-added",
			subject: t("emails.subjects.teamMemberAdded", "You've been added to {teamName}", {
				teamName,
			}),
			data: {
				memberName: userName,
				teamName,
				addedByName: getMetadataString(metadata, ["addedByName", "performedByName"]),
				teamUrl,
				appUrl,
			},
			actionUrl: teamUrl,
		};
	},

	teamMemberRemoved: ({ metadata, userName, appUrl, translator: { t } }) => {
		if (!metadata) return null;
		const teamName = getMetadataString(metadata, "teamName");
		return {
			templateKey: "team-member-removed",
			subject: t("emails.subjects.teamMemberRemoved", "You've been removed from {teamName}", {
				teamName,
			}),
			data: {
				memberName: userName,
				teamName,
				removedByName: getMetadataString(metadata, ["removedByName", "performedByName"]),
				appUrl,
			},
		};
	},
};

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

/**
 * When the security event happened (the alert goes out as it happens), in the
 * organization timezone with the zone printed; UTC without an organization.
 */
async function securityAlertTime(
	organizationId: string | undefined,
	format: NotificationParamFormatContext,
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
		format,
	);
}

/** The security alert: its dedicated template (ADR 0001), timed when it goes out. */
async function securityAlertEmail(
	eventType: SecurityEventType,
	{ metadata, userName, appUrl, translator, format, organizationId }: EmailContext,
): Promise<NotificationEmailContent> {
	const alert: SecurityAlertData = {
		userName,
		eventType,
		timestamp: await securityAlertTime(organizationId, format),
		ipAddress: metadata?.ipAddress ? String(metadata.ipAddress) : undefined,
		userAgent: metadata?.userAgent ? String(metadata.userAgent) : undefined,
		securitySettingsUrl: `${appUrl}/settings/security`,
		appUrl,
	};
	return {
		templateKey: "security-alert",
		subject: securityAlertSubject(translator.t, eventType),
		data: { ...alert },
		renderDefaultHtml: () => renderSecurityAlert(alert, translator),
	};
}

/**
 * Send email notification based on notification type
 */
export async function sendEmailNotification(
	params: EmailNotificationParams,
	options: { throwOnError?: boolean } = {},
): Promise<boolean> {
	const { userId, type, organizationId } = params;
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
		const i18nMetadata = getI18nMetadata(params.metadata);
		const hasI18nTitle = typeof i18nMetadata?.titleKey === "string";
		const hasI18nMessage = typeof i18nMetadata?.messageKey === "string";
		if (route.kind === "layout") {
			// The layout chrome follows the language the title and message were written in.
			const localized = await localizeOutboundNotification(params);
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

		// One recipient language and hour cycle for the subject, body, layout chrome and
		// override variables; without an organization, the user's own language (#812).
		const { locale: recipientLocale, timeFormat } = await resolveOutboundNotificationPreferences({
			userId,
			organizationId,
		});
		const format: NotificationParamFormatContext = {
			locale: recipientLocale,
			...(timeFormat ? { timeFormat } : {}),
		};
		const translator = await loadEmailTranslator(recipientLocale);
		const { locale, t } = translator;
		const context: EmailContext = {
			metadata: withTypedParamsAsText(params.metadata, format),
			userName,
			appUrl,
			translator,
			format,
			organizationId,
		};
		const content =
			route.kind === "template"
				? TEMPLATE_EMAILS[route.email](context)
				: await securityAlertEmail(route.securityEvent, context);
		if (!content) {
			logger.debug({ type }, "No email content generated");
			return false;
		}

		let subject = content.subject;
		let body = { title: params.title, message: params.message };
		if (hasI18nTitle || hasI18nMessage) {
			const localized = await localizeOutboundNotification({
				userId,
				organizationId,
				title: params.title,
				message: params.message,
				metadata: context.metadata,
				...format,
			});
			body = { title: localized.title, message: localized.message };
			if (hasI18nTitle) subject = localized.title;
		}

		// An enabled override wins and is sent as written; otherwise the shared layout
		// (the security alert keeps its dedicated template, ADR 0001).
		const rendered = await renderOrganizationEmailTemplate({
			organizationId,
			templateKey: content.templateKey,
			data: content.data,
			subjectOverride: subject,
			renderDefaultHtml:
				content.renderDefaultHtml ??
				(() =>
					renderNotificationEmail({
						locale,
						t,
						title: body.title,
						message: body.message,
						details: content.details,
						actionUrl: content.actionUrl ?? appUrl,
					})),
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
