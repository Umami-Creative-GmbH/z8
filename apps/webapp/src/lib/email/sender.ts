/**
 * Email Sender - Worker entry point
 *
 * Re-exports email sending functionality for use by background workers.
 */

import { sendEmail as sendEmailInternal } from "./email-service";
import { createLogger } from "@/lib/logger";
import type { EmailJobData } from "@/lib/queue";

const logger = createLogger("EmailSender");

export { sendBulkEmail } from "./email-service";

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

	// Import template renderer dynamically
	const render = await import("./render");

	// Render template based on template name
	let html: string;

	switch (data.template) {
		case "absence-request-submitted":
			html = await render.renderAbsenceRequestSubmitted(
				data.data as Parameters<typeof render.renderAbsenceRequestSubmitted>[0],
			);
			break;
		case "absence-request-pending-approval":
			html = await render.renderAbsenceRequestPendingApproval(
				data.data as Parameters<typeof render.renderAbsenceRequestPendingApproval>[0],
			);
			break;
		case "absence-request-approved":
			html = await render.renderAbsenceRequestApproved(
				data.data as Parameters<typeof render.renderAbsenceRequestApproved>[0],
			);
			break;
		case "absence-request-rejected":
			html = await render.renderAbsenceRequestRejected(
				data.data as Parameters<typeof render.renderAbsenceRequestRejected>[0],
			);
			break;
		case "time-correction-pending-approval":
			html = await render.renderTimeCorrectionPendingApproval(
				data.data as Parameters<typeof render.renderTimeCorrectionPendingApproval>[0],
			);
			break;
		case "time-correction-approved":
			html = await render.renderTimeCorrectionApproved(
				data.data as Parameters<typeof render.renderTimeCorrectionApproved>[0],
			);
			break;
		case "time-correction-rejected":
			html = await render.renderTimeCorrectionRejected(
				data.data as Parameters<typeof render.renderTimeCorrectionRejected>[0],
			);
			break;
		case "email-verification":
			html = await render.renderEmailVerification(
				data.data as Parameters<typeof render.renderEmailVerification>[0],
			);
			break;
		case "organization-invitation":
			html = await render.renderOrganizationInvitation(
				data.data as Parameters<typeof render.renderOrganizationInvitation>[0],
			);
			break;
		case "password-reset":
			html = await render.renderPasswordReset(
				data.data as Parameters<typeof render.renderPasswordReset>[0],
			);
			break;
		case "team-member-added":
			html = await render.renderTeamMemberAdded(
				data.data as Parameters<typeof render.renderTeamMemberAdded>[0],
			);
			break;
		case "team-member-removed":
			html = await render.renderTeamMemberRemoved(
				data.data as Parameters<typeof render.renderTeamMemberRemoved>[0],
			);
			break;
		case "security-alert":
			html = await render.renderSecurityAlert(
				data.data as Parameters<typeof render.renderSecurityAlert>[0],
			);
			break;
		case "export-ready":
			html = await render.renderExportReady(
				data.data as Parameters<typeof render.renderExportReady>[0],
			);
			break;
		case "export-failed":
			html = await render.renderExportFailed(
				data.data as Parameters<typeof render.renderExportFailed>[0],
			);
			break;
		default:
			throw new Error(`Unknown email template: ${data.template}`);
	}

	await sendEmailInternal({
		to: data.to,
		subject: data.subject,
		html,
	});

	logger.info({ to: data.to }, "Email sent successfully");
}
