import { Temporal } from "temporal-polyfill";

export type Instant = InstanceType<typeof Temporal.Instant>;
export type PlainDate = InstanceType<typeof Temporal.PlainDate>;
export type PlainTime = InstanceType<typeof Temporal.PlainTime>;
export type ZonedDateTime = InstanceType<typeof Temporal.ZonedDateTime>;

export interface Clock {
	nowInstant(): Instant;
}

export const systemClock: Readonly<Clock> = Object.freeze({
	nowInstant: () =>
		Temporal.Now.instant().round({
			smallestUnit: "millisecond",
			roundingMode: "trunc",
		}),
});

const INSTANT_WITH_OFFSET =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLAIN_TIME_MINUTE = /^\d{2}:\d{2}$/;
const JS_DATE_LIMIT_MS = 8_640_000_000_000_000;
const NANOSECONDS_PER_MILLISECOND = BigInt(1_000_000);

export function parseInstant(value: string): Instant {
	if (typeof value !== "string" || !INSTANT_WITH_OFFSET.test(value)) {
		throw new RangeError(
			"Instant must use a four-digit date and an explicit Z or +/-HH:mm offset",
		);
	}

	return Temporal.Instant.from(value);
}

export function parsePlainDate(value: string): PlainDate {
	if (typeof value !== "string" || !PLAIN_DATE.test(value)) {
		throw new RangeError("Plain date must use YYYY-MM-DD");
	}

	return Temporal.PlainDate.from(value, { overflow: "reject" });
}

export function parsePlainTimeMinute(value: string): PlainTime {
	if (typeof value !== "string" || !PLAIN_TIME_MINUTE.test(value)) {
		throw new RangeError("Plain time must use HH:mm");
	}

	return Temporal.PlainTime.from(value, { overflow: "reject" });
}

export function instantFromDate(value: Date): Instant {
	const epochMilliseconds = value.getTime();
	if (!Number.isFinite(epochMilliseconds)) {
		throw new RangeError("Cannot convert an invalid Date to an instant");
	}

	return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
}

export function dateFromInstant(value: Instant): Date {
	if (value.epochNanoseconds % NANOSECONDS_PER_MILLISECOND !== BigInt(0)) {
		throw new RangeError("Instant contains precision below milliseconds");
	}

	const epochMilliseconds = value.epochMilliseconds;
	if (
		!Number.isFinite(epochMilliseconds) ||
		Math.abs(epochMilliseconds) > JS_DATE_LIMIT_MS
	) {
		throw new RangeError("Instant is outside the JavaScript Date range");
	}

	const date = new Date(epochMilliseconds);
	if (!Number.isFinite(date.getTime())) {
		throw new RangeError("Instant is outside the JavaScript Date range");
	}

	return date;
}

export function compareInstants(left: Instant, right: Instant): number {
	return Temporal.Instant.compare(left, right);
}

export function comparePlainDates(left: PlainDate, right: PlainDate): number {
	return Temporal.PlainDate.compare(left, right);
}
