/**
 * Calendar Sync Module
 *
 * Provides calendar interoperability features:
 * - ICS feeds (per-user, per-team)
 * - 2-way sync with Google Calendar and Microsoft 365
 * - Conflict detection during absence creation
 */

// Domain (pure functions)
export {
	detectConflicts,
	generateAbsenceUID,
	generateICS,
	getConflictSummary,
	hasBlockingConflicts,
	mapAbsenceStatusToICS,
	mapAbsencesToICSEvents,
	mapAbsenceToCalendarEvent,
	mapAbsenceToICSEvent,
} from "./domain";

// Providers
export {
	getCalendarProvider,
	getSupportedProviders,
	type ICalendarProvider,
	isProviderSupported,
} from "./providers";
// Types
export * from "./types";
