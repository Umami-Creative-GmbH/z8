import type { useTranslate } from "@tolgee/react";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * #1990: planner text for the short-term allowance (70 working days or 3 months per calendar
 * year), with the remaining working or calendar days. Returns null for other findings.
 */
export function shortTermWarningText(
	finding: StatutoryComplianceFinding,
	t: Translate,
): string | null {
	const { used, limit, remaining, tier } = finding.summary;
	if (!used || !limit || !remaining) return null;
	const params = { used: used.value, limit: limit.value, remaining: remaining.value };
	switch (finding.statutoryKind) {
		case "short_term_work_days":
			return tier === "exceeded"
				? t(
						"scheduling:scheduling.statutory.shortTerm.daysExceeded",
						"Short-term day limit exceeded: {used} of {limit} working days this year",
						params,
					)
				: t(
						"scheduling:scheduling.statutory.shortTerm.daysRemaining",
						"Short-term employment: {remaining} of {limit} working days left this year",
						params,
					);
		case "short_term_weeks":
			return tier === "exceeded"
				? t(
						"scheduling:scheduling.statutory.shortTerm.weeksExceeded",
						"Agricultural short-term limit exceeded: {used} of {limit} calendar days",
						params,
					)
				: t(
						"scheduling:scheduling.statutory.shortTerm.weeksRemaining",
						"Agricultural short-term employment: {remaining} of {limit} calendar days left",
						params,
					);
		case "short_term_months":
			return tier === "exceeded"
				? t(
						"scheduling:scheduling.statutory.shortTerm.calendarDaysExceeded",
						"Short-term 3-month limit exceeded: {used} of {limit} calendar days this year",
						params,
					)
				: t(
						"scheduling:scheduling.statutory.shortTerm.calendarDaysRemaining",
						"Short-term employment (3-month limit): {remaining} of {limit} calendar days left this year",
						params,
					);
		default:
			return null;
	}
}
