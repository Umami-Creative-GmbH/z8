"use server";

import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { unstable_cache } from "next/cache";
import { organization, user } from "@/db/auth-schema";
import type { DashboardWidgetOrder } from "@/db/schema";
import {
	absenceEntry,
	employee,
	hydrationStats,
	teamMembership,
	userSettings,
	waterIntakeLog,
} from "@/db/schema";
import type { VacationBalanceConfiguration } from "@/lib/absences/types";
import { getEnhancedVacationBalanceResult } from "@/lib/absences/vacation.service";
import { todayCalendarDateKey } from "@/lib/calendar/date-keys";
import { currentTimestamp, dateFromDB } from "@/lib/datetime/drizzle-adapter";
import {
	calendarYearAt,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { ManagedEmployee } from "@/lib/effect/services/manager.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { writeUserSettings } from "@/lib/user-preferences/user-settings-mutation";
import { currentRosterEmployeeIds } from "./current-roster-queries";
import {
	buildTeamStreakLeaders,
	collectUniqueTeamIds,
	type TeamStreakLeader,
} from "./hydration-team-streak-leaders";
import { createHydrationTeamStreakLeadersCacheConfig } from "./hydration-team-streak-leaders-query";
import { loadManagerTodayForEmployee } from "./manager-today-read";
import { loadQuickStatsForSubject } from "./quick-stats-read";
import type { QuickStats } from "./quick-stats-tracking";
import {
	loadUpcomingAbsencesForOrganization,
	loadWhosOutForOrganization,
} from "./schedule-absence-reads";
import {
	loadManagedEmployeesForEmployee,
	loadRecentlyApprovedForOrganization,
	loadTeamOverviewForOrganization,
} from "./team-approval-reads";

export type ManagerTodaySummaryResult = {
	role: "admin" | "manager" | "employee" | null;
	summary: {
		criticalIssues: number;
		openApprovals: number;
		attendanceExceptions: number;
		absencesToday: number;
		coverageRisks: number;
		overtimeWarnings: number;
		payrollIssues: number;
	} | null;
	error?: string;
};

type DashboardAbsenceEmployeeRow = typeof absenceEntry.$inferSelect & {
	employee: Pick<typeof employee.$inferSelect, "id"> & {
		user: { name: string | null };
	};
};

/** The caller's employee in the active organization. */
const sessionEmployee = Effect.gen(function* () {
	const authService = yield* AuthService;
	const session = yield* authService.getSession();
	const organizationId = session.session.activeOrganizationId;
	const dbService = yield* DatabaseService;
	const found = organizationId
		? yield* dbService.query("dashboard.sessionEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, organizationId),
					),
					columns: { id: true, organizationId: true },
				});
			})
		: undefined;
	if (!found) {
		return yield* Effect.fail(
			new NotFoundError({
				message: "Employee profile not found",
				entityType: "employee",
			}),
		);
	}
	return found;
});

export async function getManagerTodaySummary(): Promise<ManagerTodaySummaryResult> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const activeOrganizationId = session.session.activeOrganizationId;

		if (!activeOrganizationId) {
			return { role: null, summary: null };
		}

		const dbService = yield* DatabaseService;

		const currentEmployee = yield* dbService.query(
			"getManagerTodayCurrentEmployee",
			async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, activeOrganizationId),
					),
					columns: {
						id: true,
						role: true,
						organizationId: true,
					},
				});
			},
		);

		if (!currentEmployee) {
			return { role: null, summary: null };
		}

		const role = currentEmployee.role as "admin" | "manager" | "employee";

		if (role !== "admin" && role !== "manager") {
			return { role, summary: null };
		}

		if (!currentEmployee.organizationId) {
			return { role, summary: null };
		}

		return {
			role,
			briefingFor: {
				id: currentEmployee.id,
				role,
				organizationId: currentEmployee.organizationId,
			},
		};
	});

	const result = await runServerActionSafe(effect);

	if (!result.success) {
		throw new Error(String(result.error));
	}

	const target = result.data;
	if (!target.briefingFor) {
		return target;
	}

	// The briefing is Promise code that starts its own runtime runs, so it runs here,
	// after the effect, instead of nested inside it.
	return loadManagerTodayForEmployee(target.briefingFor);
}

export type ManagedEmployeesResult = {
	/** Whether the Your team widget applies: the caller has reports or is an admin. */
	isManager: boolean;
	employees: ManagedEmployee[];
};

/**
 * The caller's own direct reports in the active organization (#1436). The
 * manager always comes from the session, never from the client.
 */
export async function getManagedEmployees(): Promise<
	ServerActionResult<ManagedEmployeesResult>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const activeOrganizationId = session.session.activeOrganizationId;
		const none: ManagedEmployeesResult = { isManager: false, employees: [] };

		if (!activeOrganizationId) {
			return none;
		}

		const dbService = yield* DatabaseService;
		const currentEmployee = yield* dbService.query(
			"getManagedEmployeesCurrentEmployee",
			async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, activeOrganizationId),
					),
					columns: { id: true, role: true },
				});
			},
		);

		if (!currentEmployee) {
			return none;
		}

		return yield* loadManagedEmployeesForEmployee({
			...currentEmployee,
			organizationId: activeOrganizationId,
		});
	});

	return runServerActionSafe(effect);
}

/**
 * Get upcoming absences for the organization
 */
export async function getUpcomingAbsences(
	limit: number = 5,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* sessionEmployee;

		return yield* loadUpcomingAbsencesForOrganization(currentEmployee.organizationId, limit);
	});

	return runServerActionSafe(effect);
}

/**
 * Get team calendar data for a specific month/year
 */
export async function getTeamCalendarData(
	month: number,
	year: number,
): Promise<ServerActionResult<any>> {
	const effect = Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const currentEmployee = yield* sessionEmployee;

		// Calculate date range for the month (as YYYY-MM-DD strings)
		const monthDT = DateTime.utc(year, month, 1);
		const monthStartStr = monthDT.startOf("month").toFormat("yyyy-MM-dd");
		const monthEndStr = monthDT.endOf("month").toFormat("yyyy-MM-dd");

		// A past calendar is a view of the past (#1438): a former employee's
		// absences stay up to today, in the organization's timezone, as in the team
		// calendar feed; later ones are left out with them.
		const [currentIds, orgEmployeeIds, organizationRow] =
			yield* dbService.query("dashboard.teamCalendar.employees", () =>
				Promise.all([
					currentRosterEmployeeIds(
						dbService.db,
						currentEmployee.organizationId,
					),
					dbService.db
						.select({ id: employee.id })
						.from(employee)
						.where(eq(employee.organizationId, currentEmployee.organizationId))
						.then((rows) => rows.map((row) => row.id)),
					dbService.db.query.organization.findFirst({
						where: eq(organization.id, currentEmployee.organizationId),
						columns: { timezone: true },
					}),
				]),
			);
		const today = todayCalendarDateKey(organizationRow?.timezone || "UTC");
		const currentOrStartedByToday =
			currentIds.length > 0
				? or(
						inArray(absenceEntry.employeeId, currentIds),
						lte(absenceEntry.startDate, today),
					)
				: lte(absenceEntry.startDate, today);

		// Get all absences for this month
		const absences = yield* dbService.query("getMonthAbsences", async () => {
			if (orgEmployeeIds.length === 0) return [];
			return await dbService.db.query.absenceEntry.findMany({
				where: and(
					inArray(absenceEntry.employeeId, orgEmployeeIds),
					currentOrStartedByToday,
					eq(absenceEntry.status, "approved"),
					or(
						and(
							gte(absenceEntry.startDate, monthStartStr),
							lte(absenceEntry.startDate, monthEndStr),
						),
						and(
							gte(absenceEntry.endDate, monthStartStr),
							lte(absenceEntry.endDate, monthEndStr),
						),
						and(
							lte(absenceEntry.startDate, monthStartStr),
							gte(absenceEntry.endDate, monthEndStr),
						),
					),
				),
				with: {
					employee: {
						with: {
							user: {
								columns: {
									name: true,
								},
							},
						},
					},
				},
			});
		});

		// Group absences by date
		const absenceDayMap = new Map<
			string,
			{ date: string; employees: any[]; count: number }
		>();
		const monthStartDT = DateTime.fromISO(monthStartStr);
		const monthEndDT = DateTime.fromISO(monthEndStr);

		const typedAbsences = absences as unknown as DashboardAbsenceEmployeeRow[];

		for (const absence of typedAbsences) {
			// absence.startDate and absence.endDate are now YYYY-MM-DD strings
			const startDT = DateTime.fromISO(absence.startDate);
			const endDT = DateTime.fromISO(absence.endDate);

			if (!startDT.isValid || !endDT.isValid) continue;

			// Iterate through each day of the absence
			let currentDT = startDT > monthStartDT ? startDT : monthStartDT;
			const lastDT = endDT < monthEndDT ? endDT : monthEndDT;

			while (currentDT <= lastDT) {
				const dateKey = currentDT.toFormat("yyyy-MM-dd");

				if (!absenceDayMap.has(dateKey)) {
					absenceDayMap.set(dateKey, {
						date: dateKey,
						employees: [],
						count: 0,
					});
				}

				const dayData = absenceDayMap.get(dateKey)!;
				dayData.employees.push({
					id: absence.employee.id,
					name: absence.employee.user.name || "Unknown",
				});
				dayData.count = dayData.employees.length;

				currentDT = currentDT.plus({ days: 1 });
			}
		}

		return {
			month,
			year,
			absenceDays: Array.from(absenceDayMap.values()),
		};
	});

	return runServerActionSafe(effect);
}

/**
 * Get recently approved requests
 */
export async function getRecentlyApprovedRequests(
	limit: number = 10,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* sessionEmployee;
		return yield* loadRecentlyApprovedForOrganization(currentEmployee.organizationId, limit);
	});

	return runServerActionSafe(effect);
}

/**
 * Get quick stats (weekly and monthly hours)
 */
export async function getQuickStats(): Promise<ServerActionResult<QuickStats>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		return yield* loadQuickStatsForSubject({
			userId: session.user.id,
			organizationId: session.session.activeOrganizationId ?? "",
		});
	});
	return runServerActionSafe(effect);
}
/**
 * Get upcoming birthdays
 */
export async function getUpcomingBirthdays(
	days: number = 30,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Get current employee
		const currentEmployee = yield* dbService
			.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
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

		// Get all employees with birthdays
		const employees = yield* dbService.query(
			"getEmployeesWithBirthdays",
			async () => {
				return await dbService.db.query.employee.findMany({
					where: and(
						onCurrentRoster(currentEmployee.organizationId),
						sql`${employee.birthday} IS NOT NULL`,
					),
					with: {
						user: {
							columns: {
								id: true,
								name: true,
								image: true,
							},
						},
					},
				});
			},
		);

		const now = currentTimestamp();
		const upcomingBirthdays: any[] = [];

		for (const emp of employees) {
			if (!emp.birthday) continue;

			const birthdayDT = dateFromDB(emp.birthday);
			if (!birthdayDT) continue;

			const nowDT = dateFromDB(now);
			if (!nowDT) continue;

			const thisYearBirthdayDT = DateTime.utc(
				nowDT.year,
				birthdayDT.month,
				birthdayDT.day,
			);
			const thisYearBirthday = thisYearBirthdayDT.toJSDate();

			// Check if birthday already passed this year
			let nextBirthdayDT = thisYearBirthdayDT;
			if (thisYearBirthday < now) {
				nextBirthdayDT = DateTime.utc(
					nowDT.year + 1,
					birthdayDT.month,
					birthdayDT.day,
				);
			}
			const nextBirthday = nextBirthdayDT.toJSDate();

			const todayStartDT = DateTime.fromJSDate(now).startOf("day");
			const daysUntil = Math.floor(
				nextBirthdayDT.diff(todayStartDT, "days").days,
			);

			if (daysUntil >= 0 && daysUntil <= days) {
				upcomingBirthdays.push({
					id: emp.id,
					userId: emp.user.id,
					image: emp.user.image,
					user: {
						name: emp.user.name,
					},
					birthday: emp.birthday,
					nextBirthday,
					daysUntil,
				});
			}
		}

		// Sort by next birthday date
		upcomingBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);

		return upcomingBirthdays;
	});

	return runServerActionSafe(effect);
}

/**
 * Team overview statistics for the organization. The employee count and the
 * average hours are the current roster's (#1438).
 */
export type TeamOverviewStats = {
	currentEmployees: number;
	teamsCount: number;
	avgWorkHours: number;
};

export async function getTeamOverviewStats(): Promise<
	ServerActionResult<TeamOverviewStats>
> {
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* sessionEmployee;

		return yield* loadTeamOverviewForOrganization(currentEmployee.organizationId);
	});

	return runServerActionSafe(effect);
}

/**
 * Get who's out today
 */
export type WhosOutTodayEmployee = {
	id: string;
	userId: string;
	name: string;
	image: string | null;
	category: string;
	categoryColor: string | null;
	endsToday: boolean;
	returnsTomorrow: boolean;
	returnDate: string;
};

export type WhosOutToday = {
	outToday: WhosOutTodayEmployee[];
	returningTomorrow: WhosOutTodayEmployee[];
	totalOut: number;
};

export async function getWhosOutToday(): Promise<
	ServerActionResult<WhosOutToday>
> {
	const effect = Effect.gen(function* () {
		const currentEmployee = yield* sessionEmployee;
		return yield* loadWhosOutForOrganization(currentEmployee.organizationId);
	});

	return runServerActionSafe(effect);
}

/**
 * Get vacation balance for the current user
 */
type DashboardVacationBalance = {
	totalDays: number;
	usedDays: number;
	previouslyTakenDays?: number;
	pendingDays: number;
	remainingDays: number;
	carryoverDays: number;
	carryoverExpiryDate: Date | null;
	carryoverExpiryDaysRemaining: number | null;
	hasCarryover: boolean;
};

/** Preserve the numeric balance API for existing callers. */
export async function getVacationBalance(): Promise<
	ServerActionResult<DashboardVacationBalance | null>
> {
	const result = await getVacationBalanceResult();
	return result.success ? { success: true, data: result.data.balance } : result;
}

/** Includes explicit policy configuration when no reliable balance is available. */
export async function getVacationBalanceResult(): Promise<
	ServerActionResult<{
		year: number;
		balance: DashboardVacationBalance | null;
		configuration: VacationBalanceConfiguration | null;
	}>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const activeOrganizationId = session.session.activeOrganizationId;

		// Get current employee
		const currentEmployee = yield* dbService
			.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						eq(employee.organizationId, activeOrganizationId ?? ""),
					),
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

		const org = yield* dbService.query(
			"getVacationBalanceOrganizationTimezone",
			async () => {
				return await dbService.db.query.organization.findFirst({
					where: eq(organization.id, currentEmployee.organizationId),
					columns: { timezone: true },
				});
			},
		);
		const timezone = org?.timezone || "UTC";
		const currentYear = calendarYearAt(
			instantFromDate(currentTimestamp()),
			timezone,
		);

		const { balance, configuration } = yield* dbService.query(
			"getVacationBalance:balance",
			() =>
				getEnhancedVacationBalanceResult({
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					year: currentYear,
					timezone,
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

	return runServerActionSafe(effect);
}

/**
 * Get hydration widget data for dashboard
 */
export async function getHydrationWidgetData(options?: {
	fresh?: boolean;
}): Promise<
	ServerActionResult<{
		enabled: boolean;
		currentStreak: number;
		longestStreak: number;
		todayIntake: number;
		dailyGoal: number;
		goalProgress: number;
		teamStreakLeaders: TeamStreakLeader[];
		organizationStreakLeaders: TeamStreakLeader[];
	}>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Get user's water reminder settings from userSettings
		const settings = yield* dbService.query(
			"getWaterReminderSettings",
			async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			},
		);

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

		// Get hydration stats
		const stats = yield* dbService.query("getHydrationStats", async () => {
			return dbService.db.query.hydrationStats.findFirst({
				where: eq(hydrationStats.userId, session.user.id),
			});
		});

		// Get today's intake using Luxon for date boundaries
		const todayStart = DateTime.now().startOf("day").toJSDate();
		const todayEnd = DateTime.now().endOf("day").toJSDate();

		const todayIntakeResult = yield* dbService.query(
			"getTodayIntake",
			async () => {
				return dbService.db
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
			},
		);

		const todayIntake = todayIntakeResult[0]?.total ?? 0;
		const goalProgress = Math.min(
			100,
			Math.round((todayIntake / dailyGoal) * 100),
		);
		const activeOrganizationId = session.session.activeOrganizationId;

		const teamStreakLeaders = yield* dbService
			.query("dashboard.getHydrationTeamStreakLeaders", async () => {
				if (!activeOrganizationId) {
					return [];
				}

				const currentEmployee = await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						onCurrentRoster(activeOrganizationId),
					),
					columns: {
						id: true,
						teamId: true,
					},
				});

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

				const teamIds = collectUniqueTeamIds(
					currentEmployee.teamId,
					memberships,
				);

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
						.leftJoin(
							hydrationStats,
							eq(hydrationStats.userId, employee.userId),
						)
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
								or(
									inArray(employee.teamId, sortedTeamIds),
									isNotNull(teamMembership.id),
								),
							),
						);

					return buildTeamStreakLeaders(
						candidates.map((candidate) => ({
							employeeId: candidate.employeeId,
							userId: candidate.userId,
							displayName: candidate.userName || "Team member",
							currentStreak: candidate.currentStreak,
						})),
						session.user.id,
						{ limit: 5, minimumParticipants: 2 },
					);
				};
				if (options?.fresh === true) return load();
				return unstable_cache(
					load,
					cacheConfig.keyParts,
					cacheConfig.options,
				)();
			})
			.pipe(Effect.catch(() => Effect.succeed([])));

		const organizationStreakLeaders = yield* dbService
			.query("dashboard.getHydrationOrganizationStreakLeaders", async () => {
				if (!activeOrganizationId) {
					return [];
				}

				const currentEmployee = await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.userId, session.user.id),
						onCurrentRoster(activeOrganizationId),
					),
					columns: {
						id: true,
					},
				});

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
					session.user.id,
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

	return runServerActionSafe(effect);
}

/**
 * Get user settings (creates if not exists)
 */
export async function getUserSettings(): Promise<
	ServerActionResult<{
		dashboardWidgetOrder: DashboardWidgetOrder | null;
	}>
> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;

		// Get or create user settings
		const settings = yield* dbService.query("getUserSettings", async () => {
			return dbService.db.query.userSettings.findFirst({
				where: eq(userSettings.userId, session.user.id),
			});
		});

		// If no settings exist, return null (will use defaults)
		return {
			dashboardWidgetOrder: settings?.dashboardWidgetOrder ?? null,
		};
	});

	return runServerActionSafe(effect);
}

/**
 * Update dashboard widget order and visibility.
 */
export async function updateWidgetOrder(
	layout: Pick<DashboardWidgetOrder, "order" | "hidden">,
	expectedScope?: { userId: string; organizationId: string },
): Promise<ServerActionResult<{ success: boolean; updatedAt: number }>> {
	const effect = Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		if (
			expectedScope &&
			(session.user.id !== expectedScope.userId ||
				session.session.activeOrganizationId !== expectedScope.organizationId)
		) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Dashboard context changed. Refresh to continue.",
				}),
			);
		}

		const widgetOrder: DashboardWidgetOrder = {
			order: layout.order,
			hidden: layout.hidden ?? [],
			version: 1,
		};

		// Upsert user settings with the new widget order
		yield* Effect.tryPromise({
			try: () =>
				writeUserSettings(dbService.db, session.user.id, {
					dashboardWidgetOrder: widgetOrder,
					updatedAt: currentTimestamp(),
				}),
			catch: (error) =>
				new NotFoundError({
					message: `Failed to update widget layout: ${error}`,
					entityType: "userSettings",
				}),
		});

		return {
			success: true,
			updatedAt: systemClock.nowInstant().epochMilliseconds,
		};
	});

	return runServerActionSafe(effect);
}
