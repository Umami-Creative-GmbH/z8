"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { employee, timeEntry, user } from "@/db/schema";
import type { TimeEntryEvent } from "./types";

interface TimeEntryFilters {
	organizationId: string;
	employeeId?: string;
}

/**
 * Get time entries for a specific month to display on the calendar
 * Only includes non-superseded entries (active corrections or original entries)
 */
export async function getTimeEntriesForMonth(
	month: number,
	year: number,
	filters: TimeEntryFilters,
): Promise<TimeEntryEvent[]> {
	// Calculate date range for the month
	const startDate = new Date(year, month, 1);
	const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

	try {
		// Build the query with filters
		let query = db
			.select({
				entry: timeEntry,
				employee: employee,
				user: user,
			})
			.from(timeEntry)
			.innerJoin(employee, eq(timeEntry.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.where(
				and(
					// Organization filter via employee
					eq(employee.organizationId, filters.organizationId),
					// Date range filter
					gte(timeEntry.timestamp, startDate),
					lte(timeEntry.timestamp, endDate),
					// Only show non-superseded entries
					eq(timeEntry.isSuperseded, false),
				),
			);

		// Add employee filter if provided
		if (filters.employeeId) {
			query = query.where(
				and(
					eq(employee.organizationId, filters.organizationId),
					eq(timeEntry.employeeId, filters.employeeId),
					gte(timeEntry.timestamp, startDate),
					lte(timeEntry.timestamp, endDate),
					eq(timeEntry.isSuperseded, false),
				),
			);
		}

		const entries = await query;

		// Transform to TimeEntryEvent objects
		return entries.map(({ entry, user }) => ({
			id: entry.id,
			type: "time_entry" as const,
			date: entry.timestamp,
			title: `${user.name} - ${formatEntryType(entry.type)}`,
			description: entry.notes || undefined,
			color: getColorByEntryType(entry.type),
			metadata: {
				entryType: entry.type,
				employeeName: user.name,
				timestamp: entry.timestamp,
			},
		}));
	} catch (error) {
		console.error("Error fetching time entries for calendar:", error);
		return [];
	}
}

/**
 * Format entry type for display
 */
function formatEntryType(type: "clock_in" | "clock_out" | "correction"): string {
	switch (type) {
		case "clock_in":
			return "Clock In";
		case "clock_out":
			return "Clock Out";
		case "correction":
			return "Time Correction";
		default:
			return type;
	}
}

/**
 * Get color based on time entry type
 * - Clock In: Green
 * - Clock Out: Red
 * - Correction: Amber
 */
function getColorByEntryType(type: "clock_in" | "clock_out" | "correction"): string {
	switch (type) {
		case "clock_in":
			return "#10b981"; // Green-500
		case "clock_out":
			return "#ef4444"; // Red-500
		case "correction":
			return "#f59e0b"; // Amber-500
		default:
			return "#6b7280"; // Gray-500 (fallback)
	}
}
