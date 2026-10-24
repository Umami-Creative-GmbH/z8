import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { project, projectAssignment, projectManager, team, teamMembership } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { removeTeamMembership } from "@/lib/organization/team-membership-removal";
import { acquireExclusiveOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction";
import {
	type AreaApplyResult,
	type DeactivationApplyContext,
	type DeactivationPlanContext,
	type DeactivationReader,
	type DeactivationWriter,
	deactivationAuditMetadata,
	type TeamLinksApplied,
	type TeamLinksPlan,
} from "./types";

/**
 * Team and project links at a deactivation (#1440, user decision 2026-10-24):
 * the person's team memberships, their own project assignments (a team's
 * assignment stays with the team) and their project manager links end, each
 * audited under the acting admin. Reactivation re-adds nothing; the #1441
 * checklist offers them from the applied ids.
 *
 * Lock order: project assignments are a manual-clocking dependency, so their
 * removal holds the exclusive organization configuration guard (rank 3), which
 * must be taken before the authorization guards (rank 4). The deactivation's
 * `withAuthorizationMutation` therefore passes `organizationWide: true`; the
 * guard taken again here is then a no-op.
 */

/** Reads only; the apply runs the same plan inside the deactivation transaction. */
export async function planTeamLinks(
	reader: DeactivationReader,
	ctx: DeactivationPlanContext,
): Promise<TeamLinksPlan> {
	const teams = await reader
		.select({ teamId: team.id, name: team.name })
		.from(teamMembership)
		.innerJoin(
			team,
			and(
				eq(team.id, teamMembership.teamId),
				eq(team.organizationId, teamMembership.organizationId),
			),
		)
		.where(
			and(
				eq(teamMembership.organizationId, ctx.organizationId),
				eq(teamMembership.employeeId, ctx.employeeId),
			),
		)
		.orderBy(asc(team.name), asc(team.id));
	const projectAssignments = await reader
		.select({ projectId: project.id, name: project.name })
		.from(projectAssignment)
		.innerJoin(
			project,
			and(
				eq(project.id, projectAssignment.projectId),
				eq(project.organizationId, projectAssignment.organizationId),
			),
		)
		.where(
			and(
				eq(projectAssignment.organizationId, ctx.organizationId),
				eq(projectAssignment.assignmentType, "employee"),
				eq(projectAssignment.employeeId, ctx.employeeId),
			),
		)
		.orderBy(asc(project.name), asc(project.id));
	const projectManagerLinks = await reader
		.select({ projectId: project.id, name: project.name })
		.from(projectManager)
		.innerJoin(
			project,
			and(eq(project.id, projectManager.projectId), eq(project.organizationId, ctx.organizationId)),
		)
		.where(eq(projectManager.employeeId, ctx.employeeId))
		.orderBy(asc(project.name), asc(project.id));
	return { teams, projectAssignments, projectManagerLinks };
}

/**
 * Ends exactly the links the plan lists, inside the deactivation transaction,
 * and audits each under the acting admin. A link already gone is skipped, so a
 * re-run changes nothing.
 */
export async function applyTeamLinks(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
	plan: TeamLinksPlan,
): Promise<AreaApplyResult<TeamLinksApplied>> {
	const applied: TeamLinksApplied = {
		teamIds: [],
		projectAssignmentProjectIds: [],
		projectManagerProjectIds: [],
	};
	const metadata = deactivationAuditMetadata(ctx);

	const present =
		plan.teams.length === 0
			? new Set<string>()
			: new Set(
					(
						await tx
							.select({ teamId: teamMembership.teamId })
							.from(teamMembership)
							.where(
								and(
									eq(teamMembership.organizationId, ctx.organizationId),
									eq(teamMembership.employeeId, ctx.employeeId),
									inArray(
										teamMembership.teamId,
										plan.teams.map((membership) => membership.teamId),
									),
								),
							)
							.for("update")
					).map((row) => row.teamId),
				);
	for (const membership of plan.teams) {
		if (!present.has(membership.teamId)) continue;
		await removeTeamMembership(tx, {
			organizationId: ctx.organizationId,
			teamId: membership.teamId,
			employeeId: ctx.employeeId,
		});
		applied.teamIds.push(membership.teamId);
		await ctx.audit.record(tx, {
			organizationId: ctx.organizationId,
			action: AuditAction.TEAM_MEMBER_REMOVED,
			actorUserId: ctx.actorUserId,
			targetType: "team",
			targetId: membership.teamId,
			employeeId: ctx.employeeId,
			metadata: { ...metadata, teamName: membership.name, employeeId: ctx.employeeId },
		});
	}

	if (plan.projectAssignments.length > 0) {
		await acquireExclusiveOrganizationConfigurationGuard(tx, ctx.organizationId);
		const names = new Map(plan.projectAssignments.map((item) => [item.projectId, item.name]));
		const removed = await tx
			.delete(projectAssignment)
			.where(
				and(
					eq(projectAssignment.organizationId, ctx.organizationId),
					eq(projectAssignment.assignmentType, "employee"),
					eq(projectAssignment.employeeId, ctx.employeeId),
					inArray(projectAssignment.projectId, [...names.keys()]),
				),
			)
			.returning({ projectId: projectAssignment.projectId });
		const removedIds = new Set(removed.map((row) => row.projectId));
		for (const item of plan.projectAssignments) {
			if (!removedIds.has(item.projectId)) continue;
			applied.projectAssignmentProjectIds.push(item.projectId);
			await ctx.audit.record(tx, {
				organizationId: ctx.organizationId,
				action: AuditAction.PROJECT_ASSIGNMENT_REMOVED,
				actorUserId: ctx.actorUserId,
				targetType: "project_assignment",
				targetId: item.projectId,
				employeeId: ctx.employeeId,
				metadata: {
					...metadata,
					projectName: item.name,
					assignmentType: "employee",
					employeeId: ctx.employeeId,
				},
			});
		}
	}

	if (plan.projectManagerLinks.length > 0) {
		const removed = await tx
			.delete(projectManager)
			.where(
				and(
					eq(projectManager.employeeId, ctx.employeeId),
					inArray(
						projectManager.projectId,
						plan.projectManagerLinks.map((item) => item.projectId),
					),
					inArray(
						projectManager.projectId,
						tx
							.select({ id: project.id })
							.from(project)
							.where(eq(project.organizationId, ctx.organizationId)),
					),
				),
			)
			.returning({ projectId: projectManager.projectId });
		const removedIds = new Set(removed.map((row) => row.projectId));
		for (const item of plan.projectManagerLinks) {
			if (!removedIds.has(item.projectId)) continue;
			applied.projectManagerProjectIds.push(item.projectId);
			await ctx.audit.record(tx, {
				organizationId: ctx.organizationId,
				action: AuditAction.PROJECT_MANAGER_REMOVED,
				actorUserId: ctx.actorUserId,
				targetType: "project",
				targetId: item.projectId,
				employeeId: ctx.employeeId,
				metadata: { ...metadata, projectName: item.name, employeeId: ctx.employeeId },
			});
		}
	}

	return { applied, afterCommit: [] };
}
