import { DateTime } from "luxon";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";
import {
	isWorkLocationType,
	normalizeWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";

export interface TimeCorrectionFormValues {
	clockInDate: string;
	clockInTime: string;
	clockOutDate: string;
	clockOutTime: string;
	reason: string;
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
}

export interface TimeCorrectionWorkPeriod {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockOut?: { notes: string | null } | null;
	workLocationType: WorkLocationType | "field" | null;
	workCategoryId: string | null;
}

export function getTimeCorrectionEndpointValues(
	date: Date,
	employeeTimezone: string,
): { date: string; time: string } {
	return getInstantLocalMinuteFields(instantFromDate(date), employeeTimezone);
}

export function formatDateInZone(date: Date, timezone: string): string {
	return getTimeCorrectionEndpointValues(date, timezone).date;
}

export function getTimeCorrectionDefaultValues(
	workPeriod: TimeCorrectionWorkPeriod,
	employeeTimezone: string,
): TimeCorrectionFormValues {
	const clockIn = getTimeCorrectionEndpointValues(
		workPeriod.startTime,
		employeeTimezone,
	);
	const clockOut = workPeriod.endTime
		? getTimeCorrectionEndpointValues(workPeriod.endTime, employeeTimezone)
		: null;
	return {
		clockInDate: clockIn.date,
		clockInTime: clockIn.time,
		clockOutDate: clockOut?.date ?? "",
		clockOutTime: clockOut?.time ?? "",
		reason: workPeriod.clockOut?.notes || "",
		workLocationType: isWorkLocationType(workPeriod.workLocationType)
			? workPeriod.workLocationType
			: normalizeWorkLocationType(workPeriod.workLocationType),
		workCategoryId: workPeriod.workCategoryId,
	};
}

export function hasTimeCorrectionChanges(params: {
	workPeriod: TimeCorrectionWorkPeriod;
	employeeTimezone: string;
	values: TimeCorrectionFormValues;
}): boolean {
	const currentValues = getTimeCorrectionDefaultValues(
		params.workPeriod,
		params.employeeTimezone,
	);

	return (
		params.values.clockInDate !== currentValues.clockInDate ||
		params.values.clockInTime !== currentValues.clockInTime ||
		params.values.clockOutDate !== currentValues.clockOutDate ||
		params.values.clockOutTime !== currentValues.clockOutTime ||
		params.values.workLocationType !== currentValues.workLocationType ||
		params.values.workCategoryId !== currentValues.workCategoryId
	);
}

export function isDirectSameDayEdit(params: {
	isSameDay: boolean;
	workPeriod: TimeCorrectionWorkPeriod;
	employeeTimezone: string;
	values: TimeCorrectionFormValues;
}): boolean {
	if (!params.isSameDay) {
		return false;
	}

	const originalClockInDate = formatDateInZone(
		params.workPeriod.startTime,
		params.employeeTimezone,
	);
	const originalClockOutDate = params.workPeriod.endTime
		? formatDateInZone(params.workPeriod.endTime, params.employeeTimezone)
		: "";

	return (
		params.values.clockInDate === originalClockInDate &&
		(!params.workPeriod.endTime ||
			params.values.clockOutDate === originalClockOutDate)
	);
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
