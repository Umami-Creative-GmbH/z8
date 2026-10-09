import "server-only";

import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { project, projectAssignment, projectTask } from "@/db/schema";
import { activeProjectCustomerIdSql } from "@/lib/billable-time/project-customer";
import { isProjectTaskId } from "./task-attribution";

/** Project statuses that accept booked time. */
export const BOOKABLE_PROJECT_STATUSES = ["planned", "active", "paused"] as const;

/**
 * The one project booking-eligibility rule (#258 §6, #315): an active project
 * of the target's organization in a bookable status, assigned within that
 * organization to the target directly or to the target's team. Assignments
 * carry no effective dates, so none are applied.
 *
 * Offered form choices and authoritative validation both read this rule, so a
 * project is offered exactly when a submission would accept it. A protected
 * operation passes its transaction.
 */
export type ProjectEligibilityTarget = {
	employeeId: string;
	teamId: string | null;
	organizationId: string;
};

export type EligibleProject = Pick<
	typeof project.$inferSelect,
	| "id"
	| "name"
	| "color"
	| "status"
	| "budgetHours"
	| "deadline"
	// Billable Time (#900): a recording form prefills billability from these.
	| "customerId"
	| "billableDefault"
>;

export async function listEligibleProjects(
	target: ProjectEligibilityTarget,
	reader: Pick<typeof db, "select"> = db,
	options: { projectId?: string } = {},
): Promise<EligibleProject[]> {
	const assignedToTarget: SQL | undefined = target.teamId
		? or(
				eq(projectAssignment.employeeId, target.employeeId),
				eq(projectAssignment.teamId, target.teamId),
			)
		: eq(projectAssignment.employeeId, target.employeeId);
	const rows = await reader
		.select({
			id: project.id,
			name: project.name,
			color: project.color,
			status: project.status,
			budgetHours: project.budgetHours,
			deadline: project.deadline,
			// A deleted customer leaves the project without customer (#768).
			customerId: activeProjectCustomerIdSql(),
			billableDefault: project.billableDefault,
		})
		.from(project)
		.innerJoin(
			projectAssignment,
			and(
				eq(projectAssignment.projectId, project.id),
				eq(projectAssignment.organizationId, target.organizationId),
				assignedToTarget,
			),
		)
		.where(
			and(
				eq(project.organizationId, target.organizationId),
				eq(project.isActive, true),
				inArray(project.status, [...BOOKABLE_PROJECT_STATUSES]),
				options.projectId ? eq(project.id, options.projectId) : undefined,
			),
		);
	// A project assigned both directly and through the team is one choice.
	return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export async function isProjectEligible(
	target: ProjectEligibilityTarget,
	projectId: string,
	reader: Pick<typeof db, "select"> = db,
): Promise<boolean> {
	return (await listEligibleProjects(target, reader, { projectId })).length > 0;
}

/**
 * Why a task cannot be booked (#873), one stable reason per case:
 * - `task_not_found`: no such task in the target's organization;
 * - `task_other_project`: the task belongs to another project than the booking's;
 * - `task_done`: the task is done;
 * - `project_not_bookable`: the booking's project is not eligible for the target.
 */
export type ProjectTaskIneligibility =
	| "task_not_found"
	| "task_other_project"
	| "task_done"
	| "project_not_bookable";

/** The established English wording of each task refusal, for adapters without their own. */
export const PROJECT_TASK_INELIGIBILITY_MESSAGES: Record<ProjectTaskIneligibility, string> = {
	task_not_found: "Task not found",
	task_other_project: "This task belongs to another project",
	task_done: "This task is done, so no time can be booked to it",
	project_not_bookable: "Cannot assign to this project",
};

export type TaskBookingOptions = {
	/**
	 * `share` locks the task row until the caller's transaction ends, so a
	 * concurrent done-marking or deletion waits for the booking to commit.
	 */
	lock?: "share";
};

/**
 * The task half of the booking rule, the one place it is read: an open task of
 * the booking's project in this organization. Returns null when the task may be
 * booked. A malformed ID names no task. Project eligibility for an employee is
 * `projectTaskIneligibility`'s second half.
 */
export async function taskBookingIneligibility(
	reader: Pick<typeof db, "select">,
	booking: { organizationId: string; projectId: string | null; taskId: string },
	options: TaskBookingOptions = {},
): Promise<Exclude<ProjectTaskIneligibility, "project_not_bookable"> | null> {
	if (!isProjectTaskId(booking.taskId)) return "task_not_found";
	const query = reader
		.select({ projectId: projectTask.projectId, state: projectTask.state })
		.from(projectTask)
		.where(
			and(
				eq(projectTask.id, booking.taskId),
				eq(projectTask.organizationId, booking.organizationId),
			),
		)
		.limit(1);
	const [task] = await (options.lock ? query.for(options.lock) : query);
	if (!task) return "task_not_found";
	if (task.projectId !== booking.projectId) return "task_other_project";
	if (task.state !== "open") return "task_done";
	return null;
}

/**
 * The task booking rule, the sibling of project eligibility: an open task of the
 * booking's project, in the target's organization, while that project is
 * eligible for the target. Returns null when the task may be booked. A task is
 * always optional, so writers call this only when a booking sets one. A
 * protected operation passes its transaction and locks the task, so the check
 * holds until the booking commits.
 */
export async function projectTaskIneligibility(
	target: ProjectEligibilityTarget,
	booking: { projectId: string | null; taskId: string },
	reader: Pick<typeof db, "select"> = db,
	options: TaskBookingOptions = {},
): Promise<ProjectTaskIneligibility | null> {
	const taskReason = await taskBookingIneligibility(
		reader,
		{ organizationId: target.organizationId, ...booking },
		options,
	);
	if (taskReason) return taskReason;
	// The task is in the booking's project, so that project is not null here.
	if (!(await isProjectEligible(target, booking.projectId as string, reader))) {
		return "project_not_bookable";
	}
	return null;
}
