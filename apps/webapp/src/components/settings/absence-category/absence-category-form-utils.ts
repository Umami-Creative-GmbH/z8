import type { AbsenceCategoryType } from "@/app/[locale]/(app)/settings/vacation/actions";
import { getBuiltInAbsenceCategoryTranslations } from "@/lib/absences/built-in-category-translations";
import { canRequireDeputy } from "@/lib/absences/deputy";

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
	drawsOnWorkBalance: boolean;
	/** Absences of this category must name a deputy (#1011). */
	deputyRequired: boolean;
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
	drawsOnWorkBalance: boolean;
	deputyRequired: boolean;
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
	drawsOnWorkBalance: false,
	deputyRequired: false,
	color: DEFAULT_CATEGORY_COLOR,
	isActive: true,
};

function normalizeTranslationMap(value: Record<string, string>) {
	const entries = Object.entries(value).flatMap(([locale, translation]) => {
		const trimmedLocale = locale.trim();
		const trimmedTranslation = translation.trim();
		return trimmedLocale && trimmedTranslation
			? [[trimmedLocale, trimmedTranslation] as const]
			: [];
	});

	return Object.fromEntries(entries);
}

export function getAbsenceCategoryTranslationValues(
	type: AbsenceCategoryType,
	nameTranslations: Record<string, string> | null = null,
	descriptionTranslations: Record<string, string> | null = null,
) {
	if (type === "custom") {
		return {
			nameTranslations: { ...nameTranslations },
			descriptionTranslations: { ...descriptionTranslations },
		};
	}

	const defaults = getBuiltInAbsenceCategoryTranslations(type);
	return {
		nameTranslations: {
			...defaults.nameTranslations,
			...normalizeTranslationMap(nameTranslations ?? {}),
		},
		descriptionTranslations: {
			...defaults.descriptionTranslations,
			...normalizeTranslationMap(descriptionTranslations ?? {}),
		},
	};
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
		...getAbsenceCategoryTranslationValues(
			existingCategory.type,
			existingCategory.nameTranslations,
			existingCategory.descriptionTranslations,
		),
		requiresWorkTime: existingCategory.requiresWorkTime,
		requiresApproval: existingCategory.requiresApproval,
		countsAgainstVacation: existingCategory.countsAgainstVacation,
		drawsOnWorkBalance: existingCategory.drawsOnWorkBalance,
		deputyRequired: existingCategory.deputyRequired,
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
		drawsOnWorkBalance: value.drawsOnWorkBalance,
		deputyRequired: canRequireDeputy(value.type) && value.deputyRequired,
		color: value.color.trim(),
		isActive: value.isActive,
	};
}
