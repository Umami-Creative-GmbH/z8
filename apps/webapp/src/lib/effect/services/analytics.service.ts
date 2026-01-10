/**
 * Analytics Service
 *
 * Effect-based service for analytics computations and aggregations.
 * Provides team performance, vacation trends, work hours analytics,
 * absence patterns, and manager effectiveness metrics.
 */

import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	team,
	user,
	workPeriod,
} from "@/db/schema";
import type {
	AbsencePatternsData,
	AbsencePatternsParams,
	ManagerEffectivenessData,
	ManagerEffectivenessParams,
	TeamPerformanceData,
	TeamPerformanceParams,
	VacationTrendsData,
	VacationTrendsParams,
	WorkHoursAnalyticsData,
	WorkHoursParams,
} from "@/lib/analytics/types";
import { differenceInDays, format } from "@/lib/datetime/luxon-utils";
import { calculateExpectedWorkHours, calculateWorkHours } from "@/lib/time-tracking/calculations";
import type { DatabaseError, NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";

/**
 * Calculate clustering score for vacation absences (0-100)
 * Higher scores indicate more clustered (overlapping) vacation periods
 */
function calculateClusteringScore(absences: Array<{ startDate: Date; endDate: Date }>): number {
	if (absences.length < 2) return 0;

	// Build a map of dates to absence counts
	const dateCountMap = new Map<string, number>();

	for (const absence of absences) {
		const startDT = DateTime.fromJSDate(new Date(absence.startDate));
		const endDT = DateTime.fromJSDate(new Date(absence.endDate));
		let currentDT = startDT;

		while (currentDT <= endDT) {
			const dateKey = currentDT.toISODate()!;
			dateCountMap.set(dateKey, (dateCountMap.get(dateKey) || 0) + 1);
			currentDT = currentDT.plus({ days: 1 });
		}
	}

	// Calculate overlap percentage
	const overlappingDays = Array.from(dateCountMap.values()).filter((count) => count > 1).length;
	const totalDays = dateCountMap.size;

	if (totalDays === 0) return 0;

	// Score is percentage of days with overlapping absences
	return Math.round((overlappingDays / totalDays) * 100);
}

/**
 * Calculate expected work days in a date range
 */
function calculateExpectedWorkDays(startDate: Date, endDate: Date): number {
	const startDT = DateTime.fromJSDate(startDate);
	const endDT = DateTime.fromJSDate(endDate);
	let workDays = 0;
	let currentDT = startDT;

	while (currentDT <= endDT) {
		// Weekday check (1-5 = Mon-Fri)
		if (currentDT.weekday <= 5) {
			workDays++;
		}
		currentDT = currentDT.plus({ days: 1 });
	}

	return workDays;
}

export class AnalyticsService extends Context.Tag("AnalyticsService")<
	AnalyticsService,
	{
		readonly getTeamPerformance: (
			params: TeamPerformanceParams,
		) => Effect.Effect<TeamPerformanceData, NotFoundError | ValidationError | DatabaseError>;
		readonly getVacationTrends: (
			params: VacationTrendsParams,
		) => Effect.Effect<VacationTrendsData, NotFoundError | ValidationError | DatabaseError>;
		readonly getWorkHoursAnalytics: (
			params: WorkHoursParams,
		) => Effect.Effect<WorkHoursAnalyticsData, NotFoundError | ValidationError | DatabaseError>;
		readonly getAbsencePatterns: (
			params: AbsencePatternsParams,
		) => Effect.Effect<AbsencePatternsData, NotFoundError | ValidationError | DatabaseError>;
		readonly getManagerEffectiveness: (
			params: ManagerEffectivenessParams,
		) => Effect.Effect<ManagerEffectivenessData, NotFoundError | ValidationError | DatabaseError>;
	}
>() {
	static readonly Live = Layer.effect(
		AnalyticsService,
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);

			return {
				getTeamPerformance: (params: TeamPerformanceParams) =>
					Effect.gen(function* (_) {
						const { organizationId, dateRange, teamId } = params;

						// Get all employees in the organization (or specific team)
						const employees = yield* _(
							dbService.query("getEmployeesForAnalytics", async () => {
								const query = dbService.db.query.employee.findMany({
									where: teamId
										? and(
												eq(employee.organizationId, organizationId),
												eq(employee.teamId, teamId),
												eq(employee.isActive, true),
											)
										: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
									with: {
										user: true,
										team: true,
									},
								});
								return await query;
							}),
						);

						// Calculate work hours for each employee
						const employeeHoursPromises = employees.map(async (emp) => {
							const summary = await calculateWorkHours(
								emp.id,
								organizationId,
								dateRange.start,
								dateRange.end,
							);

							const expected = await calculateExpectedWorkHours(
								organizationId,
								dateRange.start,
								dateRange.end,
							);

							return {
								employeeId: emp.id,
								employeeName: emp.user.name || "Unknown",
								teamId: emp.teamId,
								teamName: emp.team?.name || "No Team",
								totalHours: summary.totalHours,
								expectedHours: expected.totalHours,
								variance: summary.totalHours - expected.totalHours,
								percentageOfExpected:
									expected.totalHours > 0 ? (summary.totalHours / expected.totalHours) * 100 : 0,
							};
						});

						const employeeHours = yield* _(
							Effect.promise(() => Promise.all(employeeHoursPromises)),
						);

						// Group by team
						const teamMap = new Map<
							string,
							{
								teamId: string;
								teamName: string;
								totalHours: number;
								employeeCount: number;
								employees: typeof employeeHours;
							}
						>();

						for (const empData of employeeHours) {
							const key = empData.teamId || "no-team";
							const existing = teamMap.get(key);

							if (existing) {
								existing.totalHours += empData.totalHours;
								existing.employeeCount++;
								existing.employees.push(empData);
							} else {
								teamMap.set(key, {
									teamId: empData.teamId || "",
									teamName: empData.teamName,
									totalHours: empData.totalHours,
									employeeCount: 1,
									employees: [empData],
								});
							}
						}

						// Convert to array and calculate averages
						const teams = Array.from(teamMap.values()).map((t) => ({
							teamId: t.teamId,
							teamName: t.teamName,
							totalHours: Math.round(t.totalHours * 100) / 100,
							avgHoursPerEmployee: Math.round((t.totalHours / t.employeeCount) * 100) / 100,
							employeeCount: t.employeeCount,
							employees: t.employees.map((e) => ({
								employeeId: e.employeeId,
								employeeName: e.employeeName,
								totalHours: Math.round(e.totalHours * 100) / 100,
								expectedHours: Math.round(e.expectedHours * 100) / 100,
								variance: Math.round(e.variance * 100) / 100,
								percentageOfExpected: Math.round(e.percentageOfExpected * 100) / 100,
							})),
						}));

						const organizationTotal = teams.reduce((sum, t) => sum + t.totalHours, 0);

						return {
							teams,
							organizationTotal: Math.round(organizationTotal * 100) / 100,
							dateRange,
						};
					}),

				getVacationTrends: (params: VacationTrendsParams) =>
					Effect.gen(function* (_) {
						const { organizationId, dateRange } = params;

						// Get all employees with vacation allowances
						const employees = yield* _(
							dbService.query("getEmployeesWithVacation", async () => {
								return await dbService.db.query.employee.findMany({
									where: and(
										eq(employee.organizationId, organizationId),
										eq(employee.isActive, true),
									),
									with: {
										user: true,
										vacationAllowances: true,
									},
								});
							}),
						);

						// Get all approved absences in date range
						const absences = yield* _(
							dbService.query("getApprovedAbsences", async () => {
								return await dbService.db.query.absenceEntry.findMany({
									where: and(
										eq(absenceEntry.status, "approved"),
										gte(absenceEntry.startDate, dateRange.start),
										lte(absenceEntry.endDate, dateRange.end),
									),
									with: {
										employee: true, // Filter by organization in memory
										category: true,
									},
								});
							}),
						);

						// Calculate overall stats
						const totalDaysAllocated = employees.reduce((sum, emp) => {
							const allowance = emp.vacationAllowances?.[0];
							return (
								sum +
								(allowance
									? (Number(allowance.customAnnualDays) || 0) +
										(Number(allowance.customCarryoverDays) || 0) +
										(Number(allowance.adjustmentDays) || 0)
									: 0)
							);
						}, 0);

						const totalDaysTaken = absences.reduce((sum, absence) => {
							const days = differenceInDays(new Date(absence.endDate), new Date(absence.startDate));
							return sum + Math.max(1, days);
						}, 0);

						const totalDaysRemaining = totalDaysAllocated - totalDaysTaken;
						const utilizationRate =
							totalDaysAllocated > 0 ? (totalDaysTaken / totalDaysAllocated) * 100 : 0;

						// Group by month
						const monthlyMap = new Map<string, { taken: number; remaining: number }>();
						for (const absence of absences) {
							const month = format(new Date(absence.startDate), "yyyy-MM");
							const days = differenceInDays(new Date(absence.endDate), new Date(absence.startDate));
							const existing = monthlyMap.get(month) || { taken: 0, remaining: 0 };
							existing.taken += Math.max(1, days);
							monthlyMap.set(month, existing);
						}

						const byMonth = Array.from(monthlyMap.entries()).map(([month, data]) => ({
							month,
							daysTaken: data.taken,
							daysRemaining: totalDaysAllocated - data.taken,
						}));

						// By employee
						const byEmployee = employees.map((emp) => {
							const allowance = emp.vacationAllowances?.[0];
							const allocated = allowance
								? (Number(allowance.customAnnualDays) || 0) +
									(Number(allowance.customCarryoverDays) || 0) +
									(Number(allowance.adjustmentDays) || 0)
								: 0;

							const taken = absences
								.filter((a) => a.employeeId === emp.id)
								.reduce((sum, a) => {
									const days = differenceInDays(new Date(a.endDate), new Date(a.startDate));
									return sum + Math.max(1, days);
								}, 0);

							return {
								employeeId: emp.id,
								employeeName: emp.user.name || "Unknown",
								allocated,
								taken,
								remaining: allocated - taken,
								utilizationRate: allocated > 0 ? (taken / allocated) * 100 : 0,
							};
						});

						// Find peak months
						const monthCounts = Array.from(monthlyMap.entries())
							.sort((a, b) => b[1].taken - a[1].taken)
							.slice(0, 3)
							.map(([month]) => month);

						// Calculate clustering score (0-100)
						// Higher score means more clustered vacation patterns
						const clusteringScore = calculateClusteringScore(absences);

						return {
							overall: {
								totalDaysAllocated,
								totalDaysTaken,
								totalDaysRemaining,
								utilizationRate: Math.round(utilizationRate * 100) / 100,
							},
							byMonth,
							byEmployee: byEmployee.map((e) => ({
								employeeId: e.employeeId,
								employeeName: e.employeeName,
								daysAllocated: e.allocated,
								daysTaken: e.taken,
								daysRemaining: e.remaining,
								utilizationRate: Math.round(e.utilizationRate * 100) / 100,
							})),
							monthlyUsage: byMonth.map((m) => ({
								month: m.month,
								days: m.daysTaken,
							})),
							peakMonths: monthCounts.map((month) => ({
								month,
								count: monthlyMap.get(month)?.taken || 0,
							})),
							employees: byEmployee,
							patterns: {
								peakMonths: monthCounts,
								averageDaysPerRequest:
									absences.length > 0
										? Math.round((totalDaysTaken / absences.length) * 100) / 100
										: 0,
								clusteringScore,
							},
						};
					}),

				getWorkHoursAnalytics: (params: WorkHoursParams) =>
					Effect.gen(function* (_) {
						const { organizationId, dateRange, employeeId } = params;

						// Get employees (all or specific one)
						const employees = yield* _(
							dbService.query("getEmployeesForWorkAnalytics", async () => {
								return await dbService.db.query.employee.findMany({
									where: employeeId
										? and(eq(employee.organizationId, organizationId), eq(employee.id, employeeId))
										: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
									with: {
										user: true,
									},
								});
							}),
						);

						// Calculate work hours for each employee
						const employeeDataPromises = employees.map(async (emp) => {
							const actual = await calculateWorkHours(
								emp.id,
								organizationId,
								dateRange.start,
								dateRange.end,
							);

							const expected = await calculateExpectedWorkHours(
								organizationId,
								dateRange.start,
								dateRange.end,
							);

							const overtimeHours = Math.max(0, actual.totalHours - expected.totalHours);
							const undertimeHours = Math.max(0, expected.totalHours - actual.totalHours);

							return {
								employeeId: emp.id,
								employeeName: emp.user.name || "Unknown",
								totalHours: actual.totalHours,
								expectedHours: expected.totalHours,
								overtimeHours,
								undertimeHours,
								avgHoursPerWeek:
									expected.workDays > 0 ? (actual.totalHours / expected.workDays) * 5 : 0,
							};
						});

						const employeeData = yield* _(Effect.promise(() => Promise.all(employeeDataPromises)));

						// Calculate summary
						const totalHours = employeeData.reduce((sum, e) => sum + e.totalHours, 0);
						const totalExpected = employeeData.reduce((sum, e) => sum + e.expectedHours, 0);
						const overtimeHours = Math.max(0, totalHours - totalExpected);
						const undertimeHours = Math.max(0, totalExpected - totalHours);

						const avgHoursPerWeek =
							employeeData.length > 0 ? totalHours / employeeData.length / 4 : 0;

						// Get daily distribution by aggregating work periods per day
						const workPeriods = yield* _(
							dbService.query("getWorkPeriodsForDistribution", async () => {
								const employeeIds = employees.map((e) => e.id);
								if (employeeIds.length === 0) return [];
								return await dbService.db.query.workPeriod.findMany({
									where: and(
										sql`${workPeriod.employeeId} = ANY(${employeeIds})`,
										gte(workPeriod.startTime, dateRange.start),
										lte(workPeriod.startTime, dateRange.end),
									),
								});
							}),
						);

						// Group work periods by date
						const dailyHoursMap = new Map<string, number>();
						for (const wp of workPeriods) {
							if (!wp.endTime) continue;
							const dateKey = DateTime.fromJSDate(new Date(wp.startTime)).toISODate()!;
							const hours =
								(new Date(wp.endTime).getTime() - new Date(wp.startTime).getTime()) /
								(1000 * 60 * 60);
							dailyHoursMap.set(dateKey, (dailyHoursMap.get(dateKey) || 0) + hours);
						}

						// Calculate expected hours per work day (assuming 8 hours standard)
						const expectedPerDay = 8 * employees.length;

						const distribution = Array.from(dailyHoursMap.entries())
							.sort((a, b) => a[0].localeCompare(b[0]))
							.map(([date, hours]) => ({
								date,
								hours: Math.round(hours * 100) / 100,
								expectedHours: expectedPerDay,
								isOvertime: hours > expectedPerDay,
								isUndertime: hours < expectedPerDay * 0.9, // 10% tolerance
							}));

						return {
							summary: {
								totalHours: Math.round(totalHours * 100) / 100,
								avgHoursPerWeek: Math.round(avgHoursPerWeek * 100) / 100,
								overtimeHours: Math.round(overtimeHours * 100) / 100,
								undertimeHours: Math.round(undertimeHours * 100) / 100,
							},
							distribution,
							byEmployee: employeeData.map((e) => ({
								employeeId: e.employeeId,
								employeeName: e.employeeName,
								totalHours: Math.round(e.totalHours * 100) / 100,
								overtimeHours: Math.round(e.overtimeHours * 100) / 100,
								undertimeHours: Math.round(e.undertimeHours * 100) / 100,
								avgHoursPerWeek: Math.round(e.avgHoursPerWeek * 100) / 100,
							})),
						};
					}),

				getAbsencePatterns: (params: AbsencePatternsParams) =>
					Effect.gen(function* (_) {
						const { organizationId, dateRange } = params;

						// Get all absences in date range
						const absences = yield* _(
							dbService.query("getAbsencesForPatterns", async () => {
								return await dbService.db.query.absenceEntry.findMany({
									where: and(
										gte(absenceEntry.startDate, dateRange.start),
										lte(absenceEntry.endDate, dateRange.end),
									),
									with: {
										employee: {
											with: {
												team: true,
												user: true,
											},
										},
										category: true,
									},
								});
							}),
						);

						// Filter absences to only those belonging to employees in this organization
						const orgAbsences = absences.filter(
							(a) => a.employee.organizationId === organizationId,
						);

						// Calculate summary stats
						const totalAbsences = orgAbsences.length;
						const totalDays = orgAbsences.reduce((sum, a) => {
							const days = differenceInDays(new Date(a.endDate), new Date(a.startDate));
							return sum + Math.max(1, days);
						}, 0);
						const avgDaysPerAbsence = totalAbsences > 0 ? totalDays / totalAbsences : 0;

						// Calculate absence rate based on expected work days
						const expectedWorkDays = calculateExpectedWorkDays(dateRange.start, dateRange.end);
						const absenceRate =
							expectedWorkDays > 0
								? Math.round((totalDays / expectedWorkDays) * 100 * 100) / 100
								: 0;

						// Group by type (category)
						const typeMap = new Map<string, { count: number; days: number }>();
						for (const absence of orgAbsences) {
							const categoryName = absence.category.name;
							const days = differenceInDays(new Date(absence.endDate), new Date(absence.startDate));
							const existing = typeMap.get(categoryName) || { count: 0, days: 0 };
							existing.count++;
							existing.days += Math.max(1, days);
							typeMap.set(categoryName, existing);
						}

						const byType = Array.from(typeMap.entries()).map(([categoryName, data]) => ({
							categoryName,
							count: data.count,
							totalDays: data.days,
							percentage:
								totalAbsences > 0 ? Math.round((data.count / totalAbsences) * 100 * 100) / 100 : 0,
						}));

						// Group by team
						const teamMap = new Map<
							string,
							{ count: number; days: number; name: string; employeeCount: number }
						>();
						const teamEmployeeCounts = new Map<string, Set<string>>();

						for (const absence of orgAbsences) {
							const teamId = absence.employee.teamId || "no-team";
							const teamName = absence.employee.team?.name || "No Team";
							const days = differenceInDays(new Date(absence.endDate), new Date(absence.startDate));

							// Track unique employees per team
							if (!teamEmployeeCounts.has(teamId)) {
								teamEmployeeCounts.set(teamId, new Set());
							}
							teamEmployeeCounts.get(teamId)!.add(absence.employeeId);

							const existing = teamMap.get(teamId) || {
								count: 0,
								days: 0,
								name: teamName,
								employeeCount: 0,
							};
							existing.count++;
							existing.days += Math.max(1, days);
							teamMap.set(teamId, existing);
						}

						const byTeam = Array.from(teamMap.entries()).map(([teamId, data]) => {
							const teamEmployees = teamEmployeeCounts.get(teamId)?.size || 1;
							const teamAbsenceRate =
								expectedWorkDays > 0
									? Math.round((data.days / (expectedWorkDays * teamEmployees)) * 100 * 100) / 100
									: 0;
							return {
								teamId,
								teamName: data.name,
								absenceCount: data.count,
								totalDays: data.days,
								absenceRate: teamAbsenceRate,
							};
						});

						// Calculate sick leave patterns
						const sickLeaveAbsences = orgAbsences.filter(
							(a) =>
								a.category.name.toLowerCase().includes("sick") ||
								a.category.name.toLowerCase().includes("krank"),
						);
						const sickLeaveDays = sickLeaveAbsences.map((a) =>
							Math.max(1, differenceInDays(new Date(a.endDate), new Date(a.startDate))),
						);
						const avgSickDuration =
							sickLeaveDays.length > 0
								? Math.round(
										(sickLeaveDays.reduce((a, b) => a + b, 0) / sickLeaveDays.length) * 100,
									) / 100
								: 0;

						// Find peak months for sick leave
						const sickMonthMap = new Map<string, number>();
						for (const absence of sickLeaveAbsences) {
							const month = format(new Date(absence.startDate), "yyyy-MM");
							sickMonthMap.set(month, (sickMonthMap.get(month) || 0) + 1);
						}
						const sickPeakMonths = Array.from(sickMonthMap.entries())
							.sort((a, b) => b[1] - a[1])
							.slice(0, 3)
							.map(([month]) => month);

						// Find frequent sick leave employees
						const employeeSickCountMap = new Map<string, number>();
						for (const absence of sickLeaveAbsences) {
							employeeSickCountMap.set(
								absence.employeeId,
								(employeeSickCountMap.get(absence.employeeId) || 0) + 1,
							);
						}
						const frequentEmployees = Array.from(employeeSickCountMap.entries())
							.sort((a, b) => b[1] - a[1])
							.slice(0, 5)
							.map(([employeeId, count]) => ({ employeeId, count }));

						// Calculate vacation clustering
						const vacationAbsences = orgAbsences.filter(
							(a) =>
								a.category.name.toLowerCase().includes("vacation") ||
								a.category.name.toLowerCase().includes("urlaub") ||
								a.category.name.toLowerCase().includes("holiday"),
						);
						const vacationClusteringScore = calculateClusteringScore(vacationAbsences);

						// Find vacation hotspots (dates with multiple people off)
						const vacationDateMap = new Map<string, number>();
						for (const absence of vacationAbsences) {
							const startDT = DateTime.fromJSDate(new Date(absence.startDate));
							const endDT = DateTime.fromJSDate(new Date(absence.endDate));
							let currentDT = startDT;
							while (currentDT <= endDT) {
								const dateKey = currentDT.toISODate()!;
								vacationDateMap.set(dateKey, (vacationDateMap.get(dateKey) || 0) + 1);
								currentDT = currentDT.plus({ days: 1 });
							}
						}
						const hotspots = Array.from(vacationDateMap.entries())
							.filter(([_, count]) => count > 1)
							.sort((a, b) => b[1] - a[1])
							.slice(0, 10)
							.map(([date, count]) => ({ date, count }));

						// Build timeline data
						const timelineDateMap = new Map<
							string,
							{ absence: number; sick: number; vacation: number }
						>();
						for (const absence of orgAbsences) {
							const startDT = DateTime.fromJSDate(new Date(absence.startDate));
							const endDT = DateTime.fromJSDate(new Date(absence.endDate));
							let currentDT = startDT;

							const isSick =
								absence.category.name.toLowerCase().includes("sick") ||
								absence.category.name.toLowerCase().includes("krank");
							const isVacation =
								absence.category.name.toLowerCase().includes("vacation") ||
								absence.category.name.toLowerCase().includes("urlaub") ||
								absence.category.name.toLowerCase().includes("holiday");

							while (currentDT <= endDT) {
								const dateKey = currentDT.toISODate()!;
								const existing = timelineDateMap.get(dateKey) || {
									absence: 0,
									sick: 0,
									vacation: 0,
								};
								existing.absence++;
								if (isSick) existing.sick++;
								if (isVacation) existing.vacation++;
								timelineDateMap.set(dateKey, existing);
								currentDT = currentDT.plus({ days: 1 });
							}
						}

						const timeline = Array.from(timelineDateMap.entries())
							.sort((a, b) => a[0].localeCompare(b[0]))
							.map(([date, data]) => ({
								date,
								absenceCount: data.absence,
								sickLeaveCount: data.sick,
								vacationCount: data.vacation,
							}));

						return {
							summary: {
								totalAbsences,
								totalDays,
								avgDaysPerAbsence: Math.round(avgDaysPerAbsence * 100) / 100,
								absenceRate,
							},
							byType,
							byCategory: byType, // Alias for frontend compatibility
							byTeam,
							overall: {
								totalAbsences,
								totalDays,
							},
							patterns: {
								sickLeavePatterns: {
									avgDuration: avgSickDuration,
									peakMonths: sickPeakMonths,
									frequentEmployees,
								},
								vacationClustering: {
									score: vacationClusteringScore,
									hotspots,
								},
							},
							timeline,
						};
					}),

				getManagerEffectiveness: (params: ManagerEffectivenessParams) =>
					Effect.gen(function* (_) {
						const { organizationId, dateRange, managerId } = params;

						// Get all approval requests in date range
						const approvals = yield* _(
							dbService.query("getApprovalsForEffectiveness", async () => {
								return await dbService.db.query.approvalRequest.findMany({
									where: and(
										gte(approvalRequest.createdAt, dateRange.start),
										lte(approvalRequest.createdAt, dateRange.end),
										managerId ? eq(approvalRequest.approverId, managerId) : undefined,
									),
									with: {
										approver: {
											with: {
												user: true,
											},
										},
										requester: {
											with: {
												user: true,
											},
										},
									},
								});
							}),
						);

						// Calculate metrics
						const totalApprovals = approvals.filter((a) => a.status === "approved").length;
						const totalRejections = approvals.filter((a) => a.status === "rejected").length;
						const approvalRate =
							approvals.length > 0 ? (totalApprovals / approvals.length) * 100 : 0;

						// Calculate average response time
						const responseTimes = approvals
							.filter((a) => a.updatedAt && a.createdAt)
							.map((a) => {
								const created = new Date(a.createdAt);
								const updated = new Date(a.updatedAt!);
								return differenceInDays(updated, created);
							});

						const avgResponseTime =
							responseTimes.length > 0
								? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
								: 0;

						// Group by manager
						const managerMap = new Map<
							string,
							{
								name: string;
								approvals: number;
								rejections: number;
								responseTimes: number[];
							}
						>();

						for (const approval of approvals) {
							if (!approval.approver) continue;

							const key = approval.approverId;
							const existing = managerMap.get(key) || {
								name: approval.approver.user.name || "Unknown",
								approvals: 0,
								rejections: 0,
								responseTimes: [] as number[],
							};

							if (approval.status === "approved") existing.approvals++;
							if (approval.status === "rejected") existing.rejections++;

							if (approval.updatedAt && approval.createdAt) {
								const created = new Date(approval.createdAt);
								const updated = new Date(approval.updatedAt);
								existing.responseTimes.push(differenceInDays(updated, created));
							}

							managerMap.set(key, existing);
						}

						// Get team sizes for all managers
						const managerIds = Array.from(managerMap.keys());
						const teamSizes = yield* _(
							dbService.query("getTeamSizes", async () => {
								if (managerIds.length === 0) return [];
								return await dbService.db
									.select({
										managerId: employeeManagers.managerId,
										count: sql<number>`count(*)::int`,
									})
									.from(employeeManagers)
									.where(sql`${employeeManagers.managerId} = ANY(${managerIds})`)
									.groupBy(employeeManagers.managerId);
							}),
						);

						const teamSizeMap = new Map<string, number>();
						for (const ts of teamSizes) {
							teamSizeMap.set(ts.managerId, ts.count);
						}

						const byManager = Array.from(managerMap.entries()).map(([managerId, data]) => {
							const total = data.approvals + data.rejections;
							const avgResponse =
								data.responseTimes.length > 0
									? data.responseTimes.reduce((sum, t) => sum + t, 0) / data.responseTimes.length
									: 0;

							return {
								managerId,
								managerName: data.name,
								avgResponseTime: Math.round(avgResponse * 100) / 100,
								totalApprovals: data.approvals,
								totalRejections: data.rejections,
								approvalRate: total > 0 ? (data.approvals / total) * 100 : 0,
								teamSize: teamSizeMap.get(managerId) || 0,
							};
						});

						// Calculate response time distribution
						const distributionBuckets = {
							"< 1 day": 0,
							"1-3 days": 0,
							"3-7 days": 0,
							"> 7 days": 0,
						};

						for (const rt of responseTimes) {
							if (rt < 1) {
								distributionBuckets["< 1 day"]++;
							} else if (rt <= 3) {
								distributionBuckets["1-3 days"]++;
							} else if (rt <= 7) {
								distributionBuckets["3-7 days"]++;
							} else {
								distributionBuckets["> 7 days"]++;
							}
						}

						const responseTimeDistribution = Object.entries(distributionBuckets).map(
							([bucket, count]) => ({
								bucket,
								count,
								percentage:
									responseTimes.length > 0 ? Math.round((count / responseTimes.length) * 100) : 0,
							}),
						);

						// Calculate monthly trends
						const monthlyMap = new Map<
							string,
							{ approvals: number; rejections: number; totalResponseTime: number; count: number }
						>();

						for (const approval of approvals) {
							const month = DateTime.fromJSDate(new Date(approval.createdAt)).toFormat("yyyy-MM");
							const existing = monthlyMap.get(month) || {
								approvals: 0,
								rejections: 0,
								totalResponseTime: 0,
								count: 0,
							};

							if (approval.status === "approved") existing.approvals++;
							if (approval.status === "rejected") existing.rejections++;

							if (approval.updatedAt && approval.createdAt) {
								const created = new Date(approval.createdAt);
								const updated = new Date(approval.updatedAt);
								existing.totalResponseTime += differenceInDays(updated, created);
								existing.count++;
							}

							monthlyMap.set(month, existing);
						}

						const trends = Array.from(monthlyMap.entries())
							.sort((a, b) => a[0].localeCompare(b[0]))
							.map(([month, data]) => ({
								month,
								approvals: data.approvals,
								rejections: data.rejections,
								avgResponseTime:
									data.count > 0
										? Math.round((data.totalResponseTime / data.count) * 100) / 100
										: 0,
							}));

						return {
							approvalMetrics: {
								avgResponseTime: Math.round(avgResponseTime * 100) / 100,
								totalApprovals,
								totalRejections,
								approvalRate: Math.round(approvalRate * 100) / 100,
							},
							byManager,
							responseTimeDistribution,
							trends,
						};
					}),
			};
		}),
	);
}
