import { countries } from "country-flag-icons";
import {
	FOREIGN_PER_DIEM_TABLES,
	type ForeignPerDiemTable,
	findForeignCountry,
	foreignAreaKey,
} from "./statutory-foreign-per-diem";
import type { TripDestination } from "./trip-destination";

/**
 * Daily locations of a per diem (#611). § 9 Abs. 4a Satz 5 EStG prices a
 * travel day abroad with the amounts of the place the employee last reached
 * before midnight local time or, when that place is in Germany, of the last
 * place of business activity abroad. The BMF notice of 05.12.2025 and Rz. 52
 * of the BMF letter of 25.11.2020 apply this to arrival, intermediate and
 * departure days (the departure day takes the last place of activity), and
 * R 9.6 Abs. 3 LStR adds the foreign amounts for days with activity at home
 * and abroad, unlisted states and territories, and whole days in flight or at
 * sea. One trip-level destination does not describe these days, so the
 * employee answers per travel day what happened; the server derives each
 * day's rate location from those facts, never from the viewer's zone.
 */

export const PER_DIEM_SPECIAL_LOCATIONS = ["in_flight", "at_sea", "other"] as const;
export type PerDiemSpecialLocation = (typeof PER_DIEM_SPECIAL_LOCATIONS)[number];

/** A place by its country and, where the official table lists it, its place key. */
export interface PerDiemPlaceLocation {
	/** ISO 3166-1 alpha-2 code, "DE" for Germany. */
	country: string;
	/** A listed place of that country (e.g. "paris"); null for anywhere else in it. */
	place: string | null;
}

/**
 * - `in_flight`: on a flight for the whole calendar day, between the day of
 *   take-off and the day of landing (R 9.6 Abs. 3 Satz 4 Nr. 1 LStR);
 * - `at_sea`: on board a ship for the whole day, neither embarking nor
 *   disembarking (Nr. 2);
 * - `other`: a situation none of the listed answers describes.
 */
export type PerDiemLocation = PerDiemPlaceLocation | { special: PerDiemSpecialLocation };

/** The location answers of one travel day; both absent on a purely domestic trip. */
export interface PerDiemLocationFacts {
	/** The place last reached before midnight (local time); asked on days that end away. */
	night?: PerDiemLocation | null;
	/**
	 * The last place of business activity abroad that day ("DE" for none).
	 * On the last day of a trip that left that morning from abroad, the last
	 * place of business activity abroad of the trip (Rz. 52: departure day).
	 */
	activityAbroad?: PerDiemLocation | null;
}

export type PerDiemLocationField = keyof PerDiemLocationFacts;

/** Region codes with a flag that are groupings or placeholders, not destinations. */
const NON_DESTINATION_CODES = new Set(["EU", "XC", "XO"]);
const KNOWN_COUNTRIES = new Set(
	countries.filter((code) => /^[A-Z]{2}$/.test(code) && !NON_DESTINATION_CODES.has(code)),
);

export const DOMESTIC_LOCATION: PerDiemPlaceLocation = { country: "DE", place: null };

export function isDomesticLocation(location: PerDiemLocation | null | undefined): boolean {
	return !!location && "country" in location && location.country === "DE";
}

/** Places any verified table lists for `country`. */
export function listedPlaces(country: string): { key: string; label: string }[] {
	const places = new Map<string, string>();
	for (const table of FOREIGN_PER_DIEM_TABLES) {
		for (const place of findForeignCountry(table, country)?.places ?? []) {
			places.set(place.key, place.label);
		}
	}
	return [...places].map(([key, label]) => ({ key, label }));
}

/** An entered location, null when unanswered, or "invalid". */
export function parsePerDiemLocation(value: unknown): PerDiemLocation | null | "invalid" {
	if (value === null || value === undefined) return null;
	if (typeof value !== "object") return "invalid";
	const record = value as Record<string, unknown>;
	if ("special" in record) {
		return Object.keys(record).length === 1 &&
			(PER_DIEM_SPECIAL_LOCATIONS as readonly unknown[]).includes(record.special)
			? { special: record.special as PerDiemSpecialLocation }
			: "invalid";
	}
	const { country, place } = record;
	if (Object.keys(record).some((key) => key !== "country" && key !== "place")) return "invalid";
	if (typeof country !== "string" || !KNOWN_COUNTRIES.has(country)) return "invalid";
	if (place === null || place === undefined) return { country, place: null };
	if (typeof place !== "string" || !listedPlaces(country).some((entry) => entry.key === place)) {
		return "invalid";
	}
	return { country, place };
}

/** Select value of a location: "FR", "FR:paris" or "special:in_flight". */
export function encodePerDiemLocation(location: PerDiemLocation | null | undefined): string {
	if (!location) return "";
	if ("special" in location) return `special:${location.special}`;
	return foreignAreaKey(location.country, location.place);
}

export function decodePerDiemLocation(value: string): PerDiemLocation | null {
	if (!value) return null;
	if (value.startsWith("special:")) {
		const special = value.slice("special:".length);
		return (PER_DIEM_SPECIAL_LOCATIONS as readonly string[]).includes(special)
			? { special: special as PerDiemSpecialLocation }
			: null;
	}
	const [country = "", place] = value.split(":");
	return { country, place: place ?? null };
}

export function samePerDiemLocation(
	left: PerDiemLocation | null | undefined,
	right: PerDiemLocation | null | undefined,
): boolean {
	return encodePerDiemLocation(left) === encodePerDiemLocation(right);
}

// ---------------------------------------------------------------------------
// Which answers a day needs

/**
 * The location questions of the travel day at `index` of `count`: a single
 * day asks for the last activity abroad; a day that ends away asks where the
 * employee was at midnight and, when that was in Germany, for the last
 * activity abroad that day; the last day asks for the last activity abroad.
 */
export function perDiemLocationFields(
	index: number,
	count: number,
	day: PerDiemLocationFacts | undefined,
): PerDiemLocationField[] {
	if (count <= 1 || index === count - 1) return ["activityAbroad"];
	return isDomesticLocation(day?.night) ? ["night", "activityAbroad"] : ["night"];
}

export function hasLocationFacts(day: PerDiemLocationFacts): boolean {
	return (day.night ?? null) !== null || (day.activityAbroad ?? null) !== null;
}

/**
 * Whether the per diem needs daily locations: any destination is not in
 * Germany (or has no country), or a location was entered. A purely domestic
 * trip without answers keeps the domestic calculation (#609).
 */
export function perDiemLocationsNeeded(
	days: readonly PerDiemLocationFacts[],
	destinations: readonly TripDestination[],
): boolean {
	return (
		destinations.some((destination) => destination.countryCode !== "DE") ||
		days.some(hasLocationFacts)
	);
}

/** The travel days of `dates` whose location answers are incomplete. */
export function missingLocationDates(
	dates: readonly string[],
	days: readonly (PerDiemLocationFacts & { date: string })[],
): string[] {
	const byDate = new Map(days.map((day) => [day.date, day]));
	return dates.filter((date, index) => {
		const day = byDate.get(date);
		return perDiemLocationFields(index, dates.length, day).some(
			(field) => (day?.[field] ?? null) === null,
		);
	});
}

// ---------------------------------------------------------------------------
// Rate location of a day

export type PerDiemLocationBasis =
	/** The place last reached before midnight (Satz 5, first half). */
	| "night"
	/** The last place of business activity abroad that day (Satz 5; R 9.6 Abs. 3 Satz 3). */
	| "activity_abroad"
	/** Departure from abroad: the last place of business activity abroad (Rz. 52). */
	| "last_activity_abroad"
	/** In Germany at midnight and no business activity abroad that day. */
	| "domestic";

/** The entered location that decides the day's amounts, or null while unanswered. */
export function rateLocationOfDay(
	index: number,
	days: readonly PerDiemLocationFacts[],
): { location: PerDiemLocation; basis: PerDiemLocationBasis } | null {
	const count = days.length;
	const day = days[index];
	const activity = day?.activityAbroad ?? null;
	if (count > 1 && index < count - 1) {
		const night = day?.night ?? null;
		if (!night) return null;
		if (!isDomesticLocation(night)) return { location: night, basis: "night" };
	}
	if (!activity) return null;
	if (isDomesticLocation(activity)) return { location: DOMESTIC_LOCATION, basis: "domestic" };
	const fromAbroad =
		count > 1 && index === count - 1 && !isDomesticLocation(days[index - 1]?.night);
	return { location: activity, basis: fromAbroad ? "last_activity_abroad" : "activity_abroad" };
}

// ---------------------------------------------------------------------------
// Destination rules

export type PerDiemDestinationRule =
	| "domestic"
	/** Listed in the notice (as a country or place). */
	| "listed"
	/** The notice assigns another country's amounts ("gelten auch für"). */
	| "assigned"
	/** An unlisted overseas or external territory: the mother country's amounts. */
	| "mother_country"
	/** An unlisted state: the Luxembourg amounts. */
	| "luxembourg"
	/** A whole day in flight: the Austrian amounts. */
	| "flight_austria"
	/** A whole day at sea: the Luxembourg amounts. */
	| "ship_luxembourg";

/** Rules that price a day with another country's amounts by an official fallback (#610 `official_fallback`). */
export function isOfficialFallbackRule(rule: PerDiemDestinationRule): boolean {
	return (
		rule === "mother_country" ||
		rule === "luxembourg" ||
		rule === "flight_austria" ||
		rule === "ship_luxembourg"
	);
}

export type PerDiemDestinationResolution =
	| {
			status: "resolved";
			/** The policy rate area: "DE", a country or "country:place". */
			area: string;
			/** The country whose amounts apply. */
			country: string;
			place: string | null;
			/** The applied entry as the official table names it. */
			label: string;
			rule: PerDiemDestinationRule;
	  }
	| { status: "unsupported"; reason: "destination_not_listed" | "special_location" };

function listedEntry(
	table: ForeignPerDiemTable,
	country: string,
	place: string | null,
	rule: PerDiemDestinationRule,
): PerDiemDestinationResolution {
	const entry = findForeignCountry(table, country);
	if (!entry) return { status: "unsupported", reason: "destination_not_listed" };
	const listedPlace = place ? entry.places.find((candidate) => candidate.key === place) : undefined;
	const key = listedPlace?.key ?? null;
	return {
		status: "resolved",
		area: foreignAreaKey(country, key),
		country,
		place: key,
		label: listedPlace
			? `${entry.label} – ${listedPlace.label}`
			: entry.places.length > 0
				? `${entry.label} – im Übrigen`
				: entry.label,
		rule,
	};
}

/** The official amounts that apply to an entered location under `table`'s notice. */
export function resolvePerDiemDestination(
	table: ForeignPerDiemTable,
	location: PerDiemLocation,
): PerDiemDestinationResolution {
	if ("special" in location) {
		if (location.special === "in_flight") return listedEntry(table, "AT", null, "flight_austria");
		if (location.special === "at_sea") return listedEntry(table, "LU", null, "ship_luxembourg");
		return { status: "unsupported", reason: "special_location" };
	}
	const { country, place } = location;
	if (country === "DE") {
		return {
			status: "resolved",
			area: "DE",
			country: "DE",
			place: null,
			label: "Deutschland",
			rule: "domestic",
		};
	}
	const alias = table.codeAliases[country];
	if (alias) return listedEntry(table, alias.country, alias.place, "listed");
	if (findForeignCountry(table, country)) return listedEntry(table, country, place, "listed");
	const assigned = table.assignedCountries[country];
	if (assigned) return listedEntry(table, assigned, null, "assigned");
	const mother = table.motherCountries[country];
	if (mother) return listedEntry(table, mother, null, "mother_country");
	if (table.luxembourgFallback.includes(country)) {
		return listedEntry(table, "LU", null, "luxembourg");
	}
	return { status: "unsupported", reason: "destination_not_listed" };
}
