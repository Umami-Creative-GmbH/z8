/**
 * Calendar Sync Domain Layer
 *
 * Pure functions for calendar operations.
 * No side effects, no database access, no external API calls.
 */

export {
	type AbsenceRequest,
	type DateRange,
	detectConflicts,
	filterConfirmedEvents,
	filterPublicEvents,
	getConflictSummary,
	hasBlockingConflicts,
} from "./conflict-detector";
export {
	type EventMappingOptions,
	generateEventTitle,
	mapAbsencesToICSEvents,
	mapAbsenceToCalendarEvent,
	mapAbsenceToICSEvent,
} from "./event-mapper";
export {
	generateAbsenceUID,
	generateICS,
	mapAbsenceStatusToICS,
} from "./ics-generator";
