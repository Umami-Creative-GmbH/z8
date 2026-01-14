import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";

/**
 * Check if a timezone string is valid
 */
export function isValidTimezone(timezone: string): boolean {
	try {
		const dt = DateTime.now().setZone(timezone);
		return dt.isValid && dt.zone.type !== "invalid";
	} catch {
		return false;
	}
}

/**
 * Synchronous version for when user and org data is already loaded.
 *
 * Resolution order:
 * 1. User's personal timezone (if set and not "UTC" or empty)
 * 2. Organization's timezone (if set and not "UTC" or empty)
 * 3. Fallback to "UTC"
 */
export function resolveEffectiveTimezone(
	userTimezone: string | null | undefined,
	orgTimezone: string | null | undefined,
): string {
	// User timezone takes precedence if explicitly set to non-UTC value
	if (userTimezone && userTimezone !== "UTC" && isValidTimezone(userTimezone)) {
		return userTimezone;
	}
	// Fall back to organization timezone
	if (orgTimezone && orgTimezone !== "UTC" && isValidTimezone(orgTimezone)) {
		return orgTimezone;
	}
	// Default fallback
	return "UTC";
}

/**
 * Async version that fetches user and org data from database.
 *
 * Resolution order:
 * 1. User's personal timezone (if set and not "UTC" or empty)
 * 2. Organization's timezone (if set and not "UTC" or empty)
 * 3. Fallback to "UTC"
 */
export async function getEffectiveTimezone(
	userId: string,
	organizationId: string,
): Promise<string> {
	// Get user timezone
	const userData = await db.query.user.findFirst({
		where: eq(user.id, userId),
		columns: { timezone: true },
	});

	// User timezone takes precedence if explicitly set
	if (userData?.timezone && userData.timezone !== "UTC") {
		if (isValidTimezone(userData.timezone)) {
			return userData.timezone;
		}
	}

	// Fall back to organization timezone
	const orgData = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});

	if (orgData?.timezone && orgData.timezone !== "UTC") {
		if (isValidTimezone(orgData.timezone)) {
			return orgData.timezone;
		}
	}

	// Default fallback
	return "UTC";
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
	const [userData, orgData] = await Promise.all([
		db.query.user.findFirst({
			where: eq(user.id, userId),
			columns: { timezone: true },
		}),
		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
			columns: { timezone: true },
		}),
	]);

	const userTimezone = userData?.timezone ?? null;
	const orgTimezone = orgData?.timezone ?? null;

	// User timezone takes precedence
	if (userTimezone && userTimezone !== "UTC" && isValidTimezone(userTimezone)) {
		return {
			effectiveTimezone: userTimezone,
			userTimezone,
			orgTimezone,
			source: "user",
		};
	}

	// Fall back to organization timezone
	if (orgTimezone && orgTimezone !== "UTC" && isValidTimezone(orgTimezone)) {
		return {
			effectiveTimezone: orgTimezone,
			userTimezone,
			orgTimezone,
			source: "organization",
		};
	}

	// Default fallback
	return {
		effectiveTimezone: "UTC",
		userTimezone,
		orgTimezone,
		source: "default",
	};
}
