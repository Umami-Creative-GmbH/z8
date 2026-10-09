import "server-only";

import { and, asc, eq, exists, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import { employee, project, projectManager } from "@/db/schema";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { isSettingsAccessMembershipRole, resolveSettingsAccessTier } from "@/lib/settings-access";

/**
 * Who may manage a project's tasks (#872, decision 2 of #770):
 * - org owners and admins, for every project of their organization;
 * - that project's managers (a `project_manager` row for the project and the
 *   caller's employee, while the employee has organization access), whatever
 *   their employee role. A plain employee who manages a project qualifies.
 * Nobody else. This does not depend on the project settings access tier.
 */
export interface ProjectTaskManager {
	userId: string;
	organizationId: string;
	isOrgAdmin: boolean;
}

type Reader = Pick<typeof db, "select">;

/** The caller as a potential task manager, or null without approved membership. */
export async function loadProjectTaskManager(
	input: { userId: string; organizationId: string },
	reader: Reader = db,
): Promise<ProjectTaskManager | null> {
	const [membership] = await reader
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.userId, input.userId),
				eq(member.organizationId, input.organizationId),
				eq(member.status, "approved"),
			),
		)
		.limit(1);
	if (!membership) return null;
	return {
		userId: input.userId,
		organizationId: input.organizationId,
		// The one definition of an org admin, shared with the settings access tiers.
		isOrgAdmin:
			resolveSettingsAccessTier({
				activeOrganizationId: input.organizationId,
				membershipRole: isSettingsAccessMembershipRole(membership.role) ? membership.role : null,
				employeeRole: null,
			}) === "orgAdmin",
	};
}

/** True when the caller's employee with organization access manages the project. */
function managedByCaller(manager: ProjectTaskManager, reader: Reader): SQL {
	return exists(
		reader
			.select({ id: projectManager.id })
			.from(projectManager)
			.innerJoin(employee, eq(employee.id, projectManager.employeeId))
			.where(
				and(
					eq(projectManager.projectId, project.id),
					eq(employee.userId, manager.userId),
					eq(employee.organizationId, manager.organizationId),
					employeeHasOrganizationAccess(),
				),
			),
	);
}

function manageableProjects(manager: ProjectTaskManager, reader: Reader, projectId?: string) {
	return and(
		eq(project.organizationId, manager.organizationId),
		projectId ? eq(project.id, projectId) : undefined,
		manager.isOrgAdmin ? undefined : managedByCaller(manager, reader),
	);
}

/** Whether the caller may manage the tasks of this project of their organization. */
export async function canManageProjectTasks(
	manager: ProjectTaskManager,
	projectId: string,
	reader: Reader = db,
): Promise<boolean> {
	const [row] = await reader
		.select({ id: project.id })
		.from(project)
		.where(manageableProjects(manager, reader, projectId))
		.limit(1);
	return row !== undefined;
}

export type TaskManagedProject = Pick<
	typeof project.$inferSelect,
	"id" | "name" | "color" | "status"
>;

/** Every project of the organization whose tasks the caller may manage, by name. */
export async function listProjectsWithManageableTasks(
	manager: ProjectTaskManager,
	reader: Reader = db,
): Promise<TaskManagedProject[]> {
	return reader
		.select({ id: project.id, name: project.name, color: project.color, status: project.status })
		.from(project)
		.where(manageableProjects(manager, reader))
		.orderBy(asc(project.name));
}
