/**
 * SuperJSON configuration with Luxon DateTime support
 *
 * SuperJSON preserves JavaScript types through JSON serialization:
 * - Date objects serialize with type metadata and deserialize back to Date instances
 * - Luxon DateTime objects are also preserved via custom transformer
 *
 * Use `superJsonResponse()` in API routes instead of `NextResponse.json()`
 * The client-side `fetchApi()` automatically deserializes with SuperJSON
 */

import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import SuperJSON from "superjson";

// Register Luxon DateTime as a custom type
// This allows DateTime objects to survive JSON round-trips
SuperJSON.registerCustom<DateTime, string>(
	{
		isApplicable: (v): v is DateTime => DateTime.isDateTime(v),
		serialize: (dt) => dt.toISO()!,
		deserialize: (iso) => DateTime.fromISO(iso, { zone: "utc" }),
	},
	"luxon-datetime",
);

export { SuperJSON };

/**
 * Create a SuperJSON-serialized Response
 * Use this instead of `NextResponse.json()` to preserve Date and DateTime types
 *
 * @example
 * // In API route:
 * return superJsonResponse({ events, total: events.length });
 */
export function superJsonResponse<T>(data: T, init?: ResponseInit): Response {
	const { json, meta } = SuperJSON.serialize(data);

	// If there's no meta (no special types), return plain JSON for compatibility
	const body = meta ? JSON.stringify({ json, meta }) : JSON.stringify(json);

	return new Response(body, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init?.headers,
		},
	});
}

/**
 * Create a SuperJSON-serialized NextResponse
 * Convenience wrapper that returns NextResponse type for better typing in API routes
 *
 * @example
 * // In API route:
 * return superJsonNextResponse({ events, total: events.length });
 */
export function superJsonNextResponse<T>(data: T, init?: ResponseInit): NextResponse {
	const { json, meta } = SuperJSON.serialize(data);

	// If there's no meta (no special types), return plain JSON for compatibility
	const body = meta ? { json, meta } : json;

	return NextResponse.json(body, init);
}

/**
 * Parse a SuperJSON response
 * Handles both SuperJSON format (with meta) and plain JSON (without meta)
 *
 * @example
 * const response = await fetch('/api/calendar/events');
 * const data = await parseSuperJsonResponse<CalendarEvents>(response);
 */
export async function parseSuperJsonResponse<T>(response: Response): Promise<T> {
	const text = await response.text();

	try {
		const parsed = JSON.parse(text);

		// Check if this is a SuperJSON response (has json and meta properties)
		if (parsed && typeof parsed === "object" && "json" in parsed) {
			// SuperJSON format
			return SuperJSON.deserialize<T>(parsed);
		}

		// Plain JSON - return as-is
		return parsed as T;
	} catch {
		throw new Error(`Failed to parse response: ${text.slice(0, 100)}`);
	}
}

/**
 * Parse a SuperJSON string directly
 * Handles both SuperJSON format and plain JSON
 */
export function parseSuperJson<T>(text: string): T {
	try {
		const parsed = JSON.parse(text);

		// Check if this is a SuperJSON response (has json and meta properties)
		if (parsed && typeof parsed === "object" && "json" in parsed && "meta" in parsed) {
			return SuperJSON.deserialize<T>(parsed);
		}

		// Plain JSON - return as-is
		return parsed as T;
	} catch {
		throw new Error(`Failed to parse SuperJSON: ${text.slice(0, 100)}`);
	}
}
