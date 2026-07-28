import { Temporal } from "temporal-polyfill";
import type {
	PayrollAbsenceDetail,
	PayrollDayPeriod,
	PayrollPeriod,
	PayrollSummaryAbsenceRangeRow,
} from "./types";

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export function buildPayrollAbsenceDetails(
	rows: PayrollSummaryAbsenceRangeRow[],
	period: Pick<PayrollPeriod, "start" | "end">,
): PayrollAbsenceDetail[] {
	const periodStart = Temporal.PlainDate.from(period.start);
	const periodEnd = Temporal.PlainDate.from(period.end);
	const details: PayrollAbsenceDetail[] = [];

	for (const row of rows) {
		const originalStart = Temporal.PlainDate.from(row.startDate);
		const originalEnd = Temporal.PlainDate.from(row.endDate);

		if (Temporal.PlainDate.compare(originalStart, originalEnd) > 0) continue;

		const clippedStart =
			Temporal.PlainDate.compare(originalStart, periodStart) < 0
				? periodStart
				: originalStart;
		const clippedEnd =
			Temporal.PlainDate.compare(originalEnd, periodEnd) > 0
				? periodEnd
				: originalEnd;

		if (Temporal.PlainDate.compare(clippedStart, clippedEnd) > 0) continue;

		for (
			let date = clippedStart;
			Temporal.PlainDate.compare(date, clippedEnd) <= 0;
			date = date.add({ days: 1 })
		) {
			let dayPeriod: PayrollDayPeriod = "full_day";

			if (originalStart.equals(originalEnd)) {
				if (row.startPeriod === row.endPeriod) dayPeriod = row.startPeriod;
			} else if (date.equals(originalStart)) {
				dayPeriod = row.startPeriod;
			} else if (date.equals(originalEnd)) {
				dayPeriod = row.endPeriod;
			}

			details.push({
				employeeId: row.employeeId,
				categoryId: row.categoryId,
				categoryName: row.categoryName,
				date: date.toString(),
				period: dayPeriod,
			});
		}
	}

	return details.sort(
		(left, right) =>
			compareText(left.employeeId, right.employeeId) ||
			compareText(left.date, right.date) ||
			compareText(left.categoryName, right.categoryName) ||
			compareText(left.categoryId, right.categoryId),
	);
}

export function payrollAbsenceDetailDays(period: PayrollDayPeriod): number {
	return period === "full_day" ? 1 : 0.5;
}
