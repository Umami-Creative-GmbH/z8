import { type InstantRange, localDayRange } from "@/lib/datetime/temporal-boundaries";
import { compareInstants, instantFromDate } from "@/lib/datetime/temporal-core";
import type {
	CalendarEvent,
	DailyWorkActualMinutes,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
	DailyWorkRequirements,
} from "./types";

interface BuildDailyWorkHoursSummariesOptions {
	events: CalendarEvent[];
	dailyRequirements: DailyWorkRequirements;
	dailyActualMinutes?: DailyWorkActualMinutes;
}

function getStatus(actualMinutes: number, requiredMinutes: number): DailyWorkHoursStatus {
	if (actualMinutes === 0) return "missing";
	if (actualMinutes > requiredMinutes) return "over";
	if (actualMinutes === requiredMinutes) return "met";
	return "under";
}

export function buildDailyWorkHoursSummaries({
	events,
	dailyRequirements,
	dailyActualMinutes,
}: BuildDailyWorkHoursSummariesOptions): DailyWorkHoursSummaries {
	const actualByDate = dailyActualMinutes ?? buildDailyActualMinutes(events);

	const summaries: DailyWorkHoursSummaries = new Map();

	for (const [dateKey, requirement] of Object.entries(dailyRequirements)) {
		const actualMinutes = actualByDate[dateKey] ?? 0;
		const deltaMinutes = actualMinutes - requirement.requiredMinutes;
		summaries.set(dateKey, {
			...requirement,
			actualMinutes,
			deltaMinutes,
			status: getStatus(actualMinutes, requirement.requiredMinutes),
		});
	}

	return summaries;
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

		const totalMinutes = Math.round(start.until(endExclusive).total({ unit: "minutes" }));
		let allocatedMinutes = 0;
		let segmentStart = start;
		let localDate = start.toZonedDateTimeISO(resolvedTimezone).toPlainDate();

		while (compareInstants(segmentStart, endExclusive) < 0) {
			const dayEnd = localDayRange(localDate.toString(), resolvedTimezone).endExclusive;
			const segmentEnd = compareInstants(dayEnd, endExclusive) < 0 ? dayEnd : endExclusive;
			const isFinalSegment = compareInstants(segmentEnd, endExclusive) === 0;
			const segmentMinutes = isFinalSegment
				? totalMinutes - allocatedMinutes
				: Math.floor(segmentStart.until(segmentEnd).total({ unit: "minutes" }));
			const dateKey = localDate.toString();
			actualByDate[dateKey] = (actualByDate[dateKey] ?? 0) + segmentMinutes;
			allocatedMinutes += segmentMinutes;
			segmentStart = segmentEnd;
			localDate = localDate.add({ days: 1 });
		}
	}

	return actualByDate;
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
