import { Temporal } from "temporal-polyfill";
import type { Instant } from "@/lib/datetime/temporal-core";

type CutoffInput = Instant | string;

function toInstant(cutoff: CutoffInput): Instant {
	return typeof cutoff === "string" ? Temporal.Instant.from(cutoff) : cutoff;
}

/**
 * Formats a departure cutoff in the zone frozen on the departure, never the
 * viewer's zone, so every viewer sees the same organization-local instant.
 */
export function formatDepartureCutoff(
	cutoff: CutoffInput,
	timezone: string,
	locale: string,
): string {
	return toInstant(cutoff).toLocaleString(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: timezone,
	});
}

/** The calendar date of the cutoff in the departure's zone, as YYYY-MM-DD. */
export function departureCutoffDate(cutoff: CutoffInput, timezone: string): string {
	return toInstant(cutoff).toZonedDateTimeISO(timezone).toPlainDate().toString();
}
