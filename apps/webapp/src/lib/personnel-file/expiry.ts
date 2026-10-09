import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { ExpiryReminderKind } from "./expiry.types";

export { EXPIRY_REMINDER_KINDS, type ExpiryReminderKind } from "./expiry.types";

/**
 * Expiry reminders (#869): officers and, for shared documents, the employee
 * are reminded when a certificate or other document comes within the
 * organization's lead time of its expiry date, and again on the expiry date
 * (CONTEXT.md "Expiry date"). All days are plain calendar days; "today" is
 * the organization's calendar day (`todayInOrganization`).
 */

export const DEFAULT_EXPIRY_REMINDER_LEAD_DAYS = 30;
export const MIN_EXPIRY_REMINDER_LEAD_DAYS = 1;
export const MAX_EXPIRY_REMINDER_LEAD_DAYS = 365;

/**
 * The reminder a document is due for today, if any: the upcoming reminder
 * while today is within the lead time before the expiry date, the
 * expired-today reminder on the expiry date, nothing before or after.
 */
export function dueExpiryReminder(input: {
	today: string;
	expiryDate: string;
	leadDays: number;
}): ExpiryReminderKind | null {
	const today = parsePlainDate(input.today);
	const expiry = parsePlainDate(input.expiryDate);
	const order = today.until(expiry, { largestUnit: "days" }).days;
	if (order === 0) return "expired_today";
	if (order > 0 && order <= input.leadDays) return "upcoming";
	return null;
}

/** The last expiry date within the lead time: documents expiring up to it are listed and reminded. */
export function expiryWindowEnd(input: { today: string; leadDays: number }): string {
	return parsePlainDate(input.today).add({ days: input.leadDays }).toString();
}

export type ExpiryDescription =
	| { status: "upcoming"; days: number }
	| { status: "today"; days: 0 }
	| { status: "expired"; days: number };

/** How far a document's expiry date is from today, for the expiring documents list. */
export function describeExpiry(input: { today: string; expiryDate: string }): ExpiryDescription {
	const days = parsePlainDate(input.today).until(parsePlainDate(input.expiryDate), {
		largestUnit: "days",
	}).days;
	if (days === 0) return { status: "today", days: 0 };
	if (days > 0) return { status: "upcoming", days };
	return { status: "expired", days: -days };
}

const LEAD_DAYS_MESSAGE = `Enter a lead time between ${MIN_EXPIRY_REMINDER_LEAD_DAYS} and ${MAX_EXPIRY_REMINDER_LEAD_DAYS} days.`;

/** Validates the lead time an administrator entered; never trust the shape. */
export function validateExpiryReminderLeadDays(
	value: unknown,
): { ok: true; value: number } | { ok: false; message: string } {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim() !== ""
				? Number(value)
				: Number.NaN;
	if (
		!Number.isInteger(number) ||
		number < MIN_EXPIRY_REMINDER_LEAD_DAYS ||
		number > MAX_EXPIRY_REMINDER_LEAD_DAYS
	) {
		return { ok: false, message: LEAD_DAYS_MESSAGE };
	}
	return { ok: true, value: number };
}
