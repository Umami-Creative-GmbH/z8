import type { useTranslate } from "@tolgee/react";
import type { PerDiemItinerary } from "@/lib/travel-expenses/per-diem";
import { formatPlainDate, formatPlainTime } from "./format";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * Still needed labels of future-dated expenses and trips (#685). Each names
 * when submission opens: an expense or trip date as entered, a per diem return
 * in its own return timezone, never the viewer's.
 */

/** A receipt or mileage expense dated after today everywhere. */
export function futureDateLabel(t: Translate, locale: string, expenseDate: string | null) {
	return t(
		"travelExpenses.report.requirements.futureDate",
		"This date is in the future. Correct it, or submit from {date}.",
		{ date: expenseDate ? formatPlainDate(locale, expenseDate) : "" },
	);
}

/** A trip whose last travel day is after today everywhere. */
export function tripNotEndedLabel(t: Translate, locale: string, endDate: string | null) {
	return t(
		"travelExpenses.report.trip.requirements.notEnded",
		"The trip ends on {date}. You can submit from that day.",
		{ date: endDate ? formatPlainDate(locale, endDate) : "" },
	);
}

/** A per diem whose return has not passed. */
export function perDiemNotReturnedLabel(
	t: Translate,
	locale: string,
	itinerary: Pick<PerDiemItinerary, "endDate" | "endTime" | "endTimeZone"> | null,
) {
	return t(
		"travelExpenses.report.perDiem.requirements.notReturned",
		"You return on {date} at {time} ({timeZone}). You can submit after that.",
		{
			date: itinerary?.endDate ? formatPlainDate(locale, itinerary.endDate) : "",
			time: itinerary?.endTime ? formatPlainTime(locale, itinerary.endTime) : "",
			timeZone: itinerary?.endTimeZone ?? "",
		},
	);
}
