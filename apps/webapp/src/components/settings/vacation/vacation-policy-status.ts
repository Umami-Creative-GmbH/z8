import { Temporal } from "temporal-polyfill";
import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";

/**
 * The organization's calendar day at `now`, or null while its timezone is unknown. Policy
 * validity is a business date of the organization, never the viewer's or UTC's day.
 */
export function organizationToday(
	timezone: string | null | undefined,
	now: Instant = Temporal.Now.instant(),
): PlainDate | null {
	if (!timezone) return null;
	try {
		return now.toZonedDateTimeISO(timezone).toPlainDate();
	} catch {
		return null;
	}
}

/**
 * Whether a policy's last valid day (YYYY-MM-DD) lies before the organization's today. Unknown
 * today or an unreadable date never marks a policy superseded.
 */
export function isPolicySuperseded(
	validUntil: string | null | undefined,
	today: PlainDate | null,
): boolean {
	if (!validUntil || !today) return false;
	try {
		return comparePlainDates(parsePlainDate(validUntil), today) < 0;
	} catch {
		return false;
	}
}
