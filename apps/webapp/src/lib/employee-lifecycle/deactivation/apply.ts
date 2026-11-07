import "server-only";

import { endEmployment } from "../employment-ending";
import { applyAbsenceCancellations } from "./absences";
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

/** The deactivation's own roster areas; what the person holds ends through Employment ending. */
export type DeactivationRosterApplied = Omit<DeactivationApplied, "employmentEnding">;

/**
 * Ends what the person holds (Employment ending, #1624) for this
 * deactivation, at its instant. The caller holds the deactivation's locks and
 * the employee row FOR UPDATE, and has not switched the employee off yet.
 */
export function endEmploymentForDeactivation(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
) {
	return endEmployment(tx, {
		organizationId: ctx.organizationId,
		employeeId: ctx.employeeId,
		employmentPeriodId: ctx.employmentPeriodId,
		at: ctx.at,
		now: ctx.at,
		timeZone: ctx.organizationTimeZone,
		actorUserId: ctx.actorUserId,
		audit: ctx.audit,
		cause: {
			kind: "deactivation",
			deactivationId: ctx.deactivationId,
			reason: ctx.reason,
			...(ctx.auditMetadata ? { auditMetadata: ctx.auditMetadata } : {}),
		},
	});
}

/**
 * Applies a deactivation's roster areas inside its transaction, in the lock
 * order the areas agree on (D12): manager links, team links, approval duties,
 * shifts, then absences. The caller has already taken the absence write gates,
 * the exclusive organization configuration guard, the authorization guards and
 * the organization row, ended the employment (`endEmployment`), switched the
 * employee off with `deactivated_at = ctx.at` and refused a plan with
 * refusals. Audit rows go into `ctx.audit`; external effects come back as
 * after-commit steps.
 */
export async function applyDeactivationConsequences(
	tx: DeactivationWriter,
	ctx: DeactivationApplyContext,
	plan: DeactivationPlan,
	dependencies: DeactivationApplyDependencies,
): Promise<{ applied: DeactivationRosterApplied; afterCommit: DeactivationAfterCommit[] }> {
	const managerLinks = await applyManagerLinks(tx, ctx, plan.managerLinks);
	const teamLinks = await applyTeamLinks(tx, ctx, plan.teamLinks);
	const approvalDuties = await applyApprovalDuties(tx, ctx, plan.approvalDuties);
	const shifts = await applyShiftsToOpen(tx, ctx, plan.shifts);
	const absences = await applyAbsenceCancellations(tx, plan.absences, ctx, dependencies);
	return {
		applied: {
			managerLinks: managerLinks.applied,
			teamLinks: teamLinks.applied,
			approvalDuties: approvalDuties.applied,
			shifts: shifts.applied,
			absences: absences.applied,
		},
		afterCommit: [
			...managerLinks.afterCommit,
			...teamLinks.afterCommit,
			...approvalDuties.afterCommit,
			...shifts.afterCommit,
			...absences.afterCommit,
		],
	};
}
