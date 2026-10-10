import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";

/**
 * "Since" in the manager view (#863): the time in the zone captured at that
 * moment (Timekeeping Reference: display each endpoint with its captured zone),
 * with the date added when it was on an earlier local day.
 */
export function formatPresenceSince(
	since: Date,
	zone: string,
	context: { locale: string; timeFormat: "12h" | "24h"; now: Instant },
): string {
	const instant = instantFromDate(since);
	const sameLocalDay = instant
		.toZonedDateTimeISO(zone)
		.toPlainDate()
		.equals(context.now.toZonedDateTimeISO(zone).toPlainDate());
	return formatInstant(
		instant,
		{ locale: context.locale, timeFormat: context.timeFormat, timezone: zone },
		sameLocalDay ? "time" : "dateTimeMedium",
	);
}
