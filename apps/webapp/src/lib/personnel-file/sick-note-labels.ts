import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";

/**
 * Display helpers for sick notes on absences (#982), shared by server and
 * client code, so they import nothing server-only.
 */

/**
 * An absence's date range in the locale, e.g. "12–14 Oct 2026" (en-GB) or
 * "12. Okt. 2026" for a single day in German. Dates are YYYY-MM-DD plain days.
 */
export function formatAbsenceDateRange(startDate: string, endDate: string, locale: string): string {
	return formatPlainDateRange(
		parsePlainDate(startDate),
		parsePlainDate(endDate),
		locale,
		"dateMedium",
	);
}
