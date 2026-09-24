/**
 * Formats a departure cutoff in the zone frozen on the departure, never the
 * viewer's zone, so every viewer sees the same organization-local instant.
 */
export function formatDepartureCutoff(cutoff: string, timezone: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: timezone,
	}).format(new Date(cutoff));
}

/** The calendar date of an instant in the given zone, as YYYY-MM-DD. */
export function zonedDate(instant: string, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(instant));
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((candidate) => candidate.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}
