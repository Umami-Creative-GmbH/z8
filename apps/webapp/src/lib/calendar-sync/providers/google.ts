/**
 * Google Calendar Provider
 *
 * Implementation of ICalendarProvider for Google Calendar API v3.
 * Uses Google's REST API directly for flexibility and control.
 *
 * @see https://developers.google.com/calendar/api/v3/reference
 */

import { Effect } from "effect";
import {
	type CalendarEventToCreate,
	type CalendarEventUpdate,
	type CalendarProviderCredentials,
	CalendarProviderError,
	type CreateEventResult,
	type ExternalCalendarEvent,
	NotFoundError,
	type OAuthAuthorizationParams,
	type OAuthCallbackParams,
	type OAuthTokens,
	PermissionDeniedError,
	RateLimitError,
	RefreshTokenInvalidError,
	TokenExpiredError,
	type TokenRefreshResult,
} from "../types";
import {
	addOneDay,
	formatDateOnly,
	generateZ8EventId,
	type ICalendarProvider,
	isTokenExpired,
} from "./base";

// ============================================
// CONSTANTS
// ============================================

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// Scopes needed for calendar sync
const CALENDAR_SCOPES = [
	"https://www.googleapis.com/auth/calendar.events", // Read/write events
	"https://www.googleapis.com/auth/calendar.readonly", // Read calendars list
];

// ============================================
// TYPES
// ============================================

interface GoogleEvent {
	id: string;
	summary?: string;
	description?: string;
	start: { date?: string; dateTime?: string; timeZone?: string };
	end: { date?: string; dateTime?: string; timeZone?: string };
	status: "confirmed" | "tentative" | "cancelled";
	visibility?: "default" | "public" | "private" | "confidential";
	location?: string;
	attendees?: Array<{ email: string }>;
	iCalUID?: string;
	etag?: string;
	extendedProperties?: {
		private?: Record<string, string>;
	};
}

interface GoogleCalendar {
	id: string;
	summary: string;
	primary?: boolean;
}

interface GoogleTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	token_type: string;
}

interface GoogleUserInfo {
	sub: string;
	email: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getClientId(): string {
	// Use calendar-specific credentials if available, fall back to social login credentials
	const clientId = process.env.CALENDAR_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
	if (!clientId) {
		throw new Error("CALENDAR_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID environment variable must be set");
	}
	return clientId;
}

function getClientSecret(): string {
	// Use calendar-specific credentials if available, fall back to social login credentials
	const clientSecret = process.env.CALENDAR_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
	if (!clientSecret) {
		throw new Error("CALENDAR_GOOGLE_CLIENT_SECRET or GOOGLE_CLIENT_SECRET environment variable must be set");
	}
	return clientSecret;
}

function parseGoogleEvent(event: GoogleEvent): ExternalCalendarEvent {
	const isAllDay = !!event.start.date;
	const startDate = isAllDay
		? new Date(event.start.date!)
		: new Date(event.start.dateTime!);
	const endDate = isAllDay
		? new Date(event.end.date!)
		: new Date(event.end.dateTime!);

	return {
		id: event.id,
		title: event.summary ?? "(No title)",
		description: event.description,
		startDate,
		endDate,
		isAllDay,
		status: event.status,
		visibility: event.visibility === "confidential" ? "private" : (event.visibility ?? "default"),
		location: event.location,
		attendees: event.attendees?.map((a) => a.email),
		iCalUID: event.iCalUID,
		etag: event.etag,
	};
}

async function handleGoogleApiError(
	response: Response,
): Promise<CalendarProviderError> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = await response.text();
	}

	const status = response.status;

	if (status === 401) {
		return new TokenExpiredError("google");
	}

	if (status === 403) {
		return new PermissionDeniedError("google", "Insufficient permissions to access Google Calendar");
	}

	if (status === 404) {
		return new NotFoundError("google", "event", "unknown");
	}

	if (status === 429) {
		const retryAfter = response.headers.get("Retry-After");
		return new RateLimitError("google", retryAfter ? parseInt(retryAfter, 10) : undefined);
	}

	return new CalendarProviderError(
		"google",
		`HTTP_${status}`,
		`Google Calendar API error: ${status}`,
		body,
	);
}

// ============================================
// GOOGLE CALENDAR PROVIDER
// ============================================

export class GoogleCalendarProvider implements ICalendarProvider {
	readonly provider = "google" as const;
	readonly displayName = "Google Calendar";

	// ============================================
	// OAUTH METHODS
	// ============================================

	getAuthorizationUrl(params: OAuthAuthorizationParams): string {
		const scopes = params.scopes ?? CALENDAR_SCOPES;
		const url = new URL(GOOGLE_AUTH_URL);
		url.searchParams.set("client_id", getClientId());
		url.searchParams.set("redirect_uri", params.redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", scopes.join(" "));
		url.searchParams.set("state", params.state);
		url.searchParams.set("access_type", "offline"); // Get refresh token
		url.searchParams.set("prompt", "consent"); // Always show consent screen
		url.searchParams.set("include_granted_scopes", "true");
		return url.toString();
	}

	exchangeCodeForTokens(
		params: OAuthCallbackParams,
		redirectUri: string,
	): Effect.Effect<OAuthTokens, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				// Exchange code for tokens
				const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						client_id: getClientId(),
						client_secret: getClientSecret(),
						code: params.code,
						grant_type: "authorization_code",
						redirect_uri: redirectUri,
					}),
				});

				if (!tokenResponse.ok) {
					throw await handleGoogleApiError(tokenResponse);
				}

				const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

				// Get user info to get account ID
				const userInfoResponse = await fetch(
					"https://www.googleapis.com/oauth2/v3/userinfo",
					{
						headers: { Authorization: `Bearer ${tokens.access_token}` },
					},
				);

				if (!userInfoResponse.ok) {
					throw await handleGoogleApiError(userInfoResponse);
				}

				const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;

				return {
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token ?? null,
					expiresAt: tokens.expires_in
						? new Date(Date.now() + tokens.expires_in * 1000)
						: null,
					scope: tokens.scope,
					providerAccountId: userInfo.email,
				};
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"TOKEN_EXCHANGE_FAILED",
					"Failed to exchange authorization code for tokens",
					error,
				);
			},
		});
	}

	refreshAccessToken(refreshToken: string): Effect.Effect<TokenRefreshResult, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				const response = await fetch(GOOGLE_TOKEN_URL, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						client_id: getClientId(),
						client_secret: getClientSecret(),
						refresh_token: refreshToken,
						grant_type: "refresh_token",
					}),
				});

				if (!response.ok) {
					const error = await handleGoogleApiError(response);
					if (response.status === 400) {
						throw new RefreshTokenInvalidError("google");
					}
					throw error;
				}

				const tokens = (await response.json()) as GoogleTokenResponse;

				return {
					accessToken: tokens.access_token,
					expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
					refreshToken: tokens.refresh_token, // May be returned if rotating
				};
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"TOKEN_REFRESH_FAILED",
					"Failed to refresh access token",
					error,
				);
			},
		});
	}

	revokeTokens(accessToken: string): Effect.Effect<void, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				await fetch(`${GOOGLE_REVOKE_URL}?token=${accessToken}`, {
					method: "POST",
				});
				// Google revoke endpoint returns 200 even if token is already invalid
			},
			catch: (error) => {
				return new CalendarProviderError(
					"google",
					"TOKEN_REVOKE_FAILED",
					"Failed to revoke tokens",
					error,
				);
			},
		});
	}

	// ============================================
	// CALENDAR OPERATIONS
	// ============================================

	fetchEvents(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		startDate: Date,
		endDate: Date,
	): Effect.Effect<ExternalCalendarEvent[], CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
				url.searchParams.set("timeMin", startDate.toISOString());
				url.searchParams.set("timeMax", endDate.toISOString());
				url.searchParams.set("singleEvents", "true");
				url.searchParams.set("orderBy", "startTime");
				url.searchParams.set("maxResults", "250");

				const response = await fetch(url.toString(), {
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				if (!response.ok) {
					throw await handleGoogleApiError(response);
				}

				const data = (await response.json()) as { items?: GoogleEvent[] };
				return (data.items ?? []).map(parseGoogleEvent);
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"FETCH_EVENTS_FAILED",
					"Failed to fetch calendar events",
					error,
				);
			},
		});
	}

	createEvent(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		event: CalendarEventToCreate,
	): Effect.Effect<CreateEventResult, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				const googleEvent: Partial<GoogleEvent> = {
					summary: event.title,
					description: event.description,
					status: event.status ?? "confirmed",
					visibility: event.visibility ?? "default",
					location: event.location,
				};

				if (event.isAllDay) {
					// All-day events use date (not dateTime)
					// Google uses exclusive end date, so add one day
					googleEvent.start = { date: formatDateOnly(event.startDate) };
					googleEvent.end = { date: formatDateOnly(addOneDay(event.endDate)) };
				} else {
					googleEvent.start = { dateTime: event.startDate.toISOString() };
					googleEvent.end = { dateTime: event.endDate.toISOString() };
				}

				// Store Z8 absence ID in extended properties
				if (event.extendedProperties) {
					googleEvent.extendedProperties = {
						private: event.extendedProperties,
					};
				}

				const response = await fetch(
					`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${credentials.accessToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(googleEvent),
					},
				);

				if (!response.ok) {
					throw await handleGoogleApiError(response);
				}

				const created = (await response.json()) as GoogleEvent;
				return {
					id: created.id,
					etag: created.etag,
					iCalUID: created.iCalUID,
				};
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"CREATE_EVENT_FAILED",
					"Failed to create calendar event",
					error,
				);
			},
		});
	}

	updateEvent(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		update: CalendarEventUpdate,
	): Effect.Effect<void, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				// First fetch the existing event to preserve fields we're not updating
				const getResponse = await fetch(
					`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(update.id)}`,
					{
						headers: { Authorization: `Bearer ${credentials.accessToken}` },
					},
				);

				if (!getResponse.ok) {
					throw await handleGoogleApiError(getResponse);
				}

				const existing = (await getResponse.json()) as GoogleEvent;

				// Apply updates
				const updated: GoogleEvent = {
					...existing,
					summary: update.title ?? existing.summary,
					description: update.description ?? existing.description,
					status: update.status ?? existing.status,
				};

				if (update.startDate) {
					const isAllDay = !!existing.start.date;
					if (isAllDay) {
						updated.start = { date: formatDateOnly(update.startDate) };
					} else {
						updated.start = { dateTime: update.startDate.toISOString() };
					}
				}

				if (update.endDate) {
					const isAllDay = !!existing.end.date;
					if (isAllDay) {
						updated.end = { date: formatDateOnly(addOneDay(update.endDate)) };
					} else {
						updated.end = { dateTime: update.endDate.toISOString() };
					}
				}

				const response = await fetch(
					`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(update.id)}`,
					{
						method: "PUT",
						headers: {
							Authorization: `Bearer ${credentials.accessToken}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(updated),
					},
				);

				if (!response.ok) {
					throw await handleGoogleApiError(response);
				}
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"UPDATE_EVENT_FAILED",
					"Failed to update calendar event",
					error,
				);
			},
		});
	}

	deleteEvent(
		credentials: CalendarProviderCredentials,
		calendarId: string,
		eventId: string,
	): Effect.Effect<void, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				const response = await fetch(
					`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
					{
						method: "DELETE",
						headers: { Authorization: `Bearer ${credentials.accessToken}` },
					},
				);

				// 204 No Content is success, 410 Gone means already deleted
				if (!response.ok && response.status !== 410) {
					throw await handleGoogleApiError(response);
				}
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"DELETE_EVENT_FAILED",
					"Failed to delete calendar event",
					error,
				);
			},
		});
	}

	validateCredentials(
		credentials: CalendarProviderCredentials,
	): Effect.Effect<boolean, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				// Check if token is expired locally first
				if (isTokenExpired(credentials.expiresAt)) {
					return false;
				}

				// Try to access calendar list to validate token
				const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList?maxResults=1`, {
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				return response.ok;
			},
			catch: (error) => {
				return new CalendarProviderError(
					"google",
					"VALIDATION_FAILED",
					"Failed to validate credentials",
					error,
				);
			},
		});
	}

	listCalendars(
		credentials: CalendarProviderCredentials,
	): Effect.Effect<Array<{ id: string; name: string; primary: boolean }>, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				const response = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				if (!response.ok) {
					throw await handleGoogleApiError(response);
				}

				const data = (await response.json()) as { items?: GoogleCalendar[] };
				return (data.items ?? []).map((cal) => ({
					id: cal.id,
					name: cal.summary,
					primary: cal.primary ?? false,
				}));
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"google",
					"LIST_CALENDARS_FAILED",
					"Failed to list calendars",
					error,
				);
			},
		});
	}
}

// Export singleton instance
export const googleCalendarProvider = new GoogleCalendarProvider();
