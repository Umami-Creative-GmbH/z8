import { sql } from "drizzle-orm";
import type { LifecycleTransaction } from "./types";

export type DepartureBlockedReason =
	| "initiator_authorization_lost"
	| "owner_authorization_required"
	| "final_accessible_owner";

// Mirrors the owner-invariant triggers from migration 0054: roles are a
// comma-separated list, and an owner is accessible while approved and not
// linked to an inactive employee profile in the organization.
const hasRole = (column: string, role: string) =>
	sql.raw(`'${role}' = ANY(regexp_split_to_array(COALESCE(${column}, ''), '\\s*,\\s*'))`);

/**
 * Re-validates, under the organization lock, that a departure may still take
 * effect. A scheduled departure keeps the authority it was created with only
 * while its initiator is still an accessible owner/admin; an owner target
 * requires an owner initiator. Because that initiator is itself an accessible
 * owner, the final-owner check is a safety net for inconsistent data: two
 * owners scheduling each other resolve as effective then
 * initiator_authorization_lost. Returns the blocking reason, or null.
 */
export async function evaluateDepartureAuthority(
	tx: LifecycleTransaction,
	input: {
		organizationId: string;
		targetUserId: string;
		initiatorUserId: string;
	},
): Promise<DepartureBlockedReason | null> {
	const result = await tx.execute<{
		initiator_is_owner: boolean;
		initiator_is_admin: boolean;
		target_is_owner: boolean;
		has_alternative_owner: boolean;
	}>(sql`
		SELECT
			EXISTS (
				SELECT 1 FROM member m
				WHERE m.organization_id = ${input.organizationId} AND m.user_id = ${input.initiatorUserId}
					AND m.status = 'approved' AND ${hasRole("m.role", "owner")}
					AND NOT EXISTS (
						SELECT 1 FROM employee e
						WHERE e.organization_id = m.organization_id AND e.user_id = m.user_id
							AND e.is_active = false
					)
			) AS initiator_is_owner,
			EXISTS (
				SELECT 1 FROM member m
				WHERE m.organization_id = ${input.organizationId} AND m.user_id = ${input.initiatorUserId}
					AND m.status = 'approved' AND ${hasRole("m.role", "admin")}
					AND NOT EXISTS (
						SELECT 1 FROM employee e
						WHERE e.organization_id = m.organization_id AND e.user_id = m.user_id
							AND e.is_active = false
					)
			) AS initiator_is_admin,
			EXISTS (
				SELECT 1 FROM member m
				WHERE m.organization_id = ${input.organizationId} AND m.user_id = ${input.targetUserId}
					AND m.status = 'approved' AND ${hasRole("m.role", "owner")}
			) AS target_is_owner,
			EXISTS (
				SELECT 1 FROM member m
				WHERE m.organization_id = ${input.organizationId} AND m.user_id <> ${input.targetUserId}
					AND m.status = 'approved' AND ${hasRole("m.role", "owner")}
					AND NOT EXISTS (
						SELECT 1 FROM employee e
						WHERE e.organization_id = m.organization_id AND e.user_id = m.user_id
							AND e.is_active = false
					)
			) AS has_alternative_owner
	`);
	const facts = result.rows[0];
	if (!facts) throw new Error("owner_invariant_unavailable");

	if (!facts.initiator_is_owner && !facts.initiator_is_admin) {
		return "initiator_authorization_lost";
	}
	if (facts.target_is_owner && !facts.initiator_is_owner) {
		return "owner_authorization_required";
	}
	if (facts.target_is_owner && !facts.has_alternative_owner) {
		return "final_accessible_owner";
	}
	return null;
}
