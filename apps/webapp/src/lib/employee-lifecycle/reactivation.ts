import "server-only";

import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
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
 * reactivated (its pending handovers stop) and the admin re-grants on purpose
 * from the checklist. The history event `employee_reactivated` is recorded
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
