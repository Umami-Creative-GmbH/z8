import type { AuditTrail } from "@/lib/audit-trail";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { LifecycleClient } from "../types";

/**
 * The contract between the deactivation's consequence areas (#1440,
 * Organization ADR 0006). Each area module plans its consequences with the
 * same predicate it applies them with, so the preview lists exactly what the
 * submit changes:
 *
 * - `manager-links.ts`     `planManagerLinks` / `applyManagerLinks`
 * - `team-links.ts`        `planTeamLinks` / `applyTeamLinks`
 * - `approval-duties.ts`   `planApprovalDuties` / `applyApprovalDuties`
 * - `shifts.ts`            `planShiftsToOpen` / `applyShiftsToOpen`
 * - `absences.ts`          `planAbsences` / `applyAbsenceCancellations`
 * - `access-ends.ts`       `planAccessEnds` / `applyAccessEnds`
 *
 * `plan.ts` composes the plans, `apply.ts` applies them in that order inside
 * the deactivation transaction, and `preview.ts` serves the plan to the
 * dialog. A plan function only reads. An apply function changes only what its
 * plan lists, writes its audit rows into `ctx.audit` under `ctx.actorUserId`
 * with `deactivationAuditMetadata(ctx)`, and returns the ids it changed.
 * Anything with an external effect (notifications) is returned as an
 * after-commit step, because the transaction may be retried.
 */

/** Audit reason of an admin's deactivation. The backfill (#1442) uses its own. */
export type DeactivationReason = "employee_deactivated" | "employee_deactivation_backfill";

/** What every plan function receives. */
export type DeactivationPlanContext = {
	organizationId: string;
	employeeId: string;
	/** The moment they left; equals the `employee.deactivated_at` the action writes. */
	at: Instant;
	/** IANA zone of the organization, validated. */
	organizationTimeZone: string;
	/** The open or legacy employment period, when one exists. */
	employmentPeriodId: string | null;
	/** Report employee id → chosen replacement manager employee id. */
	replacementManagers: Readonly<Record<string, string>>;
	/** False for the backfill: reports with no current manager keep their link. */
	replaceManagers: boolean;
};

/** What every apply function receives, inside the deactivation transaction. */
export type DeactivationApplyContext = DeactivationPlanContext & {
	actorUserId: string;
	/** The `employee_deactivation` row of this deactivation. */
	deactivationId: string;
	reason: DeactivationReason;
	audit: AuditTrail;
};

export function deactivationAuditMetadata(
	ctx: Pick<DeactivationApplyContext, "reason" | "deactivationId">,
) {
	return { reason: ctx.reason, deactivationId: ctx.deactivationId };
}

/** Reads for planning; inside the transaction it is the transaction client. */
export type DeactivationReader = LifecycleClient;
export type DeactivationWriter = LifecycleClient;

/** Runs after the commit; must be safe to run again on a replayed request. */
export type DeactivationAfterCommit = () => Promise<void>;

export type NamedEmployee = { employeeId: string; name: string };

// ---- manager-links.ts ------------------------------------------------------

export type ManagerLinksPlan = {
	/** Reports left with no current manager; each needs a replacement. */
	reportsNeedingReplacement: Array<
		NamedEmployee & {
			wasPrimary: boolean;
			/** The chosen replacement, if any. */
			replacementEmployeeId: string | null;
			/** Set when the chosen replacement is missing or not eligible. */
			refusal: "replacement_missing" | "replacement_ineligible" | null;
		}
	>;
	/** Reports who keep another current manager and just lose this one. */
	reportsKeepingAnotherManager: Array<NamedEmployee & { newPrimaryManagerId: string | null }>;
	/** The deactivated person's own manager links, which end. */
	ownManagerLinks: Array<NamedEmployee & { isPrimary: boolean }>;
	/** Current employees able to manage the reports (current roster, admin or manager). */
	replacementOptions: NamedEmployee[];
};
export type ManagerLinksApplied = {
	removedLinks: Array<{ employeeId: string; managerId: string }>;
	addedLinks: Array<{ employeeId: string; managerId: string; isPrimary: boolean }>;
};

// ---- team-links.ts (user decision 2026-10-24: end team memberships and project links) ----

export type TeamLinksPlan = {
	teams: Array<{ teamId: string; name: string }>;
	projectAssignments: Array<{ projectId: string; name: string }>;
	projectManagerLinks: Array<{ projectId: string; name: string }>;
};
export type TeamLinksApplied = {
	teamIds: string[];
	projectAssignmentProjectIds: string[];
	projectManagerProjectIds: string[];
};

// ---- approval-duties.ts ----------------------------------------------------

export type ApprovalDutiesPlan = {
	/** Pending duties in the current stage, handed over after the commit. */
	handovers: Array<{
		assignmentId: string;
		workflowId: string;
		stageId: string;
		requesterEmployeeId: string;
		/** The requester's replacement manager, else the workflow's fallback; null → review. */
		targetEmployeeId: string | null;
	}>;
	/** Later stages naming only the person, and duties that can't be transferred. */
	reviews: Array<{
		workflowId: string;
		stageId: string | null;
		approvalRequestId: string | null;
		reason: string;
	}>;
};
export type ApprovalDutiesApplied = { handoverTaskIds: string[]; reviewIds: string[] };

// ---- shifts.ts -------------------------------------------------------------

export type ShiftsPlan = {
	/** Shifts starting after `at`; they become open shifts. */
	shiftsToOpen: Array<{ shiftId: string; date: string; startTime: string; endTime: string }>;
	/** Planners told once, captured before the manager links end. */
	plannerRecipientUserIds: string[];
};
export type ShiftsApplied = { openedShiftIds: string[] };

// ---- absences.ts -----------------------------------------------------------

export type AbsencePlanItem = {
	absenceId: string;
	categoryName: string;
	startDate: string;
	endDate: string;
	status: "pending" | "approved";
};
export type AbsencesPlan = {
	/** Starting after `at`: cancelled through the normal path, allowance restored. */
	absencesToCancel: AbsencePlanItem[];
	/** Spanning `at`: kept and listed. */
	absencesSpanning: AbsencePlanItem[];
};
export type AbsencesApplied = { cancelledAbsenceIds: string[] };

// ---- access-ends.ts --------------------------------------------------------

export type AccessEndsPlan = {
	grants: Array<{
		kind:
			| "expense_officer"
			| "payroll_access"
			| "personnel_file_officer"
			| "driving_licence_verifier";
		grantId: string;
	}>;
	drivingAuthorizations: Array<{ authorizationId: string; state: string }>;
	kioskBadges: Array<{ badgeId: string }>;
	shareLinks: Array<{ linkId: string; kind: string }>;
};
export type AccessEndsApplied = {
	grantIds: string[];
	drivingAuthorizationIds: string[];
	kioskBadgeIds: string[];
	shareLinkIds: string[];
};

// ---- composed (plan.ts / apply.ts / preview.ts) -----------------------------

export type DeactivationPlan = {
	at: string;
	managerLinks: ManagerLinksPlan;
	teamLinks: TeamLinksPlan;
	approvalDuties: ApprovalDutiesPlan;
	shifts: ShiftsPlan;
	absences: AbsencesPlan;
	accessEnds: AccessEndsPlan;
	/** Personnel file retention starts at `at`. */
	retentionStarts: boolean;
	/** The paid seat is released. */
	seatReleased: boolean;
	refusals: Array<"replacement_missing" | "replacement_ineligible">;
};

export type DeactivationApplied = {
	managerLinks: ManagerLinksApplied;
	teamLinks: TeamLinksApplied;
	approvalDuties: ApprovalDutiesApplied;
	shifts: ShiftsApplied;
	absences: AbsencesApplied;
	accessEnds: AccessEndsApplied;
};

/** The shape every area apply returns. */
export type AreaApplyResult<TApplied> = {
	applied: TApplied;
	afterCommit: DeactivationAfterCommit[];
};
