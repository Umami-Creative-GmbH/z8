import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { numberFormatter } from "@/lib/intl-number-format";
import type { ComparisonDays, LikeForLike } from "./statistics-types";

/** A change between two figures, signed except at zero, in the reader's locale. */
export function formatSignedCount(value: number, locale: string, maximumFractionDigits = 0) {
	return numberFormatter(locale, { signDisplay: "exceptZero", maximumFractionDigits }).format(
		value,
	);
}

/** Minutes as hours with at most one decimal, in the reader's locale. */
export function formatHours(minutes: number, locale: string) {
	return numberFormatter(locale, { maximumFractionDigits: 1 }).format(minutes / 60);
}

/** A share as a whole percentage, in the reader's locale. */
export function formatPercent(part: number, whole: number, locale: string) {
	return numberFormatter(locale, { style: "percent", maximumFractionDigits: 0 }).format(
		part / whole,
	);
}

/** Which way a like-for-like figure moved. Neither way is good or bad, so it carries no tone. */
export function changeDirection({ current, previous }: LikeForLike): "up" | "down" | "flat" {
	return current > previous ? "up" : current < previous ? "down" : "flat";
}

/**
 * The comparison window's days as a short range, e.g. "Oct 1–5" or "Feb 1–28", in
 * the reader's locale. The days are calendar dates, so they are formatted in UTC.
 */
export function formatComparisonDays(days: ComparisonDays, locale: string) {
	const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
	const toEpoch = (day: string) => parsePlainDate(day).toZonedDateTime("UTC").epochMilliseconds;
	return new Intl.DateTimeFormat(locale, options).formatRange(
		toEpoch(days.firstDay),
		toEpoch(days.lastDay),
	);
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
