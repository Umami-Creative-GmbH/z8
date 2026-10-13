/**
 * Delivery Service
 *
 * Handles S3 upload and email notification delivery for scheduled exports.
 */
import { DateTime } from "luxon";
import { db } from "@/db";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { loadEmailTranslator } from "@/lib/email/email-i18n";
import { sendEmail } from "@/lib/email/email-service";
import {
	renderScheduledExportDeliveryEmail,
	scheduledExportDeliverySubject,
} from "@/lib/email/templates/scheduled-export-delivery";
import { createLogger } from "@/lib/logger";
import {
	formatNotificationParam,
	notificationParam,
} from "@/lib/notifications/notification-params";
import {
	resolveOrganizationNotificationLocale,
	resolveRecipientNotificationLocale,
} from "@/lib/notifications/recipient-locale";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";
import {
	type CalculatedDateRange,
	type DeliveryConfig,
	type DeliveryResult,
	deliversByEmail,
	type ExecutionResult,
	type SignedFileUrl,
} from "../domain/types";
import { findMemberUserIdsByEmail } from "./member-recipients";

const logger = createLogger("ScheduledExportDeliveryService");

/** "15 minutes", "7 days", "1 hour 30 minutes" in `locale`. */
function formatLifetime(totalSeconds: number, locale: string): string {
	const units: Array<[number, "day" | "hour" | "minute" | "second"]> = [
		[Math.floor(totalSeconds / 86400), "day"],
		[Math.floor((totalSeconds % 86400) / 3600), "hour"],
		[Math.floor((totalSeconds % 3600) / 60), "minute"],
		[totalSeconds % 60, "second"],
	];
	return units
		.filter(([count]) => count > 0)
		.map(([count, unit]) =>
			new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(count),
		)
		.join(" ");
}

/**
 * A day of the schedule's date range (a Luxon value from the legacy range calculation)
 * as a calendar day. An invalid one fails the email with a message that names it.
 */
function rangeDay(day: CalculatedDateRange["start"], which: "start" | "end"): PlainDate {
	const isoDate = day.toISODate();
	if (!isoDate) {
		throw new Error(
			`Scheduled export date range ${which} is invalid: ${day.invalidReason ?? "unknown reason"}`,
		);
	}
	return parsePlainDate(isoDate);
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

interface RenderedDeliveryEmail {
	subject: string;
	html: string;
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
	 * Send notification emails to all recipients, each in their recipient language.
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
		const { organizationId, scheduleName, recipients } = params;

		const [languages, timezone] = await Promise.all([
			this.resolveRecipientLanguages(organizationId, recipients),
			loadOrganizationTimezone(db, organizationId).catch((error: unknown) => {
				logger.warn(
					{ organizationId, error: error instanceof Error ? error.message : "Unknown error" },
					"Failed to load the organization timezone for scheduled export emails",
				);
				return "UTC";
			}),
		]);

		// One rendering per language, shared by every recipient who reads it.
		const renderings = new Map<string, Promise<RenderedDeliveryEmail>>();
		const renderIn = (locale: string) => {
			let rendering = renderings.get(locale);
			if (!rendering) {
				rendering = this.renderEmail({ ...params, locale, timezone });
				renderings.set(locale, rendering);
			}
			return rendering;
		};

		const failedDelivery = (recipient: string, errorMessage: string) => {
			logger.error({ recipient, error: errorMessage, scheduleName }, "Email sending failed");
			return {
				recipient,
				success: false as const,
				error: errorMessage,
				timestamp: DateTime.utc().toISO()!,
			};
		};

		const deliveryResults = await Promise.all(
			recipients.map(async (recipient) => {
				try {
					const { subject, html } = await renderIn(languages.get(recipient) ?? DEFAULT_LANGUAGE);
					// sendEmail reports transport failures through its result instead of throwing.
					const sendResult = await sendEmail({
						to: recipient,
						subject,
						html,
						organizationId,
					});
					if (!sendResult.success) {
						return failedDelivery(
							recipient,
							sendResult.error || "Email transport reported failure",
						);
					}
					logger.info({ recipient, scheduleName }, "Notification email sent");
					return { recipient, success: true as const };
				} catch (error) {
					return failedDelivery(
						recipient,
						error instanceof Error ? error.message : "Unknown error",
					);
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
	 * Each recipient's language: a member of the organization (an org admin, or an
	 * approved external recipient who is also a member) gets their own recipient
	 * language; any other address the organization's default language. Best-effort:
	 * a failed lookup never stops a delivery.
	 */
	private async resolveRecipientLanguages(
		organizationId: string,
		recipients: readonly string[],
	): Promise<Map<string, string>> {
		const organizationLanguage = await resolveOrganizationNotificationLocale(organizationId).catch(
			(error: unknown) => {
				logger.warn(
					{ organizationId, error: error instanceof Error ? error.message : "Unknown error" },
					"Failed to load the organization language for scheduled export emails",
				);
				return DEFAULT_LANGUAGE;
			},
		);
		const memberUserIds = await findMemberUserIdsByEmail(organizationId, recipients).catch(
			(error: unknown) => {
				logger.warn(
					{ organizationId, error: error instanceof Error ? error.message : "Unknown error" },
					"Failed to match scheduled export recipients to members",
				);
				return new Map<string, string>();
			},
		);

		const entries = await Promise.all(
			recipients.map(async (recipient): Promise<[string, string]> => {
				const userId = memberUserIds.get(recipient.trim().toLowerCase());
				if (!userId) return [recipient, organizationLanguage];
				const language = await resolveRecipientNotificationLocale({
					userId,
					organizationId,
				}).catch(() => organizationLanguage);
				return [recipient, language];
			}),
		);
		return new Map(entries);
	}

	/**
	 * The email in `locale`: dates as plain calendar days, the link expiry in the
	 * organization's timezone with the zone printed. A schedule's own subject is kept as
	 * written; only its `{scheduleName}` and `{dateRange}` are filled in.
	 */
	private async renderEmail(params: {
		scheduleName: string;
		dateRange: CalculatedDateRange;
		fileUrl?: SignedFileUrl;
		recordCount?: number;
		subjectTemplate?: string;
		locale: string;
		timezone: string;
	}): Promise<RenderedDeliveryEmail> {
		const { scheduleName, fileUrl, recordCount, subjectTemplate, timezone } = params;
		const { locale, t } = await loadEmailTranslator(params.locale);

		// The range was calculated in the schedule's timezone: its days are calendar days.
		const dateRange = formatNotificationParam(
			notificationParam.plainDateRange(
				rangeDay(params.dateRange.start, "start"),
				rangeDay(params.dateRange.end, "end"),
			),
			{ locale },
		);

		const subject = subjectTemplate
			? this.renderSubject(subjectTemplate, { scheduleName, dateRange })
			: scheduledExportDeliverySubject(t, { scheduleName, dateRange });

		const html = await renderScheduledExportDeliveryEmail({
			locale,
			t,
			scheduleName,
			dateRange,
			recordCount:
				recordCount === undefined ? undefined : new Intl.NumberFormat(locale).format(recordCount),
			download: fileUrl
				? {
						url: fileUrl.url,
						lifetime: formatLifetime(fileUrl.lifetimeSeconds, locale),
						expiresAt: formatNotificationParam(
							notificationParam.zonedInstant(fileUrl.expiresAt, timezone, "dateTimeMedium"),
							{ locale },
						),
					}
				: undefined,
		});

		return { subject, html };
	}

	/**
	 * Fill a schedule's own subject template.
	 */
	private renderSubject(template: string, variables: Record<string, string>): string {
		return Object.entries(variables).reduce(
			(result, [key, value]) => result.replace(`{${key}}`, value),
			template,
		);
	}
}
