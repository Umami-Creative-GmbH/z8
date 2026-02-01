/**
 * Date Range Calculator
 *
 * Pure domain logic for calculating date ranges based on strategy.
 * No dependencies on external systems - uses only Luxon for date operations.
 */
import { DateTime } from "luxon";
import type { DateRangeConfig, CalculatedDateRange, CustomOffsetConfig } from "./types";

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
	executionTime: DateTime,
	timezone: string,
): CalculatedDateRange {
	const localTime = executionTime.setZone(timezone);

	switch (config.strategy) {
		case "previous_day":
			return calculatePreviousDay(localTime);

		case "previous_week":
			return calculatePreviousWeek(localTime);

		case "previous_month":
			return calculatePreviousMonth(localTime);

		case "previous_quarter":
			return calculatePreviousQuarter(localTime);

		case "custom_offset":
			if (!config.customOffset) {
				throw new Error("customOffset is required for custom_offset strategy");
			}
			return calculateCustomOffset(localTime, config.customOffset);

		default:
			throw new Error(`Unknown date range strategy: ${config.strategy}`);
	}
}

/**
 * Calculate previous day (yesterday)
 */
function calculatePreviousDay(time: DateTime): CalculatedDateRange {
	const start = time.minus({ days: 1 }).startOf("day");
	const end = time.minus({ days: 1 }).endOf("day");
	return { start, end };
}

/**
 * Calculate previous week (Monday to Sunday of last week)
 */
function calculatePreviousWeek(time: DateTime): CalculatedDateRange {
	const start = time.minus({ weeks: 1 }).startOf("week");
	const end = time.minus({ weeks: 1 }).endOf("week");
	return { start, end };
}

/**
 * Calculate previous month (1st to last day of last month)
 */
function calculatePreviousMonth(time: DateTime): CalculatedDateRange {
	const start = time.minus({ months: 1 }).startOf("month");
	const end = time.minus({ months: 1 }).endOf("month");
	return { start, end };
}

/**
 * Calculate previous quarter
 * Q1: Jan-Mar, Q2: Apr-Jun, Q3: Jul-Sep, Q4: Oct-Dec
 */
function calculatePreviousQuarter(time: DateTime): CalculatedDateRange {
	const start = time.minus({ quarters: 1 }).startOf("quarter");
	const end = time.minus({ quarters: 1 }).endOf("quarter");
	return { start, end };
}

/**
 * Calculate custom offset date range
 *
 * Offsets are positive integers representing "how far back" from execution time.
 * Both .minus() subtracts time, so we expect positive values.
 *
 * Example: { startOffset: { days: 30 }, endOffset: { days: 1 } }
 * => Last 30 days ending yesterday (30 days ago to 1 day ago)
 */
function calculateCustomOffset(
	time: DateTime,
	offset: CustomOffsetConfig,
): CalculatedDateRange {
	const startOffset = offset.startOffset || { days: 0 };
	const endOffset = offset.endOffset || { days: 0 };

	const start = time
		.minus({
			days: startOffset.days || 0,
			months: startOffset.months || 0,
		})
		.startOf("day");

	const end = time
		.minus({
			days: endOffset.days || 0,
			months: endOffset.months || 0,
		})
		.endOf("day");

	// Validate start is before end
	if (start > end) {
		throw new Error("Invalid custom offset: start date must be before end date");
	}

	return { start, end };
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
	const format = "yyyy-MM-dd";
	return `${range.start.toFormat(format)} to ${range.end.toFormat(format)}`;
}
