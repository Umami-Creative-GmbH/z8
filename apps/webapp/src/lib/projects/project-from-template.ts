import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	employee,
	project,
	projectAssignment,
	projectManager,
	projectTask,
	team,
} from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import {
	insertProject,
	insertProjectAssignments,
	insertProjectManagers,
	type NewProjectStatus,
} from "./project-creation";
import { listProjectTasks } from "./project-tasks";
import { projectDeadlineFromTemplateOffset } from "./project-template-deadline";
import type {
	ProjectTemplateInput,
	ManagerOrAssignmentAvailability,
	SkippedManagerOrAssignment,
} from "./project-template-model";
import { getProjectTemplate, liveUserColumns, liveUserName } from "./project-templates";

/**
 * Turning a template into a project and a project into a template (#880).
 * Both copy once: the project keeps no live link to its template (ADR 0001),
 * so later edits on either side never reach the other. Every read and write
 * is scoped by organization; authorization is the caller's job.
 */

type Writer = Pick<typeof db, "select" | "insert" | "update" | "delete">;

export type { SkippedManagerOrAssignment };

export interface ProjectFromTemplateInput {
	name: string;
	description: string | null;
	status: NewProjectStatus;
	customerId: string | null;
	/** Billable Time (#900): whether new work starts billable; the caller checks it needs a customer. */
	billableDefault?: boolean;
}

/**
 * Creates a project from a template inside the caller's transaction: the
 * template's icon, colour, budget, tasks (all open), managers and assignments
 * are copied, and the deadline is the creation date in the organization's
 * timezone plus the template's offset. Managers and assignments whose
 * employee has left or whose team or employee no longer exists are skipped
 * and reported. `alsoManagedBy` adds a manager (the manager-tier creator, as
 * for a hand-made project). Returns null when the template is not in the
 * organization; a duplicate project name surfaces as the database error.
 */
export async function createProjectFromTemplateRows(
	tx: Writer,
	scope: {
		organizationId: string;
		userId: string;
		templateId: string;
		now: Instant;
		alsoManagedBy?: string | null;
		/** Whether the creator may assign project managers (org owners and admins). */
		assignsManagers: boolean;
	},
	input: ProjectFromTemplateInput,
) {
	const { organizationId, userId } = scope;
	const template = await getProjectTemplate({ organizationId, templateId: scope.templateId }, tx);
	if (!template) return null;

	const [organizationRow] = await tx
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	const { timezone } = resolveOrganizationTimezone(organizationRow?.timezone ?? undefined);

	const created = await insertProject(tx, {
		organizationId,
		name: input.name,
		description: input.description,
		status: input.status,
		icon: template.icon,
		color: template.color,
		budgetHours: template.budgetHours,
		deadline: projectDeadlineFromTemplateOffset({
			now: scope.now,
			timezone,
			offsetDays: template.deadlineOffsetDays,
		}),
		customerId: input.customerId,
		billableDefault: input.billableDefault,
		createdBy: userId,
	});

	if (template.tasks.length > 0) {
		await tx.insert(projectTask).values(
			template.tasks.map((task) => ({
				organizationId,
				projectId: created.id,
				name: task.name,
				description: task.description,
				estimateHours: task.estimateHours,
				state: "open" as const,
				createdBy: userId,
				updatedAt: new Date(),
			})),
		);
	}

	const skipped: SkippedManagerOrAssignment[] = [];
	/** True when the manager or assignment is copied; otherwise reports why not. */
	const copyOrReport =
		(role: SkippedManagerOrAssignment["role"]) =>
		(member: { name: string; availability: ManagerOrAssignmentAvailability }) => {
			if (member.availability === "available") return true;
			skipped.push({ role, name: member.name, reason: member.availability });
			return false;
		};

	// Only org admins assign project managers (#367): another creator gets none
	// of the template's managers, only themselves (decision 9 of #770).
	const managerIds = template.managers
		.filter((manager) => manager.employeeId === null || manager.employeeId !== scope.alsoManagedBy)
		.filter(copyOrReport("manager"))
		.filter((manager) => {
			if (scope.assignsManagers) return true;
			skipped.push({ role: "manager", name: manager.name, reason: "adminOnly" });
			return false;
		})
		.flatMap((manager) => (manager.employeeId ? [manager.employeeId] : []));
	if (scope.alsoManagedBy) managerIds.push(scope.alsoManagedBy);
	await insertProjectManagers(tx, {
		projectId: created.id,
		employeeIds: managerIds,
		assignedBy: userId,
	});

	const teamIds: string[] = [];
	const employeeIds: string[] = [];
	for (const assignment of template.assignments) {
		if (!copyOrReport(assignment.type)(assignment)) continue;
		if (assignment.type === "team" && assignment.teamId) teamIds.push(assignment.teamId);
		if (assignment.type === "employee" && assignment.employeeId) {
			employeeIds.push(assignment.employeeId);
		}
	}
	await insertProjectAssignments(tx, {
		projectId: created.id,
		organizationId,
		teamIds,
		employeeIds,
		createdBy: userId,
	});

	return { id: created.id, template: { id: template.id, name: template.name }, skipped };
}

const employeeColumns = {
	employeeId: employee.id,
	hasAccess: employeeHasOrganizationAccess(),
	...liveUserColumns,
};

/**
 * What a template saved from a project holds: the project's icon, colour,
 * budget, open tasks, managers and assignments. The deadline offset stays
 * empty, because an absolute deadline has no meaningful offset. Managers and
 * assigned employees who have left the organization are skipped and
 * reported. Returns null when the project is not in the organization.
 */
export async function projectAsTemplateInput(
	tx: Writer,
	scope: { organizationId: string; projectId: string },
): Promise<{
	project: { id: string; name: string };
	input: Omit<ProjectTemplateInput, "name">;
	skipped: SkippedManagerOrAssignment[];
} | null> {
	const { organizationId, projectId } = scope;
	const [source] = await tx
		.select({
			id: project.id,
			name: project.name,
			icon: project.icon,
			color: project.color,
			budgetHours: project.budgetHours,
		})
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
		.limit(1);
	if (!source) return null;

	const tasks = await listProjectTasks({ organizationId, projectId }, { state: "open" }, tx);
	const managers = await tx
		.select(employeeColumns)
		.from(projectManager)
		.innerJoin(
			employee,
			and(eq(employee.id, projectManager.employeeId), eq(employee.organizationId, organizationId)),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(eq(projectManager.projectId, projectId))
		.orderBy(asc(projectManager.assignedAt), asc(projectManager.id));
	const teams = await tx
		.select({ teamId: team.id })
		.from(projectAssignment)
		.innerJoin(
			team,
			and(eq(team.id, projectAssignment.teamId), eq(team.organizationId, organizationId)),
		)
		.where(
			and(
				eq(projectAssignment.projectId, projectId),
				eq(projectAssignment.organizationId, organizationId),
				eq(projectAssignment.assignmentType, "team"),
			),
		)
		.orderBy(asc(sql`lower(${team.name})`));
	const employees = await tx
		.select(employeeColumns)
		.from(projectAssignment)
		.innerJoin(
			employee,
			and(
				eq(employee.id, projectAssignment.employeeId),
				eq(employee.organizationId, organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(projectAssignment.projectId, projectId),
				eq(projectAssignment.organizationId, organizationId),
				eq(projectAssignment.assignmentType, "employee"),
			),
		)
		.orderBy(asc(projectAssignment.createdAt), asc(projectAssignment.id));

	const skipped: SkippedManagerOrAssignment[] = [];
	const keep = (role: SkippedManagerOrAssignment["role"]) => (row: (typeof managers)[number]) => {
		if (row.hasAccess) return true;
		skipped.push({ role, name: liveUserName(row), reason: "departed" });
		return false;
	};
	const managerEmployeeIds = managers.filter(keep("manager")).map((row) => row.employeeId);
	const employeeIds = employees.filter(keep("employee")).map((row) => row.employeeId);

	return {
		project: { id: source.id, name: source.name },
		input: {
			icon: source.icon,
			color: source.color,
			// Stored numeric(8, 2) text passes the template's hours rule as is.
			budgetHours: source.budgetHours,
			deadlineOffsetDays: null,
			tasks: tasks.map((task) => ({
				name: task.name,
				description: task.description,
				estimateHours: task.estimateHours,
			})),
			managerEmployeeIds,
			assignments: [
				...teams.map((row) => ({ type: "team" as const, targetId: row.teamId })),
				...employeeIds.map((targetId) => ({ type: "employee" as const, targetId })),
			],
		},
		skipped,
	};
}
