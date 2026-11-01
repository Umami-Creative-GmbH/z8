import { Temporal } from "temporal-polyfill";

/**
 * Dates on the kiosk credential cards (kiosk badges #1364, kiosk fobs #1508),
 * in the UI language: an instant's date in the organization's zone, never the
 * viewer's.
 */
export function kioskDateLabel(iso: string, zone: string, locale: string): string {
	return Temporal.Instant.from(iso)
		.toZonedDateTimeISO(zone)
		.toPlainDate()
		.toLocaleString(locale, { dateStyle: "medium" });
}

/** A calendar day (ISO date) as it is, in the UI language. */
export function kioskDayLabel(day: string, locale: string): string {
	return Temporal.PlainDate.from(day).toLocaleString(locale, { dateStyle: "medium" });
}
