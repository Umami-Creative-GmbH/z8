import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { onCurrentRoster } from "./current-roster";
import { resolveCurrentEmploymentPeriod } from "./employment-periods";
import {
	markDeactivationReactivated,
	readOpenDeactivation,
	requestFingerprint,
	writeReceipt,
} from "./receipts";
import type { LifecycleClient } from "./types";

/**
 * The transaction part of Reactivate (#1441, Organization ADR 0006), after the
 * action's authorization and owner checks. The employee is switched on again,
 * which clears `deactivated_at` (migration 0283 trigger), so they are on the
 * current roster again and the personnel file retention clock stops (D8).
 * Nothing the deactivation ended is restored: the open deactivation is stamped
 * reactivated (its pending handovers stop, its open reviews close and its
 * undelivered tasks become obsolete, audited into `audit`) and the admin
 * re-grants on purpose from the checklist. The history event `employee_reactivated` is recorded
 * when the employee has an employment period.
 */

export const REACTIVATE_EMPLOYEE_COMMAND = "reactivate_employee";

export type ReactivationCommand = {
	organizationId: string;
	actorUserId: string;
	employeeId: string;
	/** Identifies this reactivation in the ledger and the history event. */
	requestId: string;
	at: Instant;
};

export async function executeReactivation(
	tx: LifecycleClient,
	command: ReactivationCommand,
	audit: AuditTrail,
): Promise<{ kind: "not_found" } | { kind: "reactivated"; deactivationIds: string[] }> {
	const [updated] = await tx
		.update(employee)
		.set({ isActive: true })
		.where(
			and(eq(employee.id, command.employeeId), eq(employee.organizationId, command.organizationId)),
		)
		.returning({ id: employee.id });
	if (!updated) return { kind: "not_found" };

	return { kind: "reactivated", deactivationIds: await recordReactivation(tx, command, audit) };
}

export type ReturnOutcome = {
	/** Whether the employee is on the current roster after the call. */
	current: boolean;
	/** The reactivation this call recorded; null when there was nothing to reactivate. */
	reactivationRequestId: string | null;
};

/**
 * Every way back after a deactivation is a Reactivation (#1628, Organization
 * ADR 0011): joining with an invite code, approval of a pending member,
 * provisioning and SCIM re-enable. Each path makes this one call in its
 * transaction (#1643). It switches the employee on when they are off (SCIM's
 * reconciler has done so already). When they are on the current roster again
 * (the migration 0073 guard keeps a departed employee inactive until a
 * rehire) and a deactivation is open, it is reactivated like Reactivate does,
 * by whoever brought them back; `metadata` (SCIM: the `connectionId`) goes
 * into its audit entries.
 *
 * The `employee.reactivated` entry, which the employment history shows once
 * (it carries the reactivation's request id) and the deactivation backfill
 * reads as a switch-on, is recorded into `audit` in this transaction, so it
 * commits or rolls back with the ledger. The caller forwards `audit` after its
 * commit, as for any other audit trail.
 */
export async function reactivateOnReturn(
	tx: LifecycleClient,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		metadata?: Readonly<Record<string, unknown>>;
	},
	audit: AuditTrail,
): Promise<ReturnOutcome> {
	const at = systemClock.nowInstant();
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const isEmployee = and(
		eq(employee.id, input.employeeId),
		eq(employee.organizationId, input.organizationId),
	);
	// Changes nothing for an employee who is on already.
	await tx.update(employee).set({ isActive: true }).where(isEmployee);

	const [current] = await tx
		.select({ id: employee.id })
		.from(employee)
		.where(and(isEmployee, onCurrentRoster(input.organizationId, employee, at)));
	if (!current) return { current: false, reactivationRequestId: null };
	if (!(await readOpenDeactivation(tx, scope))) {
		return { current: true, reactivationRequestId: null };
	}

	const requestId = randomUUID();
	const metadata = input.metadata ?? {};
	await recordReactivation(tx, { ...input, at, requestId, metadata }, audit);
	await audit.record(tx, {
		organizationId: input.organizationId,
		action: AuditAction.EMPLOYEE_REACTIVATED,
		actorUserId: input.actorUserId,
		targetType: "employee",
		targetId: input.employeeId,
		employeeId: input.employeeId,
		changes: { isActive: { from: false, to: true } },
		metadata: { ...metadata, reactivationRequestId: requestId },
	});
	return { current: true, reactivationRequestId: requestId };
}

/**
 * The ledger part of a reactivation, once the employee is switched on: the
 * open deactivation ends, its follow-up closes and the history event is
 * recorded. Returns the reactivated deactivations.
 */
async function recordReactivation(
	tx: LifecycleClient,
	command: ReactivationCommand & { metadata?: Readonly<Record<string, unknown>> },
	audit: AuditTrail,
): Promise<string[]> {
	const scope = { organizationId: command.organizationId, employeeId: command.employeeId };
	// The open deactivation ends; its pending handovers stop (#1440). Nothing else changes.
	const deactivationIds = await markDeactivationReactivated(tx, {
		...scope,
		reactivatedAt: command.at,
		reactivatedBy: command.actorUserId,
		reactivationRequestId: command.requestId,
	});
	// The person is current again: the deactivation's follow-up is obsolete.
	await closeDeactivationFollowUp(tx, audit, {
		...scope,
		deactivationIds,
		actorUserId: command.actorUserId,
		at: command.at,
		metadata: command.metadata ?? {},
	});

	const period = await resolveCurrentEmploymentPeriod(tx, scope);
	if (period) {
		const actor = { userId: command.actorUserId, organizationId: command.organizationId };
		await writeReceipt(tx, {
			actor,
			employeeId: command.employeeId,
			employmentPeriodId: period.id,
			departureId: null,
			revision: null,
			requestId: command.requestId,
			fingerprint: requestFingerprint(actor, REACTIVATE_EMPLOYEE_COMMAND, {
				employeeId: command.employeeId,
			}),
			kind: "employee_reactivated",
			occurredAt: dateFromInstant(command.at),
			result: { employeeId: command.employeeId, deactivationIds },
			metadata: { deactivationId: deactivationIds[0] ?? null },
		});
	}

	return deactivationIds;
}

const FOLLOW_UP_CLOSED_REASON = "employee_reactivated";

/**
 * Closes the open reviews of the reactivated deactivations (an admin can no
 * longer see them, since the follow-up is shown only while the person is
 * former) and completes their undelivered tasks as obsolete, each audited
 * under the reactivating admin. A task a worker holds right now finishes on
 * its own: the handover authority sees the reactivation and stops.
 */
async function closeDeactivationFollowUp(
	tx: LifecycleClient,
	audit: AuditTrail,
	input: {
		organizationId: string;
		employeeId: string;
		deactivationIds: readonly string[];
		actorUserId: string;
		at: Instant;
		metadata: Readonly<Record<string, unknown>>;
	},
): Promise<void> {
	if (input.deactivationIds.length === 0) return;
	const at = dateFromInstant(input.at);
	const ids = sql`(SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(input.deactivationIds)}::jsonb))`;
	const reviews = await tx.execute<{ id: string; deactivation_id: string; kind: string }>(sql`
		UPDATE employee_departure_review
		SET status = 'resolved', resolved_by = ${input.actorUserId}, resolved_at = ${at},
			resolution = ${FOLLOW_UP_CLOSED_REASON}
		WHERE organization_id = ${input.organizationId} AND employee_id = ${input.employeeId}::uuid
			AND deactivation_id IN ${ids} AND status = 'open'
		RETURNING id, deactivation_id, kind
	`);
	const tasks = await tx.execute<{ id: string; deactivation_id: string; kind: string }>(sql`
		UPDATE employee_departure_task
		SET status = 'completed', claim_token = NULL, completed_at = ${at}, updated_at = ${at},
			payload = payload || jsonb_build_object('outcome', 'obsolete', 'obsoleteReason', ${FOLLOW_UP_CLOSED_REASON}::text)
		WHERE organization_id = ${input.organizationId} AND employee_id = ${input.employeeId}::uuid
			AND deactivation_id IN ${ids} AND status IN ('pending', 'failed')
		RETURNING id, deactivation_id, kind
	`);
	const closed = [
		...reviews.rows.map((row) => ({ ...row, followUp: "review" as const })),
		...tasks.rows.map((row) => ({ ...row, followUp: "task" as const })),
	];
	for (const row of closed) {
		await audit.record(tx, {
			organizationId: input.organizationId,
			action: AuditAction.DEACTIVATION_FOLLOW_UP_CLOSED,
			actorUserId: input.actorUserId,
			targetType: "deactivation_follow_up",
			targetId: row.id,
			employeeId: input.employeeId,
			metadata: {
				...input.metadata,
				reason: FOLLOW_UP_CLOSED_REASON,
				deactivationId: row.deactivation_id,
				followUp: row.followUp,
				kind: row.kind,
			},
		});
	}
}
