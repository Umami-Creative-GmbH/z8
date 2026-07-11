import { instantFromDate } from "@/lib/datetime/temporal-core";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";

export type TimeEntryTimezoneSource =
	| "browser"
	| "user_setting"
	| "manager_target_user_setting"
	| "historical_inference"
	| "backfill";

export interface TimeEntryTimezoneCapture {
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: TimeEntryTimezoneSource;
}

export function isValidIanaTimezone(timezone: string | null | undefined): timezone is string {
	return isValidIanaTimeZone(timezone);
}

export function getUtcOffsetMinutesForZone(timestamp: Date, timezone: string): number {
	if (!isValidIanaTimezone(timezone)) {
		return 0;
	}

	try {
		return (
			instantFromDate(timestamp).toZonedDateTimeISO(timezone).offsetNanoseconds / 60_000_000_000
		);
	} catch {
		return 0;
	}
}

export function formatUtcOffset(offsetMinutes: number): string {
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(offsetMinutes);
	const hours = Math.floor(absoluteMinutes / 60)
		.toString()
		.padStart(2, "0");
	const minutes = (absoluteMinutes % 60).toString().padStart(2, "0");

	return `UTC${sign}${hours}:${minutes}`;
}

export function getBrowserTimezone(
	intlApi?: Pick<typeof Intl, "DateTimeFormat"> | null,
): string | null {
	try {
		if (intlApi === null) {
			return null;
		}

		const activeIntl = intlApi ?? globalThis.Intl;

		if (!activeIntl) {
			return null;
		}

		const timezone = activeIntl.DateTimeFormat().resolvedOptions().timeZone;
		return isValidIanaTimezone(timezone) ? timezone : null;
	} catch {
		return null;
	}
}

export function resolveTimeEntryTimezoneCapture({
	timestamp,
	browserTimezone,
	fallbackTimezone,
	browserSource,
	fallbackSource,
}: {
	timestamp: Date;
	browserTimezone?: string | null;
	fallbackTimezone: string;
	browserSource: Extract<TimeEntryTimezoneSource, "browser">;
	fallbackSource: Exclude<TimeEntryTimezoneSource, "browser" | "backfill">;
}): TimeEntryTimezoneCapture {
	const timezone = isValidIanaTimezone(browserTimezone)
		? browserTimezone
		: isValidIanaTimezone(fallbackTimezone)
			? fallbackTimezone
			: "UTC";
	const timezoneSource = timezone === browserTimezone ? browserSource : fallbackSource;

	return {
		timezone,
		timezoneSource,
		utcOffsetMinutes: getUtcOffsetMinutesForZone(timestamp, timezone),
	};
}

export function resolveFallbackTimezoneCapture({
	timestamp,
	timezone,
	timezoneSource,
}: {
	timestamp: Date;
	timezone: string;
	timezoneSource: Exclude<TimeEntryTimezoneSource, "browser">;
}): TimeEntryTimezoneCapture {
	const validTimezone = isValidIanaTimezone(timezone) ? timezone : "UTC";

	return {
		timezone: validTimezone,
		timezoneSource,
		utcOffsetMinutes: getUtcOffsetMinutesForZone(timestamp, validTimezone),
	};
}
