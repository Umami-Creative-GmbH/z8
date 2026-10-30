import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { unstable_cache } from "next/cache";
import { Temporal } from "temporal-polyfill";
import { organization, user } from "@/db/auth-schema";
import {
	employee,
	hydrationStats,
	teamMembership,
	userSettings,
	waterIntakeLog,
} from "@/db/schema";
import { getEnhancedVacationBalanceResult } from "@/lib/absences/vacation.service";
import {
	calendarYearAt,
	dateFromInstant,
	instantFromDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { BirthdayRemindersData, DashboardScope, DashboardSubject } from "./dashboard-types";
import { buildTeamStreakLeaders, collectUniqueTeamIds } from "./hydration-team-streak-leaders";
import { createHydrationTeamStreakLeadersCacheConfig } from "./hydration-team-streak-leaders-query";

export function loadBirthdayRemindersForOrganization(organizationId: string, days = 30) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const timezone = yield* dbService.query("dashboard.birthdayTimezone", () =>
			loadOrganizationTimezone(dbService.db, organizationId),
		);
		const today = plainDateAt(systemClock.nowInstant(), timezone);
		const employees = yield* dbService.query("getEmployeesWithBirthdays", () =>
			dbService.db.query.employee.findMany({
				where: and(onCurrentRoster(organizationId), sql`${employee.birthday} IS NOT NULL`),
				columns: { id: true, birthday: true },
				with: { user: { columns: { id: true, name: true, image: true } } },
			}),
		);
		const result: BirthdayRemindersData = [];
		for (const row of employees) {
			if (!row.birthday) continue;
			const birth = plainDateAt(instantFromDate(row.birthday), "UTC");
			for (let year = today.year; year <= today.year + 8; year++) {
				try {
					const nextBirthday = Temporal.PlainDate.from(
						{ year, month: birth.month, day: birth.day },
						{ overflow: "reject" },
					);
					if (Temporal.PlainDate.compare(nextBirthday, today) < 0) continue;
					const daysUntil = nextBirthday.since(today).days;
					if (daysUntil <= days)
						result.push({
							id: row.id,
							userId: row.user.id,
							image: row.user.image,
							user: { name: row.user.name },
							nextBirthday: nextBirthday.toString(),
							daysUntil,
						});
					break;
				} catch {
					/* February 29 has no occurrence in a non-leap year. */
				}
			}
		}
		return result.sort((left, right) => left.daysUntil - right.daysUntil);
	});
}

/** Caller owns render-local or freshly resolved employee authorization. */
export function loadVacationBalanceForEmployee(subject: {
	organizationId: string;
	employee: { id: string };
}) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const org = yield* dbService.query("getVacationBalanceOrganizationTimezone", async () => {
			return await dbService.db.query.organization.findFirst({
				where: eq(organization.id, subject.organizationId),
				columns: { timezone: true },
			});
		});
		const timezone = org?.timezone || "UTC";
		const currentYear = calendarYearAt(systemClock.nowInstant(), timezone);

		const { balance, configuration } = yield* dbService.query("getVacationBalance:balance", () =>
			getEnhancedVacationBalanceResult({
				employeeId: subject.employee.id,
				organizationId: subject.organizationId,
				year: currentYear,
				timezone,
				currentDate: dateFromInstant(systemClock.nowInstant()),
			}),
		);
		return {
			year: currentYear,
			configuration,
			balance: balance
				? {
						totalDays: balance.totalDays,
						usedDays: balance.usedDays,
						previouslyTakenDays: balance.previouslyTakenDays,
						pendingDays: balance.pendingDays,
						remainingDays: balance.remainingDays,
						carryoverDays: balance.carryoverDays ?? 0,
						carryoverExpiryDate: balance.carryoverExpiryDate ?? null,
						carryoverExpiryDaysRemaining: balance.carryoverExpiryDaysRemaining,
						hasCarryover: (balance.carryoverDays ?? 0) > 0,
					}
				: null,
		};
	});
}

export function loadHydrationForSubject(
	subject: DashboardScope & {
		employee?: DashboardSubject["employee"];
		hydrationSettings?: DashboardSubject["hydrationSettings"];
	},
	options?: { fresh?: boolean },
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		// Get user's water reminder settings from userSettings
		const settings =
			subject.hydrationSettings ??
			(yield* dbService.query("getWaterReminderSettings", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, subject.userId),
				});
			}));

		// If not enabled, return early with enabled: false
		if (!settings?.waterReminderEnabled) {
			return {
				enabled: false,
				currentStreak: 0,
				longestStreak: 0,
				todayIntake: 0,
				dailyGoal: 8,
				goalProgress: 0,
				teamStreakLeaders: [],
				organizationStreakLeaders: [],
			};
		}

		const dailyGoal = settings.waterReminderDailyGoal ?? 8;
		let currentEmployee = subject.employee;
		if (currentEmployee === undefined) {
			currentEmployee = subject.organizationId
				? yield* dbService.query("dashboard.hydrationEmployee", () =>
						dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.userId, subject.userId),
								onCurrentRoster(subject.organizationId),
							),
							columns: { id: true, organizationId: true, role: true, teamId: true },
						}),
					)
				: null;
		}

		// Get hydration stats
		const stats = yield* dbService.query("getHydrationStats", async () => {
			return dbService.db.query.hydrationStats.findFirst({
				where: eq(hydrationStats.userId, subject.userId),
			});
		});

		// Get today's intake using Luxon for date boundaries
		const todayStart = DateTime.now().startOf("day").toJSDate();
		const todayEnd = DateTime.now().endOf("day").toJSDate();

		const todayIntakeResult = yield* dbService.query("getTodayIntake", async () => {
			return dbService.db
				.select({
					total: sql<number>`COALESCE(SUM(${waterIntakeLog.amount}), 0)::int`,
				})
				.from(waterIntakeLog)
				.where(
					and(
						eq(waterIntakeLog.userId, subject.userId),
						gte(waterIntakeLog.loggedAt, todayStart),
						lte(waterIntakeLog.loggedAt, todayEnd),
					),
				);
		});

		const todayIntake = todayIntakeResult[0]?.total ?? 0;
		const goalProgress = Math.min(100, Math.round((todayIntake / dailyGoal) * 100));
		const activeOrganizationId = subject.organizationId;

		const teamStreakLeaders = yield* dbService
			.query("dashboard.getHydrationTeamStreakLeaders", async () => {
				if (!activeOrganizationId) {
					return [];
				}

				if (!currentEmployee) {
					return [];
				}

				const memberships = await dbService.db.query.teamMembership.findMany({
					where: and(
						eq(teamMembership.organizationId, activeOrganizationId),
						eq(teamMembership.employeeId, currentEmployee.id),
					),
					columns: {
						teamId: true,
					},
				});

				const teamIds = collectUniqueTeamIds(currentEmployee.teamId ?? null, memberships);

				if (teamIds.length === 0) {
					return [];
				}

				const cacheConfig = createHydrationTeamStreakLeadersCacheConfig({
					organizationId: activeOrganizationId,
					currentEmployeeId: currentEmployee.id,
					teamIds,
				});
				const sortedTeamIds = teamIds.toSorted();

				const load = async () => {
					const candidates = await dbService.db
						.select({
							employeeId: employee.id,
							userId: employee.userId,
							userName: user.name,
							currentStreak: hydrationStats.currentStreak,
						})
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.leftJoin(hydrationStats, eq(hydrationStats.userId, employee.userId))
						.leftJoin(
							teamMembership,
							and(
								eq(teamMembership.employeeId, employee.id),
								eq(teamMembership.organizationId, activeOrganizationId),
								inArray(teamMembership.teamId, sortedTeamIds),
							),
						)
						.where(
							and(
								onCurrentRoster(activeOrganizationId),
								or(inArray(employee.teamId, sortedTeamIds), isNotNull(teamMembership.id)),
							),
						);

					return buildTeamStreakLeaders(
						candidates.map((candidate) => ({
							employeeId: candidate.employeeId,
							userId: candidate.userId,
							displayName: candidate.userName || "Team member",
							currentStreak: candidate.currentStreak,
						})),
						subject.userId,
						{ limit: 5, minimumParticipants: 2 },
					);
				};
				if (options?.fresh === true) return load();
				return unstable_cache(load, cacheConfig.keyParts, cacheConfig.options)();
			})
			.pipe(Effect.catch(() => Effect.succeed([])));

		const organizationStreakLeaders = yield* dbService
			.query("dashboard.getHydrationOrganizationStreakLeaders", async () => {
				if (!activeOrganizationId) {
					return [];
				}

				if (!currentEmployee) {
					return [];
				}

				const candidates = await dbService.db
					.select({
						employeeId: employee.id,
						userId: employee.userId,
						userName: user.name,
						currentStreak: hydrationStats.currentStreak,
					})
					.from(employee)
					.innerJoin(user, eq(employee.userId, user.id))
					.leftJoin(hydrationStats, eq(hydrationStats.userId, employee.userId))
					.where(and(onCurrentRoster(activeOrganizationId)));

				return buildTeamStreakLeaders(
					candidates.map((candidate) => ({
						employeeId: candidate.employeeId,
						userId: candidate.userId,
						displayName: candidate.userName || "Team member",
						currentStreak: candidate.currentStreak,
					})),
					subject.userId,
					{ limit: 5 },
				);
			})
			.pipe(Effect.catch(() => Effect.succeed([])));

		return {
			enabled: true,
			currentStreak: stats?.currentStreak ?? 0,
			longestStreak: stats?.longestStreak ?? 0,
			todayIntake,
			dailyGoal,
			goalProgress,
			teamStreakLeaders,
			organizationStreakLeaders,
		};
	});
}
