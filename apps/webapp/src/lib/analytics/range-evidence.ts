import "server-only";

import { and, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { Effect } from "effect";
import { workPeriod } from "@/db/schema";
import type { DailyWorkRequirements } from "@/lib/calendar/types";
import {
	loadDailyWorkRequirementsForEmployees,
	type RequirementEmployee,
} from "@/lib/calendar/work-policy-range-requirements";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { EffectiveWorkPolicy } from "@/lib/effect/services/work-policy.service";
import { employeePayrollWindow } from "@/lib/payroll-allocation/protected-minutes";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import {
	type EmployeeTrackingContext,
	loadEmployeeTrackingContexts,
} from "@/lib/time-tracking/tracking-start";
import { allocateTrackedDailyWorkMinutes } from "@/lib/work-balance/tracked-work";

/** A range, never an output week, owns these reads. Process employee batches serially. */
export const ANALYTICS_EMPLOYEE_BATCH_SIZE = 64;

export const loadAnalyticsRangeEvidence = Effect.fn("analytics.rangeEvidence")(
	function* (input: {
		organizationId: string;
		employees: readonly RequirementEmployee[];
		startDate: Date;
		endDate: Date;
		/** Totals consumers reuse protected periods and the existing legacy policy path. */
		mode?: "daily" | "whole-week" | "team";
	}) {
		const database = yield* DatabaseService;
		const wholeWeekTotals = input.mode === "whole-week";
		const totalsOnly = input.mode === "team" || wholeWeekTotals;
		const scopedEmployees = input.employees.filter(
			(person) => person.organizationId === input.organizationId,
		);
		const requestedEmployeeIds = scopedEmployees.map((person) => person.id);
		const trackingByEmployee = new Map<
			string,
			EmployeeTrackingContext | null
		>();
		const dailyByEmployee = new Map<
			string,
			ReturnType<typeof allocateTrackedDailyWorkMinutes>
		>();
		const requirementsByEmployee = new Map<string, DailyWorkRequirements>();
		const policyByEmployee = new Map<string, EffectiveWorkPolicy | null>();
		const completedPeriodsByEmployee = new Map<
			string,
			{
				employeeId: string;
				startTime: Date;
				endTime: Date | null;
				durationMinutes: number | null;
			}[]
		>();
		const distributionPeriods: {
			employeeId: string;
			startTime: Date;
			endTime: Date | null;
		}[] = [];
		for (
			let offset = 0;
			offset < requestedEmployeeIds.length;
			offset += ANALYTICS_EMPLOYEE_BATCH_SIZE
		) {
			const employeeIds = requestedEmployeeIds.slice(
				offset,
				offset + ANALYTICS_EMPLOYEE_BATCH_SIZE,
			);
			const tracking = yield* database.query("analytics.rangeTracking", () =>
				loadEmployeeTrackingContexts(database.db, {
					organizationId: input.organizationId,
					employeeIds,
				}),
			);
			for (const [id, context] of tracking) trackingByEmployee.set(id, context);
			const rawPeriods = wholeWeekTotals
				? []
				: yield* database.query("analytics.rangeDistributionWork", () =>
						database.db
							.select({
								employeeId: workPeriod.employeeId,
								startTime: workPeriod.startTime,
								endTime: workPeriod.endTime,
							})
							.from(workPeriod)
							.where(
								and(
									eq(workPeriod.organizationId, input.organizationId),
									inArray(workPeriod.employeeId, employeeIds),
									input.mode === "team"
										? completedWorkPeriodCondition()
										: isNull(workPeriod.deletedAt),
									lt(
										workPeriod.startTime,
										dateFromInstant(
											instantFromDate(input.endDate).add({ milliseconds: 1 }),
										),
									),
									gt(workPeriod.endTime, input.startDate),
								),
							),
					);
			distributionPeriods.push(...rawPeriods);
			const windows = employeeIds.flatMap((id) => {
				const context = tracking.get(id);
				if (!context) return [];
				const requestedStart = plainDateAt(
					instantFromDate(input.startDate),
					context.timezone,
				).toString();
				const startDate =
					requestedStart > context.startDate
						? requestedStart
						: context.startDate;
				const throughDate = plainDateAt(
					instantFromDate(input.endDate),
					context.timezone,
				).toString();
				if (startDate > throughDate) {
					dailyByEmployee.set(id, {
						timezone: context.timezone,
						minutesByDate: {},
					});
					return [];
				}
				return [
					{
						id,
						startDate,
						throughDate,
						timezone: context.timezone,
						...employeePayrollWindow(startDate, throughDate, context.timezone),
					},
				];
			});
			if (!windows.length && !totalsOnly) continue;
			const first = windows.length
				? windows.reduce((left, right) =>
						compareInstants(left.start, right.start) < 0 ? left : right,
					).start
				: instantFromDate(input.startDate);
			const last = windows.length
				? windows.reduce((left, right) =>
						compareInstants(left.endExclusive, right.endExclusive) > 0
							? left
							: right,
					).endExclusive
				: instantFromDate(input.endDate).add({ milliseconds: 1 });
			const periods = yield* database.query(
				"analytics.rangeCompletedWork",
				() =>
					database.db
						.select({
							employeeId: workPeriod.employeeId,
							startTime: workPeriod.startTime,
							endTime: workPeriod.endTime,
							durationMinutes: workPeriod.durationMinutes,
						})
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, input.organizationId),
								inArray(
									workPeriod.employeeId,
									wholeWeekTotals ? employeeIds : windows.map((w) => w.id),
								),
								completedWorkPeriodCondition(),
								isNotNull(workPeriod.endTime),
								isNotNull(workPeriod.durationMinutes),
								lt(
									workPeriod.startTime,
									dateFromInstant(
										wholeWeekTotals
											? instantFromDate(input.endDate).add({ hours: 48 })
											: last,
									),
								),
								gt(
									workPeriod.endTime,
									dateFromInstant(
										wholeWeekTotals
											? instantFromDate(input.startDate).subtract({ hours: 48 })
											: first,
									),
								),
							),
						),
			);
			const grouped = Map.groupBy(periods, (period) => period.employeeId);
			for (const [id, values] of grouped)
				completedPeriodsByEmployee.set(id, values);
			if (!totalsOnly)
				for (const window of windows)
					dailyByEmployee.set(
						window.id,
						allocateTrackedDailyWorkMinutes(
							grouped.get(window.id) ?? [],
							window,
						),
					);
			const requirements = yield* loadDailyWorkRequirementsForEmployees({
				...input,
				employees: scopedEmployees.filter((person) =>
					employeeIds.includes(person.id),
				),
				trackingByEmployee,
				includeLegacy: totalsOnly,
			});
			for (const [id, value] of requirements.requirements)
				requirementsByEmployee.set(id, value);
			for (const [id, value] of requirements.policyByEmployee)
				policyByEmployee.set(id, value);
		}
		return {
			trackingByEmployee,
			dailyByEmployee,
			requirementsByEmployee,
			distributionPeriods,
			completedPeriodsByEmployee,
			policyByEmployee,
		};
	},
);
