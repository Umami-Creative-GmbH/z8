/**
 * ICS Generator
 *
 * Pure functions for generating iCalendar (ICS) format files.
 * Follows RFC 5545 specification.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc5545
 */

import type { ICSEvent, ICSFeedOptions } from "../types";

// ============================================
// CONSTANTS
// ============================================

const CRLF = "\r\n";
const FOLD_LENGTH = 75; // Max line length before folding

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Escape special characters in ICS text values
 */
function escapeText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\n/g, "\\n");
}

/**
 * Fold long lines according to RFC 5545 (max 75 chars)
 */
function foldLine(line: string): string {
	if (line.length <= FOLD_LENGTH) {
		return line;
	}

	const parts: string[] = [];
	let remaining = line;

	while (remaining.length > FOLD_LENGTH) {
		parts.push(remaining.substring(0, FOLD_LENGTH));
		remaining = " " + remaining.substring(FOLD_LENGTH);
	}
	parts.push(remaining);

	return parts.join(CRLF);
}

/**
 * Format date for ICS (all-day events): YYYYMMDD
 */
function formatDateOnly(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

/**
 * Format datetime for ICS: YYYYMMDDTHHMMSSZ
 */
function formatDateTime(date: Date): string {
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hours = String(date.getUTCHours()).padStart(2, "0");
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	const seconds = String(date.getUTCSeconds()).padStart(2, "0");
	return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Format current timestamp for DTSTAMP
 */
function formatNow(): string {
	return formatDateTime(new Date());
}

/**
 * Add one day to a date (for all-day event end dates)
 * ICS uses exclusive end dates for VALUE=DATE events
 */
function addOneDay(date: Date): Date {
	const result = new Date(date);
	result.setUTCDate(result.getUTCDate() + 1);
	return result;
}

// ============================================
// ICS GENERATION
// ============================================

/**
 * Generate a single VEVENT component
 */
function generateVEvent(event: ICSEvent): string {
	const lines: string[] = [
		"BEGIN:VEVENT",
		`UID:${event.uid}`,
		`DTSTAMP:${formatNow()}`,
	];

	// Date/time handling
	if (event.isAllDay) {
		lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.startDate)}`);
		// ICS uses exclusive end date for all-day events
		lines.push(`DTEND;VALUE=DATE:${formatDateOnly(addOneDay(event.endDate))}`);
	} else {
		lines.push(`DTSTART:${formatDateTime(event.startDate)}`);
		lines.push(`DTEND:${formatDateTime(event.endDate)}`);
	}

	// Summary (title)
	lines.push(foldLine(`SUMMARY:${escapeText(event.summary)}`));

	// Optional fields
	if (event.description) {
		lines.push(foldLine(`DESCRIPTION:${escapeText(event.description)}`));
	}

	if (event.location) {
		lines.push(foldLine(`LOCATION:${escapeText(event.location)}`));
	}

	if (event.organizer) {
		lines.push(foldLine(`ORGANIZER;CN=${escapeText(event.organizer.name)}:mailto:${event.organizer.email}`));
	}

	if (event.categories && event.categories.length > 0) {
		lines.push(`CATEGORIES:${event.categories.map(escapeText).join(",")}`);
	}

	// Status
	lines.push(`STATUS:${event.status}`);

	// Transparency (all-day absences should show as busy)
	lines.push("TRANSP:OPAQUE");

	// Created/modified timestamps
	if (event.created) {
		lines.push(`CREATED:${formatDateTime(event.created)}`);
	}

	if (event.lastModified) {
		lines.push(`LAST-MODIFIED:${formatDateTime(event.lastModified)}`);
	}

	lines.push("END:VEVENT");

	return lines.join(CRLF);
}

/**
 * Generate a complete ICS calendar file
 *
 * @param events - Array of events to include
 * @param options - Calendar metadata options
 * @returns ICS file content as string
 */
export function generateICS(events: ICSEvent[], options: ICSFeedOptions): string {
	const lines: string[] = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Z8 Workforce Management//Calendar Sync//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		foldLine(`X-WR-CALNAME:${escapeText(options.calendarName)}`),
	];

	if (options.calendarDescription) {
		lines.push(foldLine(`X-WR-CALDESC:${escapeText(options.calendarDescription)}`));
	}

	if (options.timezone) {
		lines.push(`X-WR-TIMEZONE:${options.timezone}`);
	}

	if (options.refreshInterval) {
		// Refresh interval in ISO 8601 duration format
		const hours = Math.floor(options.refreshInterval / 60);
		const minutes = options.refreshInterval % 60;
		const duration = hours > 0 ? `PT${hours}H${minutes}M` : `PT${minutes}M`;
		lines.push(`REFRESH-INTERVAL;VALUE=DURATION:${duration}`);
		lines.push(`X-PUBLISHED-TTL:${duration}`);
	}

	// Add all events
	for (const event of events) {
		lines.push(generateVEvent(event));
	}

	lines.push("END:VCALENDAR");

	return lines.join(CRLF);
}

/**
 * Generate a UID for an absence event
 * Format: absence-{absenceId}@z8.app
 */
export function generateAbsenceUID(absenceId: string, organizationId: string): string {
	return `absence-${absenceId}@${organizationId}.z8.app`;
}

/**
 * Map absence status to ICS status
 */
export function mapAbsenceStatusToICS(
	status: "pending" | "approved" | "rejected",
): "CONFIRMED" | "TENTATIVE" | "CANCELLED" {
	switch (status) {
		case "approved":
			return "CONFIRMED";
		case "pending":
			return "TENTATIVE";
		case "rejected":
			return "CANCELLED";
	}
}
