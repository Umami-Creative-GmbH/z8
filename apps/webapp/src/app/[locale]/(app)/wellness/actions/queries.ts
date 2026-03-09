import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
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
