import type { useTranslate } from "@tolgee/react";
import type { DateRange } from "@/app/[locale]/(app)/scheduling/types";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type { ScheduleStatutoryFindingItem } from "@/lib/statutory/scheduling/findings-list";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Youth findings that judge the week (§ 8 Abs. 1, § 15 JArbSchG count Monday to Sunday). */
const YOUTH_WEEK_KINDS: ReadonlySet<string> = new Set([
	"jarbschg_weekly_max",
	"jarbschg_days_per_week",
]);

/**
 * The day, week or month a finding concerns, as the reader's locale writes it: the day a youth or
 * apprentice finding names (the week of a youth weekly limit), else the period it judges (a whole
 * month by its name).
 */
export function statutoryFindingWhen(
	item: Pick<ScheduleStatutoryFindingItem, "finding" | "period">,
	locale: string,
	t: Translate,
): string | null {
	const day = item.finding.day ?? item.finding.releaseDay;
	if (day && YOUTH_WEEK_KINDS.has(item.finding.statutoryKind)) {
		const date = parsePlainDate(day);
		const monday = date.subtract({ days: date.dayOfWeek - 1 });
		return t("scheduling:scheduling.statutory.findings.weekOf", "Week of {date}", {
			date: formatPlainDate(monday, locale, "dateMedium"),
		});
	}
	if (day) return formatPlainDate(parsePlainDate(day), locale, "dateMedium");
	if (!item.period) return null;
	const start = parsePlainDate(item.period.start);
	const end = parsePlainDate(item.period.endExclusive);
	if (start.day === 1 && start.add({ months: 1 }).equals(end)) {
		return formatPlainDate(start, locale, "monthYear");
	}
	return formatPlainDateRange(start, end.subtract({ days: 1 }), locale, "dateMedium");
}

/**
 * The day the calendar opens on for a finding: the day it names, else the first day of its period
 * inside the visible range.
 */
export function statutoryFindingFocusDate(
	item: Pick<ScheduleStatutoryFindingItem, "finding" | "period">,
	dateRange: DateRange,
): string {
	const day = item.finding.day ?? item.finding.releaseDay;
	if (day) return day;
	if (!item.period) return dateRange.startDate;
	const overlapsRange =
		item.period.start < dateRange.endDateExclusive &&
		item.period.endExclusive > dateRange.startDate;
	if (overlapsRange && item.period.start < dateRange.startDate) return dateRange.startDate;
	return item.period.start;
}

/**
 * The count of findings the viewer may not see: "N more …" below listed findings, plain "N …" when
 * nothing is listed above it.
 */
export function outsideScopeText(count: number, besideListed: boolean, t: Translate): string {
	return besideListed
		? t(
				"scheduling:scheduling.statutory.findings.outsideScope",
				"{count, plural, one {# more finding concerns an employee you don't manage.} other {# more findings concern employees you don't manage.}}",
				{ count },
			)
		: t(
				"scheduling:scheduling.statutory.findings.outsideScopeOnly",
				"{count, plural, one {# finding concerns an employee you don't manage.} other {# findings concern employees you don't manage.}}",
				{ count },
			);
}
