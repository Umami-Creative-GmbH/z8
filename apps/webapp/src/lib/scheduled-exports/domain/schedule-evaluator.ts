/**
 * Schedule Evaluator
 *
 * Pure domain logic for evaluating when a schedule should next execute.
 * Handles both preset schedules and custom cron expressions.
 */

import { CronExpressionParser } from "cron-parser";
import type { Temporal } from "temporal-polyfill";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { ScheduleConfig, ScheduleType } from "./types";

/**
 * Calculate next execution time based on schedule config
 *
 * @param config - Schedule configuration
 * @param currentTime - Current time for calculation
 * @returns Next execution ZonedDateTime in the schedule's timezone
 */
export function calculateNextExecution(
	config: ScheduleConfig,
	currentTime: Instant = systemClock.nowInstant(),
): Temporal.ZonedDateTime {
	const localDate = currentTime.toZonedDateTimeISO(config.timezone).toPlainDate();

	switch (config.type) {
		case "daily":
			return calculateNextDaily(localDate, config.timezone);

		case "weekly":
			return calculateNextWeekly(localDate, config.timezone);

		case "monthly":
			return calculateNextMonthly(localDate, config.timezone);

		case "quarterly":
			return calculateNextQuarterly(localDate, config.timezone);

		case "cron":
			if (!config.cronExpression) {
				throw new Error("cronExpression is required for cron schedule type");
			}
			return calculateNextCron(currentTime, config.cronExpression, config.timezone);

		default:
			throw new Error(`Unknown schedule type: ${config.type}`);
	}
}

/**
 * Check if a schedule is due for execution
 */
export function isDue(nextExecutionAt: Instant, currentTime: Instant): boolean {
	return compareInstants(nextExecutionAt, currentTime) <= 0;
}

/**
 * Calculate next daily execution (midnight)
 */
function calculateNextDaily(today: PlainDate, timezone: string): Temporal.ZonedDateTime {
	return localDayRange(today.add({ days: 1 }).toString(), timezone).start.toZonedDateTimeISO(
		timezone,
	);
}

/**
 * Calculate next weekly execution (Monday at midnight)
 */
function calculateNextWeekly(today: PlainDate, timezone: string): Temporal.ZonedDateTime {
	const daysUntilNextMonday = 8 - today.dayOfWeek;
	return localDayRange(
		today.add({ days: daysUntilNextMonday }).toString(),
		timezone,
	).start.toZonedDateTimeISO(timezone);
}

/**
 * Calculate next monthly execution (1st of month at midnight)
 */
function calculateNextMonthly(today: PlainDate, timezone: string): Temporal.ZonedDateTime {
	const nextMonthFirst = today.with({ day: 1 }).add({ months: 1 });
	return localDayRange(nextMonthFirst.toString(), timezone).start.toZonedDateTimeISO(timezone);
}

/**
 * Calculate next quarterly execution (1st of quarter at midnight)
 */
function calculateNextQuarterly(today: PlainDate, timezone: string): Temporal.ZonedDateTime {
	const currentQuarterStartMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
	const nextQuarterFirst = today
		.with({ month: currentQuarterStartMonth, day: 1 })
		.add({ months: 3 });
	return localDayRange(nextQuarterFirst.toString(), timezone).start.toZonedDateTimeISO(timezone);
}

/**
 * Calculate next cron execution using cron-parser
 * Note: cron-parser v5+ uses CronExpressionParser.parse() with options including currentDate and tz
 */
function calculateNextCron(
	currentTime: Instant,
	expression: string,
	timezone: string,
): Temporal.ZonedDateTime {
	try {
		const cron = CronExpressionParser.parse(expression, {
			currentDate: dateFromInstant(currentTime),
			tz: timezone,
		});
		const nextDate = cron.next().toDate();
		return instantFromDate(nextDate).toZonedDateTimeISO(timezone);
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
	startTime: Instant = systemClock.nowInstant(),
): Temporal.ZonedDateTime[] {
	const executions: Temporal.ZonedDateTime[] = [];
	let currentTime = startTime;

	for (let i = 0; i < count; i++) {
		const next = calculateNextExecution(config, currentTime);
		executions.push(next);
		currentTime = next.toInstant();
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
