import type { useTranslate } from "@tolgee/react";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * Planner text for JArbSchG youth-protection and BBiG apprentice-release findings (#1993), or
 * null for other statutory kinds. Quantities are minutes or days, never money.
 */
export function youthProtectionWarningText(
	finding: StatutoryComplianceFinding,
	t: Translate,
): string | null {
	const used = finding.summary.used?.value ?? 0;
	const limit = finding.summary.limit?.value ?? 0;
	switch (finding.statutoryKind) {
		case "jarbschg_daily_max":
			return t(
				"scheduling:scheduling.statutory.jarbschg.dailyMax",
				"Under 18: {used} min of work on this day exceeds the {limit} min youth limit",
				{ used, limit },
			);
		case "jarbschg_weekly_max":
			return t(
				"scheduling:scheduling.statutory.jarbschg.weeklyMax",
				"Under 18: {used} min of work this week exceeds the {limit} min youth limit",
				{ used, limit },
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
				"Under 18: public holiday work needs a statutory sector exception",
			);
		case "bbig_release_day_shift":
			return t(
				"scheduling:scheduling.statutory.apprenticeship.releaseDayShift",
				"Apprentice release day: school, block-release or exam day",
			);
		case "jarbschg_school_day_workplace_return":
			return t(
				"scheduling:scheduling.statutory.apprenticeship.workplaceReturn",
				"Under 18: no work on the week's full vocational school day",
			);
		default:
			return null;
	}
}
