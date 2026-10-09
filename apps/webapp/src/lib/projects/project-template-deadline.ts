import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

/**
 * The deadline of a project created from a template (#880): the creation
 * date, as a calendar date in the organization's timezone, plus the
 * template's offset in days. A project deadline is a calendar date stored as
 * UTC midnight of that date (the project form's representation), so the
 * result is that Date; null when the template has no offset.
 */
export function projectDeadlineFromTemplateOffset({
	now,
	timezone,
	offsetDays,
}: {
	now: Instant;
	timezone: string;
	offsetDays: number | null;
}): Date | null {
	if (offsetDays === null) return null;
	const deadline = now.toZonedDateTimeISO(timezone).toPlainDate().add({ days: offsetDays });
	return new Date(
		Temporal.ZonedDateTime.from({
			timeZone: "UTC",
			year: deadline.year,
			month: deadline.month,
			day: deadline.day,
		}).epochMilliseconds,
	);
}
