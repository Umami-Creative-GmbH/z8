import type { useTranslate } from "@tolgee/react";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import type { StatutoryDomain } from "@/lib/statutory/threshold-catalog";
import { youthProtectionWarningText } from "./youth-protection-warning-text";

type Translate = ReturnType<typeof useTranslate>["t"];

/** The statutory area a finding belongs to, as planners read it. */
export function statutoryDomainLabel(domain: StatutoryDomain, t: Translate): string {
	switch (domain) {
		case "minijob":
			return t("scheduling:scheduling.statutory.domain.minijob", "Minijob limit");
		case "short_term":
			return t("scheduling:scheduling.statutory.domain.shortTerm", "Short-term employment limit");
		case "working_student":
			return t("scheduling:scheduling.statutory.domain.workingStudent", "Working student limit");
		case "on_call":
			return t("scheduling:scheduling.statutory.domain.onCall", "On-call work (§ 12 TzBfG)");
		case "youth_protection":
			return t(
				"scheduling:scheduling.statutory.domain.youthProtection",
				"Youth protection (JArbSchG)",
			);
		case "apprenticeship":
			return t(
				"scheduling:scheduling.statutory.domain.apprenticeship",
				"Apprentice release (BBiG)",
			);
	}
}

/**
 * Wage-free warning text for a statutory finding in Scheduling and Staffing. Monitors with a more
 * specific message add a `case` on `finding.statutoryKind` here (#1989–#1993). Earnings-derived
 * findings (Minijob) arrive with their tier only, so they read "approaching" or "exceeded".
 */
export function statutoryWarningText(finding: StatutoryComplianceFinding, t: Translate): string {
	const youthProtection = youthProtectionWarningText(finding, t);
	if (youthProtection) return youthProtection;
	const area = statutoryDomainLabel(finding.domain, t);
	if (finding.summary.usedPercent !== undefined) {
		return t(
			"scheduling:scheduling.statutory.warningPercent",
			"{area}: {percent} % of the statutory limit",
			{ area, percent: finding.summary.usedPercent },
		);
	}
	switch (finding.summary.tier) {
		case "exceeded":
			return t(
				"scheduling:scheduling.statutory.warningExceeded",
				"{area}: statutory limit exceeded",
				{
					area,
				},
			);
		case "warning":
		case "critical":
			return t(
				"scheduling:scheduling.statutory.warningApproaching",
				"{area}: approaching the statutory limit",
				{ area },
			);
		default:
			return t("scheduling:scheduling.statutory.warning", "{area}: statutory limit at risk", {
				area,
			});
	}
}
