import type { useTranslate } from "@tolgee/react";

export {
	formatCountry,
	formatMoney,
	formatPlainDate,
	formatPlainDateRange,
	formatRecordedInstant,
	formatSignedMoney,
} from "@/lib/travel-expenses/format";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Translated label of an expense category, falling back to the stored value. */
export function categoryLabel(t: Translate, category: string) {
	const labels: Record<string, string> = {
		transport: t("travelExpenses.report.categories.transport", "Transport"),
		accommodation: t("travelExpenses.report.categories.accommodation", "Accommodation"),
		meals: t("travelExpenses.report.categories.meals", "Meals"),
		parking: t("travelExpenses.report.categories.parking", "Parking"),
		other: t("travelExpenses.report.categories.other", "Other"),
	};
	return labels[category] ?? category;
}
