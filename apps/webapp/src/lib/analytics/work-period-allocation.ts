import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { ReportDateRange } from "@/lib/reports/report-date-range";

export function allocateAnalyticsWorkPeriodMinutes(
	periods: Array<{ employeeId: string; startTime: Date; endTime: Date | null }>,
	reportRange: ReportDateRange,
) {
	const minutesByEmployee = new Map<string, number>();
	const minutesByDate = new Map<string, number>();
	for (const period of periods) {
		if (!period.endTime) continue;
		for (const piece of reportRange.splitPeriod(
			instantFromDate(period.startTime),
			instantFromDate(period.endTime),
		)) {
			minutesByEmployee.set(
				period.employeeId,
				(minutesByEmployee.get(period.employeeId) ?? 0) + piece.minutes,
			);
			minutesByDate.set(piece.date, (minutesByDate.get(piece.date) ?? 0) + piece.minutes);
		}
	}
	return { minutesByEmployee, minutesByDate };
}
