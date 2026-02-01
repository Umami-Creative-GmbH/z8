/**
 * Calendar Provider Base
 *
 * Defines the interface that all calendar providers must implement.
 * Provides common utilities and base functionality.
 */

import { Effect } from "effect";
import type {
	CalendarEventToCreate,
	CalendarEventUpdate,
	CalendarProvider,
	CalendarProviderCredentials,
	CalendarProviderError,
	CreateEventResult,
	ExternalCalendarEvent,
	OAuthAuthorizationParams,
	OAuthCallbackParams,
	OAuthTokens,
	TokenRefreshResult,
} from "../types";

// ============================================
// CALENDAR PROVIDER INTERFACE
// ============================================

/**
 * Interface for calendar provider implementations
 *
 * Each provider (Google, M365, etc.) must implement this interface.
 * All methods return Effect for type-safe error handling.
 */
export interface ICalendarProvider {
	/** Provider identifier */
	readonly provider: CalendarProvider;

	/** Display name for UI */
	readonly displayName: string;

	// ============================================
	// OAUTH METHODS
	// ============================================

	/**
	 * Generate the OAuth authorization URL
	 */
	getAuthorizationUrl(params: OAuthAuthorizationParams): string;

	/**
	 * Exchange authorization code for tokens
	 */
	exchangeCodeForTokens(
		params: OAuthCallbackParams,
		redirectUri: string,
	): Effect.Effect<OAuthTokens, CalendarProviderError>;

	/**
	 * Refresh an expired access token
	 */
	refreshAccessToken(refreshToken: string): Effect.Effect<TokenRefreshResult, CalendarProviderError>;

	/**
	 * Revoke tokens (disconnect)
	 */
	revokeTokens(accessToken: string): Effect.Effect<void, CalendarProviderError>;

	// ============================================
	// CALENDAR OPERATIONS
	// ============================================

	/**
	 * Fetch events from external calendar in a date range
	 * Used for conflict detection (read-only)
	 */
	fetchEvents(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		startDate: Date,
		endDate: Date,
	): Effect.Effect<ExternalCalendarEvent[], CalendarProviderError>;

	/**
	 * Create a new event in external calendar
	 * Used to push approved absences
	 */
	createEvent(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		event: CalendarEventToCreate,
	): Effect.Effect<CreateEventResult, CalendarProviderError>;

	/**
	 * Update an existing event
	 * Used when absence dates change
	 */
	updateEvent(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		update: CalendarEventUpdate,
	): Effect.Effect<void, CalendarProviderError>;

	/**
	 * Delete an event
	 * Used when absence is rejected/cancelled
	 */
	deleteEvent(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		eventId: string,
	): Effect.Effect<void, CalendarProviderError>;

	/**
	 * Validate that credentials are still valid
	 * Returns false if tokens are expired/invalid
	 */
	validateCredentials(
		credentials: CalendarProviderCredentials,
	): Effect.Effect<boolean, CalendarProviderError>;

	/**
	 * List available calendars for the user
	 */
	listCalendars(
		credentials: CalendarProviderCredentials,
	): Effect.Effect<Array<{ id: string; name: string; primary: boolean }>, CalendarProviderError>;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Check if token is expired or about to expire (within 5 minutes)
 */
export function isTokenExpired(expiresAt: Date | null): boolean {
	if (!expiresAt) return false;
	const bufferMs = 5 * 60 * 1000; // 5 minutes
	return Date.now() >= expiresAt.getTime() - bufferMs;
}

/**
 * Parse error response from calendar API
 */
export function parseApiError(
	provider: CalendarProvider,
	status: number,
	body: unknown,
): CalendarProviderError {
	const { CalendarProviderError, TokenExpiredError, RateLimitError, NotFoundError, PermissionDeniedError } =
		require("../types") as typeof import("../types");

	switch (status) {
		case 401:
			return new TokenExpiredError(provider);
		case 403:
			return new PermissionDeniedError(provider);
		case 404:
			return new NotFoundError(provider, "event", "unknown");
		case 429: {
			const retryAfter = typeof body === "object" && body !== null && "retryAfter" in body
				? Number((body as { retryAfter?: unknown }).retryAfter)
				: undefined;
			return new RateLimitError(provider, retryAfter);
		}
		default:
			return new CalendarProviderError(
				provider,
				`HTTP_${status}`,
				`API request failed with status ${status}`,
				body,
			);
	}
}

/**
 * Format date for all-day events (YYYY-MM-DD)
 */
export function formatDateOnly(date: Date): string {
	return date.toISOString().split("T")[0];
}

/**
 * Format date for timed events (ISO 8601)
 */
export function formatDateTime(date: Date): string {
	return date.toISOString();
}

/**
 * Add one day to a date (for all-day event end dates)
 * Google Calendar uses exclusive end dates for all-day events
 */
export function addOneDay(date: Date): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + 1);
	return result;
}

/**
 * Generate a unique event ID for extended properties
 */
export function generateZ8EventId(absenceId: string): string {
	return `z8-absence-${absenceId}`;
}
