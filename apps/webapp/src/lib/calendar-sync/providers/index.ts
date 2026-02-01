/**
 * Calendar Provider Registry
 *
 * Central registry for all calendar provider implementations.
 * Provides factory function to get the appropriate provider.
 */

import type { CalendarProvider } from "../types";
import type { ICalendarProvider } from "./base";
import { googleCalendarProvider } from "./google";
import { microsoft365CalendarProvider } from "./microsoft365";

// ============================================
// PROVIDER REGISTRY
// ============================================

const providers: Record<CalendarProvider, ICalendarProvider> = {
	google: googleCalendarProvider,
	microsoft365: microsoft365CalendarProvider,
	// Future providers
	icloud: undefined as unknown as ICalendarProvider, // Placeholder
	caldav: undefined as unknown as ICalendarProvider, // Placeholder
};

/**
 * Get the calendar provider implementation for a given provider type
 */
export function getCalendarProvider(provider: CalendarProvider): ICalendarProvider {
	const impl = providers[provider];
	if (!impl) {
		throw new Error(`Calendar provider "${provider}" is not supported`);
	}
	return impl;
}

/**
 * Check if a calendar provider is supported and configured
 */
export function isProviderSupported(provider: CalendarProvider): boolean {
	switch (provider) {
		case "google":
			// Check for calendar-specific env vars, fallback to social login vars
			return !!(process.env.CALENDAR_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID) &&
				!!(process.env.CALENDAR_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET);
		case "microsoft365":
			// Microsoft uses calendar-specific env vars only
			return !!process.env.CALENDAR_MICROSOFT_CLIENT_ID && !!process.env.CALENDAR_MICROSOFT_CLIENT_SECRET;
		case "icloud":
		case "caldav":
			return false; // Not yet implemented
		default:
			return false;
	}
}

/**
 * Get list of supported calendar providers with their display names
 */
export function getSupportedProviders(): Array<{
	provider: CalendarProvider;
	displayName: string;
	enabled: boolean;
}> {
	return [
		{
			provider: "google",
			displayName: "Google Calendar",
			enabled: isProviderSupported("google"),
		},
		{
			provider: "microsoft365",
			displayName: "Microsoft 365",
			enabled: isProviderSupported("microsoft365"),
		},
	];
}

// Re-export base types and individual providers
export type { ICalendarProvider } from "./base";
export { isTokenExpired, formatDateOnly, formatDateTime, addOneDay, generateZ8EventId } from "./base";
export { googleCalendarProvider } from "./google";
export { microsoft365CalendarProvider } from "./microsoft365";
