import { and, eq, gte, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { headers } from "next/headers";
import { type NextRequest, NextResponse, connection } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { hydrationStats, userSettings, waterIntakeLog } from "@/db/schema";
import { auth } from "@/lib/auth";
import { calculateStreakOnIntake } from "@/lib/wellness/streak-calculator";

const waterActionSchema = z.object({
	action: z.enum(["log", "snooze"]),
	amount: z.number().int().min(1).max(10).optional().default(1),
});

/**
 * POST /api/wellness/water-action
 * Handle water reminder actions from service worker notifications
 *
 * Body: {
 *   action: "log" | "snooze"
 *   amount?: number (default 1, only for "log" action)
 * }
 */
export async function POST(request: NextRequest) {
	await connection();
	try {
		const session = await auth.api.getSession({ headers: await headers() });
		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const body = await request.json();
		const parseResult = waterActionSchema.safeParse(body);
		if (!parseResult.success) {
			return NextResponse.json(
				{ error: "Invalid request body", details: parseResult.error.flatten() },
				{ status: 400 },
			);
		}
		const { action, amount } = parseResult.data;

		if (action === "log") {
			// Log water intake
			const now = DateTime.now();
			const todayStart = now.startOf("day").toJSDate();
			const todayEnd = now.endOf("day").toJSDate();

			// Get user's daily goal from userSettings
			const settings = await db.query.userSettings.findFirst({
				where: eq(userSettings.userId, session.user.id),
			});
			const dailyGoal = settings?.waterReminderDailyGoal ?? 8;

			// Get or create hydration stats
			let stats = await db.query.hydrationStats.findFirst({
				where: eq(hydrationStats.userId, session.user.id),
			});

			if (!stats) {
				const [newStats] = await db
					.insert(hydrationStats)
					.values({
						userId: session.user.id,
						currentStreak: 0,
						longestStreak: 0,
						totalIntakeAllTime: 0,
					})
					.returning();
				stats = newStats;
			}

			// Get today's current intake
			const todayIntakeResult = await db
				.select({
					total: sql<number>`COALESCE(SUM(${waterIntakeLog.amount}), 0)::int`,
				})
				.from(waterIntakeLog)
				.where(
					and(
						eq(waterIntakeLog.userId, session.user.id),
						gte(waterIntakeLog.loggedAt, todayStart),
						lte(waterIntakeLog.loggedAt, todayEnd),
					),
				);
			const currentTodayIntake = todayIntakeResult[0]?.total ?? 0;

			// Log the intake
			await db.insert(waterIntakeLog).values({
				userId: session.user.id,
				amount,
				source: "reminder_action",
				loggedAt: new Date(),
			});

			// Calculate new streak
			const streakResult = calculateStreakOnIntake(
				{
					currentStreak: stats?.currentStreak ?? 0,
					longestStreak: stats?.longestStreak ?? 0,
					lastGoalMetDate: stats?.lastGoalMetDate ? new Date(stats.lastGoalMetDate) : null,
					todayIntake: currentTodayIntake,
					dailyGoal,
				},
				amount,
			);

			// Update stats
			await db
				.update(hydrationStats)
				.set({
					currentStreak: streakResult.newCurrentStreak,
					longestStreak: streakResult.newLongestStreak,
					lastGoalMetDate: streakResult.newLastGoalMetDate?.toISOString().split("T")[0] ?? null,
					totalIntakeAllTime: sql`${hydrationStats.totalIntakeAllTime} + ${amount}`,
				})
				.where(eq(hydrationStats.userId, session.user.id));

			const newTodayIntake = currentTodayIntake + amount;
			const goalProgress = Math.min(100, Math.round((newTodayIntake / dailyGoal) * 100));

			return NextResponse.json({
				success: true,
				todayIntake: newTodayIntake,
				goalProgress,
				currentStreak: streakResult.newCurrentStreak,
				goalJustMet: streakResult.goalJustMet,
			});
		} else if (action === "snooze") {
			// Snooze until end of today
			const snoozedUntil = DateTime.now().endOf("day").toJSDate();

			// Upsert hydration stats with snooze
			await db
				.insert(hydrationStats)
				.values({
					userId: session.user.id,
					currentStreak: 0,
					longestStreak: 0,
					totalIntakeAllTime: 0,
					snoozedUntil,
				})
				.onConflictDoUpdate({
					target: hydrationStats.userId,
					set: { snoozedUntil },
				});

			return NextResponse.json({
				success: true,
				snoozedUntil: snoozedUntil.toISOString(),
			});
		} else {
			return NextResponse.json({ error: "Invalid action" }, { status: 400 });
		}
	} catch (error) {
		console.error("Error processing water action:", error);
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
