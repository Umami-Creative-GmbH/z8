import "server-only";

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	absenceEntry,
	employee,
	workPeriod,
	workPolicyAssignment,
} from "@/db/schema";
import { shouldExcludeFromCalculations } from "@/lib/calendar/holiday-service";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { getWeekBounds } from "@/lib/user-preferences/week-start";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";
import type { DashboardScope } from "./dashboard-types";
import { calculateAdjustedExpectedHoursForRange } from "./quick-stats-calculations";
import { loadTrackedQuickStats } from "./quick-stats-tracking";

/** Existing calculation over an already authorized server-owned subject. */
export function loadQuickStatsForSubject(subject: DashboardScope) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;

		const { userId, organizationId } = subject;
		if (!organizationId) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee profile not found",
					entityType: "employee",
				}),
			);
		}

		// Get current employee
		const currentEmployee = yield* dbService
			.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, userId),
						onCurrentRoster(organizationId),
					),
					with: {
						workPolicyAssignments: {
							where: eq(workPolicyAssignment.isActive, true),
							orderBy: [desc(workPolicyAssignment.effectiveFrom)],
							limit: 1,
							with: {
								policy: {
									with: {
										schedule: true,
									},
								},
							},
						},
					},
				});
			})
			.pipe(
				Effect.flatMap((emp) =>
					emp
						? Effect.succeed(emp)
						: Effect.fail(
								new NotFoundError({
									message: "Employee profile not found",
									entityType: "employee",
								}),
							),
				),
			);

		const now = currentTimestamp();
		const weekStartDay = yield* Effect.promise(() =>
			getUserWeekStartDay(userId),
		);
		const trackedStats = yield* loadTrackedQuickStats({
			organizationId,
			employeeId: currentEmployee.id,
			now,
			weekStartDay,
		});
		if (trackedStats) return trackedStats;
		const nowDT = DateTime.fromJSDate(now);
		const { start: weekStartDateTime, end: weekEndDateTime } = getWeekBounds(
			nowDT,
			weekStartDay,
		);
		const weekStart = weekStartDateTime.toJSDate();
		const weekEnd = weekEndDateTime.toJSDate();
		const monthStart = nowDT.startOf("month").toJSDate();
		const monthEnd = nowDT.endOf("month").toJSDate();
		const monthStartStr = nowDT.startOf("month").toISODate()!;
		const monthEndStr = nowDT.endOf("month").toISODate()!;

		// Get all work periods for this month (includes this week)
		const monthPeriods = yield* dbService.query(
			"getMonthWorkPeriods",
			async () => {
				return await dbService.db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						gte(workPeriod.startTime, monthStart),
						lte(workPeriod.startTime, monthEnd),
					),
				});
			},
		);

		const approvedAbsences = yield* dbService.query(
			"getMonthApprovedAbsences",
			async () => {
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						eq(absenceEntry.employeeId, currentEmployee.id),
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						eq(absenceEntry.status, "approved"),
						lte(absenceEntry.startDate, monthEndStr),
						gte(absenceEntry.endDate, monthStartStr),
					),
					with: {
						category: {
							columns: { requiresWorkTime: true },
						},
					},
				});
			},
		);

		const excludedDates = yield* Effect.promise(async () => {
			const dates = new Set<string>();
			const rangeStart = DateTime.fromJSDate(monthStart).startOf("day");
			const rangeEnd = DateTime.fromJSDate(monthEnd).startOf("day");

			for (const absence of approvedAbsences) {
				if (absence.category?.requiresWorkTime) continue;

				let current = DateTime.fromISO(absence.startDate);
				const last = DateTime.fromISO(absence.endDate);
				if (!current.isValid || !last.isValid) continue;

				if (current < rangeStart) current = rangeStart;

				while (current <= last && current <= rangeEnd) {
					const dateKey = current.toISODate();
					if (dateKey) dates.add(dateKey);
					current = current.plus({ days: 1 });
				}
			}

			let current = rangeStart;
			while (current <= rangeEnd) {
				if (
					await shouldExcludeFromCalculations(
						currentEmployee.organizationId,
						current.toJSDate(),
					)
				) {
					const dateKey = current.toISODate();
					if (dateKey) dates.add(dateKey);
				}
				current = current.plus({ days: 1 });
			}

			return dates;
		});

		// Calculate minutes for each period (including active ones)
		const calculatePeriodMinutes = (period: (typeof monthPeriods)[0]) => {
			// Completed periods have durationMinutes set
			if (period.durationMinutes) {
				return period.durationMinutes;
			}
			// For active periods (currently clocked in), calculate elapsed time
			if (period.isActive && period.startTime) {
				const elapsedMs = now.getTime() - period.startTime.getTime();
				return Math.floor(elapsedMs / 60000);
			}
			return 0;
		};

		// Filter for week periods
		const weekPeriods = monthPeriods.filter(
			(p) => p.startTime >= weekStart && p.startTime <= weekEnd,
		);

		// Calculate total minutes
		const weekMinutes = weekPeriods.reduce(
			(sum, p) => sum + calculatePeriodMinutes(p),
			0,
		);

		const monthMinutes = monthPeriods.reduce(
			(sum, p) => sum + calculatePeriodMinutes(p),
			0,
		);

		// Convert to hours
		const weekActual = weekMinutes / 60;
		const monthActual = monthMinutes / 60;

		const schedule =
			currentEmployee.workPolicyAssignments?.[0]?.policy?.schedule ?? null;
		const weekExpected = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: weekStartDateTime,
			end: weekEndDateTime,
			excludedDates,
		});
		const weekExpectedToDate = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: weekStartDateTime,
			end: nowDT < weekEndDateTime ? nowDT : weekEndDateTime,
			excludedDates,
		});
		const monthExpected = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: DateTime.fromJSDate(monthStart),
			end: DateTime.fromJSDate(monthEnd),
			excludedDates,
		});
		const monthExpectedToDate = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: DateTime.fromJSDate(monthStart),
			end:
				nowDT < DateTime.fromJSDate(monthEnd)
					? nowDT
					: DateTime.fromJSDate(monthEnd),
			excludedDates,
		});

		return {
			thisWeek: {
				actual: weekActual,
				expected: weekExpected,
				expectedToDate: weekExpectedToDate,
			},
			thisMonth: {
				actual: monthActual,
				expected: monthExpected,
				expectedToDate: monthExpectedToDate,
			},
		};
	});
}
