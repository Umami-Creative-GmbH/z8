import "server-only";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	employee,
	projectTemplate,
	projectTemplateAssignment,
	projectTemplateManager,
	projectTemplateTask,
	team,
} from "@/db/schema";
import {
	type AuthUserDisplayNameInput,
	buildAuthUserDisplayName,
} from "@/lib/auth/derived-user-name";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type {
	NormalizedProjectTemplateInput,
	ProjectTemplate,
	ProjectTemplateAssignment,
	ProjectTemplateManager,
	ProjectTemplateMemberAvailability,
	ProjectTemplateSummary,
} from "./project-template-model";

/**
 * Project template reads and writes (#878). Every query is scoped by
 * organization. A template is never a project (ADR 0001); creating a project
 * from it (#880) reads it with `getProjectTemplate` and copies it once.
 */

export type {
	ProjectTemplate,
	ProjectTemplateAssignment,
	ProjectTemplateManager,
	ProjectTemplateMemberAvailability,
	ProjectTemplateSummary,
	ProjectTemplateTask,
} from "./project-template-model";

type Reader = Pick<typeof db, "select">;
type Writer = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/** The organization's templates, by name. */
export async function listProjectTemplates(
	scope: { organizationId: string },
	reader: Reader = db,
): Promise<ProjectTemplateSummary[]> {
	const childCount = (
		table:
			| typeof projectTemplateTask
			| typeof projectTemplateManager
			| typeof projectTemplateAssignment,
	) =>
		reader
			.select({ templateId: table.templateId, count: count() })
			.from(table)
			.where(eq(table.organizationId, scope.organizationId))
			.groupBy(table.templateId);

	const [rows, taskCounts, managerCounts, assignmentCounts] = await Promise.all([
		reader
			.select({
				id: projectTemplate.id,
				name: projectTemplate.name,
				description: projectTemplate.description,
				icon: projectTemplate.icon,
				color: projectTemplate.color,
				budgetHours: projectTemplate.budgetHours,
				deadlineOffsetDays: projectTemplate.deadlineOffsetDays,
				updatedAt: projectTemplate.updatedAt,
			})
			.from(projectTemplate)
			.where(eq(projectTemplate.organizationId, scope.organizationId))
			.orderBy(asc(sql`lower(${projectTemplate.name})`), asc(projectTemplate.id)),
		childCount(projectTemplateTask),
		childCount(projectTemplateManager),
		childCount(projectTemplateAssignment),
	]);
	const byTemplate = (counts: { templateId: string; count: number }[]) =>
		new Map(counts.map((row) => [row.templateId, Number(row.count)]));
	const tasks = byTemplate(taskCounts);
	const managers = byTemplate(managerCounts);
	const assignments = byTemplate(assignmentCounts);
	return rows.map((row) => ({
		...row,
		taskCount: tasks.get(row.id) ?? 0,
		managerCount: managers.get(row.id) ?? 0,
		assignmentCount: assignments.get(row.id) ?? 0,
	}));
}

function employeeAvailability(row: {
	employeeId: string | null;
	hasAccess: boolean | null;
}): ProjectTemplateMemberAvailability {
	if (row.employeeId === null || row.hasAccess === null) return "removed";
	return row.hasAccess ? "available" : "departed";
}

// Flat, not a nested object: Drizzle nulls a left-joined nested object whose
// first column is null, and first/last names are optional.
const liveUserColumns = {
	userFirstName: user.firstName,
	userLastName: user.lastName,
	userName: user.name,
	userEmail: user.email,
};

type LiveUserColumns = {
	userFirstName: string | null;
	userLastName: string | null;
	userName: string | null;
	userEmail: string | null;
};

/** The employee's current display name, or the stored one once they are gone. */
function memberName(snapshot: string, live: LiveUserColumns) {
	const current: AuthUserDisplayNameInput = {
		firstName: live.userFirstName,
		lastName: live.userLastName,
		name: live.userName,
		email: live.userEmail,
	};
	return buildAuthUserDisplayName(current) || snapshot;
}

const byName = <T extends { name: string }>(a: T, b: T) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/**
 * One template of the organization with its tasks, managers and assignments,
 * or null when it does not exist there. Each manager and assignment says
 * whether it can still be copied onto a new project (`availability`); a
 * removed team or employee keeps its last known name.
 */
export async function getProjectTemplate(
	scope: { organizationId: string; templateId: string },
	reader: Reader = db,
): Promise<ProjectTemplate | null> {
	const [template] = await reader
		.select({
			id: projectTemplate.id,
			organizationId: projectTemplate.organizationId,
			name: projectTemplate.name,
			description: projectTemplate.description,
			icon: projectTemplate.icon,
			color: projectTemplate.color,
			budgetHours: projectTemplate.budgetHours,
			deadlineOffsetDays: projectTemplate.deadlineOffsetDays,
			createdAt: projectTemplate.createdAt,
			updatedAt: projectTemplate.updatedAt,
		})
		.from(projectTemplate)
		.where(
			and(
				eq(projectTemplate.id, scope.templateId),
				eq(projectTemplate.organizationId, scope.organizationId),
			),
		)
		.limit(1);
	if (!template) return null;

	const [tasks, managerRows, assignmentRows] = await Promise.all([
		reader
			.select({
				id: projectTemplateTask.id,
				name: projectTemplateTask.name,
				description: projectTemplateTask.description,
				estimateHours: projectTemplateTask.estimateHours,
			})
			.from(projectTemplateTask)
			.where(
				and(
					eq(projectTemplateTask.templateId, template.id),
					eq(projectTemplateTask.organizationId, scope.organizationId),
				),
			)
			.orderBy(asc(sql`lower(${projectTemplateTask.name})`), asc(projectTemplateTask.id)),
		reader
			.select({
				id: projectTemplateManager.id,
				employeeId: projectTemplateManager.employeeId,
				displayName: projectTemplateManager.displayName,
				hasAccess: sql<
					boolean | null
				>`CASE WHEN ${employee.id} IS NULL THEN NULL ELSE ${employeeHasOrganizationAccess()} END`,
				...liveUserColumns,
			})
			.from(projectTemplateManager)
			.leftJoin(
				employee,
				and(
					eq(employee.id, projectTemplateManager.employeeId),
					eq(employee.organizationId, projectTemplateManager.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(projectTemplateManager.templateId, template.id),
					eq(projectTemplateManager.organizationId, scope.organizationId),
				),
			),
		reader
			.select({
				id: projectTemplateAssignment.id,
				type: projectTemplateAssignment.assignmentType,
				teamId: projectTemplateAssignment.teamId,
				employeeId: projectTemplateAssignment.employeeId,
				displayName: projectTemplateAssignment.displayName,
				teamName: team.name,
				hasAccess: sql<
					boolean | null
				>`CASE WHEN ${employee.id} IS NULL THEN NULL ELSE ${employeeHasOrganizationAccess()} END`,
				...liveUserColumns,
			})
			.from(projectTemplateAssignment)
			.leftJoin(
				team,
				and(
					eq(team.id, projectTemplateAssignment.teamId),
					eq(team.organizationId, projectTemplateAssignment.organizationId),
				),
			)
			.leftJoin(
				employee,
				and(
					eq(employee.id, projectTemplateAssignment.employeeId),
					eq(employee.organizationId, projectTemplateAssignment.organizationId),
				),
			)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(projectTemplateAssignment.templateId, template.id),
					eq(projectTemplateAssignment.organizationId, scope.organizationId),
				),
			),
	]);

	const managers: ProjectTemplateManager[] = managerRows
		.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			name: memberName(row.displayName, row),
			availability: employeeAvailability(row),
		}))
		.sort(byName);
	const assignments: ProjectTemplateAssignment[] = assignmentRows
		.map(
			(row): ProjectTemplateAssignment =>
				row.type === "team"
					? {
							id: row.id,
							type: row.type,
							teamId: row.teamId,
							employeeId: null,
							name: row.teamName ?? row.displayName,
							availability: row.teamName === null ? "removed" : "available",
						}
					: {
							id: row.id,
							type: row.type,
							teamId: null,
							employeeId: row.employeeId,
							name: memberName(row.displayName, row),
							availability: employeeAvailability(row),
						},
		)
		.sort((a, b) => (a.type === b.type ? byName(a, b) : a.type === "team" ? -1 : 1));

	return { ...template, tasks, managers, assignments };
}

/** Raised by `writeProjectTemplate` when the input names unusable people or teams. */
export class ProjectTemplateMemberError extends Error {
	constructor(
		readonly problem: "employeeNotFound" | "employeeDeparted" | "teamNotFound",
		readonly targetId: string,
	) {
		super(`Project template member problem: ${problem} (${targetId})`);
		this.name = "ProjectTemplateMemberError";
	}
}

async function resolveEmployees(
	tx: Writer,
	organizationId: string,
	employeeIds: string[],
	keepDepartedIds: ReadonlySet<string>,
) {
	if (employeeIds.length === 0) return new Map<string, string>();
	const rows = await tx
		.select({
			id: employee.id,
			hasAccess: employeeHasOrganizationAccess(),
			...liveUserColumns,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.organizationId, organizationId), inArray(employee.id, employeeIds)));
	const found = new Map(rows.map((row) => [row.id, row]));
	const names = new Map<string, string>();
	for (const id of employeeIds) {
		const row = found.get(id);
		if (!row) throw new ProjectTemplateMemberError("employeeNotFound", id);
		if (!row.hasAccess && !keepDepartedIds.has(id)) {
			throw new ProjectTemplateMemberError("employeeDeparted", id);
		}
		names.set(id, memberName("Unknown", row));
	}
	return names;
}

async function resolveTeams(tx: Writer, organizationId: string, teamIds: string[]) {
	if (teamIds.length === 0) return new Map<string, string>();
	const rows = await tx
		.select({ id: team.id, name: team.name })
		.from(team)
		.where(and(eq(team.organizationId, organizationId), inArray(team.id, teamIds)));
	const names = new Map(rows.map((row) => [row.id, row.name]));
	for (const id of teamIds) {
		if (!names.has(id)) throw new ProjectTemplateMemberError("teamNotFound", id);
	}
	return names;
}

/** The employees a template already references, who may stay even after departing. */
async function currentTemplateEmployeeIds(tx: Writer, organizationId: string, templateId: string) {
	const [managers, assignments] = await Promise.all([
		tx
			.select({ employeeId: projectTemplateManager.employeeId })
			.from(projectTemplateManager)
			.where(
				and(
					eq(projectTemplateManager.templateId, templateId),
					eq(projectTemplateManager.organizationId, organizationId),
				),
			),
		tx
			.select({ employeeId: projectTemplateAssignment.employeeId })
			.from(projectTemplateAssignment)
			.where(
				and(
					eq(projectTemplateAssignment.templateId, templateId),
					eq(projectTemplateAssignment.organizationId, organizationId),
				),
			),
	]);
	return new Set(
		[...managers, ...assignments].flatMap((row) => (row.employeeId ? [row.employeeId] : [])),
	);
}

/**
 * Creates a template, or replaces all contents of an existing one, inside the
 * caller's transaction. Managers and assignments must be teams and employees
 * of the organization; an employee without organization access may only stay
 * on a template that already has them, never be added. References to removed
 * teams and employees are dropped. Throws `ProjectTemplateMemberError` for
 * unusable members, and the database error for a duplicate template name (see
 * `isProjectTemplateNameConflict`). Authorization is the caller's job.
 */
export async function writeProjectTemplate(
	tx: Writer,
	scope: { organizationId: string; userId: string; templateId?: string },
	input: NormalizedProjectTemplateInput,
): Promise<{ id: string }> {
	const { organizationId, userId } = scope;
	const keepDepartedIds = scope.templateId
		? await currentTemplateEmployeeIds(tx, organizationId, scope.templateId)
		: new Set<string>();
	const employeeNames = await resolveEmployees(
		tx,
		organizationId,
		[...new Set([...input.managerEmployeeIds, ...input.employeeIds])],
		keepDepartedIds,
	);
	const teamNames = await resolveTeams(tx, organizationId, input.teamIds);

	const values = {
		name: input.name,
		description: input.description,
		icon: input.icon,
		color: input.color,
		budgetHours: input.budgetHours,
		deadlineOffsetDays: input.deadlineOffsetDays,
	};
	let templateId: string;
	if (scope.templateId) {
		templateId = scope.templateId;
		await tx
			.update(projectTemplate)
			.set({ ...values, updatedBy: userId })
			.where(
				and(eq(projectTemplate.id, templateId), eq(projectTemplate.organizationId, organizationId)),
			);
		for (const table of [projectTemplateTask, projectTemplateManager, projectTemplateAssignment]) {
			await tx
				.delete(table)
				.where(and(eq(table.templateId, templateId), eq(table.organizationId, organizationId)));
		}
	} else {
		const [created] = await tx
			.insert(projectTemplate)
			.values({ ...values, organizationId, createdBy: userId, updatedAt: new Date() })
			.returning({ id: projectTemplate.id });
		templateId = created.id;
	}

	const owned = { organizationId, templateId };
	if (input.tasks.length > 0) {
		await tx.insert(projectTemplateTask).values(input.tasks.map((task) => ({ ...owned, ...task })));
	}
	if (input.managerEmployeeIds.length > 0) {
		await tx.insert(projectTemplateManager).values(
			input.managerEmployeeIds.map((employeeId) => ({
				...owned,
				employeeId,
				displayName: employeeNames.get(employeeId) ?? "Unknown",
				createdBy: userId,
			})),
		);
	}
	const assignments = [
		...input.teamIds.map((teamId) => ({
			...owned,
			assignmentType: "team" as const,
			teamId,
			displayName: teamNames.get(teamId) ?? "Unknown",
			createdBy: userId,
		})),
		...input.employeeIds.map((employeeId) => ({
			...owned,
			assignmentType: "employee" as const,
			employeeId,
			displayName: employeeNames.get(employeeId) ?? "Unknown",
			createdBy: userId,
		})),
	];
	if (assignments.length > 0) {
		await tx.insert(projectTemplateAssignment).values(assignments);
	}
	return { id: templateId };
}

/** Deletes a template of the organization with everything it holds; false when there was none. */
export async function deleteProjectTemplateRow(
	tx: Writer,
	scope: { organizationId: string; templateId: string },
): Promise<boolean> {
	const deleted = await tx
		.delete(projectTemplate)
		.where(
			and(
				eq(projectTemplate.id, scope.templateId),
				eq(projectTemplate.organizationId, scope.organizationId),
			),
		)
		.returning({ id: projectTemplate.id });
	return deleted.length > 0;
}

/** Whether a write failed because the organization already has a template of that name. */
export function isProjectTemplateNameConflict(error: unknown): boolean {
	let candidate: unknown = error;
	for (let depth = 0; depth < 5 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (current.code === "23505" && current.constraint === "projectTemplate_org_name_unique_idx") {
			return true;
		}
		candidate = current.cause;
	}
	return false;
}
