import { Temporal } from "temporal-polyfill";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	type PlainDate,
	parsePlainDate,
	parsePlainTimeMinute,
} from "@/lib/datetime/temporal-core";
import { isValidIanaTimezone } from "./timezone-capture";
import { deriveWorkDurationMinutes } from "./work-duration";

type SplitFailureCode = "outside_period" | "nonexistent" | "ambiguous";

type SplitResult =
	| { success: true; splitTime: Date; firstDurationMinutes: number; secondDurationMinutes: number }
	| { success: false; code: SplitFailureCode };

export function resolveWorkPeriodSplit({
	startTime,
	endTime,
	splitDate,
	splitTime,
	timezone,
	disambiguation,
}: {
	startTime: Date;
	endTime: Date;
	splitDate: string | PlainDate;
	splitTime: string;
	timezone: string;
	disambiguation?: "earlier" | "later";
}): SplitResult {
	if (!isValidIanaTimezone(timezone)) return { success: false, code: "outside_period" };

	try {
		const start = instantFromDate(startTime);
		const end = instantFromDate(endTime);
		const date = typeof splitDate === "string" ? parsePlainDate(splitDate) : splitDate;
		const wallClock = date.toPlainDateTime(parsePlainTimeMinute(splitTime));
		const earlier = wallClock.toZonedDateTime(timezone, { disambiguation: "earlier" });
		const later = wallClock.toZonedDateTime(timezone, { disambiguation: "later" });
		if (
			!earlier.toPlainDateTime().equals(wallClock) ||
			!later.toPlainDateTime().equals(wallClock)
		) {
			return { success: false, code: "nonexistent" };
		}
		const candidates = [
			{ instant: earlier.toInstant(), occurrence: "earlier" as const },
			{ instant: later.toInstant(), occurrence: "later" as const },
		].filter(
			(candidate, index, all) =>
				candidate.instant.epochNanoseconds > start.epochNanoseconds &&
				candidate.instant.epochNanoseconds < end.epochNanoseconds &&
				all.findIndex(
					(item) => item.instant.epochNanoseconds === candidate.instant.epochNanoseconds,
				) === index,
		);

		if (candidates.length === 0) return { success: false, code: "outside_period" };
		if (candidates.length > 1 && !disambiguation) return { success: false, code: "ambiguous" };

		const split =
			candidates.find((candidate) => candidate.occurrence === disambiguation)?.instant ??
			candidates[0].instant;

		return {
			success: true,
			splitTime: dateFromInstant(split),
			firstDurationMinutes: Math.floor(
				Number((split.epochMilliseconds - start.epochMilliseconds) / 60_000),
			),
			secondDurationMinutes: Math.floor(
				Number((end.epochMilliseconds - split.epochMilliseconds) / 60_000),
			),
		};
	} catch {
		return { success: false, code: "outside_period" };
	}
}

export type CompletedWorkSplitSegment = {
	startAt: Instant;
	endAt: Instant;
	durationMinutes: number;
};

/**
 * Adopted split of completed work (#252 §2, #304): each segment rounds its own
 * exact UTC elapsed time half up, so a positive segment may store zero minutes.
 * A split on or outside the period's endpoints is refused.
 */
export function planCompletedWorkSplit(input: {
	startAt: Instant;
	endAt: Instant;
	splitAt: Instant;
}): { first: CompletedWorkSplitSegment; second: CompletedWorkSplitSegment } {
	return {
		first: {
			startAt: input.startAt,
			endAt: input.splitAt,
			durationMinutes: deriveWorkDurationMinutes(input.startAt, input.splitAt),
		},
		second: {
			startAt: input.splitAt,
			endAt: input.endAt,
			durationMinutes: deriveWorkDurationMinutes(input.splitAt, input.endAt),
		},
	};
}

export function getWorkPeriodSplitDates({
	startTime,
	endTime,
	timezone,
}: {
	startTime: Date;
	endTime: Date;
	timezone: string;
}): string[] {
	if (!isValidIanaTimezone(timezone)) return [];

	try {
		const endDate = instantFromDate(endTime).toZonedDateTimeISO(timezone).toPlainDate();
		let date = instantFromDate(startTime).toZonedDateTimeISO(timezone).toPlainDate();
		const dates: string[] = [];

		while (Temporal.PlainDate.compare(date, endDate) <= 0) {
			dates.push(date.toString());
			date = date.add({ days: 1 });
		}

		return dates;
	} catch {
		return [];
	}
}
