/**
 * Recipient email rules shared by creating and updating a scheduled export.
 *
 * These check address format only. Who may be an export recipient at all
 * (org admins, approved external recipients) is a separate rule.
 */
import { type DeliveryMethod, deliversByEmail } from "./types";

export type RecipientEmailsResult =
	| { ok: true; recipients: string[] }
	| { ok: false; message: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalises the recipient emails a schedule will store (trimmed, lowercased,
 * blanks dropped, de-duplicated) and checks them against the delivery method
 * the schedule will have.
 */
export function resolveRecipientEmails(
	deliveryMethod: DeliveryMethod,
	emailRecipients: readonly string[],
): RecipientEmailsResult {
	const recipients = [
		...new Set(emailRecipients.map((email) => email.trim().toLowerCase()).filter(Boolean)),
	];

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
