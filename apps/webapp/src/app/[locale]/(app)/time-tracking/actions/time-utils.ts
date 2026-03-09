"use server";

import { DateTime } from "luxon";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";

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
	const baseDateTime = dateFromDB(baseDate);

	if (!parsedTime || !baseDateTime) {
		return null;
	}

	const zonedDateTime = timezone ? baseDateTime.setZone(timezone) : baseDateTime;

	return (
		dateToDB(
			zonedDateTime
				.set({
					hour: parsedTime.hour,
					minute: parsedTime.minute,
					second: 0,
					millisecond: 0,
				})
				.toUTC(),
		) ?? null
	);
}

export function createUtcDateTime(date: string, time: string, timezone: string): Date | null {
	const parsedTime = parseTimeString(time);
	const dateTime = DateTime.fromISO(date, { zone: timezone });

	if (!parsedTime || !dateTime.isValid) {
		return null;
	}

	const combinedDateTime = dateTime.set({
		hour: parsedTime.hour,
		minute: parsedTime.minute,
		second: 0,
		millisecond: 0,
	});

	if (!combinedDateTime.isValid) {
		return null;
	}

	return dateToDB(combinedDateTime.toUTC()) ?? null;
}

export function calculateDurationMinutes(startTime: Date, endTime: Date): number {
	return Math.floor((endTime.getTime() - startTime.getTime()) / 60_000);
}
