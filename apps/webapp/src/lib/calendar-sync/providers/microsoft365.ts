/**
 * Microsoft 365 Calendar Provider
 *
 * Implementation of ICalendarProvider for Microsoft Graph API.
 * Uses Microsoft Graph REST API for calendar operations.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/resources/calendar
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
	formatDateOnly,
	type ICalendarProvider,
	isTokenExpired,
} from "./base";

// ============================================
// CONSTANTS
// ============================================

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_API = "https://graph.microsoft.com/v1.0";

// Scopes needed for calendar sync
const CALENDAR_SCOPES = [
	"openid",
	"email",
	"profile",
	"offline_access",
	"Calendars.ReadWrite",
];

// ============================================
// TYPES
// ============================================

interface MSGraphEvent {
	id: string;
	subject?: string;
	body?: { content: string; contentType: string };
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
	isAllDay: boolean;
	showAs: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
	sensitivity?: "normal" | "personal" | "private" | "confidential";
	location?: { displayName: string };
	attendees?: Array<{ emailAddress: { address: string } }>;
	iCalUId?: string;
	"@odata.etag"?: string;
}

interface MSGraphCalendar {
	id: string;
	name: string;
	isDefaultCalendar?: boolean;
}

interface MSTokenResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	token_type: string;
}

interface MSUserInfo {
	id: string;
	mail?: string;
	userPrincipalName: string;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getClientId(): string {
	const clientId = process.env.CALENDAR_MICROSOFT_CLIENT_ID;
	if (!clientId) {
		throw new Error("CALENDAR_MICROSOFT_CLIENT_ID environment variable is not set");
	}
	return clientId;
}

function getClientSecret(): string {
	const clientSecret = process.env.CALENDAR_MICROSOFT_CLIENT_SECRET;
	if (!clientSecret) {
		throw new Error("CALENDAR_MICROSOFT_CLIENT_SECRET environment variable is not set");
	}
	return clientSecret;
}

function parseMSGraphEvent(event: MSGraphEvent): ExternalCalendarEvent {
	// Microsoft uses local time with timezone, convert to UTC Date
	const startDate = new Date(event.start.dateTime + (event.start.timeZone === "UTC" ? "Z" : ""));
	const endDate = new Date(event.end.dateTime + (event.end.timeZone === "UTC" ? "Z" : ""));

	// Map showAs to status
	let status: "confirmed" | "tentative" | "cancelled" = "confirmed";
	if (event.showAs === "tentative") {
		status = "tentative";
	}

	// Map sensitivity to visibility
	let visibility: "public" | "private" | "default" = "default";
	if (event.sensitivity === "private" || event.sensitivity === "confidential") {
		visibility = "private";
	}

	return {
		id: event.id,
		title: event.subject ?? "(No title)",
		description: event.body?.content,
		startDate,
		endDate,
		isAllDay: event.isAllDay,
		status,
		visibility,
		location: event.location?.displayName,
		attendees: event.attendees?.map((a) => a.emailAddress.address),
		iCalUID: event.iCalUId,
		etag: event["@odata.etag"],
	};
}

async function handleMSGraphError(response: Response): Promise<CalendarProviderError> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		body = await response.text();
	}

	const status = response.status;

	if (status === 401) {
		return new TokenExpiredError("microsoft365");
	}

	if (status === 403) {
		return new PermissionDeniedError("microsoft365", "Insufficient permissions to access Microsoft Calendar");
	}

	if (status === 404) {
		return new NotFoundError("microsoft365", "event", "unknown");
	}

	if (status === 429) {
		const retryAfter = response.headers.get("Retry-After");
		return new RateLimitError("microsoft365", retryAfter ? parseInt(retryAfter, 10) : undefined);
	}

	return new CalendarProviderError(
		"microsoft365",
		`HTTP_${status}`,
		`Microsoft Graph API error: ${status}`,
		body,
	);
}

// ============================================
// MICROSOFT 365 CALENDAR PROVIDER
// ============================================

export class Microsoft365CalendarProvider implements ICalendarProvider {
	readonly provider = "microsoft365" as const;
	readonly displayName = "Microsoft 365";

	// ============================================
	// OAUTH METHODS
	// ============================================

	getAuthorizationUrl(params: OAuthAuthorizationParams): string {
		const scopes = params.scopes ?? CALENDAR_SCOPES;
		const url = new URL(MS_AUTH_URL);
		url.searchParams.set("client_id", getClientId());
		url.searchParams.set("redirect_uri", params.redirectUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("scope", scopes.join(" "));
		url.searchParams.set("state", params.state);
		url.searchParams.set("response_mode", "query");
		return url.toString();
	}

	exchangeCodeForTokens(
		params: OAuthCallbackParams,
		redirectUri: string,
	): Effect.Effect<OAuthTokens, CalendarProviderError> {
		return Effect.tryPromise({
			try: async () => {
				// Exchange code for tokens
				const tokenResponse = await fetch(MS_TOKEN_URL, {
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
					throw await handleMSGraphError(tokenResponse);
				}

				const tokens = (await tokenResponse.json()) as MSTokenResponse;

				// Get user info
				const userInfoResponse = await fetch(`${MS_GRAPH_API}/me`, {
					headers: { Authorization: `Bearer ${tokens.access_token}` },
				});

				if (!userInfoResponse.ok) {
					throw await handleMSGraphError(userInfoResponse);
				}

				const userInfo = (await userInfoResponse.json()) as MSUserInfo;

				return {
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token ?? null,
					expiresAt: tokens.expires_in
						? new Date(Date.now() + tokens.expires_in * 1000)
						: null,
					scope: tokens.scope,
					providerAccountId: userInfo.mail ?? userInfo.userPrincipalName,
				};
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
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
				const response = await fetch(MS_TOKEN_URL, {
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
					const error = await handleMSGraphError(response);
					if (response.status === 400) {
						throw new RefreshTokenInvalidError("microsoft365");
					}
					throw error;
				}

				const tokens = (await response.json()) as MSTokenResponse;

				return {
					accessToken: tokens.access_token,
					expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
					refreshToken: tokens.refresh_token,
				};
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
					"TOKEN_REFRESH_FAILED",
					"Failed to refresh access token",
					error,
				);
			},
		});
	}

	revokeTokens(_accessToken: string): Effect.Effect<void, CalendarProviderError> {
		// Microsoft doesn't have a simple token revocation endpoint for delegated tokens
		// The token will expire naturally, or the user can revoke via https://account.live.com/consent/Manage
		return Effect.succeed(undefined);
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
				// Microsoft Graph uses /me/calendar for primary, or /me/calendars/{id}/events
				const calendarPath = calendarId === "primary"
					? "/me/calendar/events"
					: `/me/calendars/${encodeURIComponent(calendarId)}/events`;

				const url = new URL(`${MS_GRAPH_API}${calendarPath}`);
				url.searchParams.set("$filter", `start/dateTime ge '${startDate.toISOString()}' and end/dateTime le '${endDate.toISOString()}'`);
				url.searchParams.set("$orderby", "start/dateTime");
				url.searchParams.set("$top", "250");

				const response = await fetch(url.toString(), {
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				if (!response.ok) {
					throw await handleMSGraphError(response);
				}

				const data = (await response.json()) as { value?: MSGraphEvent[] };
				return (data.value ?? []).map(parseMSGraphEvent);
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
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
				const calendarPath = calendarId === "primary"
					? "/me/calendar/events"
					: `/me/calendars/${encodeURIComponent(calendarId)}/events`;

				const msEvent: Partial<MSGraphEvent> = {
					subject: event.title,
					body: event.description
						? { content: event.description, contentType: "text" }
						: undefined,
					isAllDay: event.isAllDay,
					showAs: event.status === "tentative" ? "tentative" : "oof", // Out of Office
					sensitivity: event.visibility === "private" ? "private" : "normal",
					location: event.location ? { displayName: event.location } : undefined,
				};

				if (event.isAllDay) {
					// All-day events in Microsoft use date format (no time component)
					msEvent.start = {
						dateTime: formatDateOnly(event.startDate),
						timeZone: "UTC",
					};
					msEvent.end = {
						dateTime: formatDateOnly(event.endDate),
						timeZone: "UTC",
					};
				} else {
					msEvent.start = {
						dateTime: event.startDate.toISOString(),
						timeZone: "UTC",
					};
					msEvent.end = {
						dateTime: event.endDate.toISOString(),
						timeZone: "UTC",
					};
				}

				const response = await fetch(`${MS_GRAPH_API}${calendarPath}`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${credentials.accessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(msEvent),
				});

				if (!response.ok) {
					throw await handleMSGraphError(response);
				}

				const created = (await response.json()) as MSGraphEvent;
				return {
					id: created.id,
					etag: created["@odata.etag"],
					iCalUID: created.iCalUId,
				};
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
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
				const calendarPath = calendarId === "primary"
					? `/me/calendar/events/${encodeURIComponent(update.id)}`
					: `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(update.id)}`;

				// PATCH for partial update
				const patchData: Record<string, unknown> = {};

				if (update.title !== undefined) {
					patchData.subject = update.title;
				}

				if (update.description !== undefined) {
					patchData.body = { content: update.description, contentType: "text" };
				}

				if (update.status !== undefined) {
					patchData.showAs = update.status === "cancelled" ? "free" : "oof";
				}

				if (update.startDate !== undefined) {
					patchData.start = {
						dateTime: update.startDate.toISOString(),
						timeZone: "UTC",
					};
				}

				if (update.endDate !== undefined) {
					patchData.end = {
						dateTime: update.endDate.toISOString(),
						timeZone: "UTC",
					};
				}

				const response = await fetch(`${MS_GRAPH_API}${calendarPath}`, {
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${credentials.accessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(patchData),
				});

				if (!response.ok) {
					throw await handleMSGraphError(response);
				}
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
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
				const calendarPath = calendarId === "primary"
					? `/me/calendar/events/${encodeURIComponent(eventId)}`
					: `/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

				const response = await fetch(`${MS_GRAPH_API}${calendarPath}`, {
					method: "DELETE",
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				// 204 No Content is success, 404 means already deleted
				if (!response.ok && response.status !== 404) {
					throw await handleMSGraphError(response);
				}
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
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
				if (isTokenExpired(credentials.expiresAt)) {
					return false;
				}

				const response = await fetch(`${MS_GRAPH_API}/me/calendars?$top=1`, {
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				return response.ok;
			},
			catch: (error) => {
				return new CalendarProviderError(
					"microsoft365",
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
				const response = await fetch(`${MS_GRAPH_API}/me/calendars`, {
					headers: { Authorization: `Bearer ${credentials.accessToken}` },
				});

				if (!response.ok) {
					throw await handleMSGraphError(response);
				}

				const data = (await response.json()) as { value?: MSGraphCalendar[] };
				return (data.value ?? []).map((cal) => ({
					id: cal.id,
					name: cal.name,
					primary: cal.isDefaultCalendar ?? false,
				}));
			},
			catch: (error) => {
				if (error instanceof CalendarProviderError) {
					return error;
				}
				return new CalendarProviderError(
					"microsoft365",
					"LIST_CALENDARS_FAILED",
					"Failed to list calendars",
					error,
				);
			},
		});
	}
}

// Export singleton instance
export const microsoft365CalendarProvider = new Microsoft365CalendarProvider();
