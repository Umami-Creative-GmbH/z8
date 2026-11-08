import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { employeeDeactivation } from "@/db/schema";
import { requestFingerprint } from "../receipts";
import {
	formerEmployeeWithoutDeactivation,
	readCurrentEmploymentPeriodId,
} from "./former-employee";
import type { DeactivationReader, FollowUpDeactivationReason } from "./types";

/**
 * The hook side of a follow-up deactivation (#1629, spec #1590, Organization
 * ADR 0011): member removal (admin removal, leaving, pending rejection) and
 * SCIM deprovisioning are deactivations. Their hooks hold the removed user's
 * guard, so they cannot take a deactivation's locks inline: they keep
 * switching the employee off and record a pending deactivation here, which the
 * follow-up (`follow-up.ts`) applies or withdraws. Only reads and one insert,
 * so the auth and SCIM modules that call it stay clear of the runner.
 */

const FOLLOW_UP_COMMAND = "follow_up_deactivation";

/** Every follow-up deactivation is a system side effect of the removal. */
const SYSTEM_SIDE_EFFECT = { actorKind: "system" } as const;

/**
 * Records a pending deactivation in the removal's transaction, right after
 * that transaction switched the employee off, at the moment the switch-off
 * stored. Takes no lock beyond the removal's. Records nothing for an employee
 * the transaction did not switch off (still active, or already a former
 * employee), who was offboarded by a departure, or who already has an open
 * deactivation. Returns the row's id, or null.
 */
export async function recordFollowUpDeactivation(
	tx: DeactivationReader,
	input: {
		organizationId: string;
		employeeId: string;
		/** The removing admin, else the removed user. */
		createdBy: string;
		reason: FollowUpDeactivationReason;
		/** More audit context, e.g. the SCIM `connectionId`. */
		metadata?: Readonly<Record<string, unknown>>;
	},
): Promise<{ deactivationId: string } | null> {
	const { organizationId, employeeId } = input;
	// The switch-off trigger (0283) stamps the transaction's now() only when this
	// transaction flipped is_active, so an older former employee never matches.
	const switchedOffNow = sql`
		SELECT e.deactivated_at FROM employee e
		WHERE ${formerEmployeeWithoutDeactivation(organizationId)}
			AND e.id = ${employeeId}::uuid
			AND e.deactivated_at = now()
	`;
	const result = await tx.execute(switchedOffNow);
	if (result.rows.length === 0) return null;

	const [row] = await tx
		.insert(employeeDeactivation)
		.values({
			organizationId,
			employeeId,
			employmentPeriodId: await readCurrentEmploymentPeriodId(tx, {
				organizationId,
				employeeId,
			}),
			// Copied in SQL: readers of a deactivation in effect match it with the
			// employee's instant, which a JavaScript Date would cut to milliseconds.
			deactivatedAt: sql`(${switchedOffNow})`,
			createdBy: input.createdBy,
			reason: input.reason,
			status: "pending",
			metadata: { ...SYSTEM_SIDE_EFFECT, ...input.metadata },
			requestId: randomUUID(),
			requestFingerprint: requestFingerprint(
				{ userId: input.createdBy, organizationId },
				FOLLOW_UP_COMMAND,
				{ employeeId, reason: input.reason },
			),
			replacementManagers: {},
		})
		.returning({ id: employeeDeactivation.id });
	if (!row) throw new Error("Follow-up deactivation was not recorded");
	return { deactivationId: row.id };
}
