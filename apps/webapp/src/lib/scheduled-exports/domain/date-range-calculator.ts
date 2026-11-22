/**
 * Date Range Calculator
 *
 * Pure domain logic for calculating date ranges based on strategy.
 * Uses Temporal with explicit IANA timezones for calendar boundaries.
 */
import { localDayRange, localMonthRange, localWeekRange } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";
import type { CalculatedDateRange, CustomOffsetConfig, DateRangeConfig } from "./types";

function zonedBounds(
	startDay: PlainDate,
	endDay: PlainDate,
	timezone: string,
): CalculatedDateRange {
	const start = localDayRange(startDay.toString(), timezone).start.toZonedDateTimeISO(timezone);
	const end = localDayRange(endDay.toString(), timezone)
		.endExclusive.subtract({ milliseconds: 1 })
		.toZonedDateTimeISO(timezone);
	return { start, end };
}

/**
 * Calculate date range for an execution based on config and execution time
 *
 * @param config - Date range configuration
 * @param executionTime - When the scheduled export is being executed
 * @param timezone - Timezone for calculations
 * @returns Calculated start and end dates
 */
export function calculateDateRange(
	config: DateRangeConfig,
	executionTime: Instant,
	timezone: string,
): CalculatedDateRange {
	const localDate = executionTime.toZonedDateTimeISO(timezone).toPlainDate();

	switch (config.strategy) {
		case "previous_day":
			return calculatePreviousDay(localDate, timezone);

		case "previous_week":
			return calculatePreviousWeek(localDate, timezone);

		case "previous_month":
			return calculatePreviousMonth(localDate, timezone);

		case "previous_quarter":
			return calculatePreviousQuarter(localDate, timezone);

		case "custom_offset":
			if (!config.customOffset) {
				throw new Error("customOffset is required for custom_offset strategy");
			}
			return calculateCustomOffset(localDate, timezone, config.customOffset);

		default:
			throw new Error(`Unknown date range strategy: ${config.strategy}`);
	}
}

/**
 * Calculate previous day (yesterday)
 */
function calculatePreviousDay(today: PlainDate, timezone: string): CalculatedDateRange {
	const yesterday = today.subtract({ days: 1 });
	return zonedBounds(yesterday, yesterday, timezone);
}

/**
 * Calculate previous week (Monday to Sunday of last week)
 */
function calculatePreviousWeek(today: PlainDate, timezone: string): CalculatedDateRange {
	const range = localWeekRange(today.subtract({ days: 7 }).toString(), timezone, "monday");
	return {
		start: range.start.toZonedDateTimeISO(timezone),
		end: range.endExclusive.subtract({ milliseconds: 1 }).toZonedDateTimeISO(timezone),
	};
}

/**
 * Calculate previous month (1st to last day of last month)
 */
function calculatePreviousMonth(today: PlainDate, timezone: string): CalculatedDateRange {
	const previousMonthFirst = today.with({ day: 1 }).subtract({ months: 1 });
	const range = localMonthRange(previousMonthFirst.toString(), timezone);
	return {
		start: range.start.toZonedDateTimeISO(timezone),
		end: range.endExclusive.subtract({ milliseconds: 1 }).toZonedDateTimeISO(timezone),
	};
}

/**
 * Calculate previous quarter
 * Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec
 */
function calculatePreviousQuarter(today: PlainDate, timezone: string): CalculatedDateRange {
	const currentQuarterStartMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
	const prevQuarterStart = today.with({ month: currentQuarterStartMonth, day: 1 }).subtract({
		months: 3,
	});
	const prevQuarterEndMonth = prevQuarterStart.add({ months: 2 });
	const start = localDayRange(prevQuarterStart.toString(), timezone).start.toZonedDateTimeISO(
		timezone,
	);
	const end = localMonthRange(prevQuarterEndMonth.toString(), timezone)
		.endExclusive.subtract({ milliseconds: 1 })
		.toZonedDateTimeISO(timezone);
	return { start, end };
}

/**
 * Calculate custom offset date range
 *
 * Offsets are positive integers representing "how far back" from execution time.
 * Both subtracts move backward, so we expect positive values.
 *
 * Example: { startOffset: { days: 30 }, endOffset: { days: 1 } }
 * => Last 30 days ending yesterday (30 days ago to 1 day ago)
 */
function calculateCustomOffset(
	today: PlainDate,
	timezone: string,
	offset: CustomOffsetConfig,
): CalculatedDateRange {
	const startOffset = offset.startOffset || { days: 0 };
	const endOffset = offset.endOffset || { days: 0 };

	const startDay = today.subtract({
		months: startOffset.months || 0,
		days: startOffset.days || 0,
	});
	const endDay = today.subtract({
		months: endOffset.months || 0,
		days: endOffset.days || 0,
	});

	const range = zonedBounds(startDay, endDay, timezone);

	// Validate start is before end
	if (compareInstants(range.start.toInstant(), range.end.toInstant()) > 0) {
		throw new Error("Invalid custom offset: start date must be before end date");
	}

	return range;
}

/**
 * Get a human-readable description of a date range config
 */
export function getDateRangeDescription(config: DateRangeConfig): string {
	switch (config.strategy) {
		case "previous_day":
			return "Previous day";
		case "previous_week":
			return "Previous week (Mon-Sun)";
		case "previous_month":
			return "Previous month";
		case "previous_quarter":
			return "Previous quarter";
		case "custom_offset": {
			if (!config.customOffset) {
				return "Custom offset";
			}
			const start = config.customOffset.startOffset;
			const end = config.customOffset.endOffset;
			const startDesc = start ? `${start.days || 0}d/${start.months || 0}m ago` : "now";
			const endDesc = end ? `${end.days || 0}d/${end.months || 0}m ago` : "now";
			return `From ${startDesc} to ${endDesc}`;
		}
		default:
			return "Unknown";
	}
}

/**
 * Format a calculated date range for display
 */
export function formatDateRange(range: CalculatedDateRange): string {
	return `${range.start.toPlainDate().toString()} to ${range.end.toPlainDate().toString()}`;
}
