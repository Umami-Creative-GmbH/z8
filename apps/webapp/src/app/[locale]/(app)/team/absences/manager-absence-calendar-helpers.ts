import { DateTime } from "luxon";
import type {
	ManagerAbsenceCalendarDay,
	ManagerAbsenceCalendarEntry,
} from "./manager-absence-types";

export function buildManagerAbsenceCalendarDays(
	entries: ManagerAbsenceCalendarEntry[],
	year: number,
): ManagerAbsenceCalendarDay[] {
	const yearStart = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: "utc" });
	const yearEnd = DateTime.fromObject({ year, month: 12, day: 31 }, { zone: "utc" });
	const daysByDate = new Map<string, ManagerAbsenceCalendarEntry[]>();

	for (const entry of entries) {
		const entryStart = DateTime.fromISO(entry.startDate, { zone: "utc" }).startOf("day");
		const entryEnd = DateTime.fromISO(entry.endDate, { zone: "utc" }).startOf("day");

		if (!entryStart.isValid || !entryEnd.isValid || entryEnd < yearStart || entryStart > yearEnd) {
			continue;
		}

		const clippedStart = entryStart < yearStart ? yearStart : entryStart;
		const clippedEnd = entryEnd > yearEnd ? yearEnd : entryEnd;

		for (let day = clippedStart; day <= clippedEnd; day = day.plus({ days: 1 })) {
			const date = day.toISODate();
			if (!date) {
				continue;
			}

			const existing = daysByDate.get(date) ?? [];
			existing.push(entry);
			daysByDate.set(date, existing);
		}
	}

	return Array.from(daysByDate.entries())
		.toSorted(([dateA], [dateB]) => dateA.localeCompare(dateB))
		.map(([date, dayEntries]) => ({
			date,
			approvedCount: dayEntries.filter((entry) => entry.status === "approved").length,
			pendingCount: dayEntries.filter((entry) => entry.status === "pending").length,
			totalCount: dayEntries.length,
			entries: dayEntries.toSorted((entryA, entryB) =>
				entryA.employeeName.localeCompare(entryB.employeeName, undefined, {
					sensitivity: "base",
				}),
			),
		}));
}
