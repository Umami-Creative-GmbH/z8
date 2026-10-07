import type { useTranslate } from "@tolgee/react";
import type { AllowanceSituation } from "@/lib/travel-expenses/allowance-override";

type Translate = ReturnType<typeof useTranslate>["t"];

export function allowanceSituationLabel(t: Translate, situation: AllowanceSituation) {
	switch (situation.kind) {
		case "missing_coverage":
			return t(
				"travelExpenses.allowanceOverride.situation.missingCoverage",
				"No organization policy covers it",
			);
		case "unsupported_case":
			return t(
				"travelExpenses.allowanceOverride.situation.unsupported",
				"Not covered by the supported calculation rules",
			);
		case "official_fallback":
			return t(
				"travelExpenses.allowanceOverride.situation.fallback",
				"Calculated with an official fallback rate",
			);
		case "missing_facts":
			return t(
				"travelExpenses.allowanceOverride.situation.missingFacts",
				"Required travel facts are missing",
			);
		case "calculated":
			return t("travelExpenses.allowanceOverride.situation.calculated", "Calculated by the policy");
	}
}
