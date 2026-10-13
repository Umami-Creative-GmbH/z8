import {
	type Instant,
	instantToCanonicalString,
	type PlainDate,
	parseInstant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import {
	type DateTimeFormatPreset,
	formatInstant,
	formatPlainDate,
	formatPlainDateRange,
	localeDefaultTimeFormat,
	offsetMinutesToTimeZoneId,
	type PlainDateFormatPreset,
} from "@/lib/datetime/temporal-format";
import { formatMoney } from "@/lib/travel-expenses/format";

/**
 * Typed notification params (#1149): raw values in `metadata.i18n.params` that every
 * channel formats in the recipient language when it delivers, instead of text a
 * creator formatted once in one language. They are plain JSON, so they survive the
 * `notification.metadata` text column, and they carry their own zone context: no
 * channel ever falls back to the server's or the reader's timezone.
 *
 * - `plainDate` / `plainDateRange`: calendar days, shown as plain dates.
 * - `entryInstant`: a time from a `time_entry`, shown at that entry's stored offset.
 * - `zonedInstant`: any other instant, shown in the given (organization) zone with
 *   the zone printed.
 * - `duration`: whole minutes, shown as hours and minutes.
 * - `money`: a decimal string amount with its ISO currency.
 *
 * Client-safe (no database): the in-app inbox formats these in the browser.
 */
export type TypedNotificationParam =
	| { kind: "plainDate"; date: string; preset?: PlainDateFormatPreset }
	| { kind: "plainDateRange"; start: string; end: string; preset?: PlainDateFormatPreset }
	| { kind: "entryInstant"; at: string; utcOffsetMinutes: number; preset?: DateTimeFormatPreset }
	| {
			kind: "zonedInstant";
			at: string;
			timeZone: string;
			preset?: DateTimeFormatPreset;
			/** False when the message names the zone itself (a `{timezone}` param). */
			printZone?: false;
	  }
	| { kind: "duration"; minutes: number }
	| { kind: "money"; amount: string; currency: string };

/** A value a notification creator may put into `metadata.i18n.params`. */
export type NotificationParamValue =
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| TypedNotificationParam;

/** What ICU / Tolgee `t()` receives: never a `Date` or Temporal value. */
export type FormattedNotificationParam = string | number | bigint;

export interface NotificationParamFormatContext {
	locale: string;
	/** The recipient's hour cycle; the locale's own convention when unknown. */
	timeFormat?: "12h" | "24h";
}

const DATE_TIME_PRESETS: ReadonlySet<string> = new Set<DateTimeFormatPreset>([
	"dateShort",
	"dateMedium",
	"dateTimeMedium",
	"time",
	"timeWithSeconds",
]);
const PLAIN_DATE_PRESETS: ReadonlySet<string> = new Set<PlainDateFormatPreset>([
	"dateShort",
	"dateMedium",
	"monthDay",
	"monthDayLong",
	"monthLong",
	"monthYear",
	"weekdayShort",
	"weekdayMonthDay",
	"weekdayMonthDayLong",
	"weekdayDateLong",
]);

/** Builders for typed params; each returns the JSON value stored in the metadata. */
export const notificationParam = {
	plainDate(date: PlainDate, preset?: PlainDateFormatPreset): TypedNotificationParam {
		return { kind: "plainDate", date: date.toString(), ...(preset ? { preset } : {}) };
	},
	plainDateRange(
		start: PlainDate,
		end: PlainDate,
		preset?: PlainDateFormatPreset,
	): TypedNotificationParam {
		return {
			kind: "plainDateRange",
			start: start.toString(),
			end: end.toString(),
			...(preset ? { preset } : {}),
		};
	},
	/** A `time_entry` time at the entry's stored UTC offset. */
	entryInstant(
		at: Instant,
		utcOffsetMinutes: number,
		preset?: DateTimeFormatPreset,
	): TypedNotificationParam {
		offsetMinutesToTimeZoneId(utcOffsetMinutes);
		return {
			kind: "entryInstant",
			at: instantToCanonicalString(at),
			utcOffsetMinutes,
			...(preset ? { preset } : {}),
		};
	},
	/**
	 * Any other instant, in `timeZone` (normally the organization's), zone printed
	 * unless the message names the zone itself (`printZone: false`).
	 */
	zonedInstant(
		at: Instant,
		timeZone: string,
		preset?: DateTimeFormatPreset,
		options: { printZone?: boolean } = {},
	): TypedNotificationParam {
		return {
			kind: "zonedInstant",
			at: instantToCanonicalString(at),
			timeZone,
			...(preset ? { preset } : {}),
			...(options.printZone === false ? { printZone: false as const } : {}),
		};
	},
	duration(minutes: number): TypedNotificationParam {
		if (!Number.isSafeInteger(minutes)) throw new RangeError("Duration must be whole minutes");
		return { kind: "duration", minutes };
	},
	/** `amount` is the stored decimal string, so no float can change a digit. */
	money(amount: string, currency: string): TypedNotificationParam {
		return { kind: "money", amount, currency };
	},
} as const;

/** A plain object, as notification metadata and its params are. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalPreset(value: unknown, presets: ReadonlySet<string>): boolean {
	return value === undefined || (typeof value === "string" && presets.has(value));
}

export function isTypedNotificationParam(value: unknown): value is TypedNotificationParam {
	if (!isRecord(value)) return false;
	switch (value.kind) {
		case "plainDate":
			return typeof value.date === "string" && optionalPreset(value.preset, PLAIN_DATE_PRESETS);
		case "plainDateRange":
			return (
				typeof value.start === "string" &&
				typeof value.end === "string" &&
				optionalPreset(value.preset, PLAIN_DATE_PRESETS)
			);
		case "entryInstant":
			return (
				typeof value.at === "string" &&
				typeof value.utcOffsetMinutes === "number" &&
				optionalPreset(value.preset, DATE_TIME_PRESETS)
			);
		case "zonedInstant":
			return (
				typeof value.at === "string" &&
				typeof value.timeZone === "string" &&
				optionalPreset(value.preset, DATE_TIME_PRESETS) &&
				(value.printZone === undefined || value.printZone === false)
			);
		case "duration":
			return typeof value.minutes === "number";
		case "money":
			return typeof value.amount === "string" && typeof value.currency === "string";
		default:
			return false;
	}
}

function formatDuration(totalMinutes: number, locale: string): string {
	const minutes = Math.abs(Math.round(totalMinutes));
	const unit = (value: number, name: "hour" | "minute") =>
		new Intl.NumberFormat(locale, { style: "unit", unit: name, unitDisplay: "long" }).format(value);
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	const text =
		hours === 0
			? unit(rest, "minute")
			: rest === 0
				? unit(hours, "hour")
				: `${unit(hours, "hour")} ${unit(rest, "minute")}`;
	return totalMinutes < 0 ? `-${text}` : text;
}

/** The stored raw value, shown when a typed param cannot be formatted. */
function rawText(param: TypedNotificationParam): string {
	switch (param.kind) {
		case "plainDate":
			return param.date;
		case "plainDateRange":
			return `${param.start} – ${param.end}`;
		case "entryInstant":
		case "zonedInstant":
			return param.at;
		case "duration":
			return String(param.minutes);
		case "money":
			return `${param.amount} ${param.currency}`;
	}
}

/** One typed param as text in the reader's locale. */
export function formatNotificationParam(
	param: TypedNotificationParam,
	context: NotificationParamFormatContext,
): string {
	const { locale } = context;
	const timeFormat = context.timeFormat ?? localeDefaultTimeFormat(locale);
	try {
		switch (param.kind) {
			case "plainDate":
				return formatPlainDate(parsePlainDate(param.date), locale, param.preset ?? "dateMedium");
			case "plainDateRange":
				return formatPlainDateRange(
					parsePlainDate(param.start),
					parsePlainDate(param.end),
					locale,
					param.preset ?? "dateMedium",
				);
			case "entryInstant":
				return formatInstant(
					parseInstant(param.at),
					{ locale, timeFormat, timezone: offsetMinutesToTimeZoneId(param.utcOffsetMinutes) },
					param.preset ?? "dateTimeMedium",
				);
			case "zonedInstant": {
				const text = formatInstant(
					parseInstant(param.at),
					{ locale, timeFormat, timezone: param.timeZone },
					param.preset ?? "dateTimeMedium",
				);
				return param.printZone === false ? text : `${text} (${param.timeZone})`;
			}
			case "duration":
				return formatDuration(param.minutes, locale);
			case "money":
				return formatMoney(locale, param.amount, param.currency);
		}
	} catch {
		return rawText(param);
	}
}

/**
 * The params for ICU / `t()` in the reader's locale: typed params become text, plain
 * strings and numbers pass through, a legacy `Date` becomes its UTC ISO string (it
 * has no zone context to be formatted in), and anything else is dropped.
 */
export function formatNotificationParams(
	params: Record<string, unknown> | undefined,
	context: NotificationParamFormatContext,
): Record<string, FormattedNotificationParam> {
	const formatted: Record<string, FormattedNotificationParam> = {};
	if (!isRecord(params)) return formatted;
	for (const [key, value] of Object.entries(params)) {
		if (typeof value === "string" || typeof value === "bigint") formatted[key] = value;
		else if (typeof value === "number") {
			if (Number.isFinite(value)) formatted[key] = value;
		} else if (value instanceof Date) {
			if (Number.isFinite(value.getTime())) formatted[key] = value.toISOString();
		} else if (isTypedNotificationParam(value)) {
			formatted[key] = formatNotificationParam(value, context);
		}
	}
	return formatted;
}

/**
 * `params` with only its typed params replaced by their text in the reader's locale;
 * every other value is kept as it is, for readers with their own value rules.
 */
export function withFormattedTypedParams(
	params: Record<string, unknown>,
	context: NotificationParamFormatContext,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [
			key,
			isTypedNotificationParam(value) ? formatNotificationParam(value, context) : value,
		]),
	);
}

/** True when `params` holds at least one typed param. */
export function hasTypedNotificationParams(params: unknown): boolean {
	return isRecord(params) && Object.values(params).some(isTypedNotificationParam);
}

/**
 * Fills `{name}` placeholders of a stored English default (the notification's
 * `title`/`message` fallback, also used by webhooks) with params formatted in `en`.
 * Unknown placeholders stay as written.
 */
export function fillNotificationTemplate(
	template: string,
	params: Record<string, unknown> | undefined,
): string {
	const formatted = formatNotificationParams(params, { locale: "en" });
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
		Object.hasOwn(formatted, name) ? String(formatted[name]) : placeholder,
	);
}
