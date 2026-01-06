"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employee, user, workPeriod } from "@/db/schema";
import type { WorkPeriodEvent } from "./types";

interface WorkPeriodFilters {
	organizationId: string;
	employeeId?: string;
}

/**
 * Get work periods for a specific month to display on the calendar
 * Aggregates by day and employee, showing total duration per day
 * Only includes completed work periods (isActive = false)
 */
export async function getWorkPeriodsForMonth(
	month: number,
	year: number,
	filters: WorkPeriodFilters,
): Promise<WorkPeriodEvent[]> {
	// Calculate date range for the month
	const startDate = new Date(year, month, 1);
	const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

	try {
		// Build the query with filters
		let query = db
			.select({
				period: workPeriod,
				employee: employee,
				user: user,
			})
			.from(workPeriod)
			.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					// Organization filter via employee
					eq(employee.organizationId, filters.organizationId),
					// Date range filter
					gte(workPeriod.startTime, startDate),
					lte(workPeriod.startTime, endDate),
					// Only completed work periods
					eq(workPeriod.isActive, false),
				),
			);

		// Add employee filter if provided
		if (filters.employeeId) {
			query = query.where(
				and(
					eq(employee.organizationId, filters.organizationId),
					eq(workPeriod.employeeId, filters.employeeId),
					gte(workPeriod.startTime, startDate),
					lte(workPeriod.startTime, endDate),
					eq(workPeriod.isActive, false),
				),
			);
		}

		const periods = await query;

		// Aggregate by day and employee
		const aggregated = aggregateByDay(periods);

		return aggregated;
	} catch (error) {
		console.error("Error fetching work periods for calendar:", error);
		return [];
	}
}

/**
 * Aggregate work periods by day and employee
 */
function aggregateByDay(
	periods: Array<{
		period: typeof workPeriod.$inferSelect;
		employee: typeof employee.$inferSelect;
		user: typeof user.$inferSelect;
	}>,
): WorkPeriodEvent[] {
	// Group by date (YYYY-MM-DD) and employee ID
	const grouped = new Map<
		string,
		{
			employeeId: string;
			employeeName: string;
			date: Date;
			totalMinutes: number;
			periodCount: number;
		}
	>();

	for (const { period, user } of periods) {
		if (!period.durationMinutes) continue; // Skip if no duration

		// Get date key (YYYY-MM-DD)
		const dateKey = period.startTime.toISOString().split("T")[0];
		const groupKey = `${dateKey}_${period.employeeId}`;

		if (!grouped.has(groupKey)) {
			grouped.set(groupKey, {
				employeeId: period.employeeId,
				employeeName: user.name,
				date: new Date(period.startTime.toISOString().split("T")[0]), // Date at midnight
				totalMinutes: 0,
				periodCount: 0,
			});
		}

		const group = grouped.get(groupKey)!;
		group.totalMinutes += period.durationMinutes;
		group.periodCount += 1;
	}

	// Transform to WorkPeriodEvent objects
	return Array.from(grouped.values()).map((group) => ({
		id: `${group.date.toISOString()}_${group.employeeId}`,
		type: "work_period" as const,
		date: group.date,
		title: `${group.employeeName} - ${formatDuration(group.totalMinutes)}`,
		description: `${group.periodCount} work ${group.periodCount === 1 ? "period" : "periods"}`,
		color: "#6366f1", // Indigo-500
		metadata: {
			durationMinutes: group.totalMinutes,
			employeeName: group.employeeName,
			periodCount: group.periodCount,
		},
	}));
}

/**
 * Format duration in minutes to human-readable string
 * Examples: "8h 30m", "4h", "45m"
 */
export function formatDuration(minutes: number): string {
	if (minutes < 0) return "0m";

	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;

	if (hours === 0) {
		return `${mins}m`;
	} else if (mins === 0) {
		return `${hours}h`;
	} else {
		return `${hours}h ${mins}m`;
	}
}
