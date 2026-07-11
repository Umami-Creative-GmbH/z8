import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, timeEntry } from "@/db/schema";
import { dateFromDB } from "@/lib/datetime/drizzle-adapter";
import { localMonthRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
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
	timezone?: string | null,
): Promise<TimeEntryEvent[]> {
	const range = localMonthRange(
		`${year}-${String(month + 1).padStart(2, "0")}-01`,
		timezone || "UTC",
	);
	const startDate = dateFromInstant(range.start);
	const endExclusiveDate = dateFromInstant(range.endExclusive);

	try {
		// Prepare conditions
		const conditions = [
			// Direct organization filter (no join needed for org filtering)
			eq(timeEntry.organizationId, filters.organizationId),
			// Date range filter
			gte(timeEntry.timestamp, startDate),
			lt(timeEntry.timestamp, endExclusiveDate),
			// Only show non-superseded entries
			eq(timeEntry.isSuperseded, false),
		];

		// Add employee filter if provided
		if (filters.employeeId) {
			conditions.push(eq(timeEntry.employeeId, filters.employeeId));
		}

		const entries = await db
			.select({
				entry: timeEntry,
				employee: employee,
				user: user,
			})
			.from(timeEntry)
			.innerJoin(employee, eq(timeEntry.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.where(and(...conditions));

		// Transform to TimeEntryEvent objects
		return entries.map(({ entry, user }) => {
			// Format time for display
			const entryDT = dateFromDB(entry.timestamp);
			const timeFormatted = entryDT?.toLocaleString(DateTime.TIME_SIMPLE) ?? undefined;

			return {
				id: entry.id,
				type: "time_entry" as const,
				date: entry.timestamp,
				title: `${user.name} - ${formatEntryType(entry.type)}`,
				description: entry.notes || undefined,
				color: getColorByEntryType(entry.type),
				metadata: {
					entryType: entry.type,
					employeeName: user.name,
					time: timeFormatted,
					utcOffsetMinutes: entry.utcOffsetMinutes,
					timezone: entry.timezone || undefined,
				},
			};
		});
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
