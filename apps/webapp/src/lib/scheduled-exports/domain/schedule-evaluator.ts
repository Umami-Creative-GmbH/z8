/**
 * Schedule Evaluator
 *
 * Pure domain logic for evaluating when a schedule should next execute.
 * Handles both preset schedules and custom cron expressions.
 */
import { DateTime } from "luxon";
import { CronExpressionParser } from "cron-parser";
import type { ScheduleConfig, ScheduleType } from "./types";

/**
 * Calculate next execution time based on schedule config
 *
 * @param config - Schedule configuration
 * @param currentTime - Current time for calculation
 * @returns Next execution DateTime
 */
export function calculateNextExecution(
	config: ScheduleConfig,
	currentTime: DateTime,
): DateTime {
	const localTime = currentTime.setZone(config.timezone);

	switch (config.type) {
		case "daily":
			return calculateNextDaily(localTime);

		case "weekly":
			return calculateNextWeekly(localTime);

		case "monthly":
			return calculateNextMonthly(localTime);

		case "quarterly":
			return calculateNextQuarterly(localTime);

		case "cron":
			if (!config.cronExpression) {
				throw new Error("cronExpression is required for cron schedule type");
			}
			return calculateNextCron(localTime, config.cronExpression, config.timezone);

		default:
			throw new Error(`Unknown schedule type: ${config.type}`);
	}
}

/**
 * Check if a schedule is due for execution
 */
export function isDue(nextExecutionAt: DateTime, currentTime: DateTime): boolean {
	return nextExecutionAt <= currentTime;
}

/**
 * Calculate next daily execution (midnight)
 */
function calculateNextDaily(time: DateTime): DateTime {
	// Next day at midnight
	return time.plus({ days: 1 }).startOf("day");
}

/**
 * Calculate next weekly execution (Monday at midnight)
 */
function calculateNextWeekly(time: DateTime): DateTime {
	// Next Monday at midnight
	const nextMonday = time.plus({ weeks: 1 }).startOf("week");
	return nextMonday;
}

/**
 * Calculate next monthly execution (1st of month at midnight)
 */
function calculateNextMonthly(time: DateTime): DateTime {
	// First of next month at midnight
	return time.plus({ months: 1 }).startOf("month");
}

/**
 * Calculate next quarterly execution (1st of quarter at midnight)
 */
function calculateNextQuarterly(time: DateTime): DateTime {
	// First of next quarter at midnight
	return time.plus({ quarters: 1 }).startOf("quarter");
}

/**
 * Calculate next cron execution using cron-parser
 * Note: cron-parser v5+ uses CronExpressionParser.parse() with options including currentDate and tz
 */
function calculateNextCron(
	time: DateTime,
	expression: string,
	timezone: string,
): DateTime {
	try {
		// Parse with current date and timezone options
		const currentDate = time.setZone(timezone).toJSDate();
		const cron = CronExpressionParser.parse(expression, {
			currentDate,
			tz: timezone,
		});
		// Get next scheduled date - returns CronDate, call toDate() to get JS Date
		const nextCronDate = cron.next();
		const nextDate = nextCronDate.toDate();
		return DateTime.fromJSDate(nextDate, { zone: timezone });
	} catch (error) {
		throw new Error(
			`Invalid cron expression "${expression}": ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Validate a cron expression
 *
 * @returns true if valid, throws error if invalid
 */
export function validateCronExpression(expression: string): boolean {
	try {
		CronExpressionParser.parse(expression);
		return true;
	} catch (error) {
		throw new Error(
			`Invalid cron expression: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Get the next N execution times for a schedule
 *
 * Useful for UI preview of upcoming executions
 */
export function getNextExecutions(
	config: ScheduleConfig,
	count: number,
	startTime: DateTime = DateTime.utc(),
): DateTime[] {
	const executions: DateTime[] = [];
	let currentTime = startTime;

	for (let i = 0; i < count; i++) {
		const next = calculateNextExecution(config, currentTime);
		executions.push(next);
		currentTime = next;
	}

	return executions;
}

/**
 * Get cron expression for a preset schedule type
 *
 * Useful for converting presets to cron for consistency
 */
export function getPresetCronExpression(type: Exclude<ScheduleType, "cron">): string {
	switch (type) {
		case "daily":
			return "0 0 * * *"; // Every day at midnight
		case "weekly":
			return "0 0 * * 1"; // Every Monday at midnight
		case "monthly":
			return "0 0 1 * *"; // 1st of every month at midnight
		case "quarterly":
			return "0 0 1 1,4,7,10 *"; // 1st of Jan, Apr, Jul, Oct at midnight
		default:
			throw new Error(`Unknown preset schedule type: ${type}`);
	}
}

/**
 * Get human-readable description of a schedule
 */
export function getScheduleDescription(config: ScheduleConfig): string {
	switch (config.type) {
		case "daily":
			return `Daily at midnight (${config.timezone})`;
		case "weekly":
			return `Weekly on Monday at midnight (${config.timezone})`;
		case "monthly":
			return `Monthly on the 1st at midnight (${config.timezone})`;
		case "quarterly":
			return `Quarterly on the 1st at midnight (${config.timezone})`;
		case "cron":
			return `Cron: ${config.cronExpression} (${config.timezone})`;
		default:
			return "Unknown schedule";
	}
}
