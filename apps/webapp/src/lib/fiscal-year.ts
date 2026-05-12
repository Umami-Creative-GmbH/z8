import { DateTime } from "luxon";

export type FiscalYearRange = {
	labelYear: number;
	start: DateTime;
	end: DateTime;
};

export function normalizeFiscalYearStartMonth(month: number | null | undefined): number {
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		return 1;
	}

	return month;
}

export function getFiscalYearRangeForDate(date: DateTime, fiscalYearStartMonth: number | null | undefined): FiscalYearRange {
	const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
	const utcDate = date.toUTC();
	const labelYear = utcDate.month >= startMonth ? utcDate.year : utcDate.year - 1;

	return getFiscalYearRangeForLabelYear(labelYear, startMonth);
}

export function getFiscalYearRangeForLabelYear(
	labelYear: number,
	fiscalYearStartMonth: number | null | undefined,
): FiscalYearRange {
	const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
	const start = DateTime.utc(labelYear, startMonth, 1).startOf("day");
	const end = start.plus({ years: 1 }).minus({ milliseconds: 1 });

	return {
		labelYear,
		start,
		end,
	};
}

export function getFiscalYearToDateRange(date: DateTime, fiscalYearStartMonth: number | null | undefined): FiscalYearRange {
	const range = getFiscalYearRangeForDate(date, fiscalYearStartMonth);

	return {
		...range,
		end: date.toUTC(),
	};
}

export function getCurrentFiscalYearLabel(date: DateTime, fiscalYearStartMonth: number | null | undefined): number {
	return getFiscalYearRangeForDate(date, fiscalYearStartMonth).labelYear;
}

export function calculateFiscalCarryoverExpiryDate(
	labelYear: number,
	fiscalYearStartMonth: number | null | undefined,
	carryoverMonths: number,
): DateTime {
	return getFiscalYearRangeForLabelYear(labelYear, fiscalYearStartMonth).start.plus({ months: carryoverMonths }).minus({ milliseconds: 1 });
}
