import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { useTranslate } from "@tolgee/react";
import {
	MAX_TRIP_DESTINATIONS,
	type TripDetailsDraft,
	type TripDetailsDraftInput,
	type TripDetailsFieldError,
} from "@/lib/travel-expenses/trip-report";

type Translate = ReturnType<typeof useTranslate>["t"];
export type TripDetailsFieldName = keyof TripDetailsDraft;
export interface TripDetailsFormValues {
	purpose: string;
	startDate: string;
	endDate: string;
	timeZone: string;
	/** `key` identifies a row while it is edited; it is never saved. */
	destinations: { key: string; place: string; countryCode: string }[];
}

type Sync = FormValidateOrFn<TripDetailsFormValues> | undefined;
type Async = FormAsyncValidateOrFn<TripDetailsFormValues> | undefined;
/** The trip details editor's form, as its field groups receive it. */
export type TripDetailsForm = ReactFormExtendedApi<
	TripDetailsFormValues,
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

export function newDestinationRow(
	place = "",
	countryCode = "",
): TripDetailsFormValues["destinations"][number] {
	return { key: crypto.randomUUID(), place, countryCode };
}

export function toFormValues(details: TripDetailsDraft): TripDetailsFormValues {
	return {
		purpose: details.purpose ?? "",
		startDate: details.startDate ?? "",
		endDate: details.endDate ?? "",
		timeZone: details.timeZone,
		destinations: details.destinations.map((destination) =>
			newDestinationRow(destination.place ?? "", destination.countryCode ?? ""),
		),
	};
}

function blankToNull(value: string) {
	return value.trim() === "" ? null : value;
}

export function toDraftInput(values: TripDetailsFormValues): TripDetailsDraftInput {
	return {
		purpose: blankToNull(values.purpose),
		startDate: blankToNull(values.startDate),
		endDate: blankToNull(values.endDate),
		timeZone: blankToNull(values.timeZone),
		destinations: values.destinations.map((destination) => ({
			place: blankToNull(destination.place),
			countryCode: blankToNull(destination.countryCode),
		})),
	};
}

/** Replaces malformed fields with their last saved values. */
export function withSavedValues(
	values: TripDetailsDraftInput,
	errors: Partial<Record<TripDetailsFieldName, TripDetailsFieldError>>,
	saved: TripDetailsDraftInput,
): TripDetailsDraftInput {
	const merged = { ...values };
	for (const field of Object.keys(errors) as TripDetailsFieldName[]) {
		// A return before departure is restored together with its departure.
		if (errors[field] === "end_before_start") merged.startDate = saved.startDate;
		Object.assign(merged, { [field]: saved[field] });
	}
	return merged;
}

export function fieldErrorMessage(t: Translate, code: string | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_date":
			return t("travelExpenses.report.errors.expenseDate", "Enter a valid date.");
		case "end_before_start":
			return t(
				"travelExpenses.report.trip.errors.endBeforeStart",
				"The last travel day cannot be before the first.",
			);
		case "invalid_time_zone":
			return t("travelExpenses.report.trip.errors.timeZone", "Choose a listed time zone.");
		case "invalid_destination":
			return t("travelExpenses.report.trip.errors.destination", "Choose a listed country.");
		case "too_many_destinations":
			return t(
				"travelExpenses.report.trip.errors.tooManyDestinations",
				"Enter at most {max} destinations.",
				{ max: MAX_TRIP_DESTINATIONS },
			);
		default:
			return t("travelExpenses.report.errors.tooLong", "This text is too long.");
	}
}
