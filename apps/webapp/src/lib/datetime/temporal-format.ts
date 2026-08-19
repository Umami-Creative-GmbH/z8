import * as TemporalPolyfill from "temporal-polyfill";
import { parseTimeZone } from "../timezone/validation";
import type { Instant, PlainDate } from "./temporal-core";

export type DateTimeFormatPreset =
	| "dateShort"
	| "dateMedium"
	| "dateTimeMedium"
	| "time"
	| "timeWithSeconds";

export type PlainDateFormatPreset =
	| "dateShort"
	| "dateMedium"
	| "monthDay"
	| "monthDayLong"
	| "monthYear"
	| "weekdayShort";

export interface DisplayContext {
	locale: string;
	timezone: string;
	timeFormat: "12h" | "24h";
}

export interface LocalMinuteFields {
	date: string;
	time: string;
}

// temporal-spec 1.0.0 declares this runtime export as a namespace without its constructor value.
const TemporalDateTimeFormat = (
	TemporalPolyfill as unknown as {
		Intl: {
			DateTimeFormat: new (
				locale: string,
				options: Intl.DateTimeFormatOptions,
			) => { format(value: Instant | PlainDate): string };
		};
	}
).Intl.DateTimeFormat;

const DATE_TIME_FORMAT_OPTIONS: Readonly<Record<DateTimeFormatPreset, Intl.DateTimeFormatOptions>> =
	{
		dateShort: { year: "numeric", month: "numeric", day: "numeric" },
		dateMedium: { year: "numeric", month: "short", day: "numeric" },
		dateTimeMedium: {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		},
		time: { hour: "numeric", minute: "2-digit" },
		timeWithSeconds: { hour: "numeric", minute: "2-digit", second: "2-digit" },
	};

const PLAIN_DATE_FORMAT_OPTIONS: Readonly<
	Record<PlainDateFormatPreset, Intl.DateTimeFormatOptions>
> = {
	dateShort: { year: "numeric", month: "numeric", day: "numeric" },
	dateMedium: { year: "numeric", month: "short", day: "numeric" },
	monthDay: { month: "short", day: "numeric" },
	monthDayLong: { month: "long", day: "numeric" },
	monthYear: { year: "numeric", month: "long" },
	weekdayShort: { weekday: "short" },
};

const TIME_PRESETS: ReadonlySet<DateTimeFormatPreset> = new Set([
	"dateTimeMedium",
	"time",
	"timeWithSeconds",
]);
const MAX_FIXED_OFFSET_MINUTES = 23 * 60 + 59;

export function formatInstant(
	instant: Instant,
	context: DisplayContext,
	preset: DateTimeFormatPreset,
): string {
	const timezone = parseTimeZone(context.timezone);
	const options: Intl.DateTimeFormatOptions = {
		...DATE_TIME_FORMAT_OPTIONS[preset],
		timeZone: timezone,
		...(TIME_PRESETS.has(preset) ? { hour12: context.timeFormat === "12h" } : {}),
	};

	return new TemporalDateTimeFormat(context.locale, options).format(instant);
}

export function getInstantLocalMinuteFields(
	instant: Instant,
	timezone: string,
): LocalMinuteFields {
	const local = instant.toZonedDateTimeISO(parseTimeZone(timezone));
	return {
		date: local.toPlainDate().toString(),
		time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
	};
}

export function formatPlainDate(
	date: PlainDate,
	locale: string,
	preset: PlainDateFormatPreset,
): string {
	return new TemporalDateTimeFormat(locale, PLAIN_DATE_FORMAT_OPTIONS[preset]).format(date);
}

export function formatUtcOffset(offsetMinutes: number): string {
	return `UTC${offsetMinutesToTimeZoneId(offsetMinutes)}`;
}

export function offsetMinutesToTimeZoneId(offsetMinutes: number): string {
	if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > MAX_FIXED_OFFSET_MINUTES) {
		throw new RangeError("UTC offset must be an integer from -1439 through 1439 minutes");
	}

	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(offsetMinutes);
	const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
	const minutes = String(absoluteMinutes % 60).padStart(2, "0");
	const timezone = `${sign}${hours}:${minutes}`;

	parseTimeZone(timezone);
	return timezone;
}

export function formatCapturedOffsetInstant(
	instant: Instant,
	context: {
		locale: string;
		timeFormat: "12h" | "24h";
		offsetMinutes: number;
		preset?: DateTimeFormatPreset;
	},
): string {
	return formatInstant(
		instant,
		{
			locale: context.locale,
			timeFormat: context.timeFormat,
			timezone: offsetMinutesToTimeZoneId(context.offsetMinutes),
		},
		context.preset ?? "dateTimeMedium",
	);
}
