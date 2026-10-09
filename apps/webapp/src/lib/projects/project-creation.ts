import "server-only";

import type { db } from "@/db";
import { project, projectAssignment, projectManager, projectNotificationState } from "@/db/schema";
import { isConstraintViolation } from "./constraint-violation";

/**
 * The project writes shared by every way a project gets its rows: the project
 * form, the members panel and creating a project from a template (#880). They
 * write the same tables in the caller's transaction, so the assignment
 * history triggers fire exactly as for a hand-made project. Authorization and
 * input checks are the caller's job.
 */

type Writer = Pick<typeof db, "insert">;

export type NewProjectStatus = "planned" | "active" | "paused" | "completed" | "archived";

export interface NewProjectValues {
	organizationId: string;
	name: string;
	description: string | null;
	status: NewProjectStatus;
	icon: string | null;
	color: string | null;
	/** numeric(8, 2) text; null = unlimited. */
	budgetHours: string | null;
	/** UTC midnight of the deadline's calendar date; null = none. */
	deadline: Date | null;
	customerId: string | null;
	/** Billable Time (#900): whether new work starts billable; needs a customer. Absent is off. */
	billableDefault?: boolean;
	createdBy: string;
}

/** Inserts an active project with its notification state; returns the project row. */
export async function insertProject(tx: Writer, values: NewProjectValues) {
	const [created] = await tx
		.insert(project)
		.values({ ...values, isActive: true, updatedAt: new Date() })
		.returning();
	await tx.insert(projectNotificationState).values({
		projectId: created.id,
		budgetThresholdsNotified: [],
		deadlineThresholdsNotified: [],
		updatedAt: new Date(),
	});
	return created;
}

export async function insertProjectManagers(
	tx: Writer,
	input: { projectId: string; employeeIds: readonly string[]; assignedBy: string },
) {
	if (input.employeeIds.length === 0) return;
	await tx.insert(projectManager).values(
		input.employeeIds.map((employeeId) => ({
			projectId: input.projectId,
			employeeId,
			assignedBy: input.assignedBy,
		})),
	);
}

export async function insertProjectAssignments(
	tx: Writer,
	input: {
		projectId: string;
		organizationId: string;
		teamIds: readonly string[];
		employeeIds: readonly string[];
		createdBy: string;
	},
) {
	const owned = {
		projectId: input.projectId,
		organizationId: input.organizationId,
		createdBy: input.createdBy,
	};
	const rows = [
		...input.teamIds.map((teamId) => ({
			...owned,
			assignmentType: "team" as const,
			teamId,
			employeeId: null,
		})),
		...input.employeeIds.map((employeeId) => ({
			...owned,
			assignmentType: "employee" as const,
			teamId: null,
			employeeId,
		})),
	];
	if (rows.length === 0) return;
	await tx.insert(projectAssignment).values(rows);
}

/** Whether a write failed because the organization already has a project of that name. */
export function isProjectNameConflict(error: unknown): boolean {
	return isConstraintViolation(error, "23505", "project_org_name_idx");
}
