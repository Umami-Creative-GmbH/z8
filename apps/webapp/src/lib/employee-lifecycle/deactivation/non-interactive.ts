import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { AuditTrail } from "@/lib/audit-trail";
import { withAuthorizationMutation } from "@/lib/authorization/authorization-mutation";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { employeeCoordinationGuard, holdGuard } from "@/lib/time-tracking/work-transaction/ranks";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { onCurrentRoster } from "../current-roster";
import { notifyReleasedDeputyAssignments } from "../deputy-release-runtime";
import { lockLifecycleOrganization } from "../locks";
import { checklistPlanSnapshot } from "../reactivation-checklist";
import {
	insertDeactivation,
	recordDeactivationOutcome,
	requestFingerprint,
	writeReceipt,
} from "../receipts";
import { acquireAbsenceCancellationGuards } from "./absences";
import { applyDeactivationConsequences, endEmploymentForDeactivation } from "./apply";
import { type DeactivationResult, releasedDeputyAssignments } from "./command";
import { managerLinkAuthorizationEmployeeIds } from "./manager-links";
import { planDeactivationConsequences, readCurrentEmploymentPeriodId } from "./plan";
import type {
	DeactivationAfterCommit,
	DeactivationApplied,
	DeactivationPlan,
	DeactivationPlanContext,
	DeactivationReader,
	DeactivationReason,
	NamedEmployee,
} from "./types";

/**
 * The non-interactive deactivation (#1627, spec #1590, Organization ADR 0011):
 * deactivates one employee someone already switched off, without anyone
 * confirming it. The deactivation backfill runs it per employee; member removal
 * and SCIM deprovisioning run it from a durable task (#1629).
 *
 * In its own transaction, in the deactivation's lock order (D12), it records
 * an `employee_deactivation` row, ends what the person holds (Employment
 * ending) and applies the roster areas with `replaceManagers: false`. It never
 * refuses: reports who would be left with no current manager keep their link
 * and come back to the caller, who tells the organization's current admins
 * (`reportsStillWithoutCurrentManager`). It is idempotent: the ledger row is
 * the marker, so a second run finds nothing to do.
 */

type Database = typeof appDb;

const logger = createLogger("NonInteractiveDeactivation");

const NON_INTERACTIVE_COMMAND = "non_interactive_deactivation";

export type NonInteractiveDeactivation = {
	organizationId: string;
	employeeId: string;
	/** Who the changes are audited under. */
	actorUserId: string;
	reason: DeactivationReason;
	/**
	 * When they left: the deactivation's and the employee's `deactivated_at`,
	 * and the employment history event. Null when no evidence survives (the
	 * backfill): the row then takes `consequencesFrom`, the employee keeps none
	 * and no history event is written.
	 */
	deactivatedAt: Instant | null;
	/** The instant shifts and absences change from; defaults to `deactivatedAt`. */
	consequencesFrom?: Instant;
	/** Added to the history event and the left-on audit entry (e.g. `sourceAuditId`). */
	metadata?: Readonly<Record<string, unknown>>;
	/** Added to the result stored on the ledger row. */
	result?: Readonly<Record<string, unknown>>;
	clock?: Clock;
};

export type NonInteractiveDeactivationOutcome =
	| {
			kind: "applied";
			deactivationId: string;
			plan: DeactivationPlan;
			applied: DeactivationApplied;
			/** Reports who kept their link to the person because no current manager is left. */
			reportsWithoutManager: NamedEmployee[];
			/** After-commit steps (notices, calendar jobs) that failed; the deactivation stands. */
			warnings: string[];
	  }
	/** Not (or no longer) a former employee without a deactivation: nothing changed. */
	| { kind: "skipped" };

/**
 * Former employees a non-interactive deactivation applies to: switched off,
 * not offboarded by a departure (effective without a rehire, or pending), and
 * without a deactivation no reactivation has ended. Organization-scoped.
 */
export function formerEmployeeWithoutDeactivation(organizationId: string | null) {
	return sql`e.is_active = false
		${organizationId === null ? sql`` : sql`AND e.organization_id = ${organizationId}`}
		AND NOT employee_employment_ended_without_rehire(e.organization_id, e.id)
		AND NOT EXISTS (
			SELECT 1 FROM employee_departure d
			WHERE d.organization_id = e.organization_id AND d.employee_id = e.id AND d.status = 'pending'
		)
		AND NOT EXISTS (
			SELECT 1 FROM employee_deactivation x
			WHERE x.organization_id = e.organization_id AND x.employee_id = e.id
				AND x.reactivated_at IS NULL
		)`;
}

async function readFormerEmployee(
	reader: Pick<Database, "execute">,
	input: { organizationId: string; employeeId: string },
): Promise<{ userId: string } | null> {
	const result = await reader.execute<{ user_id: string }>(sql`
		SELECT e.user_id FROM employee e
		WHERE ${formerEmployeeWithoutDeactivation(input.organizationId)}
			AND e.id = ${input.employeeId}::uuid
	`);
	const [row] = result.rows;
	return row ? { userId: row.user_id } : null;
}

/**
 * What a non-interactive deactivation from `at` changes. Only reads, so a dry
 * run plans with it too.
 */
export async function planNonInteractiveDeactivation(
	reader: DeactivationReader,
	input: { organizationId: string; employeeId: string; at: Instant },
): Promise<{ context: DeactivationPlanContext; plan: DeactivationPlan }> {
	const scope = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	};
	const context: DeactivationPlanContext = {
		...scope,
		at: input.at,
		organizationTimeZone: await loadOrganizationTimezone(reader, input.organizationId),
		employmentPeriodId: await readCurrentEmploymentPeriodId(reader, scope),
		replacementManagers: {},
		replaceManagers: false,
	};
	return { context, plan: await planDeactivationConsequences(reader, context) };
}

/** The reports a plan leaves with no current manager; they keep their link. */
function reportsKeepingTheirLink(plan: DeactivationPlan): NamedEmployee[] {
	return plan.managerLinks.reportsNeedingReplacement.map((report) => ({
		employeeId: report.employeeId,
		name: report.name,
	}));
}

/**
 * Deactivates the employee in its own transaction. Takes, in order: the
 * absence and period submission approval write gates, the exclusive
 * organization configuration guard, the user guards of the person, their
 * reports and their managers, the employee coordination guard, then the
 * organization row. Under them it re-checks that the employee is a former
 * employee without a deactivation, and skips otherwise.
 */
export async function runNonInteractiveDeactivation(
	database: Database,
	input: NonInteractiveDeactivation,
): Promise<NonInteractiveDeactivationOutcome> {
	const { organizationId, employeeId } = input;
	const outcome = await withAuthorizationMutation(
		{
			organizationId,
			organizationWide: true,
			employeeIds: [employeeId],
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
			await lockLifecycleOrganization(tx, organizationId);
			const person = await readFormerEmployee(tx, input);
			if (!person) return null;

			const consequencesFrom = input.consequencesFrom ?? input.deactivatedAt;
			if (!consequencesFrom) throw new Error("A deactivation needs an instant to apply from");
			const { context, plan } = await planNonInteractiveDeactivation(tx, {
				organizationId,
				employeeId,
				at: consequencesFrom,
			});
			const requestId = randomUUID();
			const fingerprint = requestFingerprint(
				{ userId: input.actorUserId, organizationId },
				NON_INTERACTIVE_COMMAND,
				{ employeeId, reason: input.reason },
			);
			// For a date not recorded: the instant the consequences apply from.
			const deactivatedAt = input.deactivatedAt ?? consequencesFrom;
			const { id: deactivationId } = await insertDeactivation(tx, {
				organizationId,
				employeeId,
				employmentPeriodId: context.employmentPeriodId,
				deactivatedAt,
				createdBy: input.actorUserId,
				reason: input.reason,
				requestId,
				requestFingerprint: fingerprint,
				replacementManagers: {},
			});
			await lockEmployee(tx, input);
			const audit = new AuditTrail();
			if (input.deactivatedAt) {
				await recordLeftAt(tx, audit, {
					...input,
					at: input.deactivatedAt,
					deactivationId,
				});
			}
			const applyContext = {
				...context,
				actorUserId: input.actorUserId,
				deactivationId,
				reason: input.reason,
				audit,
			};
			// The employee is already switched off; what they hold ends first all the same.
			const ending = await endEmploymentForDeactivation(tx, applyContext);
			const roster = await applyDeactivationConsequences(tx, applyContext, plan, {
				clock: input.clock,
				database,
			});
			const applied: DeactivationApplied = {
				...roster.applied,
				employmentEnding: ending.applied,
			};
			const releasedDeputies = releasedDeputyAssignments(
				{ organizationId, employeeId },
				ending.applied.deputyAssignments,
			);
			const afterCommit: DeactivationAfterCommit[] = [
				...ending.afterCommit,
				...roster.afterCommit,
				...(releasedDeputies
					? [() => notifyReleasedDeputyAssignments(releasedDeputies, database)]
					: []),
			];
			const reportsWithoutManager = reportsKeepingTheirLink(plan);
			const result: DeactivationResult & Record<string, unknown> = {
				...input.result,
				deactivationId,
				employeeId,
				employeeUserId: person.userId,
				deactivatedAt: deactivatedAt.toString(),
				plannerNotice: null,
				releasedDeputies: releasedDeputies
					? {
							eventKey: releasedDeputies.eventKey,
							assignments: releasedDeputies.assignments,
						}
					: null,
				cancelledAbsenceIds: applied.absences.cancelledAbsenceIds,
				reportsWithoutManager,
			};
			await recordDeactivationOutcome(tx, {
				organizationId,
				deactivationId,
				applied,
				result,
				// The names a reactivated employee's checklist shows (#1441).
				plan: checklistPlanSnapshot(plan),
			});
			if (input.deactivatedAt && context.employmentPeriodId) {
				// The employment history event (#1441), only for a recorded instant.
				await writeReceipt(tx, {
					actor: { userId: input.actorUserId, organizationId },
					employeeId,
					employmentPeriodId: context.employmentPeriodId,
					departureId: null,
					revision: null,
					requestId,
					fingerprint,
					kind: "employee_deactivated",
					occurredAt: dateFromInstant(input.deactivatedAt),
					result,
					metadata: { ...input.metadata, deactivationId, reason: input.reason },
				});
			}
			return {
				deactivationId,
				plan,
				applied,
				reportsWithoutManager,
				audit,
				afterCommit,
			};
		},
		database,
	);
	if (!outcome) return { kind: "skipped" };

	outcome.audit.forwardCommitted();
	const warnings: string[] = [];
	for (const step of outcome.afterCommit) {
		try {
			await step();
		} catch (error) {
			logger.error({ error, organizationId, employeeId }, "After-commit step failed");
			warnings.push(error instanceof Error ? error.message : String(error));
		}
	}
	return {
		kind: "applied",
		deactivationId: outcome.deactivationId,
		plan: outcome.plan,
		applied: outcome.applied,
		reportsWithoutManager: outcome.reportsWithoutManager,
		warnings,
	};
}

/** The employee row FOR UPDATE, before Employment ending (spec #1590). */
async function lockEmployee(
	tx: DeactivationReader,
	scope: { organizationId: string; employeeId: string },
) {
	await tx
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.id, scope.employeeId), eq(employee.organizationId, scope.organizationId)),
		)
		.for("update");
}

/**
 * Stores when they left on the employee, audited with the deactivation's
 * reason, so the employee's instant equals the deactivation's (readers of an
 * open deactivation match the two). Replaces the instant the switch-off
 * trigger wrote, if any. Only the instant: is_active stays untouched. The
 * caller holds the employee row FOR UPDATE.
 */
async function recordLeftAt(
	tx: DeactivationReader,
	audit: AuditTrail,
	input: NonInteractiveDeactivation & { at: Instant; deactivationId: string },
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

/**
 * Of the given reports, those on the current roster whose every manager link
 * points to a former employee (or who have none left): the ones the
 * organization's current admins are told about. Organization-scoped.
 */
export async function reportsStillWithoutCurrentManager(
	reader: Pick<Database, "select" | "selectDistinct">,
	input: {
		organizationId: string;
		reports: readonly NamedEmployee[];
		at: Instant;
	},
): Promise<NamedEmployee[]> {
	if (input.reports.length === 0) return [];
	const ids = [...new Set(input.reports.map((report) => report.employeeId))];
	const current = await reader
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				inArray(employee.id, ids),
				onCurrentRoster(input.organizationId, employee, input.at),
			),
		);
	const manager = alias(employee, "manager_employee");
	const managed = await reader
		.selectDistinct({ id: employeeManagers.employeeId })
		.from(employeeManagers)
		.innerJoin(
			manager,
			and(
				eq(manager.id, employeeManagers.managerId),
				eq(manager.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				inArray(employeeManagers.employeeId, ids),
				onCurrentRoster(input.organizationId, manager, input.at),
			),
		);
	const currentIds = new Set(current.map((row) => row.id));
	const managedIds = new Set(managed.map((row) => row.id));
	const seen = new Set<string>();
	return input.reports
		.filter((report) => {
			if (seen.has(report.employeeId)) return false;
			seen.add(report.employeeId);
			return currentIds.has(report.employeeId) && !managedIds.has(report.employeeId);
		})
		.toSorted(
			(left, right) =>
				left.name.localeCompare(right.name) || left.employeeId.localeCompare(right.employeeId),
		);
}
