import { countries } from "country-flag-icons";
import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import {
	type ReceiptItemDraft,
	type ReceiptItemRequirement,
	receiptItemMissingRequirements,
} from "./receipt-report";
import type { ReceiptExceptionContext } from "./receipt-exception";
import type { TripDestination } from "./trip-destination";

/**
 * Shared travel details of a trip report (#601). Travel dates are calendar
 * days in the trip's explicit time zone; they are stored and shown as entered,
 * never converted through the viewer's zone. A draft may be incomplete, but
 * every entered value is well-formed.
 */

export const MAX_TRIP_PURPOSE_LENGTH = 500;
export const MAX_TRIP_DESTINATIONS = 10;
export const MAX_DESTINATION_PLACE_LENGTH = 100;

/** Region codes with a flag that are groupings or placeholders, not destinations. */
const NON_DESTINATION_CODES = new Set(["EU", "XC", "XO"]);

/** ISO 3166-1 alpha-2 countries and territories a trip can lead to. */
export const TRIP_COUNTRY_CODES: readonly string[] = countries.filter(
	(code) => /^[A-Z]{2}$/.test(code) && !NON_DESTINATION_CODES.has(code),
);
const tripCountryCodes = new Set(TRIP_COUNTRY_CODES);

export function isTripCountryCode(code: string): boolean {
	return tripCountryCodes.has(code);
}

export type { TripDestination };

export interface TripDetailsDraft {
	purpose: string | null;
	/** First travel day (YYYY-MM-DD) in `timeZone`. */
	startDate: string | null;
	/** Last travel day (YYYY-MM-DD) in `timeZone`. */
	endDate: string | null;
	/** IANA zone the travel dates are calendar days in; always present. */
	timeZone: string;
	destinations: TripDestination[];
}

export interface TripDetailsDraftInput {
	purpose: string | null;
	startDate: string | null;
	endDate: string | null;
	timeZone: string | null;
	destinations: { place: string | null; countryCode: string | null }[];
}

export type TripDetailsFieldError =
	| "invalid_date"
	| "end_before_start"
	| "invalid_time_zone"
	| "invalid_destination"
	| "too_many_destinations"
	| "too_long";

export type ParseTripDetailsDraftResult =
	| { ok: true; draft: TripDetailsDraft }
	| { ok: false; errors: Partial<Record<keyof TripDetailsDraft, TripDetailsFieldError>> };

function blankToNull(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function parseDate(value: string | null): { date: string | null } | null {
	const entered = blankToNull(value);
	if (!entered) return { date: null };
	try {
		return { date: parsePlainDate(entered).toString() };
	} catch {
		return null;
	}
}

function parseDestinations(
	input: TripDetailsDraftInput["destinations"],
): { destinations: TripDestination[] } | { error: TripDetailsFieldError } {
	const destinations: TripDestination[] = [];
	for (const row of input) {
		const place = blankToNull(row.place);
		const countryCode = blankToNull(row.countryCode)?.toUpperCase() ?? null;
		if (!place && !countryCode) continue;
		if (place && place.length > MAX_DESTINATION_PLACE_LENGTH) return { error: "too_long" };
		if (countryCode && !isTripCountryCode(countryCode)) return { error: "invalid_destination" };
		destinations.push({ place, countryCode });
	}
	if (destinations.length > MAX_TRIP_DESTINATIONS) return { error: "too_many_destinations" };
	return { destinations };
}

export function parseTripDetailsDraft(input: TripDetailsDraftInput): ParseTripDetailsDraftResult {
	const errors: Partial<Record<keyof TripDetailsDraft, TripDetailsFieldError>> = {};

	const purpose = blankToNull(input.purpose);
	if (purpose && purpose.length > MAX_TRIP_PURPOSE_LENGTH) errors.purpose = "too_long";

	const start = parseDate(input.startDate);
	if (!start) errors.startDate = "invalid_date";
	const end = parseDate(input.endDate);
	if (!end) errors.endDate = "invalid_date";
	if (
		start?.date &&
		end?.date &&
		comparePlainDates(parsePlainDate(end.date), parsePlainDate(start.date)) < 0
	) {
		errors.endDate = "end_before_start";
	}

	let timeZone: string | null = null;
	try {
		timeZone = parseIanaTimeZone(blankToNull(input.timeZone));
	} catch {
		errors.timeZone = "invalid_time_zone";
	}

	const destinations = parseDestinations(input.destinations);
	if ("error" in destinations) errors.destinations = destinations.error;

	if (Object.keys(errors).length > 0 || !timeZone || "error" in destinations) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		draft: {
			purpose,
			startDate: start?.date ?? null,
			endDate: end?.date ?? null,
			timeZone,
			destinations: destinations.destinations,
		},
	};
}

export type TripRequirement = "purpose" | "travel_dates" | "destination" | "expense_item";

export interface TripReportMissingRequirements {
	/** Missing shared trip facts, in form order. */
	trip: TripRequirement[];
	/** Expenses that are not complete yet, in report order. */
	items: { id: string; missing: ReceiptItemRequirement[] }[];
}

/** What still keeps a trip report from being submittable. */
export function tripReportMissingRequirements(input: {
	details: TripDetailsDraft;
	items: readonly {
		id: string;
		draft: ReceiptItemDraft;
		receiptCount: number;
		receiptException?: ReceiptExceptionContext;
	}[];
	reimbursementCurrency: string;
}): TripReportMissingRequirements {
	const { details } = input;
	const trip: TripRequirement[] = [];
	if (!details.purpose) trip.push("purpose");
	if (!details.startDate || !details.endDate) trip.push("travel_dates");
	if (
		details.destinations.length === 0 ||
		details.destinations.some((destination) => !destination.place || !destination.countryCode)
	) {
		trip.push("destination");
	}
	if (input.items.length === 0) trip.push("expense_item");
	const items = input.items
		.map((item) => ({
			id: item.id,
			missing: receiptItemMissingRequirements(item.draft, {
				receiptCount: item.receiptCount,
				reimbursementCurrency: input.reimbursementCurrency,
				receiptException: item.receiptException,
			}),
		}))
		.filter((item) => item.missing.length > 0);
	return { trip, items };
}
