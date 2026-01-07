/**
 * Analytics Service
 *
 * Effect-based service for analytics computations and aggregations.
 * Provides team performance, vacation trends, work hours analytics,
 * absence patterns, and manager effectiveness metrics.
 */

import { Context, Effect, Layer } from "effect";
import { and, eq, gte, lte, desc, sql, isNotNull } from "drizzle-orm";
import type {
	TeamPerformanceData,
	TeamPerformanceParams,
	VacationTrendsData,
	VacationTrendsParams,
	WorkHoursAnalyticsData,
	WorkHoursParams,
	AbsencePatternsData,
	AbsencePatternsParams,
	ManagerEffectivenessData,
	ManagerEffectivenessParams,
} from "@/lib/analytics/types";
import { DatabaseService } from "./database.service";
import {
	employee,
	team,
	user,
	workPeriod,
	absenceEntry,
	absenceCategory,
	approvalRequest,
	employeeVacationAllowance,
} from "@/db/schema";
import {
	calculateWorkHours,
	calculateExpectedWorkHours,
} from "@/lib/time-tracking/calculations";
import { DatabaseError, NotFoundError, ValidationError } from "../errors";
import { differenceInDays, format } from "@/lib/datetime/luxon-utils";

export class AnalyticsService extends Context.Tag("AnalyticsService")<
	AnalyticsService,
	{
		readonly getTeamPerformance: (
			params: TeamPerformanceParams,
		) => Effect.Effect<
			TeamPerformanceData,
			NotFoundError | ValidationError | DatabaseError
		>;
		readonly getVacationTrends: (
			params: VacationTrendsParams,
		) => Effect.Effect<
			VacationTrendsData,
			NotFoundError | ValidationError | DatabaseError
		>;
		readonly getWorkHoursAnalytics: (
			params: WorkHoursParams,
		) => Effect.Effect<
			WorkHoursAnalyticsData,
			NotFoundError | ValidationError | DatabaseError
		>;
		readonly getAbsencePatterns: (
			params: AbsencePatternsParams,
		) => Effect.Effect<
			AbsencePatternsData,
			NotFoundError | ValidationError | DatabaseError
		>;
		readonly getManagerEffectiveness: (
			params: ManagerEffectivenessParams,
		) => Effect.Effect<
			ManagerEffectivenessData,
			NotFoundError | ValidationError | DatabaseError
		>;
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
										: and(
												eq(employee.organizationId, organizationId),
												eq(employee.isActive, true),
											),
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
									expected.totalHours > 0
										? (summary.totalHours / expected.totalHours) * 100
										: 0,
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
							avgHoursPerEmployee:
								Math.round((t.totalHours / t.employeeCount) * 100) / 100,
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

						const organizationTotal = teams.reduce(
							(sum, t) => sum + t.totalHours,
							0,
						);

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
							const days = differenceInDays(
								new Date(absence.endDate),
								new Date(absence.startDate),
							);
							return sum + Math.max(1, days);
						}, 0);

						const totalDaysRemaining = totalDaysAllocated - totalDaysTaken;
						const utilizationRate =
							totalDaysAllocated > 0
								? (totalDaysTaken / totalDaysAllocated) * 100
								: 0;

						// Group by month
						const monthlyMap = new Map<string, { taken: number; remaining: number }>();
						for (const absence of absences) {
							const month = format(new Date(absence.startDate), "yyyy-MM");
							const days = differenceInDays(
								new Date(absence.endDate),
								new Date(absence.startDate),
							);
							const existing = monthlyMap.get(month) || { taken: 0, remaining: 0 };
							existing.taken += Math.max(1, days);
							monthlyMap.set(month, existing);
						}

						const byMonth = Array.from(monthlyMap.entries()).map(
							([month, data]) => ({
								month,
								daysTaken: data.taken,
								daysRemaining: totalDaysAllocated - data.taken,
							}),
						);

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
									const days = differenceInDays(
										new Date(a.endDate),
										new Date(a.startDate),
									);
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

						return {
							overall: {
								totalDaysAllocated,
								totalDaysTaken,
								totalDaysRemaining,
								utilizationRate: Math.round(utilizationRate * 100) / 100,
							},
							byMonth,
							byEmployee,
							patterns: {
								peakMonths: monthCounts,
								averageDaysPerRequest:
									absences.length > 0
										? Math.round((totalDaysTaken / absences.length) * 100) / 100
										: 0,
								clusteringScore: 0, // TODO: Implement clustering algorithm
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
										? and(
												eq(employee.organizationId, organizationId),
												eq(employee.id, employeeId),
											)
										: and(
												eq(employee.organizationId, organizationId),
												eq(employee.isActive, true),
											),
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

							const overtimeHours = Math.max(
								0,
								actual.totalHours - expected.totalHours,
							);
							const undertimeHours = Math.max(
								0,
								expected.totalHours - actual.totalHours,
							);

							return {
								employeeId: emp.id,
								employeeName: emp.user.name || "Unknown",
								totalHours: actual.totalHours,
								expectedHours: expected.totalHours,
								overtimeHours,
								undertimeHours,
								avgHoursPerWeek:
									expected.workDays > 0
										? (actual.totalHours / expected.workDays) * 5
										: 0,
							};
						});

						const employeeData = yield* _(
							Effect.promise(() => Promise.all(employeeDataPromises)),
						);

						// Calculate summary
						const totalHours = employeeData.reduce(
							(sum, e) => sum + e.totalHours,
							0,
						);
						const totalExpected = employeeData.reduce(
							(sum, e) => sum + e.expectedHours,
							0,
						);
						const overtimeHours = Math.max(0, totalHours - totalExpected);
						const undertimeHours = Math.max(0, totalExpected - totalHours);

						const avgHoursPerWeek =
							employeeData.length > 0
								? totalHours / employeeData.length / 4
								: 0;

						// Get daily distribution (simplified - in real implementation, aggregate by day)
						const distribution: Array<{
							date: string;
							hours: number;
							expectedHours: number;
							isOvertime: boolean;
							isUndertime: boolean;
						}> = [];

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

						// Calculate summary stats
						const totalAbsences = absences.length;
						const totalDays = absences.reduce((sum, a) => {
							const days = differenceInDays(
								new Date(a.endDate),
								new Date(a.startDate),
							);
							return sum + Math.max(1, days);
						}, 0);
						const avgDaysPerAbsence =
							totalAbsences > 0 ? totalDays / totalAbsences : 0;

						// Calculate absence rate (simplified)
						const absenceRate = 0; // TODO: Calculate based on expected work days

						// Group by type
						const typeMap = new Map<string, { count: number; days: number }>();
						for (const absence of absences) {
							const categoryName = absence.category.name;
							const days = differenceInDays(
								new Date(absence.endDate),
								new Date(absence.startDate),
							);
							const existing = typeMap.get(categoryName) || { count: 0, days: 0 };
							existing.count++;
							existing.days += Math.max(1, days);
							typeMap.set(categoryName, existing);
						}

						const byType = Array.from(typeMap.entries()).map(
							([categoryName, data]) => ({
								categoryName,
								count: data.count,
								totalDays: data.days,
								percentage: totalAbsences > 0 ? (data.count / totalAbsences) * 100 : 0,
							}),
						);

						// Group by team
						const teamMap = new Map<
							string,
							{ count: number; days: number; name: string }
						>();
						for (const absence of absences) {
							const teamId = absence.employee.teamId || "no-team";
							const teamName = absence.employee.team?.name || "No Team";
							const days = differenceInDays(
								new Date(absence.endDate),
								new Date(absence.startDate),
							);
							const existing = teamMap.get(teamId) || {
								count: 0,
								days: 0,
								name: teamName,
							};
							existing.count++;
							existing.days += Math.max(1, days);
							teamMap.set(teamId, existing);
						}

						const byTeam = Array.from(teamMap.entries()).map(
							([teamId, data]) => ({
								teamId,
								teamName: data.name,
								absenceCount: data.count,
								totalDays: data.days,
								absenceRate: 0, // TODO: Calculate rate
							}),
						);

						return {
							summary: {
								totalAbsences,
								totalDays,
								avgDaysPerAbsence: Math.round(avgDaysPerAbsence * 100) / 100,
								absenceRate,
							},
							byType,
							byTeam,
							patterns: {
								sickLeavePatterns: {
									avgDuration: 0,
									peakMonths: [],
									frequentEmployees: [],
								},
								vacationClustering: {
									score: 0,
									hotspots: [],
								},
							},
							timeline: [],
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
										managerId
											? eq(approvalRequest.approverId, managerId)
											: undefined,
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
						const totalApprovals = approvals.filter(
							(a) => a.status === "approved",
						).length;
						const totalRejections = approvals.filter(
							(a) => a.status === "rejected",
						).length;
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
								? responseTimes.reduce((sum, t) => sum + t, 0) /
									responseTimes.length
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

						const byManager = Array.from(managerMap.entries()).map(
							([managerId, data]) => {
								const total = data.approvals + data.rejections;
								const avgResponse =
									data.responseTimes.length > 0
										? data.responseTimes.reduce((sum, t) => sum + t, 0) /
											data.responseTimes.length
										: 0;

								return {
									managerId,
									managerName: data.name,
									avgResponseTime: Math.round(avgResponse * 100) / 100,
									totalApprovals: data.approvals,
									totalRejections: data.rejections,
									approvalRate: total > 0 ? (data.approvals / total) * 100 : 0,
									teamSize: 0, // TODO: Calculate team size
								};
							},
						);

						return {
							approvalMetrics: {
								avgResponseTime: Math.round(avgResponseTime * 100) / 100,
								totalApprovals,
								totalRejections,
								approvalRate: Math.round(approvalRate * 100) / 100,
							},
							byManager,
							responseTimeDistribution: [],
							trends: [],
						};
					}),
			};
		}),
	);
}
