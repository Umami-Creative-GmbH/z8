"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import { db } from "@/db";
import { employee, project, workPeriod } from "@/db/schema";
import { requireAuth } from "@/lib/auth-helpers";
import { type AnyAppError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import {
	loadProjectReportViewer,
	prepareBillableReportPricing,
	sumVisibleBillableFigures,
} from "@/lib/reports/project-billable-report";
import { buildProjectHealthFields, buildProjectHealthTotals } from "@/lib/reports/project-health";
import {
	canViewProjectReport,
	canViewProjectReports,
	type ProjectReportViewer,
	viewsAllProjectReports,
} from "@/lib/reports/project-report-access";
import {
	groupBy,
	loadReportProjects,
	projectInfo,
	readCustomerBillableReport,
	readProjectDetailedReport,
	statusConditions,
} from "@/lib/reports/project-report-readers";
import {
	loadReportedProjectWork,
	reportDayRangeFromDates,
	reportDayRangeFromDays,
} from "@/lib/reports/project-report-work";
import type {
	CustomerBillableReport,
	ProjectDetailedReport,
	ProjectPortfolioData,
	ProjectSummary,
} from "@/lib/reports/project-types";

const logger = createLogger("ProjectReportsActions");

type ProjectReportEffect<T> = Effect.Effect<T, AnyAppError, AppServices>;

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
				const { authContext, organizationId, viewer } = yield* projectReportReader();

				span.setAttribute("user.id", authContext.user.id);

				// Check permissions (admin, manager, owner/admin of the organization, or project manager)
				if (!canViewProjectReport(viewer, projectId)) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You don't have permission to view this project report",
						}),
					);
				}

				const report = yield* readProjectDetailedReport({
					organizationId,
					readerUserId: authContext.user.id,
					viewer,
					projectId,
					// Completed work by the employee-local day of its start (#794, #902).
					range: reportDayRangeFromDates(startDate, endDate),
				});

				span.setAttribute("report.total_hours", report.summary.totalHours);
				span.setAttribute("report.unique_employees", report.summary.uniqueEmployees);
				span.setStatus({ code: SpanStatusCode.OK });

				return report;
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
				const { authContext, organizationId, viewer } = yield* projectReportReader();
				span.setAttribute("user.id", authContext.user.id);

				if (!viewer.isOrganizationAdmin && viewer.managedProjectIds.size === 0) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You don't have permission to view the customer report",
						}),
					);
				}

				const { report } = yield* readCustomerBillableReport({
					organizationId,
					viewer,
					range,
					statusFilter,
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
