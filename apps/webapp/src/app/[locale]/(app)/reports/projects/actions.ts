"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import { employee, project, projectManager, workPeriod } from "@/db/schema";
import { auth } from "@/lib/auth";
import { type AnyAppError, AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import type {
	ProjectDetailedReport,
	ProjectPortfolioData,
	ProjectSummary,
	ProjectTeamBreakdown,
	ProjectTeamMember,
	ProjectTimeSeriesPoint,
} from "@/lib/reports/project-types";

const logger = createLogger("ProjectReportsActions");

/**
 * Get portfolio overview of all projects in the organization
 */
export async function getProjectsOverview(
	startDate: Date,
	endDate: Date,
	statusFilter?: string[],
): Promise<ServerActionResult<ProjectPortfolioData>> {
	const tracer = trace.getTracer("project-reports");

	const effect: Effect.Effect<ProjectPortfolioData, AnyAppError> = tracer.startActiveSpan(
		"getProjectsOverview",
		{
			attributes: {
				"report.start_date": startDate.toISOString(),
				"report.end_date": endDate.toISOString(),
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("user.id", session.user.id);

				// Get current employee and verify admin/manager role
				const currentEmployee = yield* _(
					dbService.query("getEmployeeByUserId", async () => {
						const emp = await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
						if (!emp) throw new Error("Employee not found");
						return emp;
					}),
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
					),
				);

				// Only admins and managers can view project reports
				if (currentEmployee.role !== "admin" && currentEmployee.role !== "manager") {
					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "You don't have permission to view project reports",
							}),
						),
					);
				}

				span.setAttribute("current_employee.id", currentEmployee.id);
				span.setAttribute("current_employee.role", currentEmployee.role);

				const organizationId = currentEmployee.organizationId;

				// Get all projects in the organization
				const projects = yield* _(
					dbService.query("getProjects", async () => {
						const whereConditions = [eq(project.organizationId, organizationId)];

						if (statusFilter && statusFilter.length > 0) {
							whereConditions.push(
								inArray(
									project.status,
									statusFilter as ("planned" | "active" | "paused" | "completed" | "archived")[],
								),
							);
						}

						return await dbService.db.query.project.findMany({
							where: and(...whereConditions),
							orderBy: (project, { asc }) => [asc(project.name)],
						});
					}),
				);

				// Get work period stats for each project
				const projectSummaries: ProjectSummary[] = yield* _(
					dbService.query("getProjectStats", async () => {
						const summaries: ProjectSummary[] = [];

						for (const p of projects) {
							// Get total hours and unique employees for this project in the date range
							const stats = await dbService.db
								.select({
									totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
									uniqueEmployees: sql<number>`COUNT(DISTINCT ${workPeriod.employeeId})`.mapWith(
										Number,
									),
									workPeriodCount: sql<number>`COUNT(*)`.mapWith(Number),
								})
								.from(workPeriod)
								.where(
									and(
										eq(workPeriod.projectId, p.id),
										gte(workPeriod.startTime, startDate),
										lte(workPeriod.startTime, endDate),
									),
								);

							const totalMinutes = Number(stats[0]?.totalMinutes ?? 0);
							const totalHours = totalMinutes / 60;
							const budgetHours = p.budgetHours ? Number(p.budgetHours) : null;
							const percentBudgetUsed = budgetHours ? (totalHours / budgetHours) * 100 : null;

							// Calculate days until deadline
							let daysUntilDeadline: number | null = null;
							if (p.deadline) {
								const now = new Date();
								const diffMs = p.deadline.getTime() - now.getTime();
								daysUntilDeadline = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
							}

							summaries.push({
								id: p.id,
								name: p.name,
								description: p.description,
								status: p.status,
								color: p.color,
								budgetHours,
								deadline: p.deadline,
								totalHours,
								totalMinutes,
								percentBudgetUsed,
								daysUntilDeadline,
								uniqueEmployees: stats[0]?.uniqueEmployees ?? 0,
								workPeriodCount: stats[0]?.workPeriodCount ?? 0,
							});
						}

						return summaries;
					}),
				);

				// Calculate totals
				const totals = {
					totalProjects: projectSummaries.length,
					activeProjects: projectSummaries.filter((p) => p.status === "active").length,
					totalHours: projectSummaries.reduce((sum, p) => sum + p.totalHours, 0),
					projectsOverBudget: projectSummaries.filter(
						(p) => p.percentBudgetUsed !== null && p.percentBudgetUsed > 100,
					).length,
					projectsOverdue: projectSummaries.filter(
						(p) => p.daysUntilDeadline !== null && p.daysUntilDeadline < 0,
					).length,
				};

				span.setAttribute("projects.count", totals.totalProjects);
				span.setAttribute("projects.total_hours", totals.totalHours);
				span.setStatus({ code: SpanStatusCode.OK });

				return yield* _(Effect.succeed({ projects: projectSummaries, totals }));
			}).pipe(
				Effect.catchAll((error) => {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message || "Failed to get projects overview",
					});
					span.recordException(error);
					logger.error({ error: error.message }, "Failed to get projects overview");
					return Effect.fail(error);
				}),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get detailed report for a single project
 */
export async function getProjectDetailedReport(
	projectId: string,
	startDate: Date,
	endDate: Date,
): Promise<ServerActionResult<ProjectDetailedReport>> {
	const tracer = trace.getTracer("project-reports");

	const effect: Effect.Effect<ProjectDetailedReport, AnyAppError> = tracer.startActiveSpan(
		"getProjectDetailedReport",
		{
			attributes: {
				"project.id": projectId,
				"report.start_date": startDate.toISOString(),
				"report.end_date": endDate.toISOString(),
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				span.setAttribute("user.id", session.user.id);

				// Get current employee
				const currentEmployee = yield* _(
					dbService.query("getEmployeeByUserId", async () => {
						const emp = await dbService.db.query.employee.findFirst({
							where: eq(employee.userId, session.user.id),
						});
						if (!emp) throw new Error("Employee not found");
						return emp;
					}),
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
					),
				);

				// Check permissions (admin, manager, or project manager)
				const isProjectManager = yield* _(
					dbService.query("checkProjectManager", async () => {
						const pm = await dbService.db.query.projectManager.findFirst({
							where: and(
								eq(projectManager.projectId, projectId),
								eq(projectManager.employeeId, currentEmployee.id),
							),
						});
						return !!pm;
					}),
				);

				if (
					currentEmployee.role !== "admin" &&
					currentEmployee.role !== "manager" &&
					!isProjectManager
				) {
					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "You don't have permission to view this project report",
							}),
						),
					);
				}

				// Get project details
				const projectData = yield* _(
					dbService.query("getProject", async () => {
						const p = await dbService.db.query.project.findFirst({
							where: and(
								eq(project.id, projectId),
								eq(project.organizationId, currentEmployee.organizationId),
							),
						});
						if (!p) throw new Error("Project not found");
						return p;
					}),
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Project not found",
								entityType: "project",
							}),
					),
				);

				// Get work periods for this project
				const workPeriods = yield* _(
					dbService.query("getWorkPeriods", async () => {
						return await dbService.db.query.workPeriod.findMany({
							where: and(
								eq(workPeriod.projectId, projectId),
								gte(workPeriod.startTime, startDate),
								lte(workPeriod.startTime, endDate),
							),
							with: {
								employee: {
									with: {
										user: true,
										team: true,
									},
								},
							},
							orderBy: (wp, { asc }) => [asc(wp.startTime)],
						});
					}),
				);

				// Calculate summary
				const totalMinutes = workPeriods.reduce((sum, wp) => sum + (wp.durationMinutes ?? 0), 0);
				const totalHours = totalMinutes / 60;
				const budgetHours = projectData.budgetHours ? Number(projectData.budgetHours) : null;
				const percentBudgetUsed = budgetHours ? (totalHours / budgetHours) * 100 : null;
				const remainingBudgetHours = budgetHours ? budgetHours - totalHours : null;

				// Unique employees
				const uniqueEmployeeIds = new Set(workPeriods.map((wp) => wp.employeeId));

				// Days in period for average calculation
				const daysDiff = Math.ceil(
					(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
				);
				const averageHoursPerDay = daysDiff > 0 ? totalHours / daysDiff : 0;

				// Build time series (by day)
				const timeSeriesMap = new Map<string, number>();
				for (const wp of workPeriods) {
					const dateKey = wp.startTime.toISOString().split("T")[0];
					const existing = timeSeriesMap.get(dateKey) ?? 0;
					timeSeriesMap.set(dateKey, existing + (wp.durationMinutes ?? 0) / 60);
				}

				// Sort and build cumulative
				const sortedDates = Array.from(timeSeriesMap.keys()).sort();
				let cumulative = 0;
				const timeSeries: ProjectTimeSeriesPoint[] = sortedDates.map((date) => {
					const hours = timeSeriesMap.get(date) ?? 0;
					cumulative += hours;
					return { date, hours, cumulativeHours: cumulative };
				});

				// Build employee breakdown
				const employeeStatsMap = new Map<
					string,
					{ name: string; minutes: number; count: number }
				>();
				for (const wp of workPeriods) {
					const key = wp.employeeId;
					const existing = employeeStatsMap.get(key) ?? {
						name: wp.employee.user?.name ?? "Unknown",
						minutes: 0,
						count: 0,
					};
					existing.minutes += wp.durationMinutes ?? 0;
					existing.count += 1;
					employeeStatsMap.set(key, existing);
				}

				const employeeBreakdown: ProjectTeamMember[] = Array.from(employeeStatsMap.entries()).map(
					([employeeId, stats]) => ({
						employeeId,
						employeeName: stats.name,
						totalHours: stats.minutes / 60,
						totalMinutes: stats.minutes,
						workPeriodCount: stats.count,
						percentOfTotal: totalMinutes > 0 ? (stats.minutes / totalMinutes) * 100 : 0,
					}),
				);

				// Build team breakdown
				const teamStatsMap = new Map<
					string,
					{
						name: string;
						minutes: number;
						members: Map<string, { name: string; minutes: number; count: number }>;
					}
				>();
				for (const wp of workPeriods) {
					const teamId = wp.employee.teamId ?? "unassigned";
					const teamName = wp.employee.team?.name ?? "Unassigned";
					const existing = teamStatsMap.get(teamId) ?? {
						name: teamName,
						minutes: 0,
						members: new Map(),
					};
					existing.minutes += wp.durationMinutes ?? 0;

					const memberKey = wp.employeeId;
					const memberExisting = existing.members.get(memberKey) ?? {
						name: wp.employee.user?.name ?? "Unknown",
						minutes: 0,
						count: 0,
					};
					memberExisting.minutes += wp.durationMinutes ?? 0;
					memberExisting.count += 1;
					existing.members.set(memberKey, memberExisting);

					teamStatsMap.set(teamId, existing);
				}

				const teamBreakdown: ProjectTeamBreakdown[] = Array.from(teamStatsMap.entries()).map(
					([teamId, stats]) => ({
						teamId,
						teamName: stats.name,
						totalHours: stats.minutes / 60,
						totalMinutes: stats.minutes,
						percentOfTotal: totalMinutes > 0 ? (stats.minutes / totalMinutes) * 100 : 0,
						members: Array.from(stats.members.entries()).map(([empId, empStats]) => ({
							employeeId: empId,
							employeeName: empStats.name,
							totalHours: empStats.minutes / 60,
							totalMinutes: empStats.minutes,
							workPeriodCount: empStats.count,
							percentOfTotal: totalMinutes > 0 ? (empStats.minutes / totalMinutes) * 100 : 0,
						})),
					}),
				);

				const report: ProjectDetailedReport = {
					project: {
						id: projectData.id,
						name: projectData.name,
						description: projectData.description,
						status: projectData.status,
						color: projectData.color,
						budgetHours,
						deadline: projectData.deadline,
					},
					period: {
						startDate,
						endDate,
						label: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
					},
					summary: {
						totalHours,
						totalMinutes,
						budgetHours,
						percentBudgetUsed,
						remainingBudgetHours,
						uniqueEmployees: uniqueEmployeeIds.size,
						workPeriodCount: workPeriods.length,
						averageHoursPerDay,
					},
					timeSeries,
					teamBreakdown,
					employeeBreakdown,
				};

				span.setAttribute("report.total_hours", totalHours);
				span.setAttribute("report.unique_employees", uniqueEmployeeIds.size);
				span.setStatus({ code: SpanStatusCode.OK });

				return yield* _(Effect.succeed(report));
			}).pipe(
				Effect.catchAll((error) => {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message || "Failed to get project report",
					});
					span.recordException(error);
					logger.error({ error: error.message, projectId }, "Failed to get project report");
					return Effect.fail(error);
				}),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get list of projects for the filter dropdown
 */
export async function getProjectsForFilter(): Promise<
	ServerActionResult<Array<{ id: string; name: string; status: string; color: string | null }>>
> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	if (!emp) {
		return { success: false, error: "Employee not found" };
	}

	// Only admins and managers can view project reports
	if (emp.role !== "admin" && emp.role !== "manager") {
		return { success: false, error: "Unauthorized" };
	}

	const projects = await db.query.project.findMany({
		where: eq(project.organizationId, emp.organizationId),
		columns: {
			id: true,
			name: true,
			status: true,
			color: true,
		},
		orderBy: (project, { asc }) => [asc(project.name)],
	});

	return { success: true, data: projects };
}

/**
 * Get current employee for server components
 */
export async function getCurrentEmployeeForReports(): Promise<typeof employee.$inferSelect | null> {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		return null;
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.userId, session.user.id),
	});

	return emp || null;
}
