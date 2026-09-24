import { sql } from "drizzle-orm";
import type { LifecycleTransaction } from "./types";

export type DepartureBlockedReason =
	| "initiator_authorization_lost"
	| "owner_authorization_required"
	| "final_accessible_owner";

/**
 * Re-validates, under the organization lock, that a departure may still take
 * effect. A scheduled departure keeps the authority it was created with only
 * while its initiator is still an accessible owner/admin; an owner target
 * requires an owner initiator. Because that initiator is itself an accessible
 * owner, the final-owner check is a safety net for inconsistent data: two
 * owners scheduling each other resolve as effective then
 * initiator_authorization_lost. Returns the blocking reason, or null.
 *
 * The rule lives in the SQL function `employee_departure_blocked_reason`
 * (migration 0070) so access checks evaluate exactly what the executor does.
 */
export async function evaluateDepartureAuthority(
	tx: Pick<LifecycleTransaction, "execute">,
	input: { organizationId: string; targetUserId: string; initiatorUserId: string },
): Promise<DepartureBlockedReason | null> {
	const result = await tx.execute<{ reason: DepartureBlockedReason | null }>(sql`
		SELECT employee_departure_blocked_reason(
			${input.organizationId}, ${input.targetUserId}, ${input.initiatorUserId}
		) AS reason
	`);
	const row = result.rows[0];
	if (!row) throw new Error("owner_invariant_unavailable");
	return row.reason;
}
