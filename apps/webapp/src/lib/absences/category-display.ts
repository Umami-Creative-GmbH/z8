import type { LocaleTranslationMap } from "@/db/schema/absence";

export type AbsenceCategoryDisplayType =
	| "home_office"
	| "sick"
	| "vacation"
	| "personal"
	| "unpaid"
	| "parental"
	| "bereavement"
	| "custom"
	| "time_off_in_lieu";

type TranslateFn = (key: string, fallback: string) => string;

type DisplayCategory = {
	type: AbsenceCategoryDisplayType;
	name?: string | null;
	description?: string | null;
	nameTranslations?: LocaleTranslationMap | null;
	descriptionTranslations?: LocaleTranslationMap | null;
};

type BuiltInType = Exclude<AbsenceCategoryDisplayType, "custom">;

/**
 * Translation keys for the seeded categories, with the seeded English copy as their default.
 * Keys are static so the Tolgee extractor sees them with these defaults.
 */
export const builtInAbsenceCategoryText: Record<
	BuiltInType,
	{ nameKey: string; name: string; descriptionKey: string; description: string }
> = {
	vacation: {
		nameKey: "settings.absenceCategories.defaults.vacation.name",
		name: "Vacation",
		descriptionKey: "settings.absenceCategories.defaults.vacation.description",
		description: "Paid time off",
	},
	sick: {
		nameKey: "settings.absenceCategories.defaults.sick.name",
		name: "Sick Leave",
		descriptionKey: "settings.absenceCategories.defaults.sick.description",
		description: "Sick day",
	},
	personal: {
		nameKey: "settings.absenceCategories.defaults.personal.name",
		name: "Personal Day",
		descriptionKey: "settings.absenceCategories.defaults.personal.description",
		description: "Personal time off",
	},
	home_office: {
		nameKey: "settings.absenceCategories.defaults.homeOffice.name",
		name: "Home Office",
		descriptionKey: "settings.absenceCategories.defaults.homeOffice.description",
		description: "Remote work day",
	},
	unpaid: {
		nameKey: "settings.absenceCategories.defaults.unpaid.name",
		name: "Unpaid Leave",
		descriptionKey: "settings.absenceCategories.defaults.unpaid.description",
		description: "Unpaid absence",
	},
	parental: {
		nameKey: "settings.absenceCategories.defaults.parental.name",
		name: "Parental Leave",
		descriptionKey: "settings.absenceCategories.defaults.parental.description",
		description: "Parental leave absence",
	},
	bereavement: {
		nameKey: "settings.absenceCategories.defaults.bereavement.name",
		name: "Bereavement",
		descriptionKey: "settings.absenceCategories.defaults.bereavement.description",
		description: "Bereavement leave",
	},
	time_off_in_lieu: {
		nameKey: "settings.absenceCategories.defaults.timeOffInLieu.name",
		name: "Time off in lieu",
		descriptionKey: "settings.absenceCategories.defaults.timeOffInLieu.description",
		description: "Time off taken against the work balance",
	},
};

function isBuiltInType(type: AbsenceCategoryDisplayType): type is BuiltInType {
	return type !== "custom";
}

function trimmedValue(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function translatedValue(translations: LocaleTranslationMap | null | undefined, locale: string) {
	return trimmedValue(translations?.[locale]);
}

export function getAbsenceCategoryDisplayName(
	category: DisplayCategory,
	locale: string,
	t: TranslateFn,
) {
	if (isBuiltInType(category.type)) {
		const fallback = trimmedValue(category.name) ?? category.type;
		return t(builtInAbsenceCategoryText[category.type].nameKey, fallback);
	}

	return (
		translatedValue(category.nameTranslations, locale) ??
		trimmedValue(category.name) ??
		category.type
	);
}

export function getAbsenceCategoryDisplayDescription(
	category: DisplayCategory,
	locale: string,
	t: TranslateFn,
) {
	const fallback = trimmedValue(category.description);

	if (isBuiltInType(category.type)) {
		if (!fallback) {
			return null;
		}

		return t(builtInAbsenceCategoryText[category.type].descriptionKey, fallback);
	}

	return translatedValue(category.descriptionTranslations, locale) ?? fallback;
}
