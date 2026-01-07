"use server";

import { Effect } from "effect";
import { eq, and, gte, lte, inArray, or, isNull, sql } from "drizzle-orm";
import { AppLayer } from "@/lib/effect/runtime";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { ManagerService } from "@/lib/effect/services/manager.service";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	employee,
	absenceEntry,
	absenceCategory,
	approvalRequest,
	workPeriod,
	user,
	team,
} from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import {
	startOfMonth,
	endOfMonth,
	addDays,
	startOfWeek,
	endOfWeek,
	startOfDay,
	endOfDay,
	differenceInDays,
} from "date-fns";
import { calculateWorkHours } from "@/lib/time-tracking/calculations";
import { DateTime } from "luxon";
import { currentTimestamp, dateToDB, dateFromDB } from "@/lib/datetime/drizzle-adapter";
import { toDateKey } from "@/lib/datetime/luxon-utils";

/**
 * Get all employees managed by a specific manager
 */
export async function getManagedEmployees(
	managerId: string,
): Promise<ServerActionResult<any[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const managerService = yield* _(ManagerService);

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

		// Get managed employees using ManagerService
		const managedEmployees = yield* _(
			managerService.getManagedEmployees(managerId),
		);

		return managedEmployees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get upcoming absences for the organization
 */
export async function getUpcomingAbsences(
	limit: number = 5,
): Promise<ServerActionResult<any[]>> {
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

		const now = currentTimestamp();

		// Get upcoming absences (approved, starting from today)
		const absences = yield* _(
			dbService.query("getUpcomingAbsences", async () => {
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						eq(absenceEntry.status, "approved"),
						gte(absenceEntry.startDate, now),
					),
					orderBy: (absenceEntry, { asc }) => [asc(absenceEntry.startDate)],
					limit,
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

		// Calculate date range for the month
		const monthDT = DateTime.utc(year, month, 1);
		const monthStart = dateToDB(monthDT.startOf('month'))!;
		const monthEnd = dateToDB(monthDT.endOf('month'))!;

		// Get all absences for this month
		const absences = yield* _(
			dbService.query("getMonthAbsences", async () => {
				return await dbService.db.query.absenceEntry.findMany({
					where: and(
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						eq(absenceEntry.status, "approved"),
						or(
							and(
								gte(absenceEntry.startDate, monthStart),
								lte(absenceEntry.startDate, monthEnd),
							),
							and(
								gte(absenceEntry.endDate, monthStart),
								lte(absenceEntry.endDate, monthEnd),
							),
							and(
								lte(absenceEntry.startDate, monthStart),
								gte(absenceEntry.endDate, monthEnd),
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
		const absenceDayMap = new Map<string, { date: Date; employees: any[]; count: number }>();

		for (const absence of absences) {
			const startDT = dateFromDB(absence.startDate);
			const endDT = dateFromDB(absence.endDate);
			const monthStartDT = dateFromDB(monthStart);
			const monthEndDT = dateFromDB(monthEnd);

			if (!startDT || !endDT || !monthStartDT || !monthEndDT) continue;

			// Iterate through each day of the absence
			let currentDT = startDT > monthStartDT ? startDT : monthStartDT;
			const lastDT = endDT < monthEndDT ? endDT : monthEndDT;

			while (currentDT <= lastDT) {
				const dateKey = toDateKey(currentDT);

				if (!absenceDayMap.has(dateKey)) {
					absenceDayMap.set(dateKey, {
						date: dateToDB(currentDT)!,
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

		// Get recently approved requests
		const requests = yield* _(
			dbService.query("getRecentlyApproved", async () => {
				return await dbService.db.query.approvalRequest.findMany({
					where: and(
						eq(approvalRequest.organizationId, currentEmployee.organizationId),
						eq(approvalRequest.status, "approved"),
					),
					orderBy: (approvalRequest, { desc }) => [desc(approvalRequest.updatedAt)],
					limit,
					with: {
						requestedByEmployee: {
							with: {
								user: {
									columns: {
										name: true,
									},
								},
							},
						},
						approverEmployee: {
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
						workSchedule: {
							orderBy: (schedule, { desc }) => [desc(schedule.effectiveFrom)],
							limit: 1,
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
		const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
		const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
		const monthStart = startOfMonth(now);
		const monthEnd = endOfMonth(now);

		// Get work periods for this week
		const weekPeriods = yield* _(
			dbService.query("getWeekWorkPeriods", async () => {
				return await dbService.db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.employeeId, currentEmployee.id),
						gte(workPeriod.startTime, weekStart),
						lte(workPeriod.startTime, weekEnd),
						eq(workPeriod.isActive, false),
					),
				});
			}),
		);

		// Get work periods for this month
		const monthPeriods = yield* _(
			dbService.query("getMonthWorkPeriods", async () => {
				return await dbService.db.query.workPeriod.findMany({
					where: and(
						eq(workPeriod.employeeId, currentEmployee.id),
						gte(workPeriod.startTime, monthStart),
						lte(workPeriod.startTime, monthEnd),
						eq(workPeriod.isActive, false),
					),
				});
			}),
		);

		// Calculate total hours
		const weekActual = weekPeriods.reduce((total, period) => {
			if (period.endTime) {
				return total + calculateWorkHours(period.startTime, period.endTime, []);
			}
			return total;
		}, 0);

		const monthActual = monthPeriods.reduce((total, period) => {
			if (period.endTime) {
				return total + calculateWorkHours(period.startTime, period.endTime, []);
			}
			return total;
		}, 0);

		// Get expected hours from work schedule
		let weekExpected = 40; // Default
		let monthExpected = 160; // Default

		if (currentEmployee.workSchedule && currentEmployee.workSchedule.length > 0) {
			const schedule = currentEmployee.workSchedule[0];
			if (schedule.scheduleType === "simple" && schedule.hoursPerWeek) {
				weekExpected = Number.parseFloat(schedule.hoursPerWeek);
				// Estimate monthly hours based on weekly hours
				const weeksInMonth = differenceInDays(monthEnd, monthStart) / 7;
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
export async function getUpcomingBirthdays(
	days: number = 30,
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
								name: true,
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

			const thisYearBirthday = DateTime.utc(nowDT.year, birthdayDT.month, birthdayDT.day).toJSDate();

			// Check if birthday already passed this year
			let nextBirthday = thisYearBirthday;
			if (thisYearBirthday < now) {
				nextBirthday = DateTime.utc(nowDT.year + 1, birthdayDT.month, birthdayDT.day).toJSDate();
			}

			const daysUntil = differenceInDays(nextBirthday, startOfDay(now));

			if (daysUntil >= 0 && daysUntil <= days) {
				upcomingBirthdays.push({
					id: emp.id,
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
