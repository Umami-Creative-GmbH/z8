import type { useTranslate } from "@tolgee/react";
import type { ConversionRequirement } from "@/lib/travel-expenses/currency-conversion";

type Translate = ReturnType<typeof useTranslate>["t"];

/** What a missing conversion needs, as shown in the expense's "Still needed" list. */
export function conversionRequirementLabel(
	t: Translate,
	requirement: ConversionRequirement,
	currency: string,
): string {
	switch (requirement) {
		case "conversion_missing":
			return t(
				"travelExpenses.report.requirements.conversionMissing",
				"Convert this receipt into {currency}: enter your card charge with the attachment that shows it, or ask an expense administrator for a documented rate.",
				{ currency },
			);
		case "conversion_unsupported":
			return t(
				"travelExpenses.report.requirements.conversionUnsupported",
				"This conversion cannot be used for {currency}. Ask an expense administrator to check it.",
				{ currency },
			);
		case "conversion_evidence":
			return t(
				"travelExpenses.report.requirements.conversionEvidence",
				"Select the attachment that shows the card charge.",
			);
		case "conversion_rate_date":
			return t(
				"travelExpenses.report.requirements.conversionRateDate",
				"The authorized rate's date no longer fits the expense date. Enter your card charge, or ask an expense administrator to document a rate for the new date.",
			);
	}
}
