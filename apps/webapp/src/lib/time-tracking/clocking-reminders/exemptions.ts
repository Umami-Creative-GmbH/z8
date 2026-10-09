import { and, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db";
import { absenceCategory, absenceEntry } from "@/db/schema";

type Database = Pick<typeof db, "select">;

/**
 * The given days (`YYYY-MM-DD`) on which the employee has an approved absence that does not
 * require work time, of any length (half days included).
 */
export async function loadApprovedAbsenceDays(
	input: { organizationId: string; employeeId: string; days: readonly string[] },
	database: Database,
): Promise<Set<string>> {
	if (input.days.length === 0) return new Set();
	const sorted = [...input.days].sort();
	const absences = await database
		.select({ startDate: absenceEntry.startDate, endDate: absenceEntry.endDate })
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceCategory.id, absenceEntry.categoryId))
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.organizationId, input.organizationId),
				eq(absenceCategory.requiresWorkTime, false),
				lte(absenceEntry.startDate, sorted[sorted.length - 1]),
				gte(absenceEntry.endDate, sorted[0]),
			),
		);
	return new Set(
		input.days.filter((day) =>
			absences.some((absence) => absence.startDate <= day && day <= absence.endDate),
		),
	);
}

/** The given days (`YYYY-MM-DD`) that are a holiday assigned to the employee. */
export async function loadHolidayDays(input: {
	organizationId: string;
	employeeId: string;
	days: readonly string[];
}): Promise<Set<string>> {
	if (input.days.length === 0) return new Set();
	const { getAssignedHolidayDateKeys, getAssignedHolidaysForEmployee } = await import(
		"@/lib/calendar/assigned-holidays"
	);
	const sorted = [...input.days].sort();
	const holidays = await getAssignedHolidaysForEmployee({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		// Holiday dates are calendar dates stored as UTC midnights.
		startDate: new Date(`${sorted[0]}T00:00:00.000Z`),
		endDate: new Date(`${sorted[sorted.length - 1]}T23:59:59.999Z`),
	});
	const holidayDays = getAssignedHolidayDateKeys(holidays);
	return new Set(input.days.filter((day) => holidayDays.has(day)));
}
