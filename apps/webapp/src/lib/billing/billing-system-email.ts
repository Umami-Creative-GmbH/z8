import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import { type EmailTranslate, loadEmailTranslator } from "@/lib/email/email-i18n";
import { sendEmail } from "@/lib/email/email-service";
import { renderPlatformSystemEmailTemplate } from "@/lib/email/system-template-renderer";
import {
	type BillingEmailValues,
	billingEmailSubject,
	renderBillingEmail,
	withBillingFallbackValues,
} from "@/lib/email/templates/billing-email";
import { createLogger } from "@/lib/logger";
import { withFormattedTypedParams } from "@/lib/notifications/notification-params";
import { resolveRecipientNotificationLocale } from "@/lib/notifications/recipient-locale";

const logger = createLogger("BillingSystemEmail");

export type BillingSystemEmailResult =
	| { sent: true }
	| {
			sent: false;
			reason: "missing-recipient" | "send-failed" | "template-disabled";
	  };

export interface SendBillingSystemEmailParams {
	templateKey: PlatformSystemEmailTemplateKey;
	to?: string | null;
	/**
	 * The organization billed. Its default language writes the email (a billing contact
	 * has no Z8 user); without one the email is in English.
	 */
	organizationId?: string | null;
	/**
	 * The template's `{{variables}}`. Dates and amounts are typed notification params
	 * (`notificationParam.plainDate` / `.money`), formatted in the email's language.
	 */
	data: Record<string, unknown>;
}

/**
 * `data` as text in the email's language: typed params formatted, and values Stripe
 * did not provide filled with copy in that language. Overrides receive the same values.
 */
function localizedBillingData(
	data: Record<string, unknown>,
	locale: string,
	t: EmailTranslate,
): Record<string, unknown> {
	return withBillingFallbackValues(withFormattedTypedParams(data, { locale }), t);
}

function billingEmailValues(data: Record<string, unknown>): BillingEmailValues {
	return Object.fromEntries(
		Object.entries(data).flatMap(([key, value]) =>
			typeof value === "string" || typeof value === "number" ? [[key, value]] : [],
		),
	);
}

export async function sendBillingSystemEmail({
	templateKey,
	to,
	organizationId,
	data,
}: SendBillingSystemEmailParams): Promise<BillingSystemEmailResult> {
	if (!to?.trim()) {
		logger.warn({ templateKey }, "Skipping billing system email without recipient");
		return { sent: false, reason: "missing-recipient" };
	}

	try {
		const locale = await resolveRecipientNotificationLocale({ organizationId });
		const { locale: language, t } = await loadEmailTranslator(locale);
		const localizedData = localizedBillingData(data, language, t);
		const values = billingEmailValues(localizedData);

		const rendered = await renderPlatformSystemEmailTemplate({
			templateKey,
			data: localizedData,
			renderDefault: async () => ({
				subject: billingEmailSubject(templateKey, t, values),
				html: await renderBillingEmail({ templateKey, locale: language, t, values }),
			}),
		});

		if ("skipped" in rendered) {
			logger.debug(
				{ templateKey, reason: rendered.reason },
				"Skipping billing system email because platform system template is disabled",
			);
			return { sent: false, reason: rendered.reason };
		}

		const result = await sendEmail({
			to,
			subject: rendered.subject,
			html: rendered.html,
		});

		if (!result.success) {
			logger.warn({ templateKey }, "Failed to send billing system email");
			return { sent: false, reason: "send-failed" };
		}

		return { sent: true };
	} catch (error) {
		logger.warn(
			{ templateKey, error: error instanceof Error ? error.name : typeof error },
			"Failed to render or send billing system email",
		);
		return { sent: false, reason: "send-failed" };
	}
}
