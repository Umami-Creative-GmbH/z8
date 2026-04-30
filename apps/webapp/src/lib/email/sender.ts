/**
 * Email Sender - Worker entry point
 *
 * Re-exports email sending functionality for use by background workers.
 */

import { sendEmail as sendEmailInternal } from "./email-service";
import { renderOrganizationEmailTemplate } from "./template-renderer";
import { EMAIL_TEMPLATE_KEYS, type EmailTemplateKey } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { EmailJobData } from "@/lib/queue";

const logger = createLogger("EmailSender");

export { sendBulkEmail } from "./email-service";

function isEmailTemplateKey(value: string): value is EmailTemplateKey {
	return EMAIL_TEMPLATE_KEYS.includes(value as EmailTemplateKey);
}

/**
 * Send email from worker queue job
 *
 * This processes templated emails by rendering the template with the provided data,
 * then sending via the email service.
 */
export async function sendEmail(data: EmailJobData): Promise<void> {
	logger.info(
		{ to: data.to, template: data.template, subject: data.subject },
		"Sending email from worker",
	);

	if (!isEmailTemplateKey(data.template)) {
		throw new Error(`Unknown email template: ${data.template}`);
	}

	const rendered = await renderOrganizationEmailTemplate({
		organizationId: data.organizationId,
		templateKey: data.template,
		data: data.data,
		subjectOverride: data.subject,
	});

	await sendEmailInternal({
		to: data.to,
		subject: rendered.subject,
		html: rendered.html,
		organizationId: data.organizationId,
	});

	logger.info({ to: data.to }, "Email sent successfully");
}
