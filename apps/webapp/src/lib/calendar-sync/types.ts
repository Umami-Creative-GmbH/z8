/**
 * Calendar Sync Types
 *
 * Core types and interfaces for calendar interoperability.
 * Defines the contract between the application and external calendar providers.
 */

import type { CalendarProvider as DBCalendarProvider } from "@/db/schema/calendar-sync";

// Re-export database types
export type CalendarProvider = DBCalendarProvider;

// ============================================
// CALENDAR PROVIDER CREDENTIALS
// ============================================

/**
 * OAuth credentials for accessing external calendars
 */
export interface CalendarProviderCredentials {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: Date | null;
	scope: string | null;
}

/**
 * Result of refreshing an access token
 */
export interface TokenRefreshResult {
	accessToken: string;
	expiresAt: Date;
	refreshToken?: string; // Some providers return a new refresh token
}

// ============================================
// EXTERNAL CALENDAR EVENTS
// ============================================

/**
 * Event from an external calendar (Google, M365, etc.)
 * Used for conflict detection
 */
export interface ExternalCalendarEvent {
	id: string;
	title: string;
	description?: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	status: "confirmed" | "tentative" | "cancelled";
	visibility: "public" | "private" | "default";
	location?: string;
	attendees?: string[];
	iCalUID?: string;
	etag?: string;
}

/**
 * Event to create in an external calendar
 */
export interface CalendarEventToCreate {
	title: string;
	description?: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	status?: "confirmed" | "tentative";
	visibility?: "public" | "private";
	location?: string;
	/** Custom ID to correlate with Z8 absence */
	extendedProperties?: Record<string, string>;
}

/**
 * Event update for an external calendar
 */
export interface CalendarEventUpdate {
	id: string;
	title?: string;
	description?: string;
	startDate?: Date;
	endDate?: Date;
	status?: "confirmed" | "cancelled";
}

/**
 * Result of creating an event in external calendar
 */
export interface CreateEventResult {
	id: string;
	etag?: string;
	iCalUID?: string;
}

// ============================================
// PROVIDER ERRORS
// ============================================

/**
 * Base error class for calendar provider operations
 */
export class CalendarProviderError extends Error {
	constructor(
		public readonly provider: CalendarProvider,
		public readonly code: string,
		message: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "CalendarProviderError";
	}
}

/**
 * OAuth token has expired and needs to be refreshed
 */
export class TokenExpiredError extends CalendarProviderError {
	constructor(provider: CalendarProvider) {
		super(provider, "TOKEN_EXPIRED", "Access token has expired");
		this.name = "TokenExpiredError";
	}
}

/**
 * Refresh token is invalid (user needs to re-authenticate)
 */
export class RefreshTokenInvalidError extends CalendarProviderError {
	constructor(provider: CalendarProvider) {
		super(provider, "REFRESH_TOKEN_INVALID", "Refresh token is invalid, re-authentication required");
		this.name = "RefreshTokenInvalidError";
	}
}

/**
 * Rate limit exceeded (should retry after delay)
 */
export class RateLimitError extends CalendarProviderError {
	constructor(
		provider: CalendarProvider,
		public readonly retryAfterSeconds?: number,
	) {
		super(
			provider,
			"RATE_LIMIT",
			`Rate limit exceeded${retryAfterSeconds ? `, retry after ${retryAfterSeconds}s` : ""}`,
		);
		this.name = "RateLimitError";
	}
}

/**
 * Calendar or event not found
 */
export class NotFoundError extends CalendarProviderError {
	constructor(
		provider: CalendarProvider,
		public readonly resourceType: "calendar" | "event",
		public readonly resourceId: string,
	) {
		super(provider, "NOT_FOUND", `${resourceType} not found: ${resourceId}`);
		this.name = "NotFoundError";
	}
}

/**
 * Insufficient permissions to access resource
 */
export class PermissionDeniedError extends CalendarProviderError {
	constructor(provider: CalendarProvider, message?: string) {
		super(provider, "PERMISSION_DENIED", message ?? "Insufficient permissions");
		this.name = "PermissionDeniedError";
	}
}

// ============================================
// CONFLICT DETECTION
// ============================================

/**
 * A conflict detected between requested absence and external calendar
 */
export interface ConflictWarning {
	type: "overlap" | "adjacent";
	severity: "warning" | "info";
	message: string;
	externalEvent: ExternalCalendarEvent;
	conflictingDates: {
		start: Date;
		end: Date;
	};
}

// ============================================
// ICS FEED TYPES
// ============================================

/**
 * ICS event for feed generation
 */
export interface ICSEvent {
	uid: string;
	summary: string;
	description?: string;
	startDate: Date;
	endDate: Date;
	isAllDay: boolean;
	status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
	location?: string;
	organizer?: {
		name: string;
		email: string;
	};
	categories?: string[];
	created?: Date;
	lastModified?: Date;
}

/**
 * ICS feed generation options
 */
export interface ICSFeedOptions {
	calendarName: string;
	calendarDescription?: string;
	timezone?: string;
	refreshInterval?: number; // Minutes
}

// ============================================
// SYNC TYPES
// ============================================

/**
 * Result of a sync operation
 */
export interface SyncResult {
	success: boolean;
	action: "created" | "updated" | "deleted" | "skipped";
	externalEventId?: string;
	error?: string;
}

/**
 * Batch sync result
 */
export interface BatchSyncResult {
	total: number;
	succeeded: number;
	failed: number;
	skipped: number;
	results: Array<{
		absenceId: string;
		result: SyncResult;
	}>;
}

// ============================================
// OAUTH TYPES
// ============================================

/**
 * OAuth authorization URL parameters
 */
export interface OAuthAuthorizationParams {
	redirectUri: string;
	state: string;
	scopes?: string[];
}

/**
 * OAuth callback parameters
 */
export interface OAuthCallbackParams {
	code: string;
	state: string;
}

/**
 * OAuth tokens received from authorization
 */
export interface OAuthTokens {
	accessToken: string;
	refreshToken: string | null;
	expiresAt: Date | null;
	scope: string | null;
	providerAccountId: string;
}
