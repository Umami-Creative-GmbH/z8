import { DateTime } from "luxon";
import type {
	ClockinMappedAbsence,
	ClockinMappedWorkday,
	ExistingAbsenceCandidate,
	ExistingWorkPeriodCandidate,
} from "./import-types";

function normalizeDateTime(value: string | Date): string {
	if (value instanceof Date) {
		return DateTime.fromJSDate(value).toUTC().toISO() ?? "";
	}

	return DateTime.fromISO(value).toUTC().toISO() ?? "";
}

function normalizeDate(value: string): string {
	return DateTime.fromISO(value).toISODate() ?? "";
}

export function isClockinWorkdayDuplicate(
	incoming: ClockinMappedWorkday,
	existing: ExistingWorkPeriodCandidate,
): boolean {
	if (incoming.employeeId !== existing.employeeId) {
		return false;
	}

	return (
		normalizeDateTime(incoming.startAt) === normalizeDateTime(existing.startTime) &&
		normalizeDateTime(incoming.endAt ?? incoming.startAt) ===
			normalizeDateTime(existing.endTime ?? existing.startTime)
	);
}

export function isClockinAbsenceDuplicate(
	incoming: ClockinMappedAbsence,
	existing: ExistingAbsenceCandidate,
): boolean {
	if (incoming.employeeId !== existing.employeeId) {
		return false;
	}

	return (
		normalizeDate(incoming.startDate) === normalizeDate(existing.startDate) &&
		normalizeDate(incoming.endDate) === normalizeDate(existing.endDate)
	);
}
