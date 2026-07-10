import { type InstantRange, localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	comparePlainDates,
	type Instant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { parseTimeZone } from "@/lib/timezone/validation";

export interface ReportDateRange extends InstantRange {
	startDate: string;
	endDate: string;
	timezone: string;
	dayCount: number;
	splitPeriod(start: Instant, end: Instant): Array<{ date: string; minutes: number }>;
}

export function resolveReportDateRange(
	startDate: string,
	endDate: string,
	timezone: string,
): ReportDateRange {
	const start = parsePlainDate(startDate);
	const end = parsePlainDate(endDate);
	const resolvedTimezone = parseTimeZone(timezone);
	if (comparePlainDates(start, end) > 0) {
		throw new RangeError("Report end date must be on or after the start date");
	}

	const instantRange = {
		start: start.toZonedDateTime(resolvedTimezone).toInstant(),
		endExclusive: end.add({ days: 1 }).toZonedDateTime(resolvedTimezone).toInstant(),
	};

	return {
		...instantRange,
		startDate,
		endDate,
		timezone: resolvedTimezone,
		dayCount: start.until(end, { largestUnit: "days" }).days + 1,
		splitPeriod(periodStart, periodEnd) {
			const clippedStart =
				compareInstants(periodStart, instantRange.start) < 0 ? instantRange.start : periodStart;
			const clippedEnd =
				compareInstants(periodEnd, instantRange.endExclusive) > 0
					? instantRange.endExclusive
					: periodEnd;
			if (compareInstants(clippedStart, clippedEnd) >= 0) return [];

			const pieces: Array<{ date: string; nanoseconds: bigint }> = [];
			let date = clippedStart.toZonedDateTimeISO(resolvedTimezone).toPlainDate();
			while (compareInstants(date.toZonedDateTime(resolvedTimezone).toInstant(), clippedEnd) < 0) {
				const day = localDayRange(date.toString(), resolvedTimezone);
				const pieceStart = compareInstants(clippedStart, day.start) > 0 ? clippedStart : day.start;
				const pieceEnd =
					compareInstants(clippedEnd, day.endExclusive) < 0 ? clippedEnd : day.endExclusive;
				if (compareInstants(pieceStart, pieceEnd) < 0) {
					pieces.push({
						date: date.toString(),
						nanoseconds: pieceEnd.epochNanoseconds - pieceStart.epochNanoseconds,
					});
				}
				date = date.add({ days: 1 });
			}
			const totalMinutes = Number(
				(clippedEnd.epochNanoseconds - clippedStart.epochNanoseconds) / BigInt(60_000_000_000),
			);
			let allocatedMinutes = 0;
			return pieces.map((piece, index) => {
				const minutes =
					index === pieces.length - 1
						? totalMinutes - allocatedMinutes
						: Number(piece.nanoseconds / BigInt(60_000_000_000));
				allocatedMinutes += minutes;
				return { date: piece.date, minutes };
			});
		},
	};
}
