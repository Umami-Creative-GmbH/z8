"use server";

import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { shouldExcludeFromCalculations } from "@/lib/calendar/holiday-service";
import { dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { endOfDay, fromJSDate, startOfDay, toDateKey } from "@/lib/datetime/luxon-utils";
import { runEffect } from "@/lib/effect/runtime";
import {
	type EffectiveWorkPolicy,
	WorkPolicyService,
} from "@/lib/effect/services/work-policy.service";

export interface WorkHoursSummary {
	totalMinutes: number;
	totalHours: number;
	excludedMinutes: number; // Minutes excluded due to holidays
	workDays: number;
	excludedDays: number; // Days excluded due to holidays
}

/**
 * Map Luxon weekday (1=Mon...7=Sun) to schedule day name
 */
function luxonWeekdayToScheduleDay(
	luxonWeekday: number,
): "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" {
	const dayMap: Record<
		number,
		"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"
	> = {
		1: "monday",
		2: "tuesday",
		3: "wednesday",
		4: "thursday",
		5: "friday",
		6: "saturday",
		7: "sunday",
	};
	return dayMap[luxonWeekday] || "monday";
}

/**
 * Get expected hours for a specific day based on work policy schedule
 */
function getExpectedHoursForDay(
	policy: EffectiveWorkPolicy | null,
	luxonWeekday: number,
): number {
	// Default to 8 hours on weekdays if no schedule
	if (!policy?.schedule) {
		return luxonWeekday >= 1 && luxonWeekday <= 5 ? 8 : 0;
	}

	const dayName = luxonWeekdayToScheduleDay(luxonWeekday);
	const scheduleDay = policy.schedule.days.find((d) => d.dayOfWeek === dayName);

	if (scheduleDay?.isWorkDay) {
		const hours = parseFloat(scheduleDay.hoursPerDay);
		return Number.isNaN(hours) ? 0 : hours;
	}

	return 0;
}

/**
 * Check if a day is a working day based on policy schedule
 */
function isWorkingDay(policy: EffectiveWorkPolicy | null, luxonWeekday: number): boolean {
	// Default to weekdays if no schedule
	if (!policy?.schedule) {
		return luxonWeekday >= 1 && luxonWeekday <= 5;
	}

	const dayName = luxonWeekdayToScheduleDay(luxonWeekday);
	const scheduleDay = policy.schedule.days.find((d) => d.dayOfWeek === dayName);

	return scheduleDay?.isWorkDay ?? false;
}

/**
 * Calculate total work hours for an employee in a date range
 * Excludes hours that fall on holidays with excludeFromCalculations=true
 */
export async function calculateWorkHours(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkHoursSummary> {
	// Ensure dates are at start/end of day
	const rangeStart = dateToDB(startOfDay(fromJSDate(startDate)))!;
	const rangeEnd = dateToDB(endOfDay(fromJSDate(endDate)))!;

	// Fetch all completed work periods in the date range
	const periods = await db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, false), // Only completed periods
				isNotNull(workPeriod.durationMinutes), // Must have duration
				gte(workPeriod.startTime, rangeStart),
				lte(workPeriod.startTime, rangeEnd),
			),
		)
		.orderBy(workPeriod.startTime);

	let totalMinutes = 0;
	let excludedMinutes = 0;
	const processedDates = new Set<string>();
	const excludedDates = new Set<string>();

	// Process each work period
	for (const period of periods) {
		const periodDT = dateFromDB(period.startTime);
		if (!periodDT) continue;
		const dateKey = toDateKey(periodDT); // YYYY-MM-DD

		// Track unique work days
		processedDates.add(dateKey);

		// Check if this date should be excluded from calculations
		const shouldExclude = await shouldExcludeFromCalculations(organizationId, period.startTime);

		if (shouldExclude) {
			excludedMinutes += period.durationMinutes || 0;
			excludedDates.add(dateKey);
		} else {
			totalMinutes += period.durationMinutes || 0;
		}
	}

	return {
		totalMinutes,
		totalHours: Math.round((totalMinutes / 60) * 100) / 100, // Round to 2 decimals
		excludedMinutes,
		workDays: processedDates.size,
		excludedDays: excludedDates.size,
	};
}

/**
 * Calculate work hours for multiple employees
 * Useful for team or organization reports
 */
export async function calculateWorkHoursByEmployee(
	employeeIds: string[],
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<Map<string, WorkHoursSummary>> {
	const results = new Map<string, WorkHoursSummary>();

	// Process each employee
	for (const employeeId of employeeIds) {
		const summary = await calculateWorkHours(employeeId, organizationId, startDate, endDate);
		results.set(employeeId, summary);
	}

	return results;
}

/**
 * Get employee's effective work policy
 * Returns null if no policy is assigned
 */
export async function getEmployeePolicy(
	employeeId: string,
): Promise<EffectiveWorkPolicy | null> {
	const { Effect } = await import("effect");
	try {
		const result = await runEffect(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* service.getEffectivePolicy(employeeId);
			}),
		);
		return result;
	} catch {
		// Return null if service fails or employee not found
		return null;
	}
}

/**
 * Calculate expected work hours for a date range
 * Uses employee's work schedule if available, otherwise falls back to defaults
 * @deprecated Use calculateExpectedWorkHoursForEmployee for schedule-aware calculations
 */
export async function calculateExpectedWorkHours(
	organizationId: string,
	startDate: Date,
	endDate: Date,
	hoursPerDay: number = 8,
): Promise<WorkHoursSummary> {
	let currentDT = fromJSDate(startDate);
	const endDT = fromJSDate(endDate);

	let totalMinutes = 0;
	let excludedMinutes = 0;
	let workDays = 0;
	let excludedDays = 0;

	// Iterate through each day in the range
	while (currentDT <= endDT) {
		const dayOfWeek = currentDT.weekday % 7; // Luxon: 1=Mon, 7=Sun -> convert to JS: 0=Sun, 6=Sat

		// Skip weekends (assuming 5-day work week)
		if (dayOfWeek !== 0 && dayOfWeek !== 6) {
			// Check if this is a holiday
			const shouldExclude = await shouldExcludeFromCalculations(
				organizationId,
				dateToDB(currentDT)!,
			);

			if (shouldExclude) {
				excludedDays++;
				excludedMinutes += hoursPerDay * 60;
			} else {
				workDays++;
				totalMinutes += hoursPerDay * 60;
			}
		}

		// Move to next day
		currentDT = currentDT.plus({ days: 1 });
	}

	return {
		totalMinutes,
		totalHours: Math.round((totalMinutes / 60) * 100) / 100,
		excludedMinutes,
		workDays,
		excludedDays,
	};
}

/**
 * Calculate expected work hours for an employee in a date range
 * Uses the employee's effective work policy schedule for accurate calculations
 */
export async function calculateExpectedWorkHoursForEmployee(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkHoursSummary & { scheduleInfo: { name: string; source: string } | null }> {
	// Get employee's effective policy
	const policy = await getEmployeePolicy(employeeId);

	let currentDT = fromJSDate(startDate);
	const endDT = fromJSDate(endDate);

	let totalMinutes = 0;
	let excludedMinutes = 0;
	let workDays = 0;
	let excludedDays = 0;

	// Iterate through each day in the range
	while (currentDT <= endDT) {
		const luxonWeekday = currentDT.weekday; // 1=Mon...7=Sun

		// Check if this is a working day per policy schedule
		if (isWorkingDay(policy, luxonWeekday)) {
			const hoursForDay = getExpectedHoursForDay(policy, luxonWeekday);

			// Check if this is a holiday
			const shouldExclude = await shouldExcludeFromCalculations(
				organizationId,
				dateToDB(currentDT)!,
			);

			if (shouldExclude) {
				excludedDays++;
				excludedMinutes += hoursForDay * 60;
			} else {
				workDays++;
				totalMinutes += hoursForDay * 60;
			}
		}

		// Move to next day
		currentDT = currentDT.plus({ days: 1 });
	}

	return {
		totalMinutes,
		totalHours: Math.round((totalMinutes / 60) * 100) / 100,
		excludedMinutes,
		workDays,
		excludedDays,
		scheduleInfo: policy
			? {
					name: policy.policyName,
					source: policy.assignedVia,
				}
			: null,
	};
}

/**
 * Compare actual vs expected work hours
 * Uses employee's work schedule for accurate expected hours calculation
 */
export async function compareWorkHours(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<{
	actual: WorkHoursSummary;
	expected: WorkHoursSummary & { scheduleInfo: { name: string; source: string } | null };
	differenceMinutes: number;
	differenceHours: number;
	percentageOfExpected: number;
}> {
	const [actual, expected] = await Promise.all([
		calculateWorkHours(employeeId, organizationId, startDate, endDate),
		calculateExpectedWorkHoursForEmployee(employeeId, organizationId, startDate, endDate),
	]);

	const differenceMinutes = actual.totalMinutes - expected.totalMinutes;
	const percentageOfExpected =
		expected.totalMinutes > 0
			? Math.round((actual.totalMinutes / expected.totalMinutes) * 10000) / 100
			: 0;

	return {
		actual,
		expected,
		differenceMinutes,
		differenceHours: Math.round((differenceMinutes / 60) * 100) / 100,
		percentageOfExpected,
	};
}
