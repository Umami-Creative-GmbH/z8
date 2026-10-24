import "server-only";

import { and, eq } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { AuditTrail } from "@/lib/audit-trail";
import type { AuthorizationMutationScope } from "@/lib/authorization/authorization-mutation";
import { type Clock, dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { onDeactivationShiftsOpened } from "@/lib/notifications/triggers";
import { addCalendarSyncJob } from "@/lib/queue";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	type DeputyAssignment,
	type ReleasedDeputyAssignments,
	releaseDeputyAssignmentsOnDeactivation,
} from "../deputy-release";
import { resolveCurrentEmploymentPeriod } from "../employment-periods";
import {
	type DeactivationLedgerEntry,
	insertDeactivation,
	recordDeactivationOutcome,
	requestFingerprint,
	writeReceipt,
} from "../receipts";
import { acquireAbsenceCancellationGuards } from "./absences";
import { applyDeactivationConsequences } from "./apply";
import { managerLinkAuthorizationEmployeeIds } from "./manager-links";
import { planDeactivationConsequences } from "./plan";
import type {
	DeactivationAfterCommit,
	DeactivationApplied,
	DeactivationPlan,
	DeactivationWriter,
	NamedEmployee,
} from "./types";

/**
 * The deactivation command (#1440, Organization ADR 0006): the transaction
 * part of Deactivate, after the action's authorization and owner checks. One
 * request ID is one deactivation: `employee_deactivation` is its ledger, and a
 * retried request replays the stored result instead of applying anything again.
 */

export const DEACTIVATE_EMPLOYEE_COMMAND = "deactivate_employee";

export type DeactivationCommand = {
	organizationId: string;
	actorUserId: string;
	employeeId: string;
	requestId: string;
	/** Report employee id → chosen replacement manager employee id. */
	replacementManagers: Readonly<Record<string, string>>;
};

/** The payload a request ID stands for; a retry with other picks is a conflict. */
export function deactivationRequestFingerprint(command: DeactivationCommand): string {
	return requestFingerprint(
		{ userId: command.actorUserId, organizationId: command.organizationId },
		DEACTIVATE_EMPLOYEE_COMMAND,
		{ employeeId: command.employeeId, replacementManagers: { ...command.replacementManagers } },
	);
}

/**
 * The deactivation's protection, in the lock order of D12: the absence and
 * period submission approval write gates (rank 2) before protection, the
 * exclusive organization configuration guard (rank 3, project assignments and
 * the closed-month check), then the user guards (rank 4) of the person, their
 * reports, their own managers and the chosen replacements. The caller takes
 * the organization row afterwards.
 */
export function deactivationProtectionScope(
	command: DeactivationCommand,
): AuthorizationMutationScope {
	return {
		organizationId: command.organizationId,
		organizationWide: true,
		employeeIds: [command.employeeId, ...Object.values(command.replacementManagers)],
		route: async (tx) => ({
			employeeIds: await managerLinkAuthorizationEmployeeIds(tx, {
				organizationId: command.organizationId,
				employeeId: command.employeeId,
			}),
		}),
		beforeProtection: (tx) => acquireAbsenceCancellationGuards(tx, command.organizationId),
	};
}

/** What a replayed request returns and re-runs after the commit. JSON, stored on the ledger. */
export type DeactivationResult = {
	deactivationId: string;
	employeeId: string;
	employeeUserId: string;
	deactivatedAt: string;
	/** The planner notice, keyed by the deactivation, so sending it again sends nothing new. */
	plannerNotice: { employeeName: string; shiftCount: number; recipientUserIds: string[] } | null;
	/** Absences the person stopped covering as deputy; their notices are keyed by `eventKey`. */
	releasedDeputies: { eventKey: string; assignments: DeputyAssignment[] } | null;
	cancelledAbsenceIds: string[];
};

export type DeactivationExecution =
	| {
			kind: "refused";
			plan: DeactivationPlan;
			/** Reports whose replacement is missing or not eligible. */
			reports: Array<NamedEmployee & { refusal: "replacement_missing" | "replacement_ineligible" }>;
	  }
	| {
			kind: "applied";
			deactivationId: string;
			plan: DeactivationPlan;
			applied: DeactivationApplied;
			result: DeactivationResult;
			/** Forwarded to the external audit service after the commit. */
			audit: AuditTrail;
			afterCommit: DeactivationAfterCommit[];
			releasedDeputies: ReleasedDeputyAssignments | null;
	  };

/**
 * Deactivates the employee inside the caller's transaction, which already
 * holds the protection of `deactivationProtectionScope` and the organization
 * row, and checked the actor's authority and the owner rules. Plans first and
 * refuses without writing when a report still needs an eligible replacement;
 * otherwise switches the employee off at `at`, records the deactivation, applies
 * the plan, releases deputy duties and stores the outcome for replays.
 */
export async function executeDeactivation(
	tx: DeactivationWriter,
	command: DeactivationCommand & { at: Instant; requestFingerprint: string; clock?: Clock },
): Promise<DeactivationExecution> {
	const scope = { organizationId: command.organizationId, employeeId: command.employeeId };
	const period = await resolveCurrentEmploymentPeriod(tx, scope);
	const organizationTimeZone = await loadOrganizationTimezone(tx, command.organizationId);
	const planContext = {
		...scope,
		at: command.at,
		organizationTimeZone,
		employmentPeriodId: period?.id ?? null,
		replacementManagers: command.replacementManagers,
		replaceManagers: true,
	};
	const plan = await planDeactivationConsequences(tx, planContext);
	if (plan.refusals.length > 0) {
		return {
			kind: "refused",
			plan,
			reports: plan.managerLinks.reportsNeedingReplacement.flatMap((report) =>
				report.refusal
					? [{ employeeId: report.employeeId, name: report.name, refusal: report.refusal }]
					: [],
			),
		};
	}

	const [person] = await tx
		.update(employee)
		.set({ isActive: false, deactivatedAt: dateFromInstant(command.at) })
		.where(
			and(eq(employee.id, command.employeeId), eq(employee.organizationId, command.organizationId)),
		)
		.returning({ id: employee.id, userId: employee.userId });
	if (!person) throw new Error("The deactivated employee was not found");

	const { id: deactivationId } = await insertDeactivation(tx, {
		...scope,
		employmentPeriodId: planContext.employmentPeriodId,
		deactivatedAt: command.at,
		createdBy: command.actorUserId,
		reason: "employee_deactivated",
		requestId: command.requestId,
		requestFingerprint: command.requestFingerprint,
		replacementManagers: command.replacementManagers,
	});

	const audit = new AuditTrail();
	const { applied, afterCommit } = await applyDeactivationConsequences(
		tx,
		{
			...planContext,
			actorUserId: command.actorUserId,
			deactivationId,
			reason: "employee_deactivated",
			audit,
		},
		plan,
		{ clock: command.clock },
	);

	// The deactivated employee stops being anyone's deputy (#1014).
	const releasedDeputies = await releaseDeputyAssignmentsOnDeactivation(tx, new AuditTrail(), {
		...scope,
		actorUserId: command.actorUserId,
		at: command.at,
		reason: "employee_deactivated",
	});

	const shiftCount = applied.shifts.openedShiftIds.length;
	const plannerNotice =
		shiftCount > 0 && plan.shifts.plannerRecipientUserIds.length > 0
			? {
					employeeName: await employeeName(tx, person.userId),
					shiftCount,
					recipientUserIds: plan.shifts.plannerRecipientUserIds,
				}
			: null;
	const result: DeactivationResult = {
		deactivationId,
		employeeId: command.employeeId,
		employeeUserId: person.userId,
		deactivatedAt: command.at.toString(),
		plannerNotice,
		releasedDeputies: releasedDeputies
			? { eventKey: releasedDeputies.eventKey, assignments: releasedDeputies.assignments }
			: null,
		cancelledAbsenceIds: applied.absences.cancelledAbsenceIds,
	};
	await recordDeactivationOutcome(tx, {
		organizationId: command.organizationId,
		deactivationId,
		applied,
		result,
	});
	if (period) {
		// The employment history event (#1441 shows it); its period is required.
		await writeReceipt(tx, {
			actor: { userId: command.actorUserId, organizationId: command.organizationId },
			employeeId: command.employeeId,
			employmentPeriodId: period.id,
			departureId: null,
			revision: null,
			requestId: command.requestId,
			fingerprint: command.requestFingerprint,
			kind: "employee_deactivated",
			occurredAt: dateFromInstant(command.at),
			result,
			metadata: { deactivationId },
		});
	}

	return {
		kind: "applied",
		deactivationId,
		plan,
		applied,
		result,
		audit,
		afterCommit,
		releasedDeputies,
	};
}

async function employeeName(tx: DeactivationWriter, userId: string): Promise<string> {
	const [row] = await tx.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
	return row?.name ?? "";
}

/**
 * The after-commit work of a deactivation, rebuilt from its ledger row for a
 * replayed request: the steps that are safe to run again (the planner notice
 * and the deputy notices are keyed by the deactivation; deleting a calendar
 * event twice deletes nothing). Audit entries and the self-service absence
 * notices are not repeated. A deactivation that was reactivated since replays
 * nothing.
 */
export function rebuildDeactivationAfterCommit(entry: DeactivationLedgerEntry): {
	result: DeactivationResult | null;
	afterCommit: DeactivationAfterCommit[];
	releasedDeputies: ReleasedDeputyAssignments | null;
} {
	const result = (entry.result as DeactivationResult | null) ?? null;
	if (!result || entry.reactivatedAt !== null) {
		return { result, afterCommit: [], releasedDeputies: null };
	}
	const afterCommit: DeactivationAfterCommit[] = [];
	const { plannerNotice } = result;
	if (plannerNotice) {
		afterCommit.push(() =>
			onDeactivationShiftsOpened({
				organizationId: entry.organizationId,
				deactivationId: entry.id,
				...plannerNotice,
			}),
		);
	}
	if (result.cancelledAbsenceIds.length > 0) {
		afterCommit.push(async () => {
			for (const absenceId of result.cancelledAbsenceIds) {
				await addCalendarSyncJob({
					absenceId,
					employeeId: entry.employeeId,
					organizationId: entry.organizationId,
					action: "delete",
				}).catch(() => undefined);
			}
		});
	}
	return {
		result,
		afterCommit,
		releasedDeputies: result.releasedDeputies
			? {
					organizationId: entry.organizationId,
					deputyEmployeeId: entry.employeeId,
					...result.releasedDeputies,
				}
			: null,
	};
}
