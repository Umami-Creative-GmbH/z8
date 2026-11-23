import type { useTranslate } from "@tolgee/react";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The release day of an apprentice release conflict, as the reader's locale writes it. */
function releaseDateText(finding: StatutoryComplianceFinding, locale: string): string {
	return finding.releaseDay
		? formatPlainDate(parsePlainDate(finding.releaseDay), locale, "dateMedium")
		: "—";
}

/** The day of a youth-protection finding, as the reader's locale writes it. */
function findingDayText(finding: StatutoryComplianceFinding, locale: string): string {
	return finding.day ? formatPlainDate(parsePlainDate(finding.day), locale, "dateMedium") : "—";
}

/**
 * The Monday of the week of a youth-protection finding (§ 8 counts Monday to Sunday), as the
 * reader's locale writes it: every shift past the weekly cap carries a finding of that week.
 */
function findingWeekText(finding: StatutoryComplianceFinding, locale: string): string {
	if (!finding.day) return "—";
	const day = parsePlainDate(finding.day);
	return formatPlainDate(day.subtract({ days: day.dayOfWeek - 1 }), locale, "dateMedium");
}

/**
 * Planner text for JArbSchG youth-protection and BBiG apprentice-release findings (#1993), or
 * null for other statutory kinds. Quantities are minutes or days, never money.
 */
export function youthProtectionWarningText(
	finding: StatutoryComplianceFinding,
	t: Translate,
	locale: string,
): string | null {
	const used = finding.summary.used?.value ?? 0;
	const limit = finding.summary.limit?.value ?? 0;
	switch (finding.statutoryKind) {
		// Every piece of work past a cap has a finding: the line names its day or week, so
		// Staffing can show one line per day and per week.
		case "jarbschg_daily_max":
			return t(
				"scheduling:scheduling.statutory.jarbschg.dailyMaxOn",
				"Under 18: {used} min of work on {date} exceeds the {limit} min youth limit",
				{ used, limit, date: findingDayText(finding, locale) },
			);
		case "jarbschg_weekly_max":
			return t(
				"scheduling:scheduling.statutory.jarbschg.weeklyMaxWeekOf",
				"Under 18: {used} min of work in the week of {date} exceeds the {limit} min youth limit",
				{ used, limit, date: findingWeekText(finding, locale) },
			);
		case "jarbschg_days_per_week":
			return t(
				"scheduling:scheduling.statutory.jarbschg.daysPerWeek",
				"Under 18: {used} working days this week, at most {limit} allowed",
				{ used, limit },
			);
		case "jarbschg_rest_period":
			return t(
				"scheduling:scheduling.statutory.jarbschg.restPeriod",
				"Under 18: only {used} min of rest before this shift, {limit} min required",
				{ used, limit },
			);
		case "jarbschg_break":
			return t(
				"scheduling:scheduling.statutory.jarbschg.break",
				"Under 18: {used} min of breaks taken, {limit} min required",
				{ used, limit },
			);
		case "jarbschg_uninterrupted":
			return t(
				"scheduling:scheduling.statutory.jarbschg.uninterrupted",
				"Under 18: {used} min worked without a break, at most {limit} min allowed",
				{ used, limit },
			);
		case "jarbschg_night_work":
			return t(
				"scheduling:scheduling.statutory.jarbschg.nightWork",
				"Under 18: {used} min of night work between 20:00 and 06:00",
				{ used },
			);
		case "jarbschg_saturday_work":
			return t(
				"scheduling:scheduling.statutory.jarbschg.saturdayWork",
				"Under 18: Saturday work needs a statutory sector exception",
			);
		case "jarbschg_sunday_work":
			return t(
				"scheduling:scheduling.statutory.jarbschg.sundayWork",
				"Under 18: Sunday work needs a statutory sector exception",
			);
		case "jarbschg_holiday_work":
			return t(
				"scheduling:scheduling.statutory.jarbschg.holidayWork",
				"Under 18: work on a public holiday needs a statutory sector exception",
			);
		case "jarbschg_holiday_prohibited":
			return t(
				"scheduling:scheduling.statutory.jarbschg.holidayProhibited",
				"Under 18: {used} min of prohibited work: none after 14:00 on 24 or 31 December, or on 25 December, 1 January, Easter Sunday or 1 May; no exception allows it",
				{ used },
			);
		// A shift through two release days has a conflict on each: the line names its day.
		case "bbig_release_day_shift":
			return t(
				"scheduling:scheduling.statutory.apprenticeship.releaseDayShiftOn",
				"Apprentice release day on {date}: school, block-release or exam day",
				{ date: releaseDateText(finding, locale) },
			);
		case "jarbschg_school_day_workplace_return":
			return t(
				"scheduling:scheduling.statutory.apprenticeship.workplaceReturnOn",
				"Under 18: no work on {date}, the week's full vocational school day",
				{ date: releaseDateText(finding, locale) },
			);
		default:
			return null;
	}
}
