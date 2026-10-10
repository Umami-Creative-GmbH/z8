import type { Temporal } from "temporal-polyfill";
import type { db as appDb } from "@/db";
import type { Instant } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";

/**
 * The organization's calendar day (#865–#870): personnel file days (document
 * dates, expiry and retention days, pay periods) are plain days of the
 * organization's timezone, never the viewer's or the server's.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/** Today's calendar day in the organization's timezone (UTC for an unknown zone). */
export function todayInOrganization(now: Instant, timezone: unknown): Temporal.PlainDate {
	const zone = resolveOrganizationTimezone(timezone).timezone;
	return now.toZonedDateTimeISO(zone).toPlainDate();
}

/** The organization's timezone and its calendar day at `now`. */
export async function loadOrganizationDay(
	database: Reader,
	input: { organizationId: string; now: Instant },
): Promise<{ timezone: string; today: Temporal.PlainDate }> {
	const timezone = await loadOrganizationTimezone(database, input.organizationId);
	return { timezone, today: todayInOrganization(input.now, timezone) };
}
