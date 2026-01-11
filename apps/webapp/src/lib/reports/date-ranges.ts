/**
 * Date range utilities for reports
 * Provides preset date ranges for common reporting periods
 */

import { DateTime } from "luxon";
import type { DateRange, PeriodPreset } from "./types";

/**
 * Get date range for a preset period
 * @param preset - The preset period type
 * @param year - Optional year for quarter presets (defaults to current year)
 * @returns Date range with start and end DateTime objects
 */
export function getDateRangeForPreset(preset: PeriodPreset, year?: number): DateRange {
	const now = DateTime.now();
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
			const lastYear = now.minus({ years: 1 });
			return {
				start: lastYear.startOf("year").toJSDate(),
				end: lastYear.endOf("year").toJSDate(),
			};
		}

		case "current_year":
		case "ytd":
			return {
				start: now.startOf("year").toJSDate(),
				end: now.toJSDate(),
			};

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
			return `${targetYear} (Year to Date)`;
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
