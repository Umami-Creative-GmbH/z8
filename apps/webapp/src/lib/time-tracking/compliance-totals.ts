import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import {
	type InstantRange,
	localDayRange,
	localWeekRange,
	type WeekStartDay,
} from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";

/** The worked and break minutes the working-time rules check one piece of work against. */
export type ComplianceTotals = {
	/** Work starting on the work's local day, the work itself included. */
	dailyMinutes: number;
	/** Work starting in the work's local week, the work itself included. */
	weeklyMinutes: number;
	/** Gaps of more than a minute between the day's consecutive periods. */
	breakMinutes: number;
};

export type ComplianceTotalsPeriod = {
	start: Instant;
	end: Instant | null;
	durationMinutes: number | null;
};

function startsWithin(period: ComplianceTotalsPeriod, range: InstantRange): boolean {
	return (
		compareInstants(period.start, range.start) >= 0 &&
		compareInstants(period.start, range.endExclusive) < 0
	);
}

/** Totals a set of periods for one local day and the week containing it. */
export function complianceTotalsOf(
	periods: readonly ComplianceTotalsPeriod[],
	ranges: { day: InstantRange; week: InstantRange },
): ComplianceTotals {
	const inWeek = periods.filter((period) => startsWithin(period, ranges.week));
	const inDay = inWeek
		.filter((period) => startsWithin(period, ranges.day))
		.sort((left, right) => compareInstants(left.start, right.start));
	const minutes = (list: readonly ComplianceTotalsPeriod[]) =>
		list.reduce((total, period) => total + (period.durationMinutes ?? 0), 0);

	let breakMinutes = 0;
	for (let index = 0; index < inDay.length - 1; index += 1) {
		const currentEnd = inDay[index].end;
		if (!currentEnd) continue;
		const gapMinutes = Math.floor(
			currentEnd.until(inDay[index + 1].start).total({ unit: "minutes" }),
		);
		if (gapMinutes > 1) breakMinutes += gapMinutes;
	}

	return { dailyMinutes: minutes(inDay), weeklyMinutes: minutes(inWeek), breakMinutes };
}

/**
 * The compliance totals around one piece of work, read by employee and
 * organization rather than from a request session, so they hold for on-behalf,
 * bot, API and worker closures alike. The work's own local day and week in its
 * zone are evaluated, not the current ones: a late or retried check still
 * judges the day the work happened.
 */
export async function readComplianceTotals(input: {
	organizationId: string;
	employeeId: string;
	/** Where the work started; it picks the local day and week. */
	workStart: Instant;
	timezone: string;
	/** The self-service summary's week, which compliance has always used. */
	weekStartDay?: WeekStartDay;
}): Promise<ComplianceTotals> {
	const localDate = input.workStart.toZonedDateTimeISO(input.timezone).toPlainDate().toString();
	const day = localDayRange(localDate, input.timezone);
	const week = localWeekRange(localDate, input.timezone, input.weekStartDay ?? "sunday");

	const rows = await db
		.select({
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				isNull(workPeriod.deletedAt),
				gte(workPeriod.startTime, dateFromInstant(week.start)),
				lt(workPeriod.startTime, dateFromInstant(week.endExclusive)),
			),
		);

	return complianceTotalsOf(
		rows.map((row) => ({
			start: instantFromDate(row.startTime),
			end: row.endTime ? instantFromDate(row.endTime) : null,
			durationMinutes: row.durationMinutes,
		})),
		{ day, week },
	);
}
