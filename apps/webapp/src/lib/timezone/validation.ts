import { Temporal } from "temporal-polyfill";

const TIMEZONE_VALIDATION_ANCHOR = {
	year: 2000,
	month: 1,
	day: 1,
};
const FIXED_OFFSET_TIMEZONE = /^[+-]/;

export function parseTimeZone(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
		throw new RangeError("Timezone must be a non-empty string without surrounding whitespace");
	}

	try {
		return Temporal.ZonedDateTime.from({
			...TIMEZONE_VALIDATION_ANCHOR,
			timeZone: value,
		}).timeZoneId;
	} catch {
		throw new RangeError(`Invalid timezone: ${value}`);
	}
}

export function parseIanaTimeZone(value: unknown): string {
	const timezone = parseTimeZone(value);
	if (FIXED_OFFSET_TIMEZONE.test(timezone)) {
		throw new RangeError("A named IANA timezone is required");
	}

	return timezone;
}

export function isValidTimeZone(value: unknown): boolean {
	try {
		parseTimeZone(value);
		return true;
	} catch {
		return false;
	}
}

export function isValidIanaTimeZone(value: unknown): boolean {
	try {
		parseIanaTimeZone(value);
		return true;
	} catch {
		return false;
	}
}
