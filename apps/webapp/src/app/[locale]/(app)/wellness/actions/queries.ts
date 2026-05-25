import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { employee, hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { WorkdayRequirementByDate } from "@/lib/wellness/streak-calculator";
import { createDefaultHydrationStats, getTodayRange } from "./shared";

export function getUserWaterReminderSettings(userId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return yield* _(
			dbService.query("getWaterReminderSettings", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, userId),
				});
			}),
		);
	});
}

export function getHydrationStatsRecord(userId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return yield* _(
			dbService.query("getHydrationStats", async () => {
				return dbService.db.query.hydrationStats.findFirst({
					where: eq(hydrationStats.userId, userId),
				});
			}),
		);
	});
}

export function getActiveEmployeeForHydration(userId: string, organizationId: string | null) {
	return Effect.gen(function* (_) {
		if (!organizationId) return null;

		const dbService = yield* _(DatabaseService);
		return yield* _(
			dbService.query("getActiveEmployeeForHydration", async () => {
				return dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, userId),
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
					),
					columns: { id: true, organizationId: true },
				});
			}),
		);
	});
}

export function getHydrationStreakWorkdayRequirements(params: {
	organizationId: string | null;
	employeeId: string | null;
	lastGoalMetDate: Date | null;
	today?: Date;
}) {
	return Effect.gen(function* (_) {
		if (!params.organizationId || !params.employeeId || !params.lastGoalMetDate) {
			return undefined;
		}

		const organizationId = params.organizationId;
		const employeeId = params.employeeId;
		const start = DateTime.fromJSDate(params.lastGoalMetDate, { zone: "utc" })
			.startOf("day")
			.plus({ days: 1 });
		const end = DateTime.fromJSDate(params.today ?? new Date(), { zone: "utc" }).startOf("day");

		if (!start.isValid || !end.isValid || start >= end) {
			return {} satisfies WorkdayRequirementByDate;
		}

		const requirements = yield* _(
			Effect.promise(() =>
				getDailyWorkRequirementsForEmployee({
					organizationId,
					employeeId,
					startDate: start.toJSDate(),
					endDate: end.minus({ days: 1 }).endOf("day").toJSDate(),
				}),
			),
		);

		return Object.fromEntries(
			Object.entries(requirements).map(([dateKey, requirement]) => [
				dateKey,
				requirement.requiredMinutes,
			]),
		) satisfies WorkdayRequirementByDate;
	});
}

export function ensureHydrationStatsRecord(userId: string) {
	return Effect.gen(function* (_) {
		const existingStats = yield* _(getHydrationStatsRecord(userId));
		if (existingStats) {
			return existingStats;
		}

		const dbService = yield* _(DatabaseService);
		const [createdStats] = yield* _(
			dbService.query("createHydrationStats", async () => {
				return dbService.db
					.insert(hydrationStats)
					.values(createDefaultHydrationStats(userId))
					.returning();
			}),
		);

		return createdStats;
	});
}

export function getTodayWaterIntake(userId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { start, end } = getTodayRange();
		const result = yield* _(
			dbService.query("getTodayIntake", async () => {
				return dbService.db
					.select({
						total: sql<number>`COALESCE(SUM(${waterIntakeLog.amount}), 0)::int`,
					})
					.from(waterIntakeLog)
					.where(
						and(
							eq(waterIntakeLog.userId, userId),
							gte(waterIntakeLog.loggedAt, start),
							lte(waterIntakeLog.loggedAt, end),
						),
					);
			}),
		);

		return result[0]?.total ?? 0;
	});
}

export function getLastWaterIntakeToday(userId: string) {
	return Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const { start } = getTodayRange();

		return yield* _(
			dbService.query("getLastIntake", async () => {
				return dbService.db.query.waterIntakeLog.findFirst({
					where: and(eq(waterIntakeLog.userId, userId), gte(waterIntakeLog.loggedAt, start)),
					orderBy: (log, { desc }) => desc(log.loggedAt),
				});
			}),
		);
	});
}
