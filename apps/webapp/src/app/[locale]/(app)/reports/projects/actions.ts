"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq, gte, inArray, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { customer, employee, project, workPeriod } from "@/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import type { ReportedWork } from "@/lib/billable-time/report-figures";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { listProjectTasks } from "@/lib/projects/project-tasks";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import {
	buildCustomerBillableReport,
	loadProjectReportViewer,
	prepareBillableReportPricing,
	sumVisibleBillableFigures,
} from "@/lib/reports/project-billable-report";
import { buildProjectHealthFields, buildProjectHealthTotals } from "@/lib/reports/project-health";
import { readProjectReportCustomFields } from "@/lib/reports/project-report-custom-fields";
import {
	canViewProjectReport,
	canViewProjectReports,
	type ProjectReportViewer,
	viewsAllProjectReports,
} from "@/lib/reports/project-report-access";
import {
	loadReportedProjectWork,
	reportDayRangeFromDates,
	reportDayRangeFromDays,
	reportedWorkDay,
} from "@/lib/reports/project-report-work";
import { buildProjectTaskBreakdown } from "@/lib/reports/project-task-breakdown";
import type {
	CustomerBillableReport,
	ProjectDetailedReport,
	ProjectInfo,
	ProjectPortfolioData,
	ProjectSummary,
	ProjectTeamBreakdown,
	ProjectTeamMember,
	ProjectTimeSeriesPoint,
} from "@/lib/reports/project-types";

const logger = createLogger("ProjectReportsActions");

type ProjectReportEffect<T> = Effect.Effect<T, AnyAppError, AppServices>;

type ProjectStatus = "planned" | "active" | "paused" | "completed" | "archived";

/**
 * The signed-in reader of a project report in the active organization, with
 * what they may see (`lib/reports/project-report-access.ts`).
 */
function projectReportReader() {
	return Effect.gen(function* () {
		const authContext = yield* Effect.tryPromise({
			try: async () => await requireAuth(),
			catch: () =>
				new AuthorizationError({
					message: "Approved organization membership required",
				}),
		});
		const dbService = yield* DatabaseService;
		const organizationId = authContext.session.activeOrganizationId;
		const currentEmployee = authContext.employee;
		if (!organizationId || !currentEmployee) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Active organization required",
				}),
			);
		}
		const viewer = yield* dbService.query("getProjectReportViewer", () =>
			loadProjectReportViewer(dbService.db, {
				organizationId,
				userId: authContext.user.id,
				employee: currentEmployee,
			}),
		);
		return { authContext, dbService, organizationId, currentEmployee, viewer };
	});
}

/**
 * Projects of the organization with their current customer (from the same
 * organization). A deleted (inactive) customer counts as no customer.
 */
function loadReportProjects(
	dbService: typeof DatabaseService.Service,
	organizationId: string,
	conditions: SQL[],
) {
	return dbService.query("getProjects", async () => {
		const rows = await dbService.db
			.select({
				project,
				customer: { id: customer.id, name: customer.name },
			})
			.from(project)
			.leftJoin(
				customer,
				and(
					eq(customer.id, project.customerId),
					eq(customer.organizationId, organizationId),
					eq(customer.isActive, true),
				),
			)
			.where(and(eq(project.organizationId, organizationId), ...conditions))
			.orderBy(project.name);
		return rows.map((row) => ({ ...row.project, customer: row.customer }));
	});
}

type ReportProject = typeof project.$inferSelect & {
	customer: { id: string; name: string } | null;
};

function projectInfo(p: ReportProject): ProjectInfo {
	return {
		id: p.id,
		name: p.name,
		description: p.description,
		status: p.status,
		color: p.color,
		budgetHours: p.budgetHours ? Number(p.budgetHours) : null,
		deadline: p.deadline,
		customer: p.customer,
	};
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const group = groups.get(key(item));
		if (group) group.push(item);
		else groups.set(key(item), [item]);
	}
	return groups;
}

function statusConditions(statusFilter: string[] | undefined) {
	return statusFilter && statusFilter.length > 0
		? [inArray(project.status, statusFilter as ProjectStatus[])]
		: [];
}

function visibleProjectConditions(viewer: ProjectReportViewer) {
	return viewsAllProjectReports(viewer) ? [] : [inArray(project.id, [...viewer.managedProjectIds])];
}

/**
 * Get portfolio overview of all projects in the organization
 */
export async function getProjectsOverview(
	startDate: Date,
	endDate: Date,
	statusFilter?: string[],
): Promise<ServerActionResult<ProjectPortfolioData>> {
	const tracer = trace.getTracer("project-reports");

	const effect: ProjectReportEffect<ProjectPortfolioData> = tracer.startActiveSpan(
		"getProjectsOverview",
		{
			attributes: {
				"report.start_date": startDate.toISOString(),
				"report.end_date": endDate.toISOString(),
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const { authContext, dbService, organizationId, currentEmployee, viewer } =
					yield* projectReportReader();

				span.setAttribute("user.id", authContext.user.id);

				if (!canViewProjectReports(viewer)) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You don't have permission to view project reports",
						}),
					);
				}

				span.setAttribute("current_employee.id", currentEmployee.id);
				span.setAttribute("current_employee.role", currentEmployee.role);

				// Projects the viewer reads: every project, or only the ones they manage.
				const projects = yield* loadReportProjects(dbService, organizationId, [
					...statusConditions(statusFilter),
					...visibleProjectConditions(viewer),
				]);
				const projectIds = projects.map((p) => p.id);

				// Completed work by the employee-local day of its start (#794, #902).
				const range = reportDayRangeFromDates(startDate, endDate);
				const work = yield* dbService.query("getReportedProjectWork", () =>
					loadReportedProjectWork(dbService.db, organizationId, { projectIds, range }),
				);
				const workByProject = groupBy(work, (item) => item.projectId);
				const pricing = yield* dbService.query("getBillableReportPricing", () =>
					prepareBillableReportPricing(dbService.db, organizationId, {
						viewer,
						projectIds,
						work,
					}),
				);

				// Budget usage counts all completed work of the project, whenever it was.
				const cumulativeMinutes = yield* dbService.query("getProjectCumulativeStats", async () => {
					if (projectIds.length === 0) return new Map<string, number>();
					const rows = await dbService.db
						.select({
							projectId: workPeriod.projectId,
							totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`.mapWith(
								Number,
							),
						})
						.from(workPeriod)
						.where(
							and(
								inArray(workPeriod.projectId, projectIds),
								eq(workPeriod.organizationId, organizationId),
								completedWorkPeriodCondition(),
								isNotNull(workPeriod.projectId),
							),
						)
						.groupBy(workPeriod.projectId);
					return new Map(rows.map((row) => [row.projectId ?? "", row.totalMinutes]));
				});

				const now = new Date();
				const projectSummaries: ProjectSummary[] = projects.map((p): ProjectSummary => {
					const projectWork = workByProject.get(p.id) ?? [];
					const totalMinutes = projectWork.reduce((sum, item) => sum + item.durationMinutes, 0);
					const totalHours = totalMinutes / 60;
					const cumulativeHours = (cumulativeMinutes.get(p.id) ?? 0) / 60;
					const budgetHours = p.budgetHours ? Number(p.budgetHours) : null;
					const percentBudgetUsed = budgetHours ? (cumulativeHours / budgetHours) * 100 : null;

					// Calculate days until deadline
					let daysUntilDeadline: number | null = null;
					if (p.deadline) {
						const diffMs = p.deadline.getTime() - now.getTime();
						daysUntilDeadline = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
					}

					const healthFields = buildProjectHealthFields({
						projectName: p.name,
						budgetHours,
						rangeHours: totalHours,
						cumulativeHours,
						deadline: p.deadline,
						now,
						rangeStart: startDate,
						rangeEnd: endDate,
					});

					const billable = pricing?.figures(p.id, projectWork);
					return {
						...projectInfo(p),
						...healthFields,
						totalHours,
						totalMinutes,
						percentBudgetUsed,
						daysUntilDeadline,
						uniqueEmployees: new Set(projectWork.map((item) => item.employeeId)).size,
						workPeriodCount: projectWork.length,
						...(billable ? { billable } : {}),
					};
				});

				// Calculate totals
				const budgetHealth = buildProjectHealthTotals(projectSummaries);
				const billableTotals = pricing
					? sumVisibleBillableFigures(
							projectSummaries.map((summary) => summary.billable),
							pricing.context.currency,
						)
					: undefined;
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
					budgetHealth,
					...(billableTotals ? { billable: billableTotals } : {}),
				};

				span.setAttribute("projects.count", totals.totalProjects);
				span.setAttribute("projects.total_hours", totals.totalHours);
				span.setStatus({ code: SpanStatusCode.OK });

				return yield* Effect.succeed({
					projects: projectSummaries,
					totals,
					...(pricing ? { billableTime: pricing.context } : {}),
				});
			}).pipe(
				Effect.catch((error) => {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message || "Failed to get projects overview",
					});
					span.recordException(error);
					logger.error({ error: error.message }, "Failed to get projects overview");
					return Effect.fail(error);
				}),
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

	const effect: ProjectReportEffect<ProjectDetailedReport> = tracer.startActiveSpan(
		"getProjectDetailedReport",
		{
			attributes: {
				"project.id": projectId,
				"report.start_date": startDate.toISOString(),
				"report.end_date": endDate.toISOString(),
			},
		},
		(span) => {
			return Effect.gen(function* () {
				const { authContext, dbService, organizationId, viewer } = yield* projectReportReader();

				span.setAttribute("user.id", authContext.user.id);

				// Check permissions (admin, manager, owner/admin of the organization, or project manager)
				if (!canViewProjectReport(viewer, projectId)) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You don't have permission to view this project report",
						}),
					);
				}

				// Get project details
				const [projectData] = yield* loadReportProjects(dbService, organizationId, [
					eq(project.id, projectId),
				]);
				if (!projectData) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Project not found",
							entityType: "project",
						}),
					);
				}

				// Completed work by the employee-local day of its start (#794, #902).
				const range = reportDayRangeFromDates(startDate, endDate);
				// Custom fields the reader's base role sees, as of the period's last day (#820).
				const customFields = yield* dbService.query("getProjectReportCustomFields", () =>
					readProjectReportCustomFields(dbService.db, {
						organizationId,
						readerUserId: authContext.user.id,
						projectId,
						customerId: projectData.customer?.id ?? null,
						asOf: range.toDay,
					}),
				);
				const work = yield* dbService.query("getWorkPeriods", () =>
					loadReportedProjectWork(dbService.db, organizationId, {
						projectIds: [projectId],
						range,
					}),
				);
				const pricing = yield* dbService.query("getBillableReportPricing", () =>
					prepareBillableReportPricing(dbService.db, organizationId, {
						viewer,
						projectIds: [projectId],
						work,
					}),
				);
				const employeeIds = [...new Set(work.map((item) => item.employeeId))];
				const employees = yield* dbService.query("getReportEmployees", async () => {
					if (employeeIds.length === 0) return [];
					return await dbService.db.query.employee.findMany({
						where: and(
							inArray(employee.id, employeeIds),
							eq(employee.organizationId, organizationId),
						),
						with: { user: true, team: true },
					});
				});
				const employeeInfo = new Map(
					employees.map((row) => [
						row.id,
						{
							name: row.user?.name ?? "Unknown",
							teamId: row.teamId,
							teamName: row.team?.name ?? null,
						},
					]),
				);

				// The project's tasks, and every minute ever booked to each task, for the
				// "By task" section's estimate progress.
				const { tasks, bookedMinutesToDate } = yield* dbService.query(
					"getProjectTasksForReport",
					async () => {
						const scope = { organizationId, projectId };
						const [tasks, bookedRows] = await Promise.all([
							listProjectTasks(scope, {}, dbService.db),
							dbService.db
								.select({
									taskId: workPeriod.taskId,
									minutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`.mapWith(
										Number,
									),
								})
								.from(workPeriod)
								.where(
									and(
										eq(workPeriod.projectId, projectId),
										eq(workPeriod.organizationId, organizationId),
										isNotNull(workPeriod.taskId),
										// Hours booked count completed work only (#794).
										completedWorkPeriodCondition(),
									),
								)
								.groupBy(workPeriod.taskId),
						]);
						const bookedMinutesToDate = new Map<string, number>();
						for (const row of bookedRows) {
							if (row.taskId) bookedMinutesToDate.set(row.taskId, row.minutes);
						}
						return { tasks, bookedMinutesToDate };
					},
				);

				// Calculate summary
				const totalMinutes = work.reduce((sum, item) => sum + item.durationMinutes, 0);
				const totalHours = totalMinutes / 60;
				const info: ProjectInfo = {
					...projectInfo(projectData),
					customer: projectData.customer
						? { ...projectData.customer, customFields: customFields.customer ?? [] }
						: null,
					customFields: customFields.project,
				};
				const budgetHours = info.budgetHours;
				const percentBudgetUsed = budgetHours ? (totalHours / budgetHours) * 100 : null;
				const remainingBudgetHours = budgetHours ? budgetHours - totalHours : null;

				// Days in period for average calculation
				const daysDiff = Math.ceil(
					(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
				);
				const averageHoursPerDay = daysDiff > 0 ? totalHours / daysDiff : 0;

				// Time series by the employee-local day each work period started on.
				const timeSeriesMap = new Map<string, number>();
				for (const item of work) {
					const dateKey = reportedWorkDay(item).toString();
					timeSeriesMap.set(dateKey, (timeSeriesMap.get(dateKey) ?? 0) + item.durationMinutes / 60);
				}

				// Sort and build cumulative
				const sortedDates = Array.from(timeSeriesMap.keys()).sort();
				let cumulative = 0;
				const timeSeries: ProjectTimeSeriesPoint[] = sortedDates.map((date) => {
					const hours = timeSeriesMap.get(date) ?? 0;
					cumulative += hours;
					return { date, hours, cumulativeHours: cumulative };
				});

				// Employee breakdown, with each employee's Billable Time figures.
				const workByEmployee = groupBy(work, (item) => item.employeeId);
				const memberOf = (employeeId: string, employeeWork: ReportedWork[]): ProjectTeamMember => {
					const minutes = employeeWork.reduce((sum, item) => sum + item.durationMinutes, 0);
					const billable = pricing?.figures(projectId, employeeWork);
					return {
						employeeId,
						employeeName: employeeInfo.get(employeeId)?.name ?? "Unknown",
						totalHours: minutes / 60,
						totalMinutes: minutes,
						workPeriodCount: employeeWork.length,
						percentOfTotal: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
						...(billable ? { billable } : {}),
					};
				};
				const employeeBreakdown: ProjectTeamMember[] = Array.from(workByEmployee.entries()).map(
					([employeeId, employeeWork]) => memberOf(employeeId, employeeWork),
				);

				// Team breakdown
				const workByTeam = groupBy(
					work,
					(item) => employeeInfo.get(item.employeeId)?.teamId ?? "unassigned",
				);
				const teamBreakdown: ProjectTeamBreakdown[] = Array.from(workByTeam.entries()).map(
					([teamId, teamWork]) => {
						const minutes = teamWork.reduce((sum, item) => sum + item.durationMinutes, 0);
						const teamName =
							(teamId === "unassigned"
								? null
								: employeeInfo.get(teamWork[0]?.employeeId ?? "")?.teamName) ?? "Unassigned";
						return {
							teamId,
							teamName,
							totalHours: minutes / 60,
							totalMinutes: minutes,
							percentOfTotal: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
							members: Array.from(groupBy(teamWork, (item) => item.employeeId).entries()).map(
								([employeeId, employeeWork]) => memberOf(employeeId, employeeWork),
							),
						};
					},
				);

				const billable = pricing?.figures(projectId, work);
				const report: ProjectDetailedReport = {
					project: info,
					period: {
						startDate: startDate.toISOString(),
						endDate: endDate.toISOString(),
						label: `${startDate} - ${endDate}`,
					},
					summary: {
						totalHours,
						totalMinutes,
						budgetHours,
						percentBudgetUsed,
						remainingBudgetHours,
						uniqueEmployees: workByEmployee.size,
						workPeriodCount: work.length,
						averageHoursPerDay,
						...(billable ? { billable } : {}),
					},
					timeSeries,
					teamBreakdown,
					employeeBreakdown,
					...(pricing ? { billableTime: pricing.context } : {}),
					taskBreakdown: buildProjectTaskBreakdown({
						periods: work,
						tasks,
						bookedMinutesToDate,
					}),
				};

				span.setAttribute("report.total_hours", totalHours);
				span.setAttribute("report.unique_employees", workByEmployee.size);
				span.setStatus({ code: SpanStatusCode.OK });

				return yield* Effect.succeed(report);
			}).pipe(
				Effect.catch((error) => {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message || "Failed to get project report",
					});
					span.recordException(error);
					logger.error({ error: error.message, projectId }, "Failed to get project report");
					return Effect.fail(error);
				}),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * The customer view (#902): Billable Time figures per customer, with its
 * projects to drill into. Owners and admins see every customer's projects with
 * cost and margin; project managers see their own projects' hours and revenue.
 * Nobody else sees it, and nobody sees it while Billable Time is off.
 */
export async function getCustomerBillableReport(
	fromDay: string,
	toDay: string,
	statusFilter?: string[],
): Promise<ServerActionResult<CustomerBillableReport>> {
	const tracer = trace.getTracer("project-reports");

	const effect: ProjectReportEffect<CustomerBillableReport> = tracer.startActiveSpan(
		"getCustomerBillableReport",
		{
			attributes: {
				"report.start_date": String(fromDay),
				"report.end_date": String(toDay),
			},
		},
		(span) => {
			return Effect.gen(function* () {
				// The report's calendar days, both inclusive (never read in a time zone).
				const range = reportDayRangeFromDays(fromDay, toDay);
				if (!range) {
					return yield* Effect.fail(
						new ValidationError({
							message: "Choose a period whose end is not before its start",
							field: "period",
						}),
					);
				}
				const { authContext, dbService, organizationId, viewer } = yield* projectReportReader();
				span.setAttribute("user.id", authContext.user.id);

				if (!viewer.isOrganizationAdmin && viewer.managedProjectIds.size === 0) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You don't have permission to view the customer report",
						}),
					);
				}

				// Projects without an (active) customer form the "without customer" group.
				const projects = yield* loadReportProjects(dbService, organizationId, [
					...statusConditions(statusFilter),
					...(viewer.isOrganizationAdmin
						? []
						: [inArray(project.id, [...viewer.managedProjectIds])]),
				]);
				const projectIds = projects.map((p) => p.id);
				const work = yield* dbService.query("getReportedProjectWork", () =>
					loadReportedProjectWork(dbService.db, organizationId, { projectIds, range }),
				);
				const pricing = yield* dbService.query("getBillableReportPricing", () =>
					prepareBillableReportPricing(dbService.db, organizationId, {
						viewer,
						projectIds,
						work,
					}),
				);
				if (!pricing) {
					return yield* Effect.fail(
						new ValidationError({
							message: "Billable Time is not enabled for this organization",
						}),
					);
				}

				const workByProject = groupBy(work, (item) => item.projectId);
				const report = buildCustomerBillableReport({
					period: { startDate: range.fromDay.toString(), endDate: range.toDay.toString() },
					pricing,
					access: viewer.isOrganizationAdmin ? "full" : "revenue",
					projects: projects.map((p) => ({
						project: { ...projectInfo(p), customer: p.customer },
						work: workByProject.get(p.id) ?? [],
					})),
				});

				span.setAttribute("report.customers", report.customers.length);
				span.setStatus({ code: SpanStatusCode.OK });
				return report;
			}).pipe(
				Effect.catch((error) => {
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error.message || "Failed to get customer report",
					});
					span.recordException(error);
					logger.error({ error: error.message }, "Failed to get customer report");
					return Effect.fail(error);
				}),
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
	let authContext;
	try {
		authContext = await requireAuth();
	} catch {
		return { success: false, error: "Not authenticated" };
	}

	const emp = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, authContext.employee?.id ?? ""),
			eq(employee.organizationId, authContext.session.activeOrganizationId ?? ""),
			eq(employee.isActive, true),
		),
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
	let authContext;
	try {
		authContext = await requireAuth();
	} catch {
		return null;
	}

	const emp = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, authContext.employee?.id ?? ""),
			eq(employee.organizationId, authContext.session.activeOrganizationId ?? ""),
			eq(employee.isActive, true),
		),
	});

	return emp || null;
}

export async function getCurrentEmployeeProjectReportAccess(): Promise<{
	employee: typeof employee.$inferSelect;
	canViewProjectReports: boolean;
} | null> {
	const emp = await getCurrentEmployeeForReports();

	if (!emp) {
		return null;
	}

	if (emp.role === "admin" || emp.role === "manager") {
		return { employee: emp, canViewProjectReports: true };
	}

	const authContext = await requireAuth();
	const viewer = await loadProjectReportViewer(db, {
		organizationId: emp.organizationId,
		userId: authContext.user.id,
		employee: emp,
	});

	return { employee: emp, canViewProjectReports: canViewProjectReports(viewer) };
}
