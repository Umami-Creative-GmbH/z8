import "server-only";

import { applyAbsenceCancellations } from "./absences";
import { applyAccessEnds } from "./access-ends";
import { applyApprovalDuties } from "./approval-duties";
import { applyManagerLinks } from "./manager-links";
import { applyShiftsToOpen } from "./shifts";
import { applyTeamLinks } from "./team-links";
import type {
	DeactivationAfterCommit,
	DeactivationApplied,
	DeactivationApplyContext,
	DeactivationApplyDependencies,
	DeactivationPlan,
	DeactivationWriter,
} from "./types";

/**
 * Applies a deactivation's plan inside its transaction, in the lock order the
 * areas agree on (D12): manager links, team links, approval duties, shifts,
 * absences, then access ends. The caller has already taken the absence write
 * gates, the exclusive organization configuration guard, the authorization
 * guards and the organization row, switched the employee off with
 * `deactivated_at = ctx.at` and refused a plan with refusals. Audit rows go
 * into `ctx.audit`; external effects come back as after-commit steps.
 */
export async function applyDeactivationConsequences(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
	plan: DeactivationPlan,
	dependencies: DeactivationApplyDependencies,
): Promise<{ applied: DeactivationApplied; afterCommit: DeactivationAfterCommit[] }> {
	const managerLinks = await applyManagerLinks(tx, ctx, plan.managerLinks);
	const teamLinks = await applyTeamLinks(tx, ctx, plan.teamLinks);
	const approvalDuties = await applyApprovalDuties(tx, ctx, plan.approvalDuties);
	const shifts = await applyShiftsToOpen(tx, ctx, plan.shifts);
	const absences = await applyAbsenceCancellations(tx, plan.absences, ctx, dependencies);
	const accessEnds = await applyAccessEnds(tx, plan.accessEnds, ctx);
	return {
		applied: {
			managerLinks: managerLinks.applied,
			teamLinks: teamLinks.applied,
			approvalDuties: approvalDuties.applied,
			shifts: shifts.applied,
			absences: absences.applied,
			accessEnds: accessEnds.applied,
		},
		afterCommit: [
			...managerLinks.afterCommit,
			...teamLinks.afterCommit,
			...approvalDuties.afterCommit,
			...shifts.afterCommit,
			...absences.afterCommit,
			...accessEnds.afterCommit,
		],
	};
}
