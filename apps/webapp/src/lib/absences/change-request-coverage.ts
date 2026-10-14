import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	formatInstant,
	formatPlainDateRange,
	localeDefaultTimeFormat,
} from "@/lib/datetime/temporal-format";
import type { AbsenceDayRange } from "./absence-days";

type RecordedRange = AbsenceDayRange & {
	canonical?: { startAt: string; endAt: string } | null;
};
/** Explicit hours use legacy morning markers, even when they start at night. */
export function hasExactAbsenceHours(range: RecordedRange): boolean {
	if (
		!range.canonical ||
		range.startDate !== range.endDate ||
		range.startPeriod !== "am" ||
		range.endPeriod !== "am"
	)
		return false;
	const start = parseInstant(range.canonical.startAt).toZonedDateTimeISO("UTC");
	const end = parseInstant(range.canonical.endAt).toZonedDateTimeISO("UTC");
	return (
		start.toPlainTime().toString() !== "00:00:00" ||
		end.toPlainTime().toString() !== "11:59:59.999" ||
		end.toPlainDate().toString() !== range.endDate
	);
}

/** Human-readable coverage without shifting synthetic absence clocks into the viewer's zone. */
export function formatAbsenceChangeRange(
	range: RecordedRange,
	locale: string,
	periodLabel: (period: AbsenceDayRange["startPeriod"]) => string,
): string {
	const exact = hasExactAbsenceHours(range);
	const startDay =
		exact && range.canonical
			? parseInstant(range.canonical.startAt).toZonedDateTimeISO("UTC").toPlainDate()
			: parsePlainDate(range.startDate);
	const endDay =
		exact && range.canonical
			? parseInstant(range.canonical.endAt).toZonedDateTimeISO("UTC").toPlainDate()
			: parsePlainDate(range.endDate);
	const dates = formatPlainDateRange(startDay, endDay, locale, "dateMedium");
	if (exact && range.canonical) {
		const context = {
			locale,
			timezone: "UTC",
			timeFormat: localeDefaultTimeFormat(locale),
		};
		return `${dates} (${formatInstant(parseInstant(range.canonical.startAt), context, "time")} – ${formatInstant(parseInstant(range.canonical.endAt), context, "time")})`;
	}
	if (range.startPeriod === "full_day" && range.endPeriod === "full_day") return dates;
	return `${dates} (${periodLabel(range.startPeriod)} – ${periodLabel(range.endPeriod)})`;
}
