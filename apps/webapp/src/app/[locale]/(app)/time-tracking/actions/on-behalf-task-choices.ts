"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import type { BookedProjectTask, ProjectTaskChoice } from "@/lib/projects/project-task-model";
import { findProjectTask, listOpenTasksByProject } from "@/lib/projects/project-tasks";
import { workPeriodOwner } from "@/lib/time-tracking/clocking";
import { authorizedSubject } from "@/lib/time-tracking/clocking/authorize";
import { isProjectEligible } from "@/lib/time-tracking/project-eligibility";
import { getCurrentSession } from "./auth";
import { logger } from "./shared";

/** What the clock-out on behalf dialog may offer for one running work period (#874). */
export interface OnBehalfClockOutTaskChoices {
	/** The running work's project; the dialog keeps it. Null: no task can be chosen. */
	projectId: string | null;
	/** Open tasks of that project, by name; empty when the project is not bookable. */
	tasks: ProjectTaskChoice[];
	/** The task the running work carries now, which may be done by now. */
	currentTask: BookedProjectTask | null;
}

/**
 * Task choices for clocking out another employee's running work. Authorized
 * like the clock-out on behalf itself: an owner or admin for anyone active in the
 * organization, a manager for a direct report, never for one's own work.
 */
export async function getClockOutOnBehalfTaskChoices(
	workPeriodId: string,
): Promise<ServerActionResult<OnBehalfClockOutTaskChoices>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}
	const organizationId = session.session.activeOrganizationId;
	if (!organizationId) {
		return { success: false, error: "No active organization" };
	}

	try {
		const owner = await workPeriodOwner(organizationId, workPeriodId);
		if (!owner) return { success: false, error: "Work period not found" };
		const subject = await authorizedSubject({
			organizationId,
			principal: { kind: "user", userId: session.user.id },
			subject: { employeeId: owner.id, onBehalf: true },
			kind: "clock_out",
		});
		if (!subject) {
			return { success: false, error: "Not authorized to clock out this employee" };
		}

		const [period] = await db
			.select({ projectId: workPeriod.projectId, taskId: workPeriod.taskId })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, subject.id),
					eq(workPeriod.isActive, true),
					isNull(workPeriod.endTime),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);
		if (!period) return { success: false, error: "Work period is no longer running" };
		if (!period.projectId) {
			return { success: true, data: { projectId: null, tasks: [], currentTask: null } };
		}

		const target = { employeeId: subject.id, teamId: subject.teamId, organizationId };
		const [bookable, current] = await Promise.all([
			isProjectEligible(target, period.projectId),
			period.taskId ? findProjectTask({ organizationId, taskId: period.taskId }) : null,
		]);
		const tasks = bookable
			? ((
					await listOpenTasksByProject({
						organizationId,
						projectIds: [period.projectId],
					})
				).get(period.projectId) ?? [])
			: [];

		return {
			success: true,
			data: {
				projectId: period.projectId,
				tasks,
				currentTask: current
					? {
							id: current.id,
							name: current.name,
							state: current.state,
							projectId: current.projectId,
						}
					: null,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load clock-out on behalf task choices");
		return { success: false, error: "Failed to load tasks" };
	}
}
