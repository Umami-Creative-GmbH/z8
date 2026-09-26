import "server-only";

import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { project, projectAssignment } from "@/db/schema";
import { BOOKABLE_PROJECT_STATUSES } from "@/app/[locale]/(app)/time-tracking/actions/shared";

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
	"id" | "name" | "color" | "status" | "budgetHours" | "deadline"
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
