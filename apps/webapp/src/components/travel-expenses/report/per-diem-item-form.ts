import type {
	FormAsyncValidateOrFn,
	FormValidateOrFn,
	ReactFormExtendedApi,
} from "@tanstack/react-form";
import type { useTranslate } from "@tolgee/react";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	MAX_PER_DIEM_DAYS,
	PER_DIEM_MEALS,
	type PerDiemDraftInput,
	type PerDiemItinerary,
	type PerDiemMeal,
	tripDays,
} from "@/lib/travel-expenses/per-diem";
import { perDiemLocationFields } from "@/lib/travel-expenses/per-diem-location";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import {
	type DayLocationForm,
	dayLocationDraft,
	dayLocationForm,
} from "./per-diem-day-location-form";

type Translate = ReturnType<typeof useTranslate>["t"];
export type MealForm = { provided: boolean; payment: string };
export type DayMealsForm = Record<PerDiemMeal, MealForm>;
export interface PerDiemFormValues {
	startDate: string;
	startTime: string;
	startTimeZone: string;
	endDate: string;
	endTime: string;
	endTimeZone: string;
	overnight: string;
	prolongedWorkplace: boolean;
	/** Meal facts by date; kept when the travel dates move. */
	meals: Record<string, DayMealsForm>;
	/** Daily location answers by date (#611); kept when the travel dates move. */
	locations: Record<string, DayLocationForm>;
}

type Sync = FormValidateOrFn<PerDiemFormValues> | undefined;
type Async = FormAsyncValidateOrFn<PerDiemFormValues> | undefined;
/** The per diem editor's form, as its field groups receive it. */
export type PerDiemItemForm = ReactFormExtendedApi<
	PerDiemFormValues,
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

/** The trip a per diem belongs to, as its editor receives it. */
export interface PerDiemTrip {
	startDate: string | null;
	endDate: string | null;
	timeZone: string;
	/** The trip's destinations; one abroad asks for daily locations (#611). */
	destinations?: readonly TripDestination[];
}

export const NO_MEALS: DayMealsForm = {
	breakfast: { provided: false, payment: "" },
	lunch: { provided: false, payment: "" },
	dinner: { provided: false, payment: "" },
};

/** The travel days of entered dates; empty while they are missing, reversed or too long. */
export function travelDays(startDate: string, endDate: string): string[] {
	try {
		if (!startDate || !endDate) return [];
		if (comparePlainDates(parsePlainDate(endDate), parsePlainDate(startDate)) < 0) return [];
		const days = tripDays(startDate, endDate);
		return days.length > MAX_PER_DIEM_DAYS ? [] : days;
	} catch {
		return [];
	}
}

export function toFormValues(itinerary: PerDiemItinerary): PerDiemFormValues {
	return {
		startDate: itinerary.startDate ?? "",
		startTime: itinerary.startTime ?? "",
		startTimeZone: itinerary.startTimeZone ?? "",
		endDate: itinerary.endDate ?? "",
		endTime: itinerary.endTime ?? "",
		endTimeZone: itinerary.endTimeZone ?? "",
		overnight: itinerary.overnight ?? "",
		prolongedWorkplace: itinerary.prolongedWorkplace,
		meals: Object.fromEntries(
			itinerary.meals.map((day) => [
				day.date,
				Object.fromEntries(
					PER_DIEM_MEALS.map((meal) => [
						meal,
						{ provided: day[meal].provided, payment: day[meal].employeePayment ?? "" },
					]),
				) as DayMealsForm,
			]),
		),
		locations: Object.fromEntries(itinerary.meals.map((day) => [day.date, dayLocationForm(day)])),
	};
}

function blank(value: string): string | null {
	return value.trim() === "" ? null : value;
}

export function toDraftInput(values: PerDiemFormValues): PerDiemDraftInput {
	const days = travelDays(values.startDate, values.endDate);
	return {
		startDate: blank(values.startDate),
		startTime: blank(values.startTime),
		startTimeZone: blank(values.startTimeZone),
		endDate: blank(values.endDate),
		endTime: blank(values.endTime),
		endTimeZone: blank(values.endTimeZone),
		// Only a trip over more than one calendar day has nights to answer for.
		overnight: days.length > 1 ? blank(values.overnight) : null,
		prolongedWorkplace: values.prolongedWorkplace,
		meals: days.map((date, index) => {
			const day = values.meals[date] ?? NO_MEALS;
			const entry = (meal: PerDiemMeal) => ({
				provided: day[meal].provided,
				employeePayment: day[meal].provided ? blank(day[meal].payment) : null,
			});
			// Only the location questions this day asks (#611); stale answers are dropped.
			const location = dayLocationDraft(values.locations?.[date]);
			const asked = perDiemLocationFields(index, days.length, location);
			return {
				date,
				breakfast: entry("breakfast"),
				lunch: entry("lunch"),
				dinner: entry("dinner"),
				...(asked.includes("night") && location.night ? { night: location.night } : {}),
				...(asked.includes("activityAbroad") && location.activityAbroad
					? { activityAbroad: location.activityAbroad }
					: {}),
			};
		}),
	};
}

export function fieldErrorMessage(t: Translate, code: string | undefined) {
	switch (code) {
		case undefined:
			return undefined;
		case "invalid_date":
			return t("travelExpenses.report.errors.expenseDate", "Enter a valid date.");
		case "invalid_time":
			return t("travelExpenses.report.perDiem.errors.time", "Enter a time as hours and minutes.");
		case "invalid_time_zone":
			return t("travelExpenses.report.trip.errors.timeZone", "Choose a listed time zone.");
		case "nonexistent_local_time":
			return t(
				"travelExpenses.report.perDiem.errors.clockChange",
				"This time does not exist on this day because the clocks are put forward. Enter a time outside the skipped hour.",
			);
		case "ambiguous_local_time":
			return t(
				"travelExpenses.report.perDiem.errors.clockChangeRepeated",
				"This time occurs twice on this day because the clocks are put back. Enter a time outside the repeated hour.",
			);
		case "end_before_start":
			return t(
				"travelExpenses.report.perDiem.errors.endBeforeStart",
				"Your return must be after your departure.",
			);
		case "invalid_location":
			return t(
				"travelExpenses.report.perDiem.errors.location",
				"Choose a listed location for each day.",
			);
		case "invalid_payment":
			return t(
				"travelExpenses.report.perDiem.errors.payment",
				"Enter what you paid as an amount with at most two decimals, e.g. 2.50.",
			);
		default:
			return t("travelExpenses.report.perDiem.errors.meals", "Check the meal entries.");
	}
}
