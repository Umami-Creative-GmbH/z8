/**
 * Event Mapper
 *
 * Pure functions for mapping between Z8 absences and calendar events.
 */

import type { AbsenceWithCategory } from "@/lib/absences/types";
import type { CalendarEventToCreate, ICSEvent } from "../types";
import { generateAbsenceUID, mapAbsenceStatusToICS } from "./ics-generator";

// ============================================
// TYPES
// ============================================

export interface EventMappingOptions {
	organizationId: string;
	organizationName?: string;
	employeeName?: string;
	/** Template for event title. Supports: {categoryName}, {employeeName}, {status} */
	titleTemplate?: string;
	/** Template for event description */
	descriptionTemplate?: string;
	/** Whether to include employee name in title (for team feeds) */
	includeEmployeeName?: boolean;
}

// ============================================
// TEMPLATE HELPERS
// ============================================

const DEFAULT_TITLE_TEMPLATE = "Out of Office - {categoryName}";
const DEFAULT_TEAM_TITLE_TEMPLATE = "{employeeName} - {categoryName}";
const DEFAULT_DESCRIPTION_TEMPLATE = "Absence recorded in Z8";

/**
 * Replace template variables with actual values
 */
function applyTemplate(
	template: string,
	variables: Record<string, string>,
): string {
	let result = template;
	for (const [key, value] of Object.entries(variables)) {
		result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
	}
	return result;
}

// ============================================
// MAPPERS
// ============================================

/**
 * Map a Z8 absence to a calendar event for pushing to external calendar
 */
export function mapAbsenceToCalendarEvent(
	absence: AbsenceWithCategory,
	options: EventMappingOptions,
): CalendarEventToCreate {
	const variables = {
		categoryName: absence.category.name,
		employeeName: options.employeeName ?? "Employee",
		status: absence.status,
	};

	const titleTemplate = options.includeEmployeeName
		? options.titleTemplate ?? DEFAULT_TEAM_TITLE_TEMPLATE
		: options.titleTemplate ?? DEFAULT_TITLE_TEMPLATE;

	const title = applyTemplate(titleTemplate, variables);
	const description = options.descriptionTemplate
		? applyTemplate(options.descriptionTemplate, variables)
		: absence.notes ?? DEFAULT_DESCRIPTION_TEMPLATE;

	// Parse dates from YYYY-MM-DD strings
	const startDate = new Date(absence.startDate);
	const endDate = new Date(absence.endDate);

	return {
		title,
		description,
		startDate,
		endDate,
		isAllDay: true, // Absences are always all-day events
		status: absence.status === "approved" ? "confirmed" : "tentative",
		// Visibility not set - let provider use their default
		extendedProperties: {
			z8AbsenceId: absence.id,
			z8CategoryId: absence.category.id,
		},
	};
}

/**
 * Map a Z8 absence to an ICS event for feed generation
 */
export function mapAbsenceToICSEvent(
	absence: AbsenceWithCategory,
	options: EventMappingOptions,
): ICSEvent {
	const variables = {
		categoryName: absence.category.name,
		employeeName: options.employeeName ?? "Employee",
		status: absence.status,
	};

	const titleTemplate = options.includeEmployeeName
		? options.titleTemplate ?? DEFAULT_TEAM_TITLE_TEMPLATE
		: options.titleTemplate ?? DEFAULT_TITLE_TEMPLATE;

	const summary = applyTemplate(titleTemplate, variables);

	// Parse dates from YYYY-MM-DD strings
	const startDate = new Date(absence.startDate);
	const endDate = new Date(absence.endDate);

	return {
		uid: generateAbsenceUID(absence.id, options.organizationId),
		summary,
		description: absence.notes ?? undefined,
		startDate,
		endDate,
		isAllDay: true,
		status: mapAbsenceStatusToICS(absence.status),
		categories: [absence.category.type, absence.category.name],
		created: absence.createdAt,
		lastModified: absence.approvedAt ?? absence.createdAt,
	};
}

/**
 * Map multiple absences to ICS events
 */
export function mapAbsencesToICSEvents(
	absences: AbsenceWithCategory[],
	options: EventMappingOptions,
): ICSEvent[] {
	return absences.map((absence) => mapAbsenceToICSEvent(absence, options));
}

/**
 * Generate event title for an absence
 */
export function generateEventTitle(
	categoryName: string,
	employeeName?: string,
	template?: string,
): string {
	if (template) {
		return applyTemplate(template, { categoryName, employeeName: employeeName ?? "" });
	}
	return employeeName ? `${employeeName} - ${categoryName}` : `Out of Office - ${categoryName}`;
}
