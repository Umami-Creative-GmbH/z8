"use server";

import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import {
	absenceEntry,
	approvalRequest,
	employee,
	hydrationStats,
	team,
	userSettings,
	waterIntakeLog,
	workPeriod,
} from "@/db/schema";
import type { DashboardWidgetOrder } from "@/db/schema";
import { getEnhancedVacationBalance } from "@/lib/absences/vacation.service";
import { currentTimestamp, dateFromDB, dateToDB } from "@/lib/datetime/drizzle-adapter";
import { toDateKey } from "@/lib/datetime/luxon-utils";
import { NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { getVacationAllowance } from "@/lib/query/vacation.queries";

/**
 * Get all employees managed by a specific manager
 */
export async function getManagedEmployees(managerId: string): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const managerService = yield* _(ManagerService);

		// Get current employee
		const _currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		// Get managed employees using ManagerService
		const managedEmployees = yield* _(managerService.getManagedEmployees(managerId));

		return managedEmployees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get upcoming absences for the organization
 */
export async function getUpcomingAbsences(limit: number = 5): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee with organization
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
					with: {
						organization: true,
					},
				});
			}),
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

		// Get today's date as YYYY-MM-DD string for absence date comparison
		const todayStr = DateTime.now().toFormat("yyyy-MM-dd");

		// Get all employee IDs in this organization
		const orgEmployees = yield* _(
			dbService.query("getOrgEmployeeIds", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, currentEmployee.organizationId),
					columns: { id: true },
				});
			}),
		);
		const orgEmployeeIds = orgEmployees.map((e) => e.id);

		// Get upcoming absences (approved, starting from today)
		const absences = yield* _(
			dbService.query("getUpcomingAbsences", async () => {
				if (orgEmployeeIds.length === 0) return [];
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						inArray(absenceEntry.employeeId, orgEmployeeIds),
						eq(absenceEntry.status, "approved"),
						gte(absenceEntry.startDate, todayStr),
					),
					orderBy: (absenceEntry, { asc }) => [asc(absenceEntry.startDate)],
					limit,
					with: {
						employee: {
							with: {
								user: {
									columns: {
										id: true,
										name: true,
										image: true,
									},
								},
							},
						},
						category: {
							columns: {
								name: true,
								color: true,
							},
						},
					},
				});
			}),
		);

		return absences;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get team calendar data for a specific month/year
 */
export async function getTeamCalendarData(
	month: number,
	year: number,
): Promise<ServerActionResult<any>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		// Calculate date range for the month (as YYYY-MM-DD strings)
		const monthDT = DateTime.utc(year, month, 1);
		const monthStartStr = monthDT.startOf("month").toFormat("yyyy-MM-dd");
		const monthEndStr = monthDT.endOf("month").toFormat("yyyy-MM-dd");

		// Get all employee IDs in this organization
		const orgEmployees = yield* _(
			dbService.query("getOrgEmployeeIds", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, currentEmployee.organizationId),
					columns: { id: true },
				});
			}),
		);
		const orgEmployeeIds = orgEmployees.map((e) => e.id);

		// Get all absences for this month
		const absences = yield* _(
			dbService.query("getMonthAbsences", async () => {
				if (orgEmployeeIds.length === 0) return [];
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						inArray(absenceEntry.employeeId, orgEmployeeIds),
						eq(absenceEntry.status, "approved"),
						or(
							and(
								gte(absenceEntry.startDate, monthStartStr),
								lte(absenceEntry.startDate, monthEndStr),
							),
							and(gte(absenceEntry.endDate, monthStartStr), lte(absenceEntry.endDate, monthEndStr)),
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
			}),
		);

		// Group absences by date
		const absenceDayMap = new Map<string, { date: string; employees: any[]; count: number }>();
		const monthStartDT = DateTime.fromISO(monthStartStr);
		const monthEndDT = DateTime.fromISO(monthEndStr);

		for (const absence of absences) {
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get recently approved requests
 */
export async function getRecentlyApprovedRequests(
	limit: number = 10,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		// Get all employee IDs in this organization for filtering
		const orgEmployees = yield* _(
			dbService.query("getOrgEmployeeIds", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, currentEmployee.organizationId),
					columns: { id: true },
				});
			}),
		);
		const orgEmployeeIds = orgEmployees.map((e) => e.id);

		// Get recently approved requests
		const requests = yield* _(
			dbService.query("getRecentlyApproved", async () => {
				if (orgEmployeeIds.length === 0) return [];
				return await dbService.db.query.approvalRequest.findMany({
					where: and(
						inArray(approvalRequest.requestedBy, orgEmployeeIds),
						eq(approvalRequest.status, "approved"),
					),
					orderBy: (approvalRequest, { desc }) => [desc(approvalRequest.updatedAt)],
					limit,
					with: {
						requester: {
							with: {
								user: {
									columns: {
										name: true,
									},
								},
							},
						},
						approver: {
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
			}),
		);

		return requests;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get quick stats (weekly and monthly hours)
 */
export async function getQuickStats(): Promise<ServerActionResult<any>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
					with: {
						workPolicyAssignments: {
							where: (assignment, { eq }) => eq(assignment.isActive, true),
							orderBy: (assignment, { desc }) => [desc(assignment.effectiveFrom)],
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
			}),
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
		const nowDT = DateTime.fromJSDate(now);
		const weekStart = nowDT.startOf("week").toJSDate(); // Luxon uses Monday by default
		const weekEnd = nowDT.endOf("week").toJSDate();
		const monthStart = nowDT.startOf("month").toJSDate();
		const monthEnd = nowDT.endOf("month").toJSDate();

		// Get all work periods for this month (includes this week)
		const monthPeriods = yield* _(
			dbService.query("getMonthWorkPeriods", async () => {
				return await dbService.db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.employeeId, currentEmployee.id),
						eq(workPeriod.organizationId, currentEmployee.organizationId),
						gte(workPeriod.startTime, monthStart),
						lte(workPeriod.startTime, monthEnd),
					),
				});
			}),
		);

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

		// Get expected hours from work schedule
		let weekExpected = 40; // Default
		let monthExpected = 160; // Default

		if (currentEmployee.workPolicyAssignments && currentEmployee.workPolicyAssignments.length > 0) {
			const assignment = currentEmployee.workPolicyAssignments[0];
			const schedule = assignment.policy?.schedule;
			if (schedule && schedule.scheduleType === "simple" && schedule.hoursPerCycle) {
				// Convert hoursPerCycle to weekly hours based on scheduleCycle
				const hoursPerCycle = Number.parseFloat(schedule.hoursPerCycle);
				if (schedule.scheduleCycle === "weekly") {
					weekExpected = hoursPerCycle;
				} else if (schedule.scheduleCycle === "biweekly") {
					weekExpected = hoursPerCycle / 2;
				} else if (schedule.scheduleCycle === "monthly") {
					weekExpected = (hoursPerCycle * 12) / 52;
				} else {
					weekExpected = hoursPerCycle; // default to treating as weekly
				}
				// Estimate monthly hours based on weekly hours
				const daysInMonth = DateTime.fromJSDate(monthEnd).diff(
					DateTime.fromJSDate(monthStart),
					"days",
				).days;
				const weeksInMonth = daysInMonth / 7;
				monthExpected = weekExpected * weeksInMonth;
			}
		}

		return {
			thisWeek: {
				actual: weekActual,
				expected: weekExpected,
			},
			thisMonth: {
				actual: monthActual,
				expected: monthExpected,
			},
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get upcoming birthdays
 */
export async function getUpcomingBirthdays(days: number = 30): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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
		const employees = yield* _(
			dbService.query("getEmployeesWithBirthdays", async () => {
				return await dbService.db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, currentEmployee.organizationId),
						eq(employee.isActive, true),
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
			}),
		);

		const now = currentTimestamp();
		const upcomingBirthdays: any[] = [];

		for (const emp of employees) {
			if (!emp.birthday) continue;

			const birthdayDT = dateFromDB(emp.birthday);
			if (!birthdayDT) continue;

			const nowDT = dateFromDB(now);
			if (!nowDT) continue;

			const thisYearBirthdayDT = DateTime.utc(nowDT.year, birthdayDT.month, birthdayDT.day);
			const thisYearBirthday = thisYearBirthdayDT.toJSDate();

			// Check if birthday already passed this year
			let nextBirthdayDT = thisYearBirthdayDT;
			if (thisYearBirthday < now) {
				nextBirthdayDT = DateTime.utc(nowDT.year + 1, birthdayDT.month, birthdayDT.day);
			}
			const nextBirthday = nextBirthdayDT.toJSDate();

			const todayStartDT = DateTime.fromJSDate(now).startOf("day");
			const daysUntil = Math.floor(nextBirthdayDT.diff(todayStartDT, "days").days);

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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get team overview statistics for the organization
 */
export async function getTeamOverviewStats(): Promise<
	ServerActionResult<{
		totalEmployees: number;
		activeEmployees: number;
		teamsCount: number;
		avgWorkHours: number;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		// Count total employees in organization
		const totalEmployeesResult = yield* _(
			dbService.query("getTotalEmployees", async () => {
				const result = await dbService.db
					.select({ count: sql<number>`count(*)::int` })
					.from(employee)
					.where(eq(employee.organizationId, currentEmployee.organizationId));
				return result[0]?.count ?? 0;
			}),
		);

		// Count active employees in organization
		const activeEmployeesResult = yield* _(
			dbService.query("getActiveEmployees", async () => {
				const result = await dbService.db
					.select({ count: sql<number>`count(*)::int` })
					.from(employee)
					.where(
						and(
							eq(employee.organizationId, currentEmployee.organizationId),
							eq(employee.isActive, true),
						),
					);
				return result[0]?.count ?? 0;
			}),
		);

		// Count teams in organization
		const teamsCountResult = yield* _(
			dbService.query("getTeamsCount", async () => {
				const result = await dbService.db
					.select({ count: sql<number>`count(*)::int` })
					.from(team)
					.where(eq(team.organizationId, currentEmployee.organizationId));
				return result[0]?.count ?? 0;
			}),
		);

		// Calculate average work hours from work schedules
		const avgWorkHoursResult = yield* _(
			dbService.query("getAvgWorkHours", async () => {
				// Get all employees with their work schedule assignments (includes template)
				const employeesWithSchedules = await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, currentEmployee.organizationId),
					with: {
						workPolicyAssignments: {
							where: (assignment, { eq }) => eq(assignment.isActive, true),
							orderBy: (assignment, { desc }) => [desc(assignment.effectiveFrom)],
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

				// Calculate average from simple schedules that have hoursPerCycle
				let totalHours = 0;
				let countWithSchedule = 0;

				for (const emp of employeesWithSchedules) {
					if (emp.workPolicyAssignments && emp.workPolicyAssignments.length > 0) {
						const assignment = emp.workPolicyAssignments[0];
						const schedule = assignment.policy?.schedule;
						if (schedule && schedule.scheduleType === "simple" && schedule.hoursPerCycle) {
							// Convert hoursPerCycle to weekly hours based on scheduleCycle
							const hoursPerCycle = Number.parseFloat(schedule.hoursPerCycle);
							let weeklyHours = hoursPerCycle;
							if (schedule.scheduleCycle === "biweekly") {
								weeklyHours = hoursPerCycle / 2;
							} else if (schedule.scheduleCycle === "monthly") {
								weeklyHours = (hoursPerCycle * 12) / 52;
							}
							totalHours += weeklyHours;
							countWithSchedule++;
						}
					}
				}

				// Default to 40 if no schedules found
				return countWithSchedule > 0 ? totalHours / countWithSchedule : 40;
			}),
		);

		return {
			totalEmployees: totalEmployeesResult,
			activeEmployees: activeEmployeesResult,
			teamsCount: teamsCountResult,
			avgWorkHours: Math.round(avgWorkHoursResult * 10) / 10, // Round to 1 decimal
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get who's out today
 */
export async function getWhosOutToday(): Promise<
	ServerActionResult<{
		outToday: Array<{
			id: string;
			userId: string;
			name: string;
			image: string | null;
			category: string;
			categoryColor: string | null;
			endsToday: boolean;
			returnDate: string;
		}>;
		returningTomorrow: Array<{
			id: string;
			userId: string;
			name: string;
			image: string | null;
			category: string;
			categoryColor: string | null;
			endsToday: boolean;
			returnDate: string;
		}>;
		totalOut: number;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee with organization
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		// Get today's date as YYYY-MM-DD string
		const todayDT = DateTime.now();
		const todayStr = todayDT.toFormat("yyyy-MM-dd");
		const tomorrowStr = todayDT.plus({ days: 1 }).toFormat("yyyy-MM-dd");

		// Get all employee IDs in this organization
		const orgEmployees = yield* _(
			dbService.query("getOrgEmployeeIds", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, currentEmployee.organizationId),
					columns: { id: true },
				});
			}),
		);
		const orgEmployeeIds = orgEmployees.map((e) => e.id);

		// Get absences that overlap with today
		const todayAbsences = yield* _(
			dbService.query("getTodayAbsences", async () => {
				if (orgEmployeeIds.length === 0) return [];
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						inArray(absenceEntry.employeeId, orgEmployeeIds),
						eq(absenceEntry.status, "approved"),
						lte(absenceEntry.startDate, todayStr),
						gte(absenceEntry.endDate, todayStr),
					),
					with: {
						employee: {
							with: {
								user: {
									columns: {
										id: true,
										name: true,
										image: true,
									},
								},
							},
						},
						category: {
							columns: {
								name: true,
								color: true,
							},
						},
					},
				});
			}),
		);

		// Process absences - deduplicate by employee ID (employee may have multiple overlapping absences)
		const outTodayMap = new Map<
			string,
			{
				id: string;
				userId: string;
				name: string;
				image: string | null;
				category: string;
				categoryColor: string | null;
				endsToday: boolean;
				returnDate: string;
			}
		>();

		const returningTomorrowMap = new Map<
			string,
			{
				id: string;
				userId: string;
				name: string;
				image: string | null;
				category: string;
				categoryColor: string | null;
				endsToday: boolean;
				returnDate: string;
			}
		>();

		for (const absence of todayAbsences) {
			const employeeId = absence.employee.id;
			const endsToday = absence.endDate === todayStr;
			const endDT = DateTime.fromISO(absence.endDate);
			const returnDate = endDT.plus({ days: 1 }).toFormat("MMM d");

			const employeeData = {
				id: employeeId,
				userId: absence.employee.user.id,
				name: absence.employee.user.name || "Unknown",
				image: absence.employee.user.image,
				category: absence.category.name,
				categoryColor: absence.category.color,
				endsToday,
				returnDate,
			};

			// Only add if not already present (first absence wins)
			if (!outTodayMap.has(employeeId)) {
				outTodayMap.set(employeeId, employeeData);
			}

			if (endsToday && !returningTomorrowMap.has(employeeId)) {
				returningTomorrowMap.set(employeeId, employeeData);
			}
		}

		const outToday = Array.from(outTodayMap.values());
		const returningTomorrow = Array.from(returningTomorrowMap.values());

		// Sort by name
		outToday.sort((a, b) => a.name.localeCompare(b.name));
		returningTomorrow.sort((a, b) => a.name.localeCompare(b.name));

		return {
			outToday,
			returningTomorrow,
			totalOut: outToday.length,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get vacation balance for the current user
 */
export async function getVacationBalance(): Promise<
	ServerActionResult<{
		totalDays: number;
		usedDays: number;
		pendingDays: number;
		remainingDays: number;
		carryoverDays: number;
		carryoverExpiryDate: Date | null;
		carryoverExpiryDaysRemaining: number | null;
		hasCarryover: boolean;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get current employee
		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
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

		const currentYear = new Date().getFullYear();

		// Check if organization has a vacation policy
		const policy = yield* _(
			Effect.tryPromise({
				try: () => getVacationAllowance(currentEmployee.organizationId, currentYear),
				catch: () =>
					new NotFoundError({
						message: "Vacation policy not found",
						entityType: "vacationAllowance",
					}),
			}),
		);

		if (!policy) {
			return {
				totalDays: 0,
				usedDays: 0,
				pendingDays: 0,
				remainingDays: 0,
				carryoverDays: 0,
				carryoverExpiryDate: null,
				carryoverExpiryDaysRemaining: null,
				hasCarryover: false,
			};
		}

		// Get enhanced vacation balance
		const balance = yield* _(
			Effect.tryPromise({
				try: () =>
					getEnhancedVacationBalance({
						employeeId: currentEmployee.id,
						year: currentYear,
					}),
				catch: (error) =>
					new NotFoundError({
						message: `Failed to get vacation balance: ${error}`,
						entityType: "vacationBalance",
					}),
			}),
		);

		if (!balance) {
			return {
				totalDays: parseFloat(policy.defaultAnnualDays),
				usedDays: 0,
				pendingDays: 0,
				remainingDays: parseFloat(policy.defaultAnnualDays),
				carryoverDays: 0,
				carryoverExpiryDate: null,
				carryoverExpiryDaysRemaining: null,
				hasCarryover: policy.allowCarryover,
			};
		}

		return {
			totalDays: balance.totalDays,
			usedDays: balance.usedDays,
			pendingDays: balance.pendingDays,
			remainingDays: balance.remainingDays,
			carryoverDays: balance.carryoverDays || 0,
			carryoverExpiryDate: balance.carryoverExpiryDate || null,
			carryoverExpiryDaysRemaining: balance.carryoverExpiryDaysRemaining,
			hasCarryover: policy.allowCarryover,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get hydration widget data for dashboard
 */
export async function getHydrationWidgetData(): Promise<
	ServerActionResult<{
		enabled: boolean;
		currentStreak: number;
		longestStreak: number;
		todayIntake: number;
		dailyGoal: number;
		goalProgress: number;
	}>
> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get user's water reminder settings from userSettings
		const settings = yield* _(
			dbService.query("getWaterReminderSettings", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			}),
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
			};
		}

		const dailyGoal = settings.waterReminderDailyGoal ?? 8;

		// Get hydration stats
		const stats = yield* _(
			dbService.query("getHydrationStats", async () => {
				return dbService.db.query.hydrationStats.findFirst({
					where: eq(hydrationStats.userId, session.user.id),
				});
			}),
		);

		// Get today's intake using Luxon for date boundaries
		const todayStart = DateTime.now().startOf("day").toJSDate();
		const todayEnd = DateTime.now().endOf("day").toJSDate();

		const todayIntakeResult = yield* _(
			dbService.query("getTodayIntake", async () => {
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
			}),
		);

		const todayIntake = todayIntakeResult[0]?.total ?? 0;
		const goalProgress = Math.min(100, Math.round((todayIntake / dailyGoal) * 100));

		return {
			enabled: true,
			currentStreak: stats?.currentStreak ?? 0,
			longestStreak: stats?.longestStreak ?? 0,
			todayIntake,
			dailyGoal,
			goalProgress,
		};
	}).pipe(Effect.provide(AppLayer));

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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		// Get or create user settings
		const settings = yield* _(
			dbService.query("getUserSettings", async () => {
				return dbService.db.query.userSettings.findFirst({
					where: eq(userSettings.userId, session.user.id),
				});
			}),
		);

		// If no settings exist, return null (will use defaults)
		return {
			dashboardWidgetOrder: settings?.dashboardWidgetOrder ?? null,
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update dashboard widget order
 */
export async function updateWidgetOrder(
	order: string[],
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const widgetOrder: DashboardWidgetOrder = {
			order,
			version: 1,
		};

		// Upsert user settings with the new widget order
		yield* _(
			Effect.tryPromise({
				try: async () => {
					// Try to update existing settings first
					const updated = await dbService.db
						.update(userSettings)
						.set({
							dashboardWidgetOrder: widgetOrder,
							updatedAt: currentTimestamp(),
						})
						.where(eq(userSettings.userId, session.user.id))
						.returning();

					// If no row was updated, insert a new one
					if (updated.length === 0) {
						await dbService.db.insert(userSettings).values({
							userId: session.user.id,
							dashboardWidgetOrder: widgetOrder,
							updatedAt: currentTimestamp(),
						});
					}
				},
				catch: (error) =>
					new NotFoundError({
						message: `Failed to update widget order: ${error}`,
						entityType: "userSettings",
					}),
			}),
		);

		return { success: true };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
