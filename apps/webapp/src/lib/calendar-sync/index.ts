/**
 * Calendar Sync Module
 *
 * Provides calendar interoperability features:
 * - ICS feeds (per-user, per-team)
 * - 2-way sync with Google Calendar and Microsoft 365
 * - Conflict detection during absence creation
 */

// Types
export * from "./types";

// Providers
export {
	getCalendarProvider,
	isProviderSupported,
	getSupportedProviders,
	type ICalendarProvider,
} from "./providers";

// Domain (pure functions)
export {
	generateICS,
	generateAbsenceUID,
	mapAbsenceStatusToICS,
	detectConflicts,
	hasBlockingConflicts,
	getConflictSummary,
	mapAbsenceToCalendarEvent,
	mapAbsenceToICSEvent,
	mapAbsencesToICSEvents,
} from "./domain";
