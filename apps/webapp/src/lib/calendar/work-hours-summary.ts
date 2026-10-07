import { type InstantRange, localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type {
	CalendarEvent,
	DailyWorkActualMinutes,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
	DailyWorkRequirements,
	LiveWork,
} from "./types";

interface BuildDailyWorkHoursSummariesOptions {
	dailyRequirements: DailyWorkRequirements;
	/** Completed work per local day. */
	dailyActualMinutes: DailyWorkActualMinutes;
	liveWork?: LiveWork[];
	timezone?: string | null;
	now?: Instant;
}

function getStatus(actualMinutes: number, requiredMinutes: number): DailyWorkHoursStatus {
	if (actualMinutes === 0) return "missing";
	if (actualMinutes > requiredMinutes) return "over";
	if (actualMinutes === requiredMinutes) return "met";
	return "under";
}

/**
 * Day totals: completed work plus the elapsed part of live work, split at local
 * midnight in the employee's timezone.
 */
export function buildDailyWorkHoursSummaries({
	dailyRequirements,
	dailyActualMinutes,
	liveWork = [],
	timezone,
	now = systemClock.nowInstant(),
}: BuildDailyWorkHoursSummariesOptions): DailyWorkHoursSummaries {
	const liveByDate = buildLiveDailyMinutes(liveWork, timezone, now);
	const summaries: DailyWorkHoursSummaries = new Map();
	const dateKeys = new Set([
		...Object.keys(dailyRequirements),
		...Object.keys(dailyActualMinutes),
		...Object.keys(liveByDate),
	]);

	for (const dateKey of dateKeys) {
		const requirement = dailyRequirements[dateKey];
		const includesLiveWork = dateKey in liveByDate;
		const actualMinutes = (dailyActualMinutes[dateKey] ?? 0) + (liveByDate[dateKey] ?? 0);
		// A day without required hours shows its total only once work exists.
		if (!requirement && actualMinutes <= 0 && !includesLiveWork) continue;

		summaries.set(dateKey, {
			actualMinutes,
			includesLiveWork,
			requirement: requirement
				? {
						...requirement,
						deltaMinutes: actualMinutes - requirement.requiredMinutes,
						status: getStatus(actualMinutes, requirement.requiredMinutes),
					}
				: null,
		});
	}

	return summaries;
}

/**
 * Live work counts in whole elapsed minutes, so its total changes on each
 * elapsed-minute boundary. Every local day it has reached gets an entry, even
 * one with no whole minute yet, so that day is marked live from clock-in.
 */
function buildLiveDailyMinutes(
	liveWork: LiveWork[],
	timezone: string | null | undefined,
	now: Instant,
): DailyWorkActualMinutes {
	const liveByDate: DailyWorkActualMinutes = {};
	const resolvedTimezone = timezone || "UTC";

	for (const work of liveWork) {
		const start = instantFromDate(work.startedAt);
		if (compareInstants(start, now) > 0) continue;

		const elapsedMinutes = Math.floor(start.until(now).total({ unit: "minutes" }));
		if (elapsedMinutes > 0) {
			addMinutesByLocalDay(
				liveByDate,
				start,
				start.add({ minutes: elapsedMinutes }),
				resolvedTimezone,
			);
		}
		const today = now.toZonedDateTimeISO(resolvedTimezone).toPlainDate().toString();
		liveByDate[today] ??= 0;
	}

	return liveByDate;
}

export function buildDailyActualMinutes(
	events: CalendarEvent[],
	timezone?: string | null,
	requestedRange?: { start: Date; endExclusive: Date },
): DailyWorkActualMinutes {
	const actualByDate: DailyWorkActualMinutes = {};
	const resolvedTimezone = timezone || "UTC";
	const range: InstantRange | undefined = requestedRange && {
		start: instantFromDate(requestedRange.start),
		endExclusive: instantFromDate(requestedRange.endExclusive),
	};

	for (const event of events) {
		if (event.type !== "work_period" || !event.endDate) continue;
		const eventStart = instantFromDate(event.date);
		const eventEnd = instantFromDate(event.endDate);
		const start = range && compareInstants(eventStart, range.start) < 0 ? range.start : eventStart;
		const endExclusive =
			range && compareInstants(eventEnd, range.endExclusive) > 0 ? range.endExclusive : eventEnd;
		if (compareInstants(start, endExclusive) >= 0) continue;

		addMinutesByLocalDay(actualByDate, start, endExclusive, resolvedTimezone);
	}

	return actualByDate;
}

function addMinutesByLocalDay(
	minutesByDate: DailyWorkActualMinutes,
	start: Instant,
	endExclusive: Instant,
	timezone: string,
) {
	const totalMinutes = Math.round(start.until(endExclusive).total({ unit: "minutes" }));
	let allocatedMinutes = 0;
	let segmentStart = start;
	let localDate = start.toZonedDateTimeISO(timezone).toPlainDate();

	while (compareInstants(segmentStart, endExclusive) < 0) {
		const dayEnd = localDayRange(localDate.toString(), timezone).endExclusive;
		const segmentEnd = compareInstants(dayEnd, endExclusive) < 0 ? dayEnd : endExclusive;
		const isFinalSegment = compareInstants(segmentEnd, endExclusive) === 0;
		const segmentMinutes = isFinalSegment
			? totalMinutes - allocatedMinutes
			: Math.floor(segmentStart.until(segmentEnd).total({ unit: "minutes" }));
		const dateKey = localDate.toString();
		minutesByDate[dateKey] = (minutesByDate[dateKey] ?? 0) + segmentMinutes;
		allocatedMinutes += segmentMinutes;
		segmentStart = segmentEnd;
		localDate = localDate.add({ days: 1 });
	}
}

export function formatTimeHours(minutes: number): string {
	const safeMinutes = Math.max(0, Math.round(minutes));
	const hours = Math.floor(safeMinutes / 60);
	const mins = safeMinutes % 60;
	return `${hours}:${String(mins).padStart(2, "0")}h`;
}

export function formatSignedMinutes(minutes: number): string {
	const sign = minutes >= 0 ? "+" : "-";
	return `${sign}${formatTimeHours(Math.abs(minutes))}`;
}
