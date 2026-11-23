import { instantFromDB, instantToDB } from "@/lib/datetime/drizzle-adapter";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { isValidTimeZone, parseTimeZone } from "@/lib/timezone/validation";

interface ParsedTime {
	hour: number;
	minute: number;
}

export function parseTimeString(value: string): ParsedTime | null {
	const [hour, minute] = value.split(":").map(Number);

	if (
		Number.isNaN(hour) ||
		Number.isNaN(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59
	) {
		return null;
	}

	return { hour, minute };
}

export function setTimeOnStoredDate(baseDate: Date, time: string, timezone?: string): Date | null {
	const parsedTime = parseTimeString(time);
	const baseInstant = instantFromDB(baseDate);

	if (!parsedTime || !baseInstant) {
		return null;
	}

	if (timezone && !isValidTimeZone(timezone)) {
		return null;
	}

	const zone = timezone ? parseTimeZone(timezone) : "UTC";
	const zonedDateTime = baseInstant.toZonedDateTimeISO(zone).with({
		hour: parsedTime.hour,
		minute: parsedTime.minute,
		second: 0,
		millisecond: 0,
		microsecond: 0,
		nanosecond: 0,
	});

	return instantToDB(zonedDateTime.toInstant());
}

export function createUtcDateTime(date: string, time: string, timezone: string): Date | null {
	const parsedTime = parseTimeString(time);
	if (!parsedTime || !isValidTimeZone(timezone)) {
		return null;
	}

	let plainDate: PlainDate;
	try {
		plainDate = parsePlainDate(date);
	} catch {
		return null;
	}

	const combinedDateTime = plainDate
		.toPlainDateTime({
			hour: parsedTime.hour,
			minute: parsedTime.minute,
			second: 0,
			millisecond: 0,
		})
		.toZonedDateTime(parseTimeZone(timezone));

	return instantToDB(combinedDateTime.toInstant());
}

export function createCorrectionDateTime(input: {
	date?: string;
	time?: string;
	timezone: string;
}): Date | null {
	if (!input.date || !input.time) {
		return null;
	}

	return createUtcDateTime(input.date, input.time, input.timezone);
}

export function calculateDurationMinutes(startTime: Date, endTime: Date): number {
	return Math.floor((endTime.getTime() - startTime.getTime()) / 60_000);
}
