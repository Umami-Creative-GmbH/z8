/**
 * Reserved, undeliverable email addresses of kiosk-only employees (ADR 0006,
 * #857). A kiosk-only employee is a real user without a credential whose email
 * is a placeholder under `RESERVED_EMAIL_DOMAIN`. It is distinct from the demo
 * domain because kiosk-only employees are billable seats.
 *
 * `isReservedEmail` is the one predicate every refusal point asks: sign-in,
 * sign-up, password reset, passkey enrolment, sessions, invitations, SCIM and
 * the mailer. Shared with client code, so this file has no server-only imports.
 */

/** RFC 2606 reserves `.invalid`; nothing under it is ever delivered. */
export const RESERVED_EMAIL_DOMAIN = "kiosk.invalid";

/** Whether `email` is a reserved kiosk-only address. Missing or malformed values are not. */
export function isReservedEmail(email: string | null | undefined): boolean {
	if (typeof email !== "string") return false;
	const normalized = email.trim().toLowerCase();
	const at = normalized.lastIndexOf("@");
	if (at <= 0) return false;
	return normalized.slice(at + 1) === RESERVED_EMAIL_DOMAIN;
}

/** A new reserved address, unique per user. */
export function generateReservedEmail(): string {
	return `kiosk-${crypto.randomUUID().replaceAll("-", "")}@${RESERVED_EMAIL_DOMAIN}`;
}
