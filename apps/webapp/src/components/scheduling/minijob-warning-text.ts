import type { useTranslate } from "@tolgee/react";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * Wage-free Scheduling / Staffing text for Minijob findings (#1989), or null for other findings.
 * Minijob findings reach planners with their tier only.
 */
export function minijobWarningText(
	finding: StatutoryComplianceFinding,
	t: Translate,
): string | null {
	const exceeded = finding.summary.tier === "exceeded";
	switch (finding.statutoryKind) {
		case "minijob_monthly_cap":
			// A current acknowledgement documents the month only while it still qualifies: above twice
			// the cap or one exceedance too many, the finding stays critical however it was acknowledged.
			if (
				exceeded &&
				finding.acknowledgementStatus === "current" &&
				finding.severity !== "critical"
			) {
				return t(
					"scheduling:scheduling.statutory.minijob.monthlyDocumented",
					"Minijob monthly limit exceeded (documented as unforeseeable)",
				);
			}
			return exceeded
				? t(
						"scheduling:scheduling.statutory.minijob.monthlyExceeded",
						"Minijob monthly limit exceeded",
					)
				: t(
						"scheduling:scheduling.statutory.minijob.monthlyApproaching",
						"Minijob monthly limit approaching",
					);
		case "minijob_rolling_12m_cap":
			return exceeded
				? t(
						"scheduling:scheduling.statutory.minijob.rollingExceeded",
						"Minijob 12-month earnings limit exceeded",
					)
				: t(
						"scheduling:scheduling.statutory.minijob.rollingApproaching",
						"Minijob 12-month earnings limit approaching",
					);
		default:
			return null;
	}
}
