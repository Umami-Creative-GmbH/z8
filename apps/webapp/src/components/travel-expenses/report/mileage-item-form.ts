import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { useTranslate } from "@tolgee/react";
import type { MileageItemDraft, MileageItemDraftInput } from "@/lib/travel-expenses/mileage";

type Translate = ReturnType<typeof useTranslate>["t"];
export type MileageFormValues = { [K in keyof MileageItemDraft]: string };
export type MileageFieldName = keyof MileageItemDraft;

type Sync = FormValidateOrFn<MileageFormValues> | undefined;
type Async = FormAsyncValidateOrFn<MileageFormValues> | undefined;
/** The mileage editor's form, as its field groups receive it. */
export type MileageItemForm = ReactFormExtendedApi<
	MileageFormValues,
	Sync,
	Sync,
	Async,
	Sync,
	Async,
	Sync,
	Async,
	Sync,
	Async,
	Async,
	unknown
>;

export function toFormValues(draft: MileageItemDraft): MileageFormValues {
	return {
		expenseDate: draft.expenseDate ?? "",
		route: draft.route ?? "",
		distanceKm: draft.distanceKm ?? "",
		vehicle: draft.vehicle ?? "",
		accountingReference: draft.accountingReference ?? "",
	};
}

export function toDraftInput(values: MileageFormValues): MileageItemDraftInput {
	const input = {} as MileageItemDraftInput;
	for (const key of Object.keys(values) as MileageFieldName[]) {
		input[key] = values[key].trim() === "" ? null : values[key];
	}
	return input;
}

export function fieldErrorMessage(t: Translate, field: MileageFieldName, code: string | undefined) {
	if (!code) return undefined;
	if (code === "too_long")
		return t("travelExpenses.report.errors.tooLong", "This text is too long.");
	const messages: Partial<Record<MileageFieldName, string>> = {
		expenseDate: t("travelExpenses.report.errors.expenseDate", "Enter a valid date."),
		distanceKm: t(
			"travelExpenses.report.mileage.errors.distance",
			"Enter the kilometres driven as a positive number with at most two decimals, e.g. 61.5.",
		),
		vehicle: t("travelExpenses.report.mileage.errors.vehicle", "Choose the vehicle you drove."),
	};
	return messages[field];
}
