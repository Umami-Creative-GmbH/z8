import type { LocaleTranslationMap } from "@/db/schema/absence";

export type AbsenceCategoryDisplayType =
	| "home_office"
	| "sick"
	| "vacation"
	| "personal"
	| "unpaid"
	| "parental"
	| "bereavement"
	| "custom";

type TranslateFn = (key: string, fallback: string) => string;

type DisplayCategory = {
	type: AbsenceCategoryDisplayType;
	name?: string | null;
	description?: string | null;
	nameTranslations?: LocaleTranslationMap | null;
	descriptionTranslations?: LocaleTranslationMap | null;
};

const builtInTypes = new Set<AbsenceCategoryDisplayType>([
	"home_office",
	"sick",
	"vacation",
	"personal",
	"unpaid",
	"parental",
	"bereavement",
]);

function isBuiltInType(type: AbsenceCategoryDisplayType) {
	return builtInTypes.has(type);
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
		return t(`settings.absenceCategories.defaults.${category.type}.name`, fallback);
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

		return t(`settings.absenceCategories.defaults.${category.type}.description`, fallback);
	}

	return translatedValue(category.descriptionTranslations, locale) ?? fallback;
}
