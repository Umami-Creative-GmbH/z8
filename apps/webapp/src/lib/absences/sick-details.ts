import type { SickDetail } from "./types";

export const sickDetailOptions = [
	{ value: "child_sick", label: "Child sick" },
	{ value: "with_certificate", label: "With certificate" },
	{ value: "without_certificate", label: "Without certificate" },
	{ value: "other", label: "Other" },
] satisfies Array<{ value: SickDetail; label: string }>;

const sickDetailLabels = new Map<SickDetail, string>(
	sickDetailOptions.map((option) => [option.value, option.label]),
);

export function getSickDetailLabel(value: SickDetail): string {
	return sickDetailLabels.get(value) ?? value;
}

export function validateSickDetailForCategory(input: {
	categoryType: string;
	sickDetail?: SickDetail | null;
}): string | null {
	if (input.categoryType === "sick" && !input.sickDetail) {
		return "Sick detail is required for sick absences";
	}

	if (input.categoryType !== "sick" && input.sickDetail) {
		return "Sick detail can only be used for sick absences";
	}

	return null;
}

export function isFullDayAbsence(input: {
	startPeriod: "full_day" | "am" | "pm";
	endPeriod: "full_day" | "am" | "pm";
}): boolean {
	return input.startPeriod === "full_day" && input.endPeriod === "full_day";
}
