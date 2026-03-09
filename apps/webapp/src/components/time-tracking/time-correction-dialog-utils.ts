import { formatTimeInZone } from "@/lib/time-tracking/timezone-utils";

export interface TimeCorrectionFormValues {
	clockInTime: string;
	clockOutTime: string;
	reason: string;
}

export interface TimeCorrectionWorkPeriod {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockOut?: { notes: string | null } | null;
}

export function getTimeCorrectionDefaultValues(
	workPeriod: TimeCorrectionWorkPeriod,
	employeeTimezone: string,
): TimeCorrectionFormValues {
	return {
		clockInTime: formatTimeInZone(workPeriod.startTime, employeeTimezone),
		clockOutTime: workPeriod.endTime ? formatTimeInZone(workPeriod.endTime, employeeTimezone) : "",
		reason: workPeriod.clockOut?.notes || "",
	};
}

export function isValidClockRange(clockInTime: string, clockOutTime: string): boolean {
	if (!clockOutTime) {
		return true;
	}

	const [inHours, inMinutes] = clockInTime.split(":").map(Number);
	const [outHours, outMinutes] = clockOutTime.split(":").map(Number);

	return inHours * 60 + inMinutes < outHours * 60 + outMinutes;
}
