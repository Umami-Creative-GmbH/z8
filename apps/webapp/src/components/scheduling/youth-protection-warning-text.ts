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
			// Outside the hours § 14 Abs. 2, 3, 5, 6 allow for the minor's age: no exception. Only the
			// minutes outside them are named, not the night work an exception could cover.
			if (finding.acknowledgementStatus === null) {
				return t(
					"scheduling:scheduling.statutory.jarbschg.nightWorkBeyondSector",
					"Under 18: {minutes} min of night work outside the hours a sector exception allows (from 15: 05:00 to 21:00; from 16 until 23:30; from 17 in bakeries from 04:00; none under 15); no exception allows it",
					{ minutes: finding.beyondSectorHours ?? used },
				);
			}
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
		case "jarbschg_shift_span":
			return t(
				"scheduling:scheduling.statutory.jarbschg.shiftSpanOn",
				"Under 18: the shift span on {date} is {used} min, from the first work to the end of the last; at most {limit} min allowed (11 h in hospitality, agriculture, animal husbandry and on construction sites)",
				{ used, limit, date: findingDayText(finding, locale) },
			);
		// A shift through two release days has a conflict on each: the line names its day.
		case "bbig_release_day_shift":
			// Work past a full block week's 2 h of in-company training: the week's total work on its
			// block days (every finding of the week holds the same total), the limit, and the day.
			if (finding.summary.limit) {
				const week = t(
					"scheduling:scheduling.statutory.apprenticeship.blockWeekTrainingWeek",
					"Block-release week: {used} min of work on this week's school days, {limit} min of in-company training allowed; past the allowance on {date}",
					{ used, limit, date: releaseDateText(finding, locale) },
				);
				// #2023: the allowed minutes stay out of a minor's § 8 totals; say why.
				const note = t(
					"scheduling:scheduling.statutory.apprenticeship.blockWeekTrainingNote",
					"The allowed training (§ 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 3 BBiG) comes on top of the block week, which counts with the average weekly working time (§ 9 Abs. 2 Nr. 2 JArbSchG), and does not count towards an under-18's § 8 daily and weekly limits",
				);
				return `${week}. ${note}`;
			}
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
