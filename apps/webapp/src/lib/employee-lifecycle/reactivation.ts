import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { resolveCurrentEmploymentPeriod } from "./employment-periods";
import { markDeactivationReactivated, requestFingerprint, writeReceipt } from "./receipts";
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
	const scope = { organizationId: command.organizationId, employeeId: command.employeeId };
	const [updated] = await tx
		.update(employee)
		.set({ isActive: true })
		.where(
			and(eq(employee.id, command.employeeId), eq(employee.organizationId, command.organizationId)),
		)
		.returning({ id: employee.id });
	if (!updated) return { kind: "not_found" };

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

	return { kind: "reactivated", deactivationIds };
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
				reason: FOLLOW_UP_CLOSED_REASON,
				deactivationId: row.deactivation_id,
				followUp: row.followUp,
				kind: row.kind,
			},
		});
	}
}
