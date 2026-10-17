import type { useTranslate } from "@tolgee/react";
import {
	getAbsenceCategoryDisplayDescription,
	getAbsenceCategoryDisplayName,
} from "@/lib/absences/category-display";
import type { AbsenceCategoryForSettings } from "./absence-category-form-utils";

type Translate = ReturnType<typeof useTranslate>["t"];

export const getCategoryTypeLabel = (t: Translate, type: string) => {
	const labels: Record<string, string> = {
		bereavement: t("settings.absenceCategories.type.bereavement", "Bereavement"),
		custom: t("settings.absenceCategories.type.custom", "Custom"),
		home_office: t("settings.absenceCategories.type.homeOffice", "Home Office"),
		parental: t("settings.absenceCategories.type.parental", "Parental Leave"),
		personal: t("settings.absenceCategories.type.personal", "Personal"),
		sick: t("settings.absenceCategories.type.sick", "Sick Leave"),
		unpaid: t("settings.absenceCategories.type.unpaid", "Unpaid"),
		vacation: t("settings.absenceCategories.type.vacation", "Vacation"),
		time_off_in_lieu: t("settings.absenceCategories.type.timeOffInLieu", "Time Off in Lieu"),
	};

	return labels[type] || type;
};

export function filterAbsenceCategories(
	categories: AbsenceCategoryForSettings[] | undefined,
	search: string,
	locale: string,
	t: Translate,
) {
	if (!categories) return [];
	if (!search) return categories;

	const searchLower = search.toLowerCase();
	return categories.filter((category) => {
		const searchableValues = [
			category.name,
			category.description,
			getAbsenceCategoryDisplayName(category, locale, t),
			getAbsenceCategoryDisplayDescription(category, locale, t),
		];

		return searchableValues.some((value) => value?.toLowerCase().includes(searchLower));
	});
}
