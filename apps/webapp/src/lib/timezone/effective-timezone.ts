import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { userSettings } from "@/db/schema";
import { type InvalidTimezoneCandidate, resolvePersonalTimezone } from "./resolve-timezone";
import { isValidIanaTimeZone } from "./validation";

function warnInvalidTimezoneCandidates(invalidCandidates: InvalidTimezoneCandidate[]): void {
	if (invalidCandidates.length > 0) {
		console.warn("Invalid persisted timezone candidates", { invalidCandidates });
	}
}

/**
 * Check if a timezone string is valid
 */
export function isValidTimezone(timezone: string): boolean {
	return isValidIanaTimeZone(timezone);
}

/**
 * Synchronous version for when user and org data is already loaded.
 *
 * Resolution order:
 * 1. User's personal timezone (if valid and set)
 * 2. Organization's timezone (if valid and set)
 * 3. Fallback to "UTC"
 */
export function resolveEffectiveTimezone(
	userTimezone: string | null | undefined,
	orgTimezone: string | null | undefined,
): string {
	return resolvePersonalTimezone({
		userTimezone,
		organizationTimezone: orgTimezone,
	}).timezone;
}

/**
 * Async version that fetches user and org data from database.
 *
 * Resolution order:
 * 1. User's personal timezone (if valid and set)
 * 2. Organization's timezone (if valid and set)
 * 3. Fallback to "UTC"
 */
export async function getEffectiveTimezone(
	userId: string,
	organizationId: string,
): Promise<string> {
	// Get user timezone from userSettings
	const settingsData = await db.query.userSettings.findFirst({
		where: eq(userSettings.userId, userId),
		columns: { timezone: true },
	});

	const userResolution = resolvePersonalTimezone({ userTimezone: settingsData?.timezone });
	if (userResolution.source === "user") {
		return userResolution.timezone;
	}

	// Fall back to organization timezone
	const orgData = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});

	const resolution = resolvePersonalTimezone({
		userTimezone: settingsData?.timezone,
		organizationTimezone: orgData?.timezone,
	});
	warnInvalidTimezoneCandidates(resolution.invalidCandidates);
	return resolution.timezone;
}

/**
 * Get effective timezone with both user and org data in a single query.
 * More efficient when you need to fetch both anyway.
 */
export async function getEffectiveTimezoneWithContext(
	userId: string,
	organizationId: string,
): Promise<{
	effectiveTimezone: string;
	userTimezone: string | null;
	orgTimezone: string | null;
	source: "user" | "organization" | "default";
}> {
	// Fetch both in parallel
	const [settingsData, orgData] = await Promise.all([
		db.query.userSettings.findFirst({
			where: eq(userSettings.userId, userId),
			columns: { timezone: true },
		}),
		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { timezone: true },
		}),
	]);

	const userTimezone = settingsData?.timezone ?? null;
	const orgTimezone = orgData?.timezone ?? null;

	const resolution = resolvePersonalTimezone({
		userTimezone: settingsData?.timezone,
		organizationTimezone: orgData?.timezone,
	});
	warnInvalidTimezoneCandidates(resolution.invalidCandidates);

	return {
		effectiveTimezone: resolution.timezone,
		userTimezone,
		orgTimezone,
		source: resolution.source,
	};
}
