import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { organization } from "@/db/auth-schema";
import { absenceEntry, employee, userSettings, workPeriod } from "@/db/schema";
import { shouldExcludeFromCalculations } from "@/lib/calendar/holiday-service";
import { resolveEffectiveContractOnDay } from "@/lib/contracts/resolve-contract";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { localDayRange, localMonthRange, localWeekRange } from "@/lib/datetime/temporal-boundaries";
import {
	compareInstants,
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
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
					where: and(eq(employee.userId, userId), onCurrentRoster(organizationId)),
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
		const balanceRead = yield* dbService
			.query("dashboard.workBalance", () =>
				getEmployeeWorkBalance({ organizationId, employeeId: currentEmployee.id }, dbService.db),
			)
			.pipe(
				Effect.map((balance) => ({ balance, unavailable: false })),
				Effect.catch(() => Effect.succeed({ balance: null, unavailable: true })),
			);
		const balance = balanceRead.balance;
		const workBalanceUnavailable = balanceRead.unavailable;
		const workBalance = balance
			? {
					balanceMinutes: balance.balanceMinutes,
					computedAt: balance.computedAt.toISOString(),
				}
			: null;
		const weekStartDay = yield* Effect.promise(() => getUserWeekStartDay(userId));
		const trackedStats = yield* loadTrackedQuickStats({
			organizationId,
			employeeId: currentEmployee.id,
			now,
			weekStartDay,
		});
		if (trackedStats) return { ...trackedStats, workBalance, workBalanceUnavailable };
		const effectiveTimezone = yield* dbService
			.query("getQuickStatsTimezone", async () => {
				const [settings, org] = await Promise.all([
					dbService.db.query.userSettings.findFirst({
						where: eq(userSettings.userId, userId),
						columns: { timezone: true },
					}),
					dbService.db.query.organization.findFirst({
						where: eq(organization.id, organizationId),
						columns: { timezone: true },
					}),
				]);
				return resolveEffectiveTimezone(settings?.timezone, org?.timezone);
			})
			.pipe(Effect.catch(() => Effect.succeed("UTC")));
		const nowInstant = instantFromDate(now);
		const nowZdt = nowInstant.toZonedDateTimeISO(effectiveTimezone);
		const today = plainDateAt(nowInstant, effectiveTimezone);
		const todayStr = today.toString();
		const weekRange = localWeekRange(todayStr, effectiveTimezone, weekStartDay);
		const monthRange = localMonthRange(todayStr, effectiveTimezone);
		const weekEndInclusiveInstant = weekRange.endExclusive.subtract({
			milliseconds: 1,
		});
		const monthEndInclusiveInstant = monthRange.endExclusive.subtract({
			milliseconds: 1,
		});
		const weekStartZdt = weekRange.start.toZonedDateTimeISO(effectiveTimezone);
		const weekEndZdt = weekEndInclusiveInstant.toZonedDateTimeISO(effectiveTimezone);
		const monthStartZdt = monthRange.start.toZonedDateTimeISO(effectiveTimezone);
		const monthEndZdt = monthEndInclusiveInstant.toZonedDateTimeISO(effectiveTimezone);
		const weekStart = dateFromInstant(weekRange.start);
		const weekEnd = dateFromInstant(weekEndInclusiveInstant);
		const monthStart = dateFromInstant(monthRange.start);
		const monthEnd = dateFromInstant(monthEndInclusiveInstant);
		const monthStartPlain = monthStartZdt.toPlainDate();
		const monthEndPlain = monthEndZdt.toPlainDate();
		const monthStartStr = monthStartPlain.toString();
		const monthEndStr = monthEndPlain.toString();

		// Get all work periods for this month (includes this week)
		const monthPeriods = yield* dbService.query("getMonthWorkPeriods", async () => {
			return await dbService.db.query.workPeriod.findMany({
				where: and(
					eq(workPeriod.employeeId, currentEmployee.id),
					eq(workPeriod.organizationId, currentEmployee.organizationId),
					gte(workPeriod.startTime, monthStart),
					lte(workPeriod.startTime, monthEnd),
				),
			});
		});

		const approvedAbsences = yield* dbService.query("getMonthApprovedAbsences", async () => {
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
		});

		const excludedDates = yield* Effect.promise(async () => {
			const dates = new Set<string>();

			for (const absence of approvedAbsences) {
				if (absence.category?.requiresWorkTime) continue;

				let current: Temporal.PlainDate;
				let last: Temporal.PlainDate;
				try {
					current = parsePlainDate(absence.startDate);
					last = parsePlainDate(absence.endDate);
				} catch {
					continue;
				}

				if (Temporal.PlainDate.compare(current, monthStartPlain) < 0) {
					current = monthStartPlain;
				}

				while (
					Temporal.PlainDate.compare(current, last) <= 0 &&
					Temporal.PlainDate.compare(current, monthEndPlain) <= 0
				) {
					dates.add(current.toString());
					current = current.add({ days: 1 });
				}
			}

			let current = monthStartPlain;
			while (Temporal.PlainDate.compare(current, monthEndPlain) <= 0) {
				if (
					await shouldExcludeFromCalculations(
						currentEmployee.organizationId,
						dateFromInstant(localDayRange(current.toString(), effectiveTimezone).start),
					)
				) {
					dates.add(current.toString());
				}
				current = current.add({ days: 1 });
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
		const weekMinutes = weekPeriods.reduce((sum, p) => sum + calculatePeriodMinutes(p), 0);

		const monthMinutes = monthPeriods.reduce((sum, p) => sum + calculatePeriodMinutes(p), 0);

		// Convert to hours
		const weekActual = weekMinutes / 60;
		const monthActual = monthMinutes / 60;

		const resolvedContract = yield* dbService.query("dashboard.quickStatsContract", () =>
			resolveEffectiveContractOnDay(dbService.db, {
				organizationId,
				employeeId: currentEmployee.id,
				date: today,
			}),
		);
		const rawSchedule = resolvedContract?.workPolicy?.scheduleEnabled
			? (resolvedContract.workPolicy.schedule ?? null)
			: null;
		const schedule = rawSchedule
			? {
					...rawSchedule,
					days: rawSchedule.days.map((d) => ({ ...d })),
				}
			: null;
		const weekExpected = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: weekStartZdt,
			end: weekEndZdt,
			excludedDates,
		});
		const weekExpectedToDate = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: weekStartZdt,
			end: compareInstants(nowInstant, weekEndInclusiveInstant) < 0 ? nowZdt : weekEndZdt,
			excludedDates,
		});
		const monthExpected = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: monthStartZdt,
			end: monthEndZdt,
			excludedDates,
		});
		const monthExpectedToDate = calculateAdjustedExpectedHoursForRange({
			schedule,
			start: monthStartZdt,
			end: compareInstants(nowInstant, monthEndInclusiveInstant) < 0 ? nowZdt : monthEndZdt,
			excludedDates,
		});

		return {
			workBalance,
			workBalanceUnavailable,
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
