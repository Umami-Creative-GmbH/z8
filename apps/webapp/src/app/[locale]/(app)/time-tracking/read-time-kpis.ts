import "server-only";

import { Effect } from "effect";
import type { DailyWorkActualMinutes } from "@/lib/calendar/types";
import { loadDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import { WorkPolicyService } from "@/lib/effect/services/work-policy.service";
import {
	buildTimeKpiBasis,
	summarizeTimeKpis,
	type TimeKpiLimits,
	type TimeKpiRead,
	timeKpiRange,
} from "@/lib/time-tracking/time-kpis";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { type EmployeeReadScope, readDayTotalWorkPeriods } from "./read-queries";

export type { TimeKpiRead };

/**
 * The KPI cards for today, this week and this month in the employee's timezone: day totals,
 * the previous week and month up to the same point, required time and the work policy's limits.
 */
export async function readTimeKpis(
	scope: EmployeeReadScope,
	timezone: string,
	weekStartDay: WeekStartDay,
	clock: Clock = systemClock,
): Promise<TimeKpiRead> {
	const now = clock.nowInstant();
	const range = timeKpiRange(now, timezone, weekStartDay);

	const [periods, { requirements, policy }] = await Promise.all([
		readDayTotalWorkPeriods(scope, range),
		runtime.runPromise(
			Effect.gen(function* () {
				const service = yield* WorkPolicyService;
				return yield* Effect.all(
					{
						// The same required time the work balance counts.
						requirements: loadDailyWorkRequirementsForEmployee({
							...scope,
							startDate: range.start,
							endDate: new Date(range.endExclusive.getTime() - 1),
							timezone,
						}),
						policy: service.getEffectivePolicyAt({ ...scope, at: now }),
					},
					{ concurrency: "unbounded" },
				);
			}),
		),
	]);

	const requiredMinutesByDate: DailyWorkActualMinutes = {};
	for (const [date, requirement] of Object.entries(requirements)) {
		requiredMinutesByDate[date] = requirement.requiredMinutes;
	}
	const regulation = policy?.regulation;
	const limits: TimeKpiLimits | null = regulation
		? {
				maxDailyMinutes: regulation.maxDailyMinutes,
				maxWeeklyMinutes: regulation.maxWeeklyMinutes,
				alertBeforeLimitMinutes: regulation.alertBeforeLimitMinutes,
			}
		: null;

	const basis = buildTimeKpiBasis({
		periods,
		timezone,
		weekStartDay,
		requiredMinutesByDate,
		limits,
	});
	return { kpis: summarizeTimeKpis(basis, now), basis };
}
