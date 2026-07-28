import { Temporal } from "temporal-polyfill";
import type {
	PayrollAbsenceDetail,
	PayrollAbsenceDetailPeriod,
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
		if (isExplicitOvernightPartial(row, originalStart, originalEnd)) {
			if (
				Temporal.PlainDate.compare(originalStart, periodStart) >= 0 &&
				Temporal.PlainDate.compare(originalStart, periodEnd) <= 0
			) {
				details.push({
					employeeId: row.employeeId,
					categoryId: row.categoryId,
					categoryName: row.categoryName,
					date: originalStart.toString(),
					period: "partial_day",
				});
			}
			continue;
		}

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
			let dayPeriod: PayrollAbsenceDetailPeriod = "full_day";

			if (originalStart.equals(originalEnd)) {
				dayPeriod = classifySameDayPeriod(row);
			} else if (date.equals(originalStart)) {
				dayPeriod = row.startPeriod === "pm" ? "pm" : "full_day";
			} else if (date.equals(originalEnd)) {
				dayPeriod = row.endPeriod === "am" ? "am" : "full_day";
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

export function payrollAbsenceDetailDays(
	period: PayrollAbsenceDetailPeriod,
): number {
	return period === "full_day" ? 1 : 0.5;
}

function classifySameDayPeriod(
	row: PayrollSummaryAbsenceRangeRow,
): PayrollAbsenceDetailPeriod {
	if (
		row.startPeriod === "am" &&
		row.endPeriod === "am" &&
		row.startTime &&
		row.endTime
	) {
		const noon = Temporal.PlainTime.from("12:00:00");
		const startTime = Temporal.PlainTime.from(row.startTime);
		const endTime = Temporal.PlainTime.from(row.endTime);

		if (Temporal.PlainTime.compare(startTime, noon) >= 0) return "pm";
		if (Temporal.PlainTime.compare(endTime, noon) <= 0) return "am";
		return "partial_day";
	}

	return row.startPeriod === row.endPeriod ? row.startPeriod : "full_day";
}

function isExplicitOvernightPartial(
	row: PayrollSummaryAbsenceRangeRow,
	startDate: Temporal.PlainDate,
	endDate: Temporal.PlainDate,
): boolean {
	return (
		!startDate.equals(endDate) &&
		row.startPeriod === "am" &&
		row.endPeriod === "am" &&
		row.startTime !== undefined &&
		row.endTime !== undefined &&
		Temporal.PlainTime.compare(
			Temporal.PlainTime.from(row.endTime),
			Temporal.PlainTime.from(row.startTime),
		) < 0
	);
}
