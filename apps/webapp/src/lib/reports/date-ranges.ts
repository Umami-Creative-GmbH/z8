/**
 * Date range utilities for reports
 * Provides preset date ranges for common reporting periods
 */

import { DateTime } from "luxon";
import type { DateRange, PeriodPreset } from "./types";

type DateRangePresetOptions = {
	year?: number;
	timezone?: string;
};

/**
 * Get date range for a preset period
 * @param preset - The preset period type
 * @param options - Optional year for quarter presets
 * @returns Date range with start and end DateTime objects
 */
export function getDateRangeForPreset(
	preset: PeriodPreset,
	options?: number | DateRangePresetOptions,
): DateRange {
	const timezone = typeof options === "number" ? undefined : options?.timezone;
	const now = timezone ? DateTime.now().setZone(timezone) : DateTime.now();
	const year = typeof options === "number" ? options : options?.year;
	const targetYear = year ?? now.year;
	const dateInZone = (month: number) =>
		timezone
			? DateTime.fromObject({ year: targetYear, month, day: 1 }, { zone: timezone })
			: DateTime.local(targetYear, month, 1);

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
			const lastYear = now.minus({ years: 1 });
			return {
				start: lastYear.startOf("year").toJSDate(),
				end: lastYear.endOf("year").toJSDate(),
			};
		}

		case "current_year": {
			return {
				start: now.startOf("year").toJSDate(),
				end: now.endOf("year").toJSDate(),
			};
		}

		case "ytd": {
			return {
				start: now.startOf("year").toJSDate(),
				end: now.toJSDate(),
			};
		}

		case "q1": {
			const qStart = dateInZone(1);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}

		case "q2": {
			const qStart = dateInZone(4);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}

		case "q3": {
			const qStart = dateInZone(7);
			return {
				start: qStart.startOf("quarter").toJSDate(),
				end: qStart.endOf("quarter").toJSDate(),
			};
		}

		case "q4": {
			const qStart = dateInZone(10);
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
export function formatDateRangeLabel(
	start: Date | DateTime,
	end: Date | DateTime,
	timezone?: string,
): string {
	// Convert to DateTime if needed
	const startDT = (start instanceof Date ? DateTime.fromJSDate(start) : start).setZone(timezone);
	const endDT = (end instanceof Date ? DateTime.fromJSDate(end) : end).setZone(timezone);

	const startStr = startDT.toLocaleString({ year: "numeric", month: "short", day: "numeric" });
	const endStr = endDT.toLocaleString({ year: "numeric", month: "short", day: "numeric" });

	return `${startStr} - ${endStr}`;
}
