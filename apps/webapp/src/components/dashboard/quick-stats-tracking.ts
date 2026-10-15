import { and, eq, isNull, lt } from "drizzle-orm";
import { Effect } from "effect";
import { workPeriod } from "@/db/schema";
import { buildDailyWorkHoursSummaries } from "@/lib/calendar/work-hours-summary";
import { loadDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import {
	localDayRange,
	localMonthRange,
	localWeekRange,
	type WeekStartDay,
} from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import { readTrackedDailyWorkMinutes } from "@/lib/work-balance/tracked-work";

export type QuickStats = {
	thisWeek: { actual: number; expected: number; expectedToDate: number };
	thisMonth: { actual: number; expected: number; expectedToDate: number };
};

/** Return null for legacy organizations so their existing progress calculation stays in force. */
export function loadTrackedQuickStats(input: {
	organizationId: string;
	employeeId: string;
	now: Date;
	weekStartDay: WeekStartDay;
}) {
	return Effect.gen(function* () {
		const database = yield* DatabaseService;
		const tracking = yield* database.query("dashboard.trackingStart", () =>
			loadEmployeeTrackingContext(database.db, input),
		);
		if (!tracking) return null;
		const now = instantFromDate(input.now);
		const today = plainDateAt(now, tracking.timezone).toString();
		const week = localWeekRange(today, tracking.timezone, input.weekStartDay);
		const month = localMonthRange(today, tracking.timezone);
		const start = compareInstants(week.start, month.start) < 0 ? week.start : month.start;
		const endExclusive =
			compareInstants(week.endExclusive, month.endExclusive) > 0
				? week.endExclusive
				: month.endExclusive;
		const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
		const range = {
			startDate: dateFromInstant(start),
			endDate: dateFromInstant(endExclusive.subtract({ milliseconds: 1 })),
		};
		const [completed, requirements, livePeriods] = yield* Effect.all(
			[
				database.query("dashboard.trackedDailyWork", () =>
					readTrackedDailyWorkMinutes(database.db, { ...scope, ...range }),
				),
				loadDailyWorkRequirementsForEmployee({ ...scope, ...range, timezone: tracking.timezone }),
				database.query("dashboard.liveWork", () =>
					database.db
						.select({ startTime: workPeriod.startTime })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, input.organizationId),
								eq(workPeriod.employeeId, input.employeeId),
								eq(workPeriod.isActive, true),
								isNull(workPeriod.endTime),
								lt(workPeriod.startTime, input.now),
							),
						),
				),
			],
			{ concurrency: "unbounded" },
		);
		const trackingStart = localDayRange(tracking.startDate, tracking.timezone).start;
		const liveStart = compareInstants(start, trackingStart) > 0 ? start : trackingStart;
		const summaries = buildDailyWorkHoursSummaries({
			dailyRequirements: requirements,
			dailyActualMinutes: completed?.minutesByDate ?? {},
			timezone: tracking.timezone,
			now,
			liveWork: livePeriods.map((period) => {
				const recordedStart = instantFromDate(period.startTime);
				return {
					startedAt: dateFromInstant(
						compareInstants(recordedStart, liveStart) > 0 ? recordedStart : liveStart,
					),
				};
			}),
		});
		const day = localDayRange(today, tracking.timezone);
		const todayFraction =
			day.start.until(now).total({ unit: "milliseconds" }) /
			day.start.until(day.endExclusive).total({ unit: "milliseconds" });
		const summarize = (window: typeof week) => {
			const first = plainDateAt(window.start, tracking.timezone).toString();
			const lastExclusive = plainDateAt(window.endExclusive, tracking.timezone).toString();
			let actual = 0;
			let expected = 0;
			let expectedToDate = 0;
			for (const [date, summary] of summaries) {
				if (date < first || date >= lastExclusive) continue;
				const required = summary.requirement?.requiredMinutes ?? 0;
				actual += summary.actualMinutes;
				expected += required;
				expectedToDate += required * (date < today ? 1 : date === today ? todayFraction : 0);
			}
			return {
				actual: actual / 60,
				expected: Math.round((expected / 60) * 100) / 100,
				expectedToDate: Math.round((expectedToDate / 60) * 100) / 100,
			};
		};
		return { thisWeek: summarize(week), thisMonth: summarize(month) } satisfies QuickStats;
	});
}
