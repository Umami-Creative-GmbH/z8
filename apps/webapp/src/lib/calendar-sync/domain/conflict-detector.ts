/**
 * Conflict Detector
 *
 * Pure functions for detecting conflicts between requested absences
 * and existing external calendar events.
 */

import type { ConflictWarning, ExternalCalendarEvent } from "../types";

// ============================================
// TYPES
// ============================================

export interface DateRange {
	start: Date;
	end: Date;
}

export interface AbsenceRequest {
	startDate: Date;
	endDate: Date;
	isAllDay?: boolean;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if two date ranges overlap
 */
function rangesOverlap(range1: DateRange, range2: DateRange): boolean {
	return range1.start < range2.end && range1.end > range2.start;
}

/**
 * Check if two date ranges are adjacent (touch but don't overlap)
 */
function rangesAdjacent(range1: DateRange, range2: DateRange): boolean {
	const gap1 = range2.start.getTime() - range1.end.getTime();
	const gap2 = range1.start.getTime() - range2.end.getTime();

	// Adjacent if end of one is within 1 hour of start of other
	const adjacentThreshold = 60 * 60 * 1000; // 1 hour
	return (
		(gap1 >= 0 && gap1 <= adjacentThreshold) ||
		(gap2 >= 0 && gap2 <= adjacentThreshold)
	);
}

/**
 * Get the overlapping date range between two ranges
 */
function getOverlapRange(range1: DateRange, range2: DateRange): DateRange {
	return {
		start: new Date(Math.max(range1.start.getTime(), range2.start.getTime())),
		end: new Date(Math.min(range1.end.getTime(), range2.end.getTime())),
	};
}

/**
 * Format a date range for display
 */
function formatDateRange(range: DateRange): string {
	const startStr = range.start.toLocaleDateString();
	const endStr = range.end.toLocaleDateString();
	return startStr === endStr ? startStr : `${startStr} - ${endStr}`;
}

// ============================================
// CONFLICT DETECTION
// ============================================

/**
 * Detect conflicts between a requested absence and external calendar events
 *
 * @param request - The absence being requested
 * @param externalEvents - Events from the external calendar
 * @returns Array of conflict warnings
 */
export function detectConflicts(
	request: AbsenceRequest,
	externalEvents: ExternalCalendarEvent[],
): ConflictWarning[] {
	const conflicts: ConflictWarning[] = [];
	const requestRange: DateRange = {
		start: request.startDate,
		end: request.endDate,
	};

	for (const event of externalEvents) {
		// Skip cancelled events
		if (event.status === "cancelled") {
			continue;
		}

		const eventRange: DateRange = {
			start: event.startDate,
			end: event.endDate,
		};

		// Check for direct overlap
		if (rangesOverlap(requestRange, eventRange)) {
			const overlapRange = getOverlapRange(requestRange, eventRange);

			conflicts.push({
				type: "overlap",
				severity: "warning",
				message: `Overlaps with "${event.title}" on ${formatDateRange(overlapRange)}`,
				externalEvent: event,
				conflictingDates: overlapRange,
			});
		}
		// Check for adjacent events (informational)
		else if (rangesAdjacent(requestRange, eventRange)) {
			conflicts.push({
				type: "adjacent",
				severity: "info",
				message: `Adjacent to "${event.title}" on ${event.startDate.toLocaleDateString()}`,
				externalEvent: event,
				conflictingDates: {
					start: event.startDate,
					end: event.endDate,
				},
			});
		}
	}

	// Sort by severity (warnings first) then by date
	conflicts.sort((a, b) => {
		if (a.severity !== b.severity) {
			return a.severity === "warning" ? -1 : 1;
		}
		return a.conflictingDates.start.getTime() - b.conflictingDates.start.getTime();
	});

	return conflicts;
}

/**
 * Check if any conflicts are blocking (warnings, not info)
 */
export function hasBlockingConflicts(conflicts: ConflictWarning[]): boolean {
	return conflicts.some((c) => c.severity === "warning");
}

/**
 * Get a summary of conflicts for display
 */
export function getConflictSummary(conflicts: ConflictWarning[]): string {
	const warnings = conflicts.filter((c) => c.severity === "warning");
	const infos = conflicts.filter((c) => c.severity === "info");

	const parts: string[] = [];

	if (warnings.length > 0) {
		parts.push(`${warnings.length} overlapping event${warnings.length > 1 ? "s" : ""}`);
	}

	if (infos.length > 0) {
		parts.push(`${infos.length} adjacent event${infos.length > 1 ? "s" : ""}`);
	}

	return parts.length > 0 ? parts.join(", ") : "No conflicts";
}

/**
 * Filter out tentative events (optional - some orgs may want to ignore tentative)
 */
export function filterConfirmedEvents(
	events: ExternalCalendarEvent[],
): ExternalCalendarEvent[] {
	return events.filter((e) => e.status === "confirmed");
}

/**
 * Filter events by visibility (exclude private events if needed)
 */
export function filterPublicEvents(
	events: ExternalCalendarEvent[],
): ExternalCalendarEvent[] {
	return events.filter((e) => e.visibility !== "private");
}
