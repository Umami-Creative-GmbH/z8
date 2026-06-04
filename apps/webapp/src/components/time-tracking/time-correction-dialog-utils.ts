import { DateTime } from "luxon";
import { formatTimeInZone } from "@/lib/time-tracking/timezone-utils";

export interface TimeCorrectionFormValues {
	clockInDate: string;
	clockInTime: string;
	clockOutDate: string;
	clockOutTime: string;
	reason: string;
}

export interface TimeCorrectionWorkPeriod {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockOut?: { notes: string | null } | null;
}

export function formatDateInZone(date: Date, timezone: string): string {
	return DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone).toISODate() ?? "";
}

export function getTimeCorrectionDefaultValues(
	workPeriod: TimeCorrectionWorkPeriod,
	employeeTimezone: string,
): TimeCorrectionFormValues {
	return {
		clockInDate: formatDateInZone(workPeriod.startTime, employeeTimezone),
		clockInTime: formatTimeInZone(workPeriod.startTime, employeeTimezone),
		clockOutDate: workPeriod.endTime ? formatDateInZone(workPeriod.endTime, employeeTimezone) : "",
		clockOutTime: workPeriod.endTime ? formatTimeInZone(workPeriod.endTime, employeeTimezone) : "",
		reason: workPeriod.clockOut?.notes || "",
	};
}

export function isValidClockRange(
	clockInDate: string,
	clockInTime: string,
	clockOutDate: string,
	clockOutTime: string,
): boolean {
	if (!clockOutDate && !clockOutTime) {
		return true;
	}

	if (!clockInDate || !clockInTime || !clockOutDate || !clockOutTime) {
		return false;
	}

	const clockIn = DateTime.fromISO(`${clockInDate}T${clockInTime}`);
	const clockOut = DateTime.fromISO(`${clockOutDate}T${clockOutTime}`);

	if (!clockIn.isValid || !clockOut.isValid) {
		return false;
	}

	return clockIn < clockOut;
}
