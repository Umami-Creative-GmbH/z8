import { type Instant, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";

/**
 * The skill expiry date (#1142, Scheduling CONTEXT.md): the last day an employee skill is valid,
 * a plain `YYYY-MM-DD` day on the organization's calendar, null when it never expires. It means
 * the same as a personnel file expiry date.
 *
 * Every check of an employee skill against a day goes through `isExpiredSkillOn`: the shift date
 * when planning a shift (save warning, qualification checks, qualified-employee lookups, staffing
 * suggestions), the organization's today (`skillExpiryToday`) for badges and reminders.
 *
 * Pure and client-safe: no database access.
 */

/** Days before the skill expiry date that the "Expiring soon" badge counts from (#1143 makes it a setting). */
export const DEFAULT_SKILL_EXPIRING_SOON_DAYS = 30;

const toPlainDate = (day: string | PlainDate): PlainDate =>
	typeof day === "string" ? parsePlainDate(day) : day;

/**
 * An expired skill on `day`: `day` is after the skill expiry date. The skill expiry date itself
 * is still covered; a skill without one never expires.
 */
export function isExpiredSkillOn(expiresAt: string | null, day: string | PlainDate): boolean {
	if (expiresAt === null) return false;
	return parsePlainDate(expiresAt).until(toPlainDate(day), { largestUnit: "days" }).days > 0;
}

export type SkillExpiryBadge = "expired" | "expiringSoon";

/**
 * The badge an employee skill shows on the organization's `today`: expired after its skill
 * expiry date, expiring soon from `expiringSoonDays` before it up to and including the date.
 */
export function skillExpiryBadge(input: {
	expiresAt: string | null;
	today: string;
	expiringSoonDays: number;
}): SkillExpiryBadge | null {
	if (input.expiresAt === null) return null;
	if (isExpiredSkillOn(input.expiresAt, input.today)) return "expired";
	const daysLeft = parsePlainDate(input.today).until(parsePlainDate(input.expiresAt), {
		largestUnit: "days",
	}).days;
	return daysLeft <= input.expiringSoonDays ? "expiringSoon" : null;
}

/** The organization's calendar day at `now` (UTC for a missing or unknown zone). */
export function skillExpiryToday(now: Instant, organizationTimezone: unknown): PlainDate {
	const zone = resolveOrganizationTimezone(organizationTimezone).timezone;
	return now.toZonedDateTimeISO(zone).toPlainDate();
}

const EXPIRY_DATE_MESSAGE = "Enter the expiry date as YYYY-MM-DD.";

/** Validates a skill expiry date sent by a client; empty means "never expires". Never trust the shape. */
export function parseSkillExpiryDate(
	value: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
	if (value === undefined || value === null || value === "") return { ok: true, value: null };
	if (typeof value !== "string") return { ok: false, message: EXPIRY_DATE_MESSAGE };
	try {
		return { ok: true, value: parsePlainDate(value).toString() };
	} catch {
		return { ok: false, message: EXPIRY_DATE_MESSAGE };
	}
}
