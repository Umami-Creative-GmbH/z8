import { DateTime } from "luxon";

export type FiscalYearRange = {
	labelYear: number;
	start: DateTime;
	end: DateTime;
};

export function normalizeFiscalYearStartMonth(month: number | null | undefined): number {
	if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) {
		return 1;
	}

	return month;
}

export function getFiscalYearRangeForDate(
	date: DateTime,
	fiscalYearStartMonth: number | null | undefined,
	timezone = "UTC",
): FiscalYearRange {
	const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
	const zonedDate = date.setZone(timezone);
	const labelYear = zonedDate.month >= startMonth ? zonedDate.year : zonedDate.year - 1;

	return getFiscalYearRangeForLabelYear(labelYear, startMonth, timezone);
}

export function getFiscalYearRangeForLabelYear(
	labelYear: number,
	fiscalYearStartMonth: number | null | undefined,
	timezone = "UTC",
): FiscalYearRange {
	const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
	const start = getFiscalYearStart(labelYear, startMonth, timezone);
	const end = getFiscalYearStart(labelYear + 1, startMonth, timezone).minus({ milliseconds: 1 });

	return {
		labelYear,
		start,
		end,
	};
}

export function getFiscalYearToDateRange(
	date: DateTime,
	fiscalYearStartMonth: number | null | undefined,
	timezone = "UTC",
): FiscalYearRange {
	const range = getFiscalYearRangeForDate(date, fiscalYearStartMonth, timezone);

	return {
		...range,
		end: date.toUTC(),
	};
}

export function getPreviousFiscalYearRange(
	date: DateTime,
	fiscalYearStartMonth: number | null | undefined,
	timezone = "UTC",
): FiscalYearRange {
	const currentRange = getFiscalYearRangeForDate(date, fiscalYearStartMonth, timezone);

	return getFiscalYearRangeForLabelYear(currentRange.labelYear - 1, fiscalYearStartMonth, timezone);
}

export function getCurrentFiscalYearLabel(
	date: DateTime,
	fiscalYearStartMonth: number | null | undefined,
	timezone = "UTC",
): number {
	return getFiscalYearRangeForDate(date, fiscalYearStartMonth, timezone).labelYear;
}

export function calculateFiscalCarryoverExpiryDate(
	labelYear: number,
	fiscalYearStartMonth: number | null | undefined,
	carryoverMonths: number,
): DateTime {
	return getFiscalYearRangeForLabelYear(labelYear, fiscalYearStartMonth).start.plus({ months: carryoverMonths }).minus({ milliseconds: 1 });
}

function getFiscalYearStart(labelYear: number, fiscalYearStartMonth: number, timezone: string): DateTime {
	return DateTime.fromObject({ year: labelYear, month: fiscalYearStartMonth, day: 1 }, { zone: timezone }).startOf("day").toUTC();
}
