"use server";

import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { shouldExcludeFromCalculations } from "@/lib/calendar/holiday-service";

export interface WorkHoursSummary {
	totalMinutes: number;
	totalHours: number;
	excludedMinutes: number; // Minutes excluded due to holidays
	workDays: number;
	excludedDays: number; // Days excluded due to holidays
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
	const rangeStart = new Date(startDate);
	rangeStart.setHours(0, 0, 0, 0);

	const rangeEnd = new Date(endDate);
	rangeEnd.setHours(23, 59, 59, 999);

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
		const periodDate = new Date(period.startTime);
		const dateKey = periodDate.toISOString().split("T")[0]; // YYYY-MM-DD

		// Track unique work days
		processedDates.add(dateKey);

		// Check if this date should be excluded from calculations
		const shouldExclude = await shouldExcludeFromCalculations(organizationId, periodDate);

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
 * Calculate expected work hours for a date range
 * Based on organization's working days per week (excluding weekends and holidays)
 */
export async function calculateExpectedWorkHours(
	organizationId: string,
	startDate: Date,
	endDate: Date,
	hoursPerDay: number = 8,
): Promise<WorkHoursSummary> {
	const rangeStart = new Date(startDate);
	const rangeEnd = new Date(endDate);

	let totalMinutes = 0;
	let excludedMinutes = 0;
	let workDays = 0;
	let excludedDays = 0;

	// Iterate through each day in the range
	const currentDate = new Date(rangeStart);
	while (currentDate <= rangeEnd) {
		const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 6 = Saturday

		// Skip weekends (assuming 5-day work week)
		if (dayOfWeek !== 0 && dayOfWeek !== 6) {
			// Check if this is a holiday
			const shouldExclude = await shouldExcludeFromCalculations(organizationId, currentDate);

			if (shouldExclude) {
				excludedDays++;
				excludedMinutes += hoursPerDay * 60;
			} else {
				workDays++;
				totalMinutes += hoursPerDay * 60;
			}
		}

		// Move to next day
		currentDate.setDate(currentDate.getDate() + 1);
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
 * Compare actual vs expected work hours
 * Returns difference and percentage
 */
export async function compareWorkHours(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
	hoursPerDay: number = 8,
): Promise<{
	actual: WorkHoursSummary;
	expected: WorkHoursSummary;
	differenceMinutes: number;
	differenceHours: number;
	percentageOfExpected: number;
}> {
	const [actual, expected] = await Promise.all([
		calculateWorkHours(employeeId, organizationId, startDate, endDate),
		calculateExpectedWorkHours(organizationId, startDate, endDate, hoursPerDay),
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
