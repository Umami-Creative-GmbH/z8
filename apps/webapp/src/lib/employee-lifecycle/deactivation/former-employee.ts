import { and, eq, isNull, or, sql } from "drizzle-orm";
import { employeeEmploymentPeriod } from "@/db/schema";
import type { DeactivationReader } from "./types";

/**
 * Read-only facts a deactivation without a confirmation starts from (#1627,
 * #1629). Kept apart from the runner, so the member-removal and SCIM hooks
 * that record a pending deactivation import only these reads.
 */

/**
 * Former employees a non-interactive deactivation applies to: switched off,
 * not offboarded by a departure (effective without a rehire, or pending), and
 * without a deactivation no reactivation has ended. Organization-scoped.
 */
export function formerEmployeeWithoutDeactivation(
	organizationId: string | null,
) {
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

/**
 * The employee's current employment period without writing: the open one,
 * else an unended legacy one. The deactivation transaction resolves (and
 * backfills) it with `resolveCurrentEmploymentPeriod`; the read-only preview
 * uses this, so an employee whose legacy period is not backfilled yet previews
 * with none (D10).
 */
export async function readCurrentEmploymentPeriodId(
	reader: Pick<DeactivationReader, "select">,
	input: { organizationId: string; employeeId: string },
): Promise<string | null> {
	const rows = await reader
		.select({
			id: employeeEmploymentPeriod.id,
			status: employeeEmploymentPeriod.status,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				eq(employeeEmploymentPeriod.employeeId, input.employeeId),
				or(
					eq(employeeEmploymentPeriod.status, "open"),
					and(
						eq(employeeEmploymentPeriod.status, "legacy_unknown"),
						isNull(employeeEmploymentPeriod.endedAt),
					),
				),
			),
		);
	return (rows.find((row) => row.status === "open") ?? rows[0])?.id ?? null;
}
