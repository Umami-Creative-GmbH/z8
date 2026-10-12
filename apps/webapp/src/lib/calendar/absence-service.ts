import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { absenceCategory, absenceEntry, employee } from "@/db/schema";
import { loadDeputyDisplays, loadDeputyViewer } from "@/lib/absences/deputy-display-store";
import type { AbsenceEvent, CalendarEvent } from "./types";

const deputyEmployee = alias(employee, "deputy_employee");
const deputyUser = alias(user, "deputy_user");

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
			eq(absenceEntry.organizationId, filters.organizationId),
			eq(employee.organizationId, filters.organizationId),
			// Date range filter - absences that overlap with the month
			lte(absenceEntry.startDate, endDateStr),
			gte(absenceEntry.endDate, startDateStr),
		];

		// Add employee filter if provided
		if (filters.employeeId) {
			conditions.push(eq(absenceEntry.employeeId, filters.employeeId));
		}

		// Only the fields shown; never the whole row (sick details stay out).
		const absences = await db
			.select({
				absence: {
					id: absenceEntry.id,
					startDate: absenceEntry.startDate,
					endDate: absenceEntry.endDate,
					status: absenceEntry.status,
					notes: absenceEntry.notes,
				},
				category: { name: absenceCategory.name, color: absenceCategory.color },
				user: { name: user.name },
				deputy: { id: deputyEmployee.id, name: deputyUser.name },
			})
			.from(absenceEntry)
			.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
			.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
			.innerJoin(user, eq(employee.userId, user.id))
			.leftJoin(
				deputyEmployee,
				and(
					eq(deputyEmployee.id, absenceEntry.deputyEmployeeId),
					eq(deputyEmployee.organizationId, filters.organizationId),
				),
			)
			.leftJoin(deputyUser, eq(deputyUser.id, deputyEmployee.userId))
			.where(and(...conditions));

		// Transform to AbsenceEvent objects
		// Note: absence.startDate and absence.endDate are YYYY-MM-DD strings, convert to Date for calendar
		return absences.map(({ absence, category, user, deputy }) => ({
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
				// Linked to the profile per viewer by linkAbsenceDeputyProfiles (#1012).
				deputy:
					deputy?.id && deputy.name
						? { id: deputy.id, name: deputy.name, canOpenProfile: false }
						: null,
			},
		}));
	} catch (error) {
		console.error("Error fetching absences for calendar:", error);
		return [];
	}
}

function absenceDeputyOf(event: CalendarEvent): AbsenceEvent["metadata"]["deputy"] {
	if (event.type !== "absence") return null;
	return (event.metadata as AbsenceEvent["metadata"]).deputy ?? null;
}

/**
 * Links each absence's deputy to their profile when the viewer may open it
 * (#1012). Other events pass through unchanged.
 */
export async function linkAbsenceDeputyProfiles<Event extends CalendarEvent>(
	events: Event[],
	input: { organizationId: string; viewerUserId: string },
): Promise<Event[]> {
	const deputyIds = events.flatMap((event) => {
		const deputy = absenceDeputyOf(event);
		return deputy ? [deputy.id] : [];
	});
	if (deputyIds.length === 0) return events;

	const viewer = await loadDeputyViewer(db, {
		organizationId: input.organizationId,
		userId: input.viewerUserId,
	});
	const deputies = await loadDeputyDisplays(db, {
		organizationId: input.organizationId,
		viewer,
		deputyEmployeeIds: deputyIds,
	});
	return events.map((event) => {
		const deputy = absenceDeputyOf(event);
		if (!deputy) return event;
		return {
			...event,
			metadata: {
				...event.metadata,
				deputy: { ...deputy, canOpenProfile: deputies.get(deputy.id)?.canOpenProfile ?? false },
			},
		};
	});
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
