import { DateTime } from "luxon";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type BirthdayInput = Date | string | null | undefined;

export function calendarDateToBirthdayString(date: Date | null | undefined): string | null {
	if (!date) {
		return null;
	}

	return DateTime.fromJSDate(date).toISODate();
}

export function birthdayInputToUTCDate(value: BirthdayInput): Date | null | undefined {
	if (value == null) {
		return value;
	}

	if (typeof value === "string") {
		if (!DATE_ONLY_PATTERN.test(value)) {
			return value as unknown as Date;
		}

		const parsed = DateTime.fromISO(value, { zone: "utc" }).startOf("day");
		return parsed.isValid && parsed.toISODate() === value
			? parsed.toJSDate()
			: (value as unknown as Date);
	}

	return DateTime.fromJSDate(value, { zone: "utc" }).startOf("day").toJSDate();
}

export function birthdayValueToCalendarDate(value: Date | string | null | undefined): Date | null {
	if (!value) {
		return null;
	}

	const parsed =
		typeof value === "string"
			? DateTime.fromISO(value, { zone: "utc" })
			: DateTime.fromJSDate(value, { zone: "utc" });

	if (!parsed.isValid) {
		return null;
	}

	return new Date(parsed.year, parsed.month - 1, parsed.day);
}

export function formatBirthdayDate(date: Date): string {
	return DateTime.fromJSDate(date).toFormat("LLLL d, yyyy");
}
