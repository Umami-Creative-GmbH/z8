import "server-only";

import { and, eq } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { AuditTrail } from "@/lib/audit-trail";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { employeeCoordinationGuard, holdGuard } from "@/lib/time-tracking/work-transaction/ranks";
import type { DeputyAssignment } from "../deputy-release";
import type { DeputyAssignmentsEndingApplied } from "../employment-ending/deputy-assignments";
import { lockEmployeeRow, tryLockLifecycleOrganization } from "../locks";
import { checklistPlanSnapshot } from "../reactivation-checklist";
import { recordDeactivationOutcome, writeReceipt } from "../receipts";
import { acquireAbsenceCancellationGuards } from "./absences";
import { applyDeactivationConsequences, endEmploymentForDeactivation } from "./apply";
import { managerLinkAuthorizationEmployeeIds } from "./manager-links";
import { type DeactivationPlannerNotice, loadPlannerNotice } from "./shifts";
import type {
	DeactivationAfterCommit,
	DeactivationApplied,
	DeactivationPlan,
	DeactivationPlanContext,
	DeactivationReason,
	DeactivationWriter,
	NamedEmployee,
} from "./types";

/**
 * The one sequence every deactivation runs (#1638): its locks, what it applies
 * once the ledger row exists, and its after-commit steps. Internal to the
 * deactivation module: `command.ts` (an admin's Deactivate) and
 * `non-interactive.ts` (the backfill and the follow-up deactivation) are the
 * entries, and each decides under the locks whether there is anything to
 * apply.
 */

type Database = typeof appDb;

/**
 * Runs `body` in its own transaction under the deactivation's locks, in the
 * lock order of D12: the absence and period submission approval write gates
 * (rank 2) before protection, the exclusive organization configuration guard
 * (rank 3, project assignments and the closed-month check), the user guards
 * (rank 4) of the person, their reports, their own managers and the picked
 * replacements, the employee coordination guard, then the organization row.
 *
 * An organization that does not exist returns `organizationMissing()` when
 * given, and throws otherwise.
 */
export function inDeactivationLocks<T>(
	database: Database,
	scope: {
		organizationId: string;
		employeeId: string;
		/** The replacement managers an admin picked; their user guards are taken too. */
		replacementManagerIds?: readonly string[];
	},
	body: (tx: DeactivationWriter) => Promise<T>,
	organizationMissing?: () => T,
): Promise<T> {
	const { organizationId, employeeId } = scope;
	return withAuthorizationMutation(
		{
			organizationId,
			organizationWide: true,
			employeeIds: [employeeId, ...(scope.replacementManagerIds ?? [])],
			route: async (tx) => ({
				employeeIds: await managerLinkAuthorizationEmployeeIds(tx, {
					organizationId,
					employeeId,
				}),
			}),
			beforeProtection: (tx) => acquireAbsenceCancellationGuards(tx, organizationId),
		},
		async (tx) => {
			await holdGuard(tx, employeeCoordinationGuard(employeeId));
			// All lifecycle mutations for an organization take this row lock, serializing owner safety checks.
			if (!(await tryLockLifecycleOrganization(tx, organizationId))) {
				if (organizationMissing) return organizationMissing();
				throw new Error("organization_not_found");
			}
			return body(tx);
		},
		database,
	);
}

/** What a replayed request returns and re-runs after the commit. JSON, stored on the ledger. */
export type DeactivationResult = {
	deactivationId: string;
	employeeId: string;
	employeeUserId: string;
	deactivatedAt: string;
	/** The planner notice, keyed by the deactivation, so sending it again sends nothing new. */
	plannerNotice: DeactivationPlannerNotice | null;
	/** Absences the person stopped covering as deputy; their notices are keyed by `eventKey`. */
	releasedDeputies: {
		eventKey: string;
		assignments: DeputyAssignment[];
	} | null;
	cancelledAbsenceIds: string[];
};

/** How the two kinds of deactivation differ once the ledger row exists. */
export type DeactivationMode =
	/**
	 * An admin confirmed it. The employee is still switched on: the sequence
	 * switches them off at the plan's instant, after Employment ending. The
	 * stored result keeps the planner notice for a replay, and the history event
	 * is written whenever the employee has an employment period.
	 */
	| { kind: "interactive" }
	/**
	 * Nobody confirms it, and someone already switched the employee off: only
	 * the instant is stored on the employee. No planner notice is stored;
	 * reports left with no current manager keep their link and are returned.
	 */
	| {
			kind: "non_interactive";
			employeeUserId: string;
			/**
			 * When they left: stored on the employee and as the history event. Null
			 * when no evidence survives: the employee keeps no instant and no
			 * history event is written.
			 */
			leftAt: Instant | null;
			/** Added to every audit row and to the history event (e.g. `connectionId`). */
			metadata?: Readonly<Record<string, unknown>>;
			/** Added to the result stored on the ledger row. */
			result?: Readonly<Record<string, unknown>>;
			/**
			 * Marks the row while reports are left with no current manager, so the
			 * follow-up tells the admins until it succeeds (`sendOwedReportsNotices`).
			 */
			owesReportsNotice?: boolean;
	  };

export type AppliedDeactivation = {
	deactivationId: string;
	employeeUserId: string;
	plan: DeactivationPlan;
	applied: DeactivationApplied;
	/** Reports who kept their link to the person because no current manager is left. */
	reportsWithoutManager: NamedEmployee[];
	/** Forwarded to the external audit service after the commit. */
	audit: AuditTrail;
	afterCommit: DeactivationAfterCommit[];
};

/**
 * Everything after the ledger row exists, inside the transaction of
 * `inDeactivationLocks`: the employee row lock, Employment ending while the
 * person still holds everything, the employee's switch-off or instant, the
 * roster areas, the stored outcome and the history event. The caller planned
 * under the same locks and refused a plan with refusals.
 */
export async function applyRecordedDeactivation(
	tx: DeactivationWriter,
	database: Database,
	input: {
		context: DeactivationPlanContext;
		plan: DeactivationPlan;
		deactivationId: string;
		actorUserId: string;
		reason: DeactivationReason;
		requestId: string;
		requestFingerprint: string;
		/** The instant on the ledger row. */
		deactivatedAt: Instant;
		clock?: Clock;
		mode: DeactivationMode;
	},
): Promise<AppliedDeactivation> {
	const { context, plan, deactivationId, mode } = input;
	const { organizationId, employeeId } = context;
	const scope = { organizationId, employeeId };
	const auditMetadata = mode.kind === "non_interactive" ? mode.metadata : undefined;

	// The row lock keeps a concurrent registration (a kiosk fob) from slipping in.
	await lockEmployeeRow(tx, scope);
	const audit = new AuditTrail();
	if (mode.kind === "non_interactive" && mode.leftAt) {
		await recordLeftAt(tx, audit, {
			...scope,
			actorUserId: input.actorUserId,
			reason: input.reason,
			metadata: auditMetadata,
			at: mode.leftAt,
			deactivationId,
		});
	}
	const applyContext = {
		...context,
		actorUserId: input.actorUserId,
		deactivationId,
		reason: input.reason,
		auditMetadata,
		audit,
	};

	// Everything the person holds ends first: for an admin's deactivation while
	// they are still switched on, in their teams and in their open period.
	const ending = await endEmploymentForDeactivation(tx, applyContext, { database });
	const employeeUserId =
		mode.kind === "interactive" ? await switchOff(tx, scope, context.at) : mode.employeeUserId;
	const roster = await applyDeactivationConsequences(tx, applyContext, plan, {
		clock: input.clock,
		database,
	});
	const applied: DeactivationApplied = { ...roster.applied, employmentEnding: ending.applied };
	const afterCommit = [...ending.afterCommit, ...roster.afterCommit];
	const reportsWithoutManager =
		mode.kind === "non_interactive" ? reportsKeepingTheirLink(plan) : [];

	const stored: DeactivationResult = {
		deactivationId,
		employeeId,
		employeeUserId,
		deactivatedAt: input.deactivatedAt.toString(),
		plannerNotice:
			mode.kind === "interactive"
				? await loadPlannerNotice(tx, scope, {
						openedShiftIds: applied.shifts.openedShiftIds,
						recipientUserIds: plan.shifts.plannerRecipientUserIds,
					})
				: null,
		releasedDeputies: storedReleasedDeputies(ending.applied.deputyAssignments),
		cancelledAbsenceIds: applied.absences.cancelledAbsenceIds,
	};
	const result: Record<string, unknown> =
		mode.kind === "interactive" ? stored : { ...mode.result, ...stored, reportsWithoutManager };
	await recordDeactivationOutcome(tx, {
		organizationId,
		deactivationId,
		applied,
		result,
		// The names the reactivation checklist shows (#1441).
		plan: checklistPlanSnapshot(plan),
		// The follow-up retries the admins' notice until it is sent (#1629).
		reportsNoticePending:
			mode.kind === "non_interactive" &&
			mode.owesReportsNotice === true &&
			reportsWithoutManager.length > 0,
	});

	// The employment history event (#1441 shows it): its period is required, and
	// without anyone confirming it, so is a recorded instant.
	const occurredAt = mode.kind === "interactive" ? context.at : mode.leftAt;
	if (occurredAt && context.employmentPeriodId) {
		await writeReceipt(tx, {
			actor: { userId: input.actorUserId, organizationId },
			employeeId,
			employmentPeriodId: context.employmentPeriodId,
			departureId: null,
			revision: null,
			requestId: input.requestId,
			fingerprint: input.requestFingerprint,
			kind: "employee_deactivated",
			occurredAt: dateFromInstant(occurredAt),
			result,
			metadata:
				mode.kind === "interactive"
					? { deactivationId }
					: { ...mode.metadata, deactivationId, reason: input.reason },
		});
	}

	return {
		deactivationId,
		employeeUserId,
		plan,
		applied,
		reportsWithoutManager,
		audit,
		afterCommit,
	};
}

/**
 * Runs after-commit steps one after another. A failing step never undoes the
 * commit or stops the next step: it is handed to `onFailure` and its message
 * comes back as a warning.
 */
export async function runAfterCommitSteps(
	steps: readonly DeactivationAfterCommit[],
	onFailure: (error: unknown) => void,
): Promise<string[]> {
	const warnings: string[] = [];
	for (const step of steps) {
		try {
			await step();
		} catch (error) {
			onFailure(error);
			warnings.push(error instanceof Error ? error.message : String(error));
		}
	}
	return warnings;
}

/** Switches the employee off at the instant; returns their user. */
async function switchOff(
	tx: DeactivationWriter,
	scope: { organizationId: string; employeeId: string },
	at: Instant,
): Promise<string> {
	const [person] = await tx
		.update(employee)
		.set({ isActive: false, deactivatedAt: dateFromInstant(at) })
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.returning({ userId: employee.userId });
	if (!person) throw new Error("The deactivated employee was not found");
	return person.userId;
}

/**
 * Stores when they left on the employee, audited with the deactivation's
 * reason, so the employee's instant equals the deactivation's (readers of an
 * open deactivation match the two). Replaces the instant the switch-off
 * trigger wrote, if any. Only the instant: is_active stays untouched. The
 * caller holds the employee row FOR UPDATE.
 */
async function recordLeftAt(
	tx: DeactivationWriter,
	audit: AuditTrail,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		reason: DeactivationReason;
		metadata?: Readonly<Record<string, unknown>>;
		at: Instant;
		deactivationId: string;
	},
): Promise<void> {
	const scope = and(
		eq(employee.organizationId, input.organizationId),
		eq(employee.id, input.employeeId),
	);
	const [current] = await tx
		.select({ deactivatedAt: employee.deactivatedAt })
		.from(employee)
		.where(scope);
	const at = dateFromInstant(input.at);
	if (!current || current.deactivatedAt?.getTime() === at.getTime()) return;
	await tx.update(employee).set({ deactivatedAt: at }).where(scope);
	await audit.record(tx, {
		organizationId: input.organizationId,
		action: AuditAction.EMPLOYEE_UPDATED,
		actorUserId: input.actorUserId,
		targetType: "employee",
		targetId: input.employeeId,
		employeeId: input.employeeId,
		changes: {
			deactivatedAt: {
				from: current.deactivatedAt ? instantFromDate(current.deactivatedAt).toString() : null,
				to: input.at.toString(),
			},
		},
		metadata: {
			...input.metadata,
			reason: input.reason,
			deactivationId: input.deactivationId,
		},
	});
}

/** The reports a plan leaves with no current manager; they keep their link. */
function reportsKeepingTheirLink(plan: DeactivationPlan): NamedEmployee[] {
	return plan.managerLinks.reportsNeedingReplacement.map((report) => ({
		employeeId: report.employeeId,
		name: report.name,
	}));
}

/** The deputy duties Employment ending released, as the stored result keeps them for a replay (#1014). */
function storedReleasedDeputies(
	released: DeputyAssignmentsEndingApplied,
): DeactivationResult["releasedDeputies"] {
	return released.assignments.length > 0
		? { eventKey: released.eventKey, assignments: released.assignments }
		: null;
}
