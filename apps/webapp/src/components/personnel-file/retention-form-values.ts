import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/lib/personnel-file/document.types";

/** Form fields of the retention settings: whole years as text, empty for no period. */
export type RetentionFormValues = Record<DocumentCategory, string>;

export function toRetentionFormValues(
	periods: Record<DocumentCategory, number | null>,
): RetentionFormValues {
	const values = {} as RetentionFormValues;
	for (const category of DOCUMENT_CATEGORIES) {
		const years = periods[category];
		values[category] = years === null ? "" : String(years);
	}
	return values;
}

/** Whole years between 1 and 100; empty means the category has no period. */
export function parseRetentionYears(value: string): number | null | "invalid" {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	if (!/^\d+$/.test(trimmed)) return "invalid";
	const years = Number(trimmed);
	return years >= 1 && years <= 100 ? years : "invalid";
}

/** The periods to save, or null while a field is invalid. */
export function toRetentionPeriods(
	values: RetentionFormValues,
): Record<DocumentCategory, number | null> | null {
	const periods = {} as Record<DocumentCategory, number | null>;
	for (const category of DOCUMENT_CATEGORIES) {
		const years = parseRetentionYears(values[category]);
		if (years === "invalid") return null;
		periods[category] = years;
	}
	return periods;
}
