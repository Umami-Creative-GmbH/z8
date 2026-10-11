/**
 * The project detail report and the customer view, read for a viewer whose
 * access the caller already checked (`project-report-access.ts`). The report
 * server actions and report share links (#806) read reports through these, so
 * a shared snapshot is the same report its creator sees.
 */

import "server-only";

import { and, eq, inArray, isNotNull, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Temporal } from "temporal-polyfill";
import { customer, employee, project, workPeriod } from "@/db/schema";
import type { ReportedWork } from "@/lib/billable-time/report-figures";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { listProjectTasks } from "@/lib/projects/project-tasks";
import { completedWorkPeriodCondition } from "./completed-work";
import {
	buildCustomerBillableReport,
	prepareBillableReportPricing,
} from "./project-billable-report";
import type { ProjectReportViewer } from "./project-report-access";
import { readProjectReportCustomFields } from "./project-report-custom-fields";
import {
	loadReportedProjectWork,
	type ReportDayRange,
	reportedWorkDay,
} from "./project-report-work";
import { buildProjectTaskBreakdown } from "./project-task-breakdown";
import type {
	CustomerBillableReport,
	ProjectDetailedReport,
	ProjectInfo,
	ProjectTeamBreakdown,
	ProjectTeamMember,
	ProjectTimeSeriesPoint,
} from "./project-types";

type ProjectStatus = "planned" | "active" | "paused" | "completed" | "archived";

/**
 * Projects of the organization with their current customer (from the same
 * organization). A deleted (inactive) customer counts as no customer.
 */
export function loadReportProjects(
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

export type ReportProject = typeof project.$inferSelect & {
	customer: { id: string; name: string } | null;
};

export function projectInfo(p: ReportProject): ProjectInfo {
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

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const group = groups.get(key(item));
		if (group) group.push(item);
		else groups.set(key(item), [item]);
	}
	return groups;
}

export function statusConditions(statusFilter: string[] | undefined) {
	return statusFilter && statusFilter.length > 0
		? [inArray(project.status, statusFilter as ProjectStatus[])]
		: [];
}

/** A report day's UTC midnight, the instant the report period is serialized as. */
function utcMidnight(day: Temporal.PlainDate): Date {
	return dateFromInstant(day.toZonedDateTime("UTC").toInstant());
}

/**
 * One project's detailed report for the report's calendar days, both
 * inclusive. The caller checked `canViewProjectReport`.
 */
export function readProjectDetailedReport(input: {
	organizationId: string;
	/** Decides which custom fields the report shows (#820). */
	readerUserId: string;
	viewer: ProjectReportViewer;
	projectId: string;
	range: ReportDayRange;
}) {
	return Effect.gen(function* () {
		const { organizationId, viewer, projectId, range } = input;
		// The period is serialized as the days' UTC midnights, as the report filter sends them.
		const startDate = utcMidnight(range.fromDay);
		const endDate = utcMidnight(range.toDay);
		const dbService = yield* DatabaseService;

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
		// Custom fields the reader's base role sees, as of the period's last day (#820).
		const customFields = yield* dbService.query("getProjectReportCustomFields", () =>
			readProjectReportCustomFields(dbService.db, {
				organizationId,
				readerUserId: input.readerUserId,
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
				where: and(inArray(employee.id, employeeIds), eq(employee.organizationId, organizationId)),
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
							minutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`.mapWith(Number),
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
		const daysDiff = range.fromDay.until(range.toDay, { largestUnit: "days" }).days;
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
		return report;
	});
}

/**
 * The customer view for a viewer who sees it (owners and admins, or project
 * managers): every customer of the projects they see, or only `customerId`'s.
 */
export function readCustomerBillableReport(input: {
	organizationId: string;
	viewer: ProjectReportViewer;
	range: ReportDayRange;
	statusFilter?: string[];
	/** Only this (active) customer's projects (#806). */
	customerId?: string;
}) {
	return Effect.gen(function* () {
		const { organizationId, viewer, range } = input;
		const dbService = yield* DatabaseService;

		// Projects without an (active) customer form the "without customer" group.
		const projects = yield* loadReportProjects(dbService, organizationId, [
			...statusConditions(input.statusFilter),
			...(viewer.isOrganizationAdmin ? [] : [inArray(project.id, [...viewer.managedProjectIds])]),
			...(input.customerId ? [eq(project.customerId, input.customerId)] : []),
		]);
		const scoped = input.customerId
			? projects.filter((p) => p.customer?.id === input.customerId)
			: projects;
		const projectIds = scoped.map((p) => p.id);
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
		const report: CustomerBillableReport = buildCustomerBillableReport({
			period: { startDate: range.fromDay.toString(), endDate: range.toDay.toString() },
			pricing,
			access: viewer.isOrganizationAdmin ? "full" : "revenue",
			projects: scoped.map((p) => ({
				project: { ...projectInfo(p), customer: p.customer },
				work: workByProject.get(p.id) ?? [],
			})),
		});
		return { report, projectIds };
	});
}
