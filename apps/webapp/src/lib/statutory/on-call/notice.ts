/**
 * § 12 Abs. 3 TzBfG: an on-call employee need only work when the employer announces the call at
 * least four days ahead. Four *full* calendar days must lie between the notification day and the
 * shift day, both excluded (Monday's notice → Saturday at the earliest). Days are calendar days in
 * the organization's timezone, so a 23- or 25-hour DST day still counts as one day.
 */
import {
	compareInstants,
	type Instant,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";

/** Full calendar days strictly between the notification day and the shift day (may be negative). */
export function fullNoticeDays(notifiedOn: PlainDate, shiftDate: PlainDate): number {
	return notifiedOn.until(shiftDate, { largestUnit: "days" }).days - 1;
}

export interface ShiftNotificationFacts {
	readonly status: "draft" | "published";
	readonly publishedAt: Instant | null;
	readonly assignmentChangedAt: Instant;
}

/**
 * When the employee learns of the call-in. A draft is not announced yet: publishing it now
 * announces it now. A published shift is announced at publication, or at its last material
 * assignment change if that came later (a moved or reassigned shift is a new call-in).
 */
export function shiftNotificationInstant(shift: ShiftNotificationFacts, now: Instant): Instant {
	if (shift.status === "draft") return now;
	const published = shift.publishedAt ?? shift.assignmentChangedAt;
	return compareInstants(shift.assignmentChangedAt, published) > 0
		? shift.assignmentChangedAt
		: published;
}

/** The organization-local notification day of an instant. */
export function notificationDay(notifiedAt: Instant, timezone: string): PlainDate {
	return plainDateAt(notifiedAt, timezone);
}
