import { and, eq, type SQL, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";

export type EmployeeOrganizationAccess =
	| { allowed: true; employeeId: string | null }
	| { allowed: false; reason: "offboarded" | "inactive" | "membership_required" };

/**
 * True for an employee row that may use the organization now: active, and not
 * past the cutoff of a pending departure that would take effect. Use it
 * wherever queries previously required only `employee.is_active`. The check is
 * read-only; commands and the departure worker materialize the transition.
 * Evaluated inside the same query, so an unavailable check fails the query
 * instead of admitting on a stale active flag.
 */
export function employeeHasOrganizationAccess(now?: Instant): SQL<boolean> {
	return sql<boolean>`("employee"."is_active" = true AND NOT ${dueDepartureDeniesAccess(now)})`;
}

// Table-qualified: Drizzle renders bare column names in single-table selects,
// which would bind to the departure inside subqueries or clash in joins.
function dueDepartureDeniesAccess(now?: Instant): SQL {
	const at = now ? sql`${dateFromInstant(now)}::timestamptz` : sql`now()`;
	return sql`employee_departure_denies_access("employee"."organization_id", "employee"."id", ${at})`;
}

/**
 * Resolves whether a user may act inside an organization as an employee.
 * Approved membership is required first. Legacy member-only accounts without
 * an employee profile keep their current access; an existing employee profile
 * never falls back to member-only access.
 */
export async function resolveEmployeeOrganizationAccess(
	database: Pick<typeof rootDatabase, "select">,
	input: { userId: string; organizationId: string; now?: Instant },
): Promise<EmployeeOrganizationAccess> {
	const [[membership], [profile]] = await Promise.all([
		database
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.userId, input.userId),
					eq(member.organizationId, input.organizationId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		database
			.select({
				id: employee.id,
				isActive: employee.isActive,
				dueDepartureDenies: sql<boolean>`${dueDepartureDeniesAccess(input.now)}`,
				hasEffectiveDeparture: sql<boolean>`EXISTS (
					SELECT 1 FROM employee_departure d
					WHERE d.organization_id = "employee"."organization_id"
						AND d.employee_id = "employee"."id" AND d.status = 'effective'
				)`,
			})
			.from(employee)
			.where(
				and(eq(employee.userId, input.userId), eq(employee.organizationId, input.organizationId)),
			)
			.limit(1),
	]);

	if (!membership) return { allowed: false, reason: "membership_required" };
	if (!profile) return { allowed: true, employeeId: null };
	if (profile.dueDepartureDenies) return { allowed: false, reason: "offboarded" };
	if (!profile.isActive) {
		return { allowed: false, reason: profile.hasEffectiveDeparture ? "offboarded" : "inactive" };
	}
	return { allowed: true, employeeId: profile.id };
}
