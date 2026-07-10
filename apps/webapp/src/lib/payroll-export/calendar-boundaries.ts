import { DateTime } from "luxon";

export function serializePayrollLogicalDate(value: DateTime) {
	const date = value.toISODate();
	if (!date) throw new Error("Invalid payroll logical date");
	return date;
}

export function parsePayrollLogicalDate(value: string) {
	const date = DateTime.fromISO(value, { setZone: true });
	if (!date.isValid) throw new Error("Invalid payroll logical date");
	return date;
}

export function buildEmployeePayrollRange(startDate: string, endDate: string, timezone: string) {
	return {
		start: DateTime.fromISO(startDate, { zone: timezone }).startOf("day").toUTC(),
		end: DateTime.fromISO(endDate, { zone: timezone }).endOf("day").toUTC(),
	};
}

export function buildPayrollQueryEnvelope(startDate: string, endDate: string) {
	return {
		start: DateTime.fromISO(startDate, { zone: "utc" }).startOf("day").minus({ hours: 14 }),
		end: DateTime.fromISO(endDate, { zone: "utc" }).endOf("day").plus({ hours: 14 }),
	};
}

export function clipPayrollInterval(
	start: DateTime,
	end: DateTime,
	range: { start: DateTime; end: DateTime },
) {
	const clippedStart = DateTime.max(start, range.start);
	const clippedEnd = DateTime.min(end, range.end);
	const durationMinutes = Math.max(0, Math.round(clippedEnd.diff(clippedStart, "minutes").minutes));
	return durationMinutes > 0 ? { start: clippedStart, end: clippedEnd, durationMinutes } : null;
}
