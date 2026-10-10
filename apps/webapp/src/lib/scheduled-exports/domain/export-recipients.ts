/**
 * Export recipient rules shared by creating and updating a scheduled export.
 */
import { type DeliveryMethod, deliversByEmail } from "./types";

export type ExportRecipientsResult =
	| { ok: true; recipients: string[] }
	| { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises the export recipients a schedule will store (trimmed, lowercased,
 * de-duplicated) and checks them against the delivery method the schedule will have.
 */
export function resolveExportRecipients(
	deliveryMethod: DeliveryMethod,
	emailRecipients: readonly string[],
): ExportRecipientsResult {
	const recipients = [...new Set(emailRecipients.map((email) => email.trim().toLowerCase()))];

	if (!deliversByEmail(deliveryMethod)) {
		return { ok: true, recipients };
	}

	if (recipients.length === 0) {
		return { ok: false, message: "At least one email recipient is required for email delivery" };
	}

	const invalidEmails = recipients.filter((email) => !EMAIL_PATTERN.test(email));
	if (invalidEmails.length > 0) {
		return { ok: false, message: `Invalid email addresses: ${invalidEmails.join(", ")}` };
	}

	return { ok: true, recipients };
}
