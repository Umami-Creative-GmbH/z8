/**
 * Calendar Sync Domain Layer
 *
 * Pure functions for calendar operations.
 * No side effects, no database access, no external API calls.
 */

export {
	generateICS,
	generateAbsenceUID,
	mapAbsenceStatusToICS,
} from "./ics-generator";

export {
	detectConflicts,
	hasBlockingConflicts,
	getConflictSummary,
	filterConfirmedEvents,
	filterPublicEvents,
	type DateRange,
	type AbsenceRequest,
} from "./conflict-detector";

export {
	mapAbsenceToCalendarEvent,
	mapAbsenceToICSEvent,
	mapAbsencesToICSEvents,
	generateEventTitle,
	type EventMappingOptions,
} from "./event-mapper";
