"use server";

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory, absenceEntry, employee, user } from "@/db/schema";
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
	// Calculate date range for the month
	const startDate = new Date(year, month, 1);
	const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

	try {
		// Build the query with filters
		let query = db
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
			.where(
				and(
					// Organization filter via employee
					eq(employee.organizationId, filters.organizationId),
					// Date range filter - absences that overlap with the month
					lte(absenceEntry.startDate, endDate),
					gte(absenceEntry.endDate, startDate),
				),
			);

		// Add employee filter if provided
		if (filters.employeeId) {
			query = query.where(
				and(
					eq(employee.organizationId, filters.organizationId),
					eq(absenceEntry.employeeId, filters.employeeId),
					lte(absenceEntry.startDate, endDate),
					gte(absenceEntry.endDate, startDate),
				),
			);
		}

		const absences = await query;

		// Transform to AbsenceEvent objects
		return absences.map(({ absence, category, user }) => ({
			id: absence.id,
			type: "absence" as const,
			date: absence.startDate,
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
