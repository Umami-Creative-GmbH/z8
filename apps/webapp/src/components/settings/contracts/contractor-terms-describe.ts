import { formatBillableAmount } from "@/lib/billable-time/format";
import {
	dayUnitRuleLabel,
	dayUnitRuleOfView,
} from "@/lib/contractor-compensation/day-unit-rule-label";
import type { ContractorCompensationView } from "@/lib/contractor-compensation/terms";
import type { Translate } from "@/lib/organization-action/action-error-message";

/** "€650.00 per day" and how worked days are counted (`dayUnitRuleLabel`). */
export function describeCompensation(
	t: Translate,
	locale: string,
	terms: ContractorCompensationView,
): { rate: string; rule: string | null } {
	// Display only: the stored decimal string is formatted as it is.
	const amount = formatBillableAmount(locale, terms.rateAmount, terms.currency);
	const rule = dayUnitRuleOfView(terms);
	return {
		rate:
			terms.compensationBasis === "hourly"
				? t("settings.contracts.contractors.perHour", "{amount} per hour", { amount })
				: t("settings.contracts.contractors.perDay", "{amount} per day", { amount }),
		rule: rule ? dayUnitRuleLabel(t, rule) : null,
	};
}
