import "server-only";

// Server-side helpers only (#327): not server actions, so they cannot be invoked
// from a client without the callers' authorization. The raw entry writers live in
// `@/lib/time-tracking/time-entry-writer` (#524).

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { project, workPeriod } from "@/db/schema";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { listOpenTasksByProject } from "@/lib/projects/project-tasks";
import {
	BOOKABLE_PROJECT_STATUSES,
	isProjectEligible,
	listEligibleProjects,
} from "@/lib/time-tracking/project-eligibility";

export async function validateProjectAssignment(
	projectId: string,
	employeeId: string,
	teamId: string | null,
	organizationId: string,
	/** A protected operation passes its transaction; defaults to the global client. */
	reader: Pick<typeof db, "query" | "select"> = db,
): Promise<{ isValid: boolean; error?: string }> {
	// Validity is the shared eligibility rule; the reads below only explain a refusal.
	if (await isProjectEligible({ employeeId, teamId, organizationId }, projectId, reader)) {
		return { isValid: true };
	}

	const assignedProject = await reader.query.project.findFirst({
		where: and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
	});

	if (!assignedProject) {
		return { isValid: false, error: "Project not found" };
	}

	if (!assignedProject.isActive) {
		return { isValid: false, error: "Cannot book time to an inactive project" };
	}

	if (
		!BOOKABLE_PROJECT_STATUSES.includes(
			assignedProject.status as (typeof BOOKABLE_PROJECT_STATUSES)[number],
		)
	) {
		return {
			isValid: false,
			error: `Cannot book time to ${assignedProject.status} projects. Project must be planned, active, or paused.`,
		};
	}

	return {
		isValid: false,
		error: "You are not assigned to this project. Contact your administrator.",
	};
}

/**
 * Eligible projects (`listEligibleProjects`) with their booked hours in the
 * organization and their open tasks (#874).
 */
export async function getAssignedProjectsWithHours(
	employeeId: string,
	organizationId: string,
	teamId: string | null,
) {
	const eligible = await listEligibleProjects({ employeeId, teamId, organizationId });
	const projectsById = new Map(eligible.map((row) => [row.id, row]));

	const projectIds = Array.from(projectsById.keys());
	const hoursByProjectId = new Map<string, number>();
	const tasksByProjectId = await listOpenTasksByProject({ organizationId, projectIds });

	if (projectIds.length > 0) {
		const totalHoursByProject = await db
			.select({
				projectId: workPeriod.projectId,
				totalMinutes: sql<number>`COALESCE(SUM(${workPeriod.durationMinutes}), 0)`,
			})
			.from(workPeriod)
			.where(
				and(
					inArray(workPeriod.projectId, projectIds),
					eq(workPeriod.organizationId, organizationId),
					// Completed work only, as the reports count it (#794).
					completedWorkPeriodCondition(),
				),
			)
			.groupBy(workPeriod.projectId);

		for (const row of totalHoursByProject) {
			if (row.projectId) {
				hoursByProjectId.set(row.projectId, row.totalMinutes / 60);
			}
		}
	}

	return { projectsById, hoursByProjectId, tasksByProjectId };
}
