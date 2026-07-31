import Holidays from "date-holidays";
import { Temporal } from "temporal-polyfill";

export interface CountryOption {
	code: string;
	name: string;
}

export interface StateOption {
	code: string;
	name: string;
}

export interface HolidayPreview {
	name: string;
	date: string;
	startDate: Date;
	endDate: Date;
	type: "public" | "bank" | "optional" | "school" | "observance";
}

export type HolidayType = "public" | "bank" | "optional" | "school" | "observance";

function holidayPlainDate(date: string): Temporal.PlainDate {
	return Temporal.PlainDate.from(date.slice(0, 10), { overflow: "reject" });
}

function databasePlainDate(date: Date): Temporal.PlainDate {
	return Temporal.Instant.from(date.toISOString()).toZonedDateTimeISO("UTC").toPlainDate();
}

function holidayDurationDays(holiday: HolidayPreview, startDate: Temporal.PlainDate): number {
	const start = Temporal.Instant.from(holiday.startDate.toISOString());
	const end = Temporal.Instant.from(holiday.endDate.toISOString());
	if (Temporal.Instant.compare(end, start) < 0) {
		throw new RangeError("Holiday end date must not precede its start date");
	}

	// date-holidays exposes instants but no end-date key. Rounding the elapsed hours
	// recovers its local calendar-day count across 23- and 25-hour DST days.
	const elapsedHours = end.since(start).total({ unit: "hours" });
	const endExclusive = startDate.add({ days: Math.max(1, Math.round(elapsedHours / 24)) });
	return startDate.until(endExclusive, { largestUnit: "days" }).days;
}

/**
 * Get list of all supported countries
 */
export function getCountries(): CountryOption[] {
	const hd = new Holidays();
	const countries = hd.getCountries();

	return Object.entries(countries)
		.map(([code, name]) => ({ code, name: name as string }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get list of states/subdivisions for a country
 */
export function getStates(countryCode: string): StateOption[] {
	const hd = new Holidays();
	const states = hd.getStates(countryCode);

	if (!states) {
		return [];
	}

	return Object.entries(states)
		.map(([code, name]) => ({ code, name: name as string }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get list of regions for a country and state
 */
export function getRegions(countryCode: string, stateCode: string): StateOption[] {
	const hd = new Holidays();
	const regions = hd.getRegions(countryCode, stateCode);

	if (!regions) {
		return [];
	}

	return Object.entries(regions)
		.map(([code, name]) => ({ code, name: name as string }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get holidays for a specific location and year
 */
export function getHolidaysForYear(
	countryCode: string,
	stateCode?: string,
	regionCode?: string,
	year?: number,
	types?: HolidayType[],
): HolidayPreview[] {
	const targetYear = year ?? Temporal.Now.plainDateISO("UTC").year;

	// Initialize with appropriate specificity
	let hd: Holidays;
	if (regionCode && stateCode) {
		hd = new Holidays(countryCode, stateCode, regionCode);
	} else if (stateCode) {
		hd = new Holidays(countryCode, stateCode);
	} else {
		hd = new Holidays(countryCode);
	}

	const holidays = hd.getHolidays(targetYear);

	// Filter by type if specified
	const typeSet = types ? new Set(types) : null;
	const filteredHolidays =
		typeSet && typeSet.size > 0
			? holidays.filter((h) => typeSet.has(h.type as HolidayType))
			: holidays;

	return filteredHolidays.map((h) => ({
		name: h.name,
		date: h.date,
		startDate: h.start,
		endDate: h.end,
		type: h.type as HolidayType,
	}));
}

/**
 * Map a date-holidays holiday to the format needed for our schema
 */
export function mapToHolidayFormValues(
	holiday: HolidayPreview,
	categoryId: string,
	createRecurring: boolean = true,
): {
	name: string;
	description: string | undefined;
	categoryId: string;
	startDate: Date;
	endDate: Date;
	recurrenceType: "none" | "yearly" | "custom";
	recurrenceRule: string | undefined;
	recurrenceEndDate: Date | null | undefined;
	isActive: boolean;
} {
	const startDate = new Date(holiday.startDate);
	const endDate = new Date(holiday.endDate);
	const calendarStartDate = holidayPlainDate(holiday.date);
	const durationDays = holidayDurationDays(holiday, calendarStartDate);

	return {
		name: holiday.name,
		description: undefined,
		categoryId,
		startDate,
		endDate,
		recurrenceType: createRecurring ? "yearly" : "none",
		recurrenceRule: createRecurring
			? JSON.stringify({
					month: calendarStartDate.month,
					day: calendarStartDate.day,
					duration: durationDays > 1 ? durationDays : undefined,
				})
			: undefined,
		recurrenceEndDate: undefined,
		isActive: true,
	};
}

/**
 * Check if a holiday already exists by matching name and month/day
 */
export function isHolidayDuplicate(
	holiday: HolidayPreview,
	existingHolidays: Array<{
		name: string;
		startDate: Date;
		recurrenceRule: string | null;
	}>,
): boolean {
	const startDate = holidayPlainDate(holiday.date);
	const month = startDate.month;
	const day = startDate.day;

	return existingHolidays.some((existing) => {
		// Check by name (case-insensitive)
		const nameMatch = existing.name.toLowerCase() === holiday.name.toLowerCase();

		// Check by date (same month/day)
		let dateMatch = false;

		if (existing.recurrenceRule) {
			try {
				const rule = JSON.parse(existing.recurrenceRule);
				dateMatch = rule.month === month && rule.day === day;
			} catch {
				// If rule is not valid JSON, compare dates directly
				const existingDate = databasePlainDate(existing.startDate);
				dateMatch = existingDate.month === month && existingDate.day === day;
			}
		} else {
			const existingDate = databasePlainDate(existing.startDate);
			dateMatch = existingDate.month === month && existingDate.day === day;
		}

		return nameMatch || dateMatch;
	});
}
