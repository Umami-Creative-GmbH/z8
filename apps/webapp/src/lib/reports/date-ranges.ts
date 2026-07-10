/**
 * Date range utilities for reports
 * Provides preset date ranges for common reporting periods
 */

import { type Instant, parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { parseTimeZone } from "@/lib/timezone/validation";
import type { PeriodPreset, ReportDateRange } from "./types";

type DateRangePresetOptions = {
	year?: number;
	timezone?: string;
	now?: Instant;
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
): ReportDateRange {
	const timezone = parseTimeZone(
		typeof options === "number" ? "UTC" : (options?.timezone ?? "UTC"),
	);
	const now = (
		typeof options === "number"
			? systemClock.nowInstant()
			: (options?.now ?? systemClock.nowInstant())
	)
		.toZonedDateTimeISO(timezone)
		.toPlainDate();
	const year = typeof options === "number" ? options : options?.year;
	const targetYear = year ?? now.year;
	const range = (
		start: ReturnType<typeof parsePlainDate>,
		end: ReturnType<typeof parsePlainDate>,
	): ReportDateRange => ({
		startDate: start.toString(),
		endDate: end.toString(),
	});
	const monthStart = (month: number) =>
		parsePlainDate(`${targetYear}-${String(month).padStart(2, "0")}-01`);

	switch (preset) {
		case "last_month": {
			const lastMonth = now.subtract({ months: 1 }).with({ day: 1 });
			return range(lastMonth, lastMonth.add({ months: 1 }).subtract({ days: 1 }));
		}

		case "current_month":
			return range(
				now.with({ day: 1 }),
				now.with({ day: 1 }).add({ months: 1 }).subtract({ days: 1 }),
			);

		case "last_year": {
			const lastYear = now.subtract({ years: 1 }).with({ month: 1, day: 1 });
			return range(lastYear, lastYear.add({ years: 1 }).subtract({ days: 1 }));
		}

		case "current_year": {
			const start = now.with({ month: 1, day: 1 });
			return range(start, start.add({ years: 1 }).subtract({ days: 1 }));
		}

		case "ytd": {
			return range(now.with({ month: 1, day: 1 }), now);
		}

		case "q1": {
			const qStart = monthStart(1);
			return range(qStart, qStart.add({ months: 3 }).subtract({ days: 1 }));
		}

		case "q2": {
			const qStart = monthStart(4);
			return range(qStart, qStart.add({ months: 3 }).subtract({ days: 1 }));
		}

		case "q3": {
			const qStart = monthStart(7);
			return range(qStart, qStart.add({ months: 3 }).subtract({ days: 1 }));
		}

		case "q4": {
			const qStart = monthStart(10);
			return range(qStart, qStart.add({ months: 3 }).subtract({ days: 1 }));
		}
		default:
			// For custom, return current month as default
			return range(
				now.with({ day: 1 }),
				now.with({ day: 1 }).add({ months: 1 }).subtract({ days: 1 }),
			);
	}
}

/**
 * Get a human-readable label for a period preset
 * @param preset - The preset period type
 * @param year - Optional year for quarter presets
 * @returns Human-readable label
 */
export function getPresetLabel(preset: PeriodPreset, year?: number): string {
	const targetYear = year ?? systemClock.nowInstant().toZonedDateTimeISO("UTC").year;

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
export function formatDateRangeLabel(startDate: string, endDate: string): string {
	return `${formatPlainDate(parsePlainDate(startDate), "en-US", "dateMedium")} - ${formatPlainDate(parsePlainDate(endDate), "en-US", "dateMedium")}`;
}

export function dateToCalendarString(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
