import type { PlatformSystemEmailTemplateKey } from "@/db/schema";
import { sendEmail } from "@/lib/email/email-service";
import { renderPlatformSystemEmailTemplate } from "@/lib/email/system-template-renderer";
import { createLogger } from "@/lib/logger";

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
	data: Record<string, unknown>;
}

export async function sendBillingSystemEmail({
	templateKey,
	to,
	data,
}: SendBillingSystemEmailParams): Promise<BillingSystemEmailResult> {
	if (!to?.trim()) {
		logger.warn({ templateKey }, "Skipping billing system email without recipient");
		return { sent: false, reason: "missing-recipient" };
	}

	try {
		const rendered = await renderPlatformSystemEmailTemplate({ templateKey, data });

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
