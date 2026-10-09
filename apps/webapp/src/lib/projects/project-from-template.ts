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
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";
import {
	insertProject,
	insertProjectAssignments,
	insertProjectManagers,
	type NewProjectStatus,
} from "./project-creation";
import type { ProjectTemplateInput } from "./project-template-model";
import { projectDeadlineFromTemplateOffset } from "./project-template-deadline";
import { getProjectTemplate } from "./project-templates";

/**
 * Turning a template into a project and a project into a template (#880).
 * Both copy once: the project keeps no live link to its template (ADR 0001),
 * so later edits on either side never reach the other. Every read and write
 * is scoped by organization; authorization is the caller's job.
 */

type Writer = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/** A template or project member that could not be copied, and why. */
export interface SkippedProjectMember {
	role: "manager" | "team" | "employee";
	name: string;
	/** `departed`: the employee left the organization; `removed`: the team or employee no longer exists. */
	reason: "departed" | "removed";
}

export interface ProjectFromTemplateInput {
	name: string;
	description: string | null;
	status: NewProjectStatus;
	customerId: string | null;
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

	const skipped: SkippedProjectMember[] = [];
	const skip = (role: SkippedProjectMember["role"]) => (member: {
		name: string;
		availability: string;
	}) => {
		if (member.availability === "available") return true;
		skipped.push({ role, name: member.name, reason: member.availability as "departed" | "removed" });
		return false;
	};

	const managerIds = template.managers
		.filter(skip("manager"))
		.flatMap((manager) => (manager.employeeId ? [manager.employeeId] : []));
	if (scope.alsoManagedBy && !managerIds.includes(scope.alsoManagedBy)) {
		managerIds.push(scope.alsoManagedBy);
	}
	await insertProjectManagers(tx, {
		projectId: created.id,
		employeeIds: managerIds,
		assignedBy: userId,
	});

	const teamIds: string[] = [];
	const employeeIds: string[] = [];
	for (const assignment of template.assignments) {
		if (!skip(assignment.type)(assignment)) continue;
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
