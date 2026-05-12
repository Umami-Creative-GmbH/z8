/**
 * Date range utilities for reports
 * Provides preset date ranges for common reporting periods
 */

import { DateTime } from "luxon";
import {
	getFiscalYearRangeForDate,
	getFiscalYearToDateRange,
	getPreviousFiscalYearRange,
} from "@/lib/fiscal-year";
import type { DateRange, PeriodPreset } from "./types";

type DateRangePresetOptions = {
	year?: number;
	fiscalYearStartMonth?: number;
	timezone?: string;
};

/**
 * Get date range for a preset period
 * @param preset - The preset period type
 * @param options - Optional year for quarter presets, or fiscal year settings for year presets
 * @returns Date range with start and end DateTime objects
 */
export function getDateRangeForPreset(
	preset: PeriodPreset,
	options?: number | DateRangePresetOptions,
): DateRange {
	const now = DateTime.now();
	const year = typeof options === "number" ? options : options?.year;
	const fiscalYearStartMonth = typeof options === "number" ? 1 : options?.fiscalYearStartMonth;
	const timezone = typeof options === "number" ? "UTC" : (options?.timezone ?? "UTC");
	const targetYear = year ?? now.year;

	switch (preset) {
		case "last_month": {
			const lastMonth = now.minus({ months: 1 });
			return {
				start: lastMonth.startOf("month").toJSDate(),
				end: lastMonth.endOf("month").toJSDate(),
			};
		}

		case "current_month":
			return {
				start: now.startOf("month").toJSDate(),
				end: now.endOf("month").toJSDate(),
			};

		case "last_year": {
			const lastYear = getPreviousFiscalYearRange(now, fiscalYearStartMonth, timezone);
			return {
				start: lastYear.start.toJSDate(),
				end: lastYear.end.toJSDate(),
			};
		}

		case "current_year": {
			const currentYear = getFiscalYearRangeForDate(now, fiscalYearStartMonth, timezone);
			return {
				start: currentYear.start.toJSDate(),
				end: currentYear.end.toJSDate(),
			};
		}

		case "ytd": {
			const yearToDate = getFiscalYearToDateRange(now, fiscalYearStartMonth, timezone);
			return {
				start: yearToDate.start.toJSDate(),
				end: yearToDate.end.toJSDate(),
			};
		}

		case "q1": {
			const qStart = DateTime.local(targetYear, 1, 1);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}

		case "q2": {
			const qStart = DateTime.local(targetYear, 4, 1);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}

		case "q3": {
			const qStart = DateTime.local(targetYear, 7, 1);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}

		case "q4": {
			const qStart = DateTime.local(targetYear, 10, 1);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}
		default:
			// For custom, return current month as default
			return {
				start: now.startOf("month").toJSDate(),
				end: now.endOf("month").toJSDate(),
			};
	}
}

/**
 * Get a human-readable label for a period preset
 * @param preset - The preset period type
 * @param year - Optional year for quarter presets
 * @returns Human-readable label
 */
export function getPresetLabel(preset: PeriodPreset, year?: number): string {
	const targetYear = year ?? DateTime.now().year;

	switch (preset) {
		case "last_month":
			return "Last Month";
		case "current_month":
			return "Current Month";
		case "last_year":
			return `${targetYear - 1}`;
		case "current_year":
			return `${targetYear}`;
		case "ytd":
			return "Year to Date";
		case "q1":
			return `Q1 ${targetYear}`;
		case "q2":
			return `Q2 ${targetYear}`;
		case "q3":
			return `Q3 ${targetYear}`;
		case "q4":
			return `Q4 ${targetYear}`;
		case "custom":
			return "Custom Range";
		default:
			return "Custom Range";
	}
}

/**
 * Format a date range as a human-readable string
 * @param start - Start date (Date or DateTime)
 * @param end - End date (Date or DateTime)
 * @returns Formatted date range string
 */
export function formatDateRangeLabel(start: Date | DateTime, end: Date | DateTime): string {
	// Convert to DateTime if needed
	const startDT = start instanceof Date ? DateTime.fromJSDate(start) : start;
	const endDT = end instanceof Date ? DateTime.fromJSDate(end) : end;

	const startStr = startDT.toLocaleString({ year: "numeric", month: "short", day: "numeric" });
	const endStr = endDT.toLocaleString({ year: "numeric", month: "short", day: "numeric" });

	return `${startStr} - ${endStr}`;
}
