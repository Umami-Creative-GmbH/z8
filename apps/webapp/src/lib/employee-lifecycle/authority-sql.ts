import { type SQL, sql } from "drizzle-orm";

/** Roles are comma-separated with optional spaces, as `getOrganizationRoleTokens` reads them. */
const ROLE_SEPARATOR = String.raw`\s*,\s*`;

/**
 * SQL condition: the `member` row aliased `m` is an accessible organization
 * owner or admin at `at`. Accessible follows migration 0072: approved, and not
 * linked to an inactive employee profile; additionally, a due departure of
 * that profile already ends the authority before a worker materializes it.
 * Departure follow-up authority and its notification recipients both use
 * this one definition.
 */
export function memberIsAccessibleOwnerOrAdmin(at: SQL): SQL {
	return sql`(
		m.status = 'approved'
		AND ('owner' = ANY(regexp_split_to_array(COALESCE(m.role, ''), ${ROLE_SEPARATOR}))
			OR 'admin' = ANY(regexp_split_to_array(COALESCE(m.role, ''), ${ROLE_SEPARATOR})))
		AND NOT EXISTS (
			SELECT 1 FROM employee e
			WHERE e.organization_id = m.organization_id AND e.user_id = m.user_id
				AND (e.is_active = false OR employee_departure_denies_access(e.organization_id, e.id, ${at}))
		)
	)`;
}
