/**
 * Assigned public holidays of many employees over local days `[from, until)`, as date keys. Shared
 * by the statutory monitors (JArbSchG holidays, on-call released days). Read-only.
 */
import {
	getAssignedHolidayDateKeys,
	getAssignedHolidaysForEmployees,
} from "@/lib/calendar/assigned-holidays";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

/**
 * Public holiday date keys (`YYYY-MM-DD`) per employee over `[from, until)`; every employee asked
 * for has an entry. The holiday reader needs the relational query API; it only reads.
 */
export async function loadHolidayDateKeys(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, Set<string>>> {
	if (input.employeeIds.length === 0) return new Map();
	const holidays = await getAssignedHolidaysForEmployees({
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		startDate: new Date(`${input.from}T00:00:00.000Z`),
		endDate: new Date(`${parsePlainDate(input.until).subtract({ days: 1 })}T23:59:59.999Z`),
		database: db as DatabaseClient,
	});
	return new Map(
		input.employeeIds.map((employeeId) => [
			employeeId,
			getAssignedHolidayDateKeys(holidays.get(employeeId) ?? []),
		]),
	);
}
