import { Temporal } from "temporal-polyfill";
import { instantFromDB, instantToDB } from "@/lib/datetime/drizzle-adapter";
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	instantToCanonicalString,
	type PlainDate,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { parseIanaTimeZone } from "@/lib/timezone/validation";

const RFC3339_WITH_EXPLICIT_OFFSET =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_WORK_PERIOD_DURATION = Temporal.Duration.from({ hours: 24 });

export interface TimeCorrectionTemporalEndpoint {
	readonly id: string;
	readonly instant: Instant;
	readonly utcOffsetMinutes: number;
	readonly timezone: string;
}

export interface CalculateTimeCorrectionPeriodInput {
	readonly action: "edit" | "delete";
	readonly originalClockIn: TimeCorrectionTemporalEndpoint;
	readonly originalClockOut: TimeCorrectionTemporalEndpoint | null;
	readonly correctedClockIn: TimeCorrectionTemporalEndpoint | null;
	readonly correctedClockOut: TimeCorrectionTemporalEndpoint | null;
}

export interface TimeCorrectionTemporalPeriod {
	readonly clockIn: TimeCorrectionTemporalEndpoint;
	readonly clockOut: TimeCorrectionTemporalEndpoint | null;
	readonly durationMinutes: number | null;
	readonly isDeletion: boolean;
}

export function instantFromTimeCorrectionBoundary(
	value: Date | string,
): Instant {
	if (typeof value === "string") return parseInstant(value);
	const instant = instantFromDB(value);
	if (!instant) throw new RangeError("Time correction timestamp is required");
	return instant;
}

export function instantToTimeCorrectionDate(value: Instant): Date {
	const date = instantToDB(value);
	if (!date) throw new RangeError("Time correction timestamp is required");
	return date;
}

export function serializeTimeCorrectionInstant(value: Instant): string {
	return instantToCanonicalString(value);
}

export function validateTimeCorrectionTimezoneEvidence(
	endpoint: Pick<
		TimeCorrectionTemporalEndpoint,
		"instant" | "timezone" | "utcOffsetMinutes"
	>,
): void {
	const timezone = parseIanaTimeZone(endpoint.timezone);
	if (!Number.isInteger(endpoint.utcOffsetMinutes)) {
		throw new RangeError(
			"Timezone offset must be an integer number of minutes",
		);
	}
	const expectedOffsetMinutes =
		endpoint.instant.toZonedDateTimeISO(timezone).offsetNanoseconds /
		60_000_000_000;
	if (expectedOffsetMinutes !== endpoint.utcOffsetMinutes) {
		throw new RangeError("Timezone offset does not match the event instant");
	}
}

export function parseTimeCorrectionRfc3339Evidence(
	timestamp: string,
	timezone: string,
): Pick<
	TimeCorrectionTemporalEndpoint,
	"instant" | "timezone" | "utcOffsetMinutes"
> {
	const parsed = parseTimeCorrectionRfc3339(timestamp);
	const evidence = { ...parsed, timezone };
	validateTimeCorrectionTimezoneEvidence(evidence);
	return evidence;
}

export function parseTimeCorrectionRfc3339(
	timestamp: string,
): Pick<TimeCorrectionTemporalEndpoint, "instant" | "utcOffsetMinutes"> {
	if (!RFC3339_WITH_EXPLICIT_OFFSET.test(timestamp)) {
		throw new RangeError(
			"Timestamp must be a valid RFC3339 value with an explicit offset",
		);
	}
	const instant = parseInstant(timestamp);
	const offset = timestamp.endsWith("Z") ? "Z" : timestamp.slice(-6);
	const utcOffsetMinutes =
		offset === "Z"
			? 0
			: (offset[0] === "-" ? -1 : 1) *
				(Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
	return { instant, utcOffsetMinutes };
}

export function validateTimeCorrectionRange(
	clockIn: Instant,
	clockOut: Instant | null,
): void {
	if (clockOut && compareInstants(clockIn, clockOut) >= 0) {
		throw new RangeError("Clock out time must be after clock in time");
	}
	if (
		clockOut &&
		Temporal.Duration.compare(
			clockIn.until(clockOut),
			MAX_WORK_PERIOD_DURATION,
		) > 0
	) {
		throw new RangeError("Work period cannot exceed 24 hours");
	}
}

export function calculateTimeCorrectionPeriod(
	input: CalculateTimeCorrectionPeriodInput,
): TimeCorrectionTemporalPeriod {
	if (input.action === "delete") {
		if (!input.originalClockOut) {
			throw new RangeError("Deletion requires a completed work period");
		}
		if (!input.correctedClockIn || !input.correctedClockOut) {
			throw new RangeError("Deletion requires both correction endpoints");
		}
		if (
			compareInstants(
				input.correctedClockIn.instant,
				input.correctedClockOut.instant,
			) !== 0
		) {
			throw new RangeError("Deletion requires matching correction timestamps");
		}
		return {
			clockIn: input.correctedClockIn,
			clockOut: input.correctedClockOut,
			durationMinutes: 0,
			isDeletion: true,
		};
	}

	const clockIn = input.correctedClockIn ?? input.originalClockIn;
	const clockOut = input.correctedClockOut ?? input.originalClockOut;
	validateTimeCorrectionRange(clockIn.instant, clockOut?.instant ?? null);
	return {
		clockIn,
		clockOut,
		durationMinutes: clockOut
			? Math.floor(clockIn.instant.until(clockOut.instant).total("minutes"))
			: null,
		isDeletion: false,
	};
}

export function dirtyFromDateForTimeCorrection(
	endpoints: readonly Pick<
		TimeCorrectionTemporalEndpoint,
		"instant" | "timezone" | "utcOffsetMinutes"
	>[],
): string | null {
	let earliest: PlainDate | null = null;
	for (const endpoint of endpoints) {
		validateTimeCorrectionTimezoneEvidence(endpoint);
		const localDate = endpoint.instant
			.toZonedDateTimeISO(parseIanaTimeZone(endpoint.timezone))
			.toPlainDate();
		if (!earliest || comparePlainDates(localDate, earliest) < 0)
			earliest = localDate;
	}
	return earliest?.toString() ?? null;
}
