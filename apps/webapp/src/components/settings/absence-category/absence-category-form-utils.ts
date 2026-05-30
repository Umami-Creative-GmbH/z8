import type { AbsenceCategoryType } from "@/app/[locale]/(app)/settings/vacation/actions";

export interface AbsenceCategoryForSettings {
	id: string;
	type: AbsenceCategoryType;
	name: string;
	description: string | null;
	nameTranslations: Record<string, string> | null;
	descriptionTranslations: Record<string, string> | null;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color: string | null;
	isActive: boolean;
}

export type AbsenceCategoryFormValues = {
	name: string;
	type: AbsenceCategoryType;
	description: string;
	nameTranslations: Record<string, string>;
	descriptionTranslations: Record<string, string>;
	requiresWorkTime: boolean;
	requiresApproval: boolean;
	countsAgainstVacation: boolean;
	color: string;
	isActive: boolean;
};

export const DEFAULT_CATEGORY_COLOR = "#3b82f6";

export const defaultAbsenceCategoryFormValues: AbsenceCategoryFormValues = {
	name: "",
	type: "custom",
	description: "",
	nameTranslations: {},
	descriptionTranslations: {},
	requiresWorkTime: false,
	requiresApproval: true,
	countsAgainstVacation: false,
	color: DEFAULT_CATEGORY_COLOR,
	isActive: true,
};

function normalizeTranslationMap(value: Record<string, string>) {
	const entries = Object.entries(value)
		.map(([locale, translation]) => [locale.trim(), translation.trim()] as const)
		.filter(([locale, translation]) => locale && translation);

	return Object.fromEntries(entries);
}

export function getAbsenceCategoryFormValues(
	existingCategory?: AbsenceCategoryForSettings,
): AbsenceCategoryFormValues {
	if (!existingCategory) {
		return {
			...defaultAbsenceCategoryFormValues,
			nameTranslations: {},
			descriptionTranslations: {},
		};
	}

	return {
		name: existingCategory.name,
		type: existingCategory.type,
		description: existingCategory.description ?? "",
		nameTranslations: { ...(existingCategory.nameTranslations ?? {}) },
		descriptionTranslations: { ...(existingCategory.descriptionTranslations ?? {}) },
		requiresWorkTime: existingCategory.requiresWorkTime,
		requiresApproval: existingCategory.requiresApproval,
		countsAgainstVacation: existingCategory.countsAgainstVacation,
		color: existingCategory.color ?? DEFAULT_CATEGORY_COLOR,
		isActive: existingCategory.isActive,
	};
}

export function buildAbsenceCategoryPayload(value: AbsenceCategoryFormValues) {
	return {
		name: value.name.trim(),
		type: value.type,
		description: value.description.trim(),
		nameTranslations: normalizeTranslationMap(value.nameTranslations),
		descriptionTranslations: normalizeTranslationMap(value.descriptionTranslations),
		requiresWorkTime: value.requiresWorkTime,
		requiresApproval: value.requiresApproval,
		countsAgainstVacation: value.countsAgainstVacation,
		color: value.color.trim(),
		isActive: value.isActive,
	};
}
