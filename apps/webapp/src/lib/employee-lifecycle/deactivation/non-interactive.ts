import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { db as appDb } from "@/db";
import { employee, employeeDeactivation, employeeManagers } from "@/db/schema";
import {
	type Clock,
	dateFromInstant,
	type Instant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { onCurrentRoster } from "../current-roster";
import { insertDeactivation, requestFingerprint } from "../receipts";
import { formerEmployeeWithoutDeactivation, readCurrentEmploymentPeriodId } from "./former-employee";
import { planDeactivationConsequences } from "./plan";
import {
	type AppliedDeactivation,
	applyRecordedDeactivation,
	inDeactivationLocks,
	runAfterCommitSteps,
} from "./sequence";
import type {
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
 * In its own transaction, under the deactivation's locks (`sequence.ts`), it
 * records an `employee_deactivation` row and runs the deactivation sequence in
 * its non-interactive mode, with `replaceManagers: false`. It never refuses:
 * reports who would be left with no current manager keep their link and come
 * back to the caller, who tells the organization's current admins
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
	| { kind: "skipped" }
	/** A pending deactivation whose person came back first: closed, nothing ended (#1629). */
	| { kind: "withdrawn"; deactivationId: string };

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
	input: {
		organizationId: string;
		employeeId: string;
		at: Instant;
		/** The period a pending deactivation recorded (#1629); else the current one. */
		employmentPeriodId?: string | null;
	},
): Promise<{ context: DeactivationPlanContext; plan: DeactivationPlan }> {
	const scope = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
	};
	const context: DeactivationPlanContext = {
		...scope,
		at: input.at,
		organizationTimeZone: await loadOrganizationTimezone(reader, input.organizationId),
		employmentPeriodId:
			input.employmentPeriodId !== undefined
				? input.employmentPeriodId
				: await readCurrentEmploymentPeriodId(reader, scope),
		replacementManagers: {},
		replaceManagers: false,
	};
	return { context, plan: await planDeactivationConsequences(reader, context) };
}

/**
 * Deactivates the employee in its own transaction, under the deactivation's
 * locks. Under them it re-checks that the employee is a former employee
 * without a deactivation, and skips otherwise.
 */
export async function runNonInteractiveDeactivation(
	database: Database,
	input: NonInteractiveDeactivation,
): Promise<NonInteractiveDeactivationOutcome> {
	const { organizationId, employeeId } = input;
	const outcome = await inDeactivationLocks(database, input, async (tx) => {
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
		return applyRecordedDeactivation(tx, database, {
			context,
			plan,
			deactivationId,
			actorUserId: input.actorUserId,
			reason: input.reason,
			requestId,
			requestFingerprint: fingerprint,
			deactivatedAt,
			clock: input.clock,
			mode: {
				kind: "non_interactive",
				employeeUserId: person.userId,
				leftAt: input.deactivatedAt,
				metadata: input.metadata,
				result: input.result,
			},
		});
	});
	if (!outcome) return { kind: "skipped" };
	return completeAfterCommit(outcome, { organizationId, employeeId });
}

/**
 * Completes a deactivation member removal or SCIM deprovisioning recorded as
 * pending (#1629), in its own transaction and the same locks as
 * `runNonInteractiveDeactivation`. Under them it re-reads the row: one that is
 * no longer pending is done (`skipped`); one whose person came back first (a
 * reactivation stamped it, or the employee is active again) is closed as
 * withdrawn and ends nothing. Otherwise the consequences apply from the
 * recorded removal moment, under the recorded actor, reason, period and audit
 * context, and the row becomes applied. Never refuses; idempotent.
 */
export async function completePendingDeactivation(
	database: Database,
	input: { organizationId: string; employeeId: string; deactivationId: string; clock?: Clock },
): Promise<NonInteractiveDeactivationOutcome> {
	const { organizationId, employeeId, deactivationId } = input;
	const outcome = await inDeactivationLocks(database, input, async (tx) => {
		const [row] = await tx
			.select({
				status: employeeDeactivation.status,
				employmentPeriodId: employeeDeactivation.employmentPeriodId,
				deactivatedAt: employeeDeactivation.deactivatedAt,
				createdBy: employeeDeactivation.createdBy,
				reason: employeeDeactivation.reason,
				requestId: employeeDeactivation.requestId,
				requestFingerprint: employeeDeactivation.requestFingerprint,
				metadata: employeeDeactivation.metadata,
				reactivatedAt: employeeDeactivation.reactivatedAt,
			})
			.from(employeeDeactivation)
			.where(
				and(
					eq(employeeDeactivation.organizationId, organizationId),
					eq(employeeDeactivation.employeeId, employeeId),
					eq(employeeDeactivation.id, deactivationId),
				),
			)
			.for("update");
		if (row?.status !== "pending") return null;
		const [person] = await tx
			.select({ userId: employee.userId, current: onCurrentRoster(organizationId) })
			.from(employee)
			.where(and(eq(employee.organizationId, organizationId), eq(employee.id, employeeId)))
			.for("update");
		if (!person) return null;
		if (row.reactivatedAt || person.current) {
			await tx
				.update(employeeDeactivation)
				.set({
					status: "withdrawn",
					reactivatedAt: row.reactivatedAt ?? dateFromInstant((input.clock ?? systemClock).nowInstant()),
				})
				.where(
					and(
						eq(employeeDeactivation.organizationId, organizationId),
						eq(employeeDeactivation.id, deactivationId),
					),
				);
			return "withdrawn" as const;
		}

		const deactivatedAt = instantFromDate(new Date(row.deactivatedAt));
		const { context, plan } = await planNonInteractiveDeactivation(tx, {
			organizationId,
			employeeId,
			at: deactivatedAt,
			employmentPeriodId: row.employmentPeriodId,
		});
		return applyRecordedDeactivation(tx, database, {
			context,
			plan,
			deactivationId,
			actorUserId: row.createdBy,
			reason: row.reason,
			requestId: row.requestId,
			requestFingerprint: row.requestFingerprint,
			deactivatedAt,
			clock: input.clock,
			mode: {
				kind: "non_interactive",
				employeeUserId: person.userId,
				leftAt: deactivatedAt,
				metadata: row.metadata,
				owesReportsNotice: true,
			},
		});
	});
	if (!outcome) return { kind: "skipped" };
	if (outcome === "withdrawn") return { kind: "withdrawn", deactivationId };
	return completeAfterCommit(outcome, { organizationId, employeeId });
}

/** Forwards the audit and runs the after-commit steps; failures become warnings. */
async function completeAfterCommit(
	outcome: AppliedDeactivation,
	scope: { organizationId: string; employeeId: string },
): Promise<NonInteractiveDeactivationOutcome> {
	outcome.audit.forwardCommitted();
	const warnings = await runAfterCommitSteps(outcome.afterCommit, (error) => {
		logger.error({ error, ...scope }, "After-commit step failed");
	});
	return {
		kind: "applied",
		deactivationId: outcome.deactivationId,
		plan: outcome.plan,
		applied: outcome.applied,
		reportsWithoutManager: outcome.reportsWithoutManager,
		warnings,
	};
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
