import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { WorkPeriodData } from "./time-entries-table-columns";

/** Calendar headings follow the employee, while each row keeps its captured endpoint offsets. */
export function timeEntryDayGroups(
	periods: WorkPeriodData[],
	timezone: string,
) {
	const groups = new Map<
		string,
		{
			date: string;
			periods: WorkPeriodData[];
			durationMinutes: number;
			incomplete: boolean;
		}
	>();
	for (const period of periods) {
		const date = instantFromDate(period.startTime)
			.toZonedDateTimeISO(timezone)
			.toPlainDate()
			.toString();
		const group = groups.get(date) ?? {
			date,
			periods: [],
			durationMinutes: 0,
			incomplete: false,
		};
		group.periods.push(period);
		if (period.durationMinutes === null || period.endTime === null)
			group.incomplete = true;
		else group.durationMinutes += period.durationMinutes;
		groups.set(date, group);
	}
	return Array.from(groups.values()).sort((left, right) =>
		right.date.localeCompare(left.date),
	);
}
