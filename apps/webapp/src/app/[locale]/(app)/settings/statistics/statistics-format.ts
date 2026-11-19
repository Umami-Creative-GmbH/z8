import { parseInstant } from "@/lib/datetime/temporal-core";
import { numberFormatter } from "@/lib/intl-number-format";

/** A change between two counts, signed except at zero, in the reader's locale. */
export function formatSignedCount(value: number, locale: string) {
	return numberFormatter(locale, { signDisplay: "exceptZero" }).format(value);
}

/**
 * When the statistics were read: the instant in the organization's time zone,
 * with the zone named, in the reader's locale.
 */
export function formatStatisticsFetchedAt(fetchedAt: string, locale: string, timeZone: string) {
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
		timeZoneName: "short",
	};
	let formatter: Intl.DateTimeFormat;
	try {
		formatter = new Intl.DateTimeFormat(locale, options);
	} catch {
		formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
	}
	return formatter.format(parseInstant(fetchedAt).epochMilliseconds);
}
