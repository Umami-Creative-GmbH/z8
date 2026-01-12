"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee } from "@/db/schema";
import type { AbsenceEvent } from "./types";

interface AbsenceFilters {
	organizationId: string;
	employeeId?: string;
}

/**
 * Get absences for a specific month to display on the calendar
 * Includes all absences (pending, approved, rejected) with color coding
 */
export async function getAbsencesForMonth(
	month: number,
	year: number,
	filters: AbsenceFilters,
): Promise<AbsenceEvent[]> {
	// Calculate date range for the month (month is 0-indexed in JavaScript, 1-indexed in Luxon)
	const startDT = DateTime.utc(year, month + 1, 1).startOf("day");
	const endDT = startDT.endOf("month");

	// Convert to YYYY-MM-DD strings for date column comparison
	const startDateStr = startDT.toFormat("yyyy-MM-dd");
	const endDateStr = endDT.toFormat("yyyy-MM-dd");

	try {
		// Prepare conditions
		const conditions = [
			// Organization filter via employee
			eq(employee.organizationId, filters.organizationId),
			// Date range filter - absences that overlap with the month
			lte(absenceEntry.startDate, endDateStr),
			gte(absenceEntry.endDate, startDateStr),
		];

		// Add employee filter if provided
		if (filters.employeeId) {
			conditions.push(eq(absenceEntry.employeeId, filters.employeeId));
		}

		const absences = await db
			.select({
				absence: absenceEntry,
				category: absenceCategory,
				employee: employee,
				user: user,
			})
			.from(absenceEntry)
			.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
			.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.where(and(...conditions));

		// Transform to AbsenceEvent objects
		// Note: absence.startDate and absence.endDate are YYYY-MM-DD strings, convert to Date for calendar
		return absences.map(({ absence, category, user }) => ({
			id: absence.id,
			type: "absence" as const,
			date: new Date(absence.startDate),
			endDate: new Date(absence.endDate), // For multi-day display in schedule-x
			title: `${user.name} - ${category.name}`,
			description: absence.notes || undefined,
			color: getColorByStatus(absence.status, category.color),
			metadata: {
				categoryName: category.name,
				status: absence.status,
				employeeName: user.name,
				startDate: absence.startDate,
				endDate: absence.endDate,
			},
		}));
	} catch (error) {
		console.error("Error fetching absences for calendar:", error);
		return [];
	}
}

/**
 * Get color based on absence status
 * - Pending: Yellow/Amber
 * - Approved: Green (or category color if available)
 * - Rejected: Red
 */
function getColorByStatus(
	status: "pending" | "approved" | "rejected",
	categoryColor: string | null,
): string {
	switch (status) {
		case "pending":
			return "#fbbf24"; // Amber-400
		case "approved":
			return categoryColor || "#10b981"; // Green-500
		case "rejected":
			return "#ef4444"; // Red-500
		default:
			return "#6b7280"; // Gray-500 (fallback)
	}
}
