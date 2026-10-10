import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";

/**
 * How the kiosk page shows times and durations (#862). There is no user and so
 * no time-format preference: times follow the page language's convention, in
 * the zone the moment belongs to (the kiosk's zone, or a break's recorded zone).
 */
function localeHourCycle(locale: string): "12h" | "24h" {
	try {
		return new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12
			? "12h"
			: "24h";
	} catch {
		return "24h";
	}
}

/** A UTC ISO instant as a wall-clock time in `zone`, e.g. "08:30" or "8:30 AM". */
export function formatKioskTime(isoInstant: string, zone: string, locale: string): string {
	return formatInstant(
		parseInstant(isoInstant),
		{ locale, timezone: zone, timeFormat: localeHourCycle(locale) },
		"time",
	);
}

/** Worked minutes as hours and minutes in the page language, e.g. "4 hr 5 min". */
export function formatKioskDuration(totalMinutes: number, locale: string): string {
	const minutes = Math.max(0, Math.round(totalMinutes));
	const unit = (value: number, name: "hour" | "minute") =>
		new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "short" }).format(
			value,
		);
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return hours === 0 ? unit(rest, "minute") : `${unit(hours, "hour")} ${unit(rest, "minute")}`;
}
