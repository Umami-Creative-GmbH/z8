import { Temporal } from "temporal-polyfill";
import { getAssignedHolidaysForEmployee } from "@/lib/calendar/assigned-holidays";
import type { Holiday } from "./types";

/** Resolve the same organization, team, employee and recurring holidays used by calendars. */
export async function getVacationHolidays(input: {
	organizationId: string;
	employeeId: string;
	startDate: string;
	endDate: string;
}): Promise<Holiday[]> {
	const start = Temporal.PlainDate.from(input.startDate).toZonedDateTime("UTC").toInstant();
	const end = Temporal.PlainDate.from(input.endDate)
		.add({ days: 1 })
		.toZonedDateTime("UTC")
		.toInstant()
		.subtract({ milliseconds: 1 });
	const holidays = await getAssignedHolidaysForEmployee({
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		startDate: new Date(start.epochMilliseconds),
		endDate: new Date(end.epochMilliseconds),
	});
	return holidays.map((holiday) => ({
		...holiday,
		categoryId: holiday.categoryId ?? "",
	}));
}
