import "server-only";

import { z } from "zod";
import type { db as appDb } from "@/db";
import { AuditAction, type AuditLogEntry, logAudit } from "@/lib/audit-logger";
import { revokeOrganizationActiveSessions } from "@/lib/auth/organization-session-revocation";
import { reconcileBillingSeatsForOrganization } from "@/lib/billing/seat-sync-trigger";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { addCalendarSyncJob } from "@/lib/queue";
import { pauseSchedulesAfterOwnerAccessChange } from "@/lib/scheduled-exports/application/owner-access-change";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { deputyReleaseNotice } from "../employment-ending/deputy-assignments";
import { resolveCurrentEmploymentPeriod } from "../employment-periods";
import { checkLifecycleTarget, type LifecycleTargetCheck } from "../lifecycle-target";
import {
	type DeactivationLedgerEntry,
	insertDeactivation,
	readDeactivationByRequest,
	requestFingerprint,
} from "../receipts";
import { validatedReplacementManagers } from "./manager-links";
import { planDeactivationConsequences } from "./plan";
import {
	type AppliedDeactivation,
	applyRecordedDeactivation,
	type DeactivationResult,
	inDeactivationLocks,
	runAfterCommitSteps,
} from "./sequence";
import { sendPlannerNotice } from "./shifts";
import type { DeactivationAfterCommit, DeactivationPlanContext, NamedEmployee } from "./types";

/**
 * Deactivate (#1440, Organization ADR 0006), as an admin confirms it: the
 * whole command behind one call (#1638). One request ID is one deactivation:
 * `employee_deactivation` is its ledger, and a retried request replays the
 * stored result instead of applying anything again.
 */

export type { DeactivationResult } from "./sequence";

type Database = typeof appDb;

const logger = createLogger("Deactivation");

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
		{
			employeeId: command.employeeId,
			replacementManagers: { ...command.replacementManagers },
		},
	);
}

/** Why the actor may not deactivate this employee; the caller words it. */
export type DeactivationTargetRefusal = Exclude<
	LifecycleTargetCheck,
	{ type: "change" } | { type: "unchanged" }
>;

export type DeactivateOutcome =
	/** This request deactivated the employee. */
	| { kind: "deactivated"; deactivationId: string; warnings: string[] }
	/**
	 * The same request again: nothing was applied twice. Its after-commit work
	 * that is safe to repeat ran again, unless the deactivation was reactivated
	 * since.
	 */
	| { kind: "replayed"; reactivatedSince: boolean; warnings: string[] }
	/** Already a former employee: nothing changed; only their sessions were revoked again. */
	| { kind: "unchanged"; warnings: string[] }
	/** A report still needs an eligible replacement manager. Nothing was written. */
	| {
			kind: "refused";
			reports: Array<
				NamedEmployee & {
					refusal: "replacement_missing" | "replacement_ineligible";
				}
			>;
	  }
	/** The actor may not deactivate this employee, or there is no such employee. Nothing was written. */
	| { kind: "rejected"; refusal: DeactivationTargetRefusal };

/**
 * What a deactivation does outside the database once it has committed. The
 * real ones are the default; a test passes its own to see their order.
 */
export type DeactivationEffects = {
	revokeSessions: (userId: string, organizationId: string) => Promise<void>;
	logAudit: (entry: AuditLogEntry) => Promise<void>;
	/** A former employee holds no paid seat (#1439). */
	reconcileSeats: (organizationId: string) => Promise<void>;
	/** A deactivated owner or admin can no longer own scheduled exports (#988). */
	pauseOwnedExports: (
		database: Database,
		input: { organizationId: string; owner: { userId: string }; actorUserId: string },
	) => Promise<void>;
};

const defaultEffects: DeactivationEffects = {
	revokeSessions: (userId, organizationId) =>
		revokeOrganizationActiveSessions(userId, organizationId),
	logAudit,
	// Best effort, as for member removal, but recounting the local seats even
	// while external billing is off, as a departure does: a failed delivery is
	// logged, and the billing seat reconciliation job settles it.
	reconcileSeats: (organizationId) =>
		reconcileBillingSeatsForOrganization(organizationId, { alsoWhenBillingDisabled: true }),
	pauseOwnedExports: pauseSchedulesAfterOwnerAccessChange,
};

export type DeactivateDependencies = {
	/** Gives the instant every consequence uses; read once the locks are held. */
	clock?: Clock;
	effects?: Partial<DeactivationEffects>;
};

type Committed =
	| { kind: "deactivated"; applied: AppliedDeactivation }
	| {
			kind: "replayed";
			employeeUserId: string | null;
			reactivatedSince: boolean;
			afterCommit: DeactivationAfterCommit[];
	  }
	| { kind: "unchanged"; employeeUserId: string }
	| Extract<DeactivateOutcome, { kind: "refused" | "rejected" }>;

/**
 * Deactivates the employee: they become a former employee with the same
 * consequences as a departure taking effect, applied in one transaction.
 *
 * The caller has authenticated the actor and parsed the command; everything
 * else happens here. In its own transaction on `database`, under the
 * deactivation's locks (`sequence.ts`), it replays a request ID it has seen,
 * checks that the actor may deactivate this employee (the owner rules), plans
 * and refuses without writing while a report still needs an eligible
 * replacement, and otherwise records the deactivation and runs the
 * deactivation sequence. After the commit it forwards the audit, runs the
 * consequences' after-commit steps (a failing step is logged and returned as a
 * warning, never undoing the commit), revokes the person's sessions, writes
 * the `employee.deactivated` audit entry, recounts the seats and pauses the
 * scheduled exports they owned. All of it runs on `database`.
 *
 * Throws `DeactivationRequestConflictError` for a request ID used before with
 * other picks, and passes on the database's owner-invariant error.
 */
export async function deactivate(
	database: Database,
	command: DeactivationCommand & { actorEmail?: string },
	dependencies: DeactivateDependencies = {},
): Promise<DeactivateOutcome> {
	const { organizationId, employeeId, actorUserId } = command;
	const scope = { organizationId, employeeId };
	const clock = dependencies.clock ?? systemClock;
	const effects = { ...defaultEffects, ...dependencies.effects };
	const fingerprint = deactivationRequestFingerprint(command);

	const committed = await inDeactivationLocks<Committed>(
		database,
		{ ...scope, replacementManagerIds: Object.values(command.replacementManagers) },
		async (tx) => {
			const recorded = await readDeactivationByRequest(tx, {
				organizationId,
				requestId: command.requestId,
				requestFingerprint: fingerprint,
			});
			if (recorded) {
				const rebuilt = rebuildAfterCommit(recorded, database);
				return {
					kind: "replayed",
					employeeUserId: rebuilt.result?.employeeUserId ?? null,
					reactivatedSince: recorded.reactivatedAt !== null,
					afterCommit: rebuilt.afterCommit,
				};
			}

			const check = await checkLifecycleTarget(tx, { ...scope, actorUserId, isActive: false });
			if (check.type === "unchanged") {
				return { kind: "unchanged", employeeUserId: check.targetEmployee.userId };
			}
			if (check.type !== "change") return { kind: "rejected", refusal: check };

			// The instant every consequence uses, taken once the locks are held.
			const at = clock.nowInstant();
			const period = await resolveCurrentEmploymentPeriod(tx, scope);
			const context: DeactivationPlanContext = {
				...scope,
				at,
				organizationTimeZone: await loadOrganizationTimezone(tx, organizationId),
				employmentPeriodId: period?.id ?? null,
				replacementManagers: command.replacementManagers,
				replaceManagers: true,
			};
			const plan = await planDeactivationConsequences(tx, context);
			if (plan.refusals.length > 0) {
				return {
					kind: "refused",
					reports: plan.managerLinks.reportsNeedingReplacement.flatMap((report) =>
						report.refusal
							? [{ employeeId: report.employeeId, name: report.name, refusal: report.refusal }]
							: [],
					),
				};
			}

			const { id: deactivationId } = await insertDeactivation(tx, {
				...scope,
				employmentPeriodId: context.employmentPeriodId,
				deactivatedAt: at,
				createdBy: actorUserId,
				reason: "employee_deactivated",
				requestId: command.requestId,
				requestFingerprint: fingerprint,
				// Only the validated picks: stage activation routes later stages by them.
				replacementManagers: validatedReplacementManagers(plan.managerLinks),
			});
			const applied = await applyRecordedDeactivation(tx, database, {
				context,
				plan,
				deactivationId,
				actorUserId,
				reason: "employee_deactivated",
				requestId: command.requestId,
				requestFingerprint: fingerprint,
				deactivatedAt: at,
				clock: dependencies.clock,
				mode: { kind: "interactive" },
			});
			return { kind: "deactivated", applied };
		},
		() => ({ kind: "rejected", refusal: { type: "not_found" } }),
	);

	if (committed.kind === "refused" || committed.kind === "rejected") return committed;
	if (committed.kind === "replayed" && committed.reactivatedSince) {
		// Reactivated since: nothing to repeat for the earlier deactivation.
		return { kind: "replayed", reactivatedSince: true, warnings: [] };
	}

	const employeeUserId =
		committed.kind === "deactivated" ? committed.applied.employeeUserId : committed.employeeUserId;
	const steps =
		committed.kind === "deactivated"
			? committed.applied.afterCommit
			: committed.kind === "replayed"
				? committed.afterCommit
				: [];
	if (committed.kind === "deactivated") committed.applied.audit.forwardCommitted();
	const warnings = await runAfterCommitSteps(steps, (error) => {
		logger.warn({ error, ...scope }, "Deactivation follow-up step failed after the commit");
	});

	// Always tried again, also for someone already former: a retry finishes a failed cleanup.
	let sessionCleanupPending = false;
	if (employeeUserId !== null) {
		try {
			await effects.revokeSessions(employeeUserId, organizationId);
		} catch {
			sessionCleanupPending = true;
		}
	}

	if (committed.kind === "deactivated") {
		await effects.logAudit({
			action: AuditAction.EMPLOYEE_DEACTIVATED,
			actorId: actorUserId,
			actorEmail: command.actorEmail,
			employeeId,
			targetId: employeeId,
			targetType: "employee",
			organizationId,
			changes: { isActive: { from: true, to: false } },
			// The employment history shows this deactivation once (#1441).
			metadata: {
				reason: "employee_deactivated",
				deactivationId: committed.applied.deactivationId,
			},
			timestamp: new Date(),
		});
	}

	// Everything the deactivation committed, on the first run and again on a replay.
	if (committed.kind !== "unchanged") {
		await effects.reconcileSeats(organizationId);
		if (employeeUserId !== null) {
			await effects.pauseOwnedExports(database, {
				organizationId,
				owner: { userId: employeeUserId },
				actorUserId,
			});
		}
	}

	if (sessionCleanupPending) {
		// The cause may name infrastructure; it stays out of the log and the warning.
		logger.warn(
			{
				operation: "revokeOrganizationActiveSessions",
				...scope,
				targetUserId: employeeUserId,
			},
			"Employee deactivated with session cleanup pending",
		);
		warnings.push("Session cleanup is pending");
	}

	switch (committed.kind) {
		case "deactivated":
			return { kind: "deactivated", deactivationId: committed.applied.deactivationId, warnings };
		case "replayed":
			return { kind: "replayed", reactivatedSince: false, warnings };
		case "unchanged":
			return { kind: "unchanged", warnings };
	}
}

/**
 * The after-commit work of a deactivation, rebuilt from its ledger row for a
 * replayed request: the steps that are safe to run again (the planner notice
 * and the deputy notices are keyed by the deactivation; deleting a calendar
 * event twice deletes nothing). Audit entries and the self-service absence
 * notices are not repeated. A deactivation that was reactivated since replays
 * nothing. The steps run on `database`, the caller's client.
 */
function rebuildAfterCommit(
	entry: DeactivationLedgerEntry,
	database: Database,
): {
	result: DeactivationResult | null;
	afterCommit: DeactivationAfterCommit[];
} {
	const parsed = deactivationResultSchema.safeParse(entry.result);
	const result = parsed.success ? parsed.data : null;
	if (!result || entry.reactivatedAt !== null) {
		return { result, afterCommit: [] };
	}
	const afterCommit: DeactivationAfterCommit[] = [];
	const { plannerNotice } = result;
	if (plannerNotice) {
		afterCommit.push(sendPlannerNotice(entry.organizationId, entry.id, plannerNotice));
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
	// The deputy participant's notice, as the first run returned it.
	const deputyNotice =
		result.releasedDeputies && deputyReleaseNotice(entry, result.releasedDeputies, database);
	if (deputyNotice) afterCommit.push(deputyNotice);
	return { result, afterCommit };
}

/** A ledger row's stored result, validated before a replay reads it. */
const deactivationResultSchema: z.ZodType<DeactivationResult> = z.object({
	deactivationId: z.string(),
	employeeId: z.string(),
	employeeUserId: z.string(),
	deactivatedAt: z.string(),
	plannerNotice: z
		.object({
			employeeName: z.string(),
			shiftCount: z.number(),
			recipientUserIds: z.array(z.string()),
		})
		.nullable(),
	releasedDeputies: z
		.object({
			eventKey: z.string(),
			assignments: z.array(
				z.object({
					absenceId: z.string(),
					absentEmployeeId: z.string(),
					startDate: z.string(),
					endDate: z.string(),
				}),
			),
		})
		.nullable(),
	cancelledAbsenceIds: z.array(z.string()),
});
