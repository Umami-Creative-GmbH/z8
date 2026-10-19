import { and, desc, eq, lte, or, type SQL, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db as rootDatabase } from "@/db";
import { member } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { employeeDeparture } from "@/db/schema/employee-lifecycle";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";

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

/** The departure that ended an employment period's access, as `departureEndingEmploymentPeriod` reads it. */
export type EndingDeparture = {
	cutoff: Instant;
	/** The last working day in the departure's zone (an offboard-now departure's own day). */
	lastWorkingDay: Temporal.PlainDate;
};

/**
 * The departure that ends an employment period's access at `now`, if any: an
 * effective departure of that period, or a pending one past its cutoff that
 * would take effect. The pending case is the live rule
 * `employeeHasOrganizationAccess` enforces (`employee_departure_denies_access`
 * evaluates `employee_departure_blocked_reason` now, not the stored column), so
 * what managers are shown agrees with what kiosks and sign-in accept. Read
 * within the organization only.
 */
export async function departureEndingEmploymentPeriod(
	database: Pick<typeof rootDatabase, "select">,
	input: { organizationId: string; employeeId: string; employmentPeriodId: string; now: Instant },
): Promise<EndingDeparture | null> {
	const at = dateFromInstant(input.now);
	const [departure] = await database
		.select({
			cutoffAt: employeeDeparture.cutoffAt,
			lastWorkingDay: employeeDeparture.lastWorkingDay,
			timezone: employeeDeparture.timezone,
		})
		.from(employeeDeparture)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeDeparture.employeeId),
				eq(employee.organizationId, employeeDeparture.organizationId),
			),
		)
		.where(
			and(
				eq(employeeDeparture.organizationId, input.organizationId),
				eq(employeeDeparture.employeeId, input.employeeId),
				eq(employeeDeparture.employmentPeriodId, input.employmentPeriodId),
				lte(employeeDeparture.cutoffAt, at),
				or(
					eq(employeeDeparture.status, "effective"),
					and(
						eq(employeeDeparture.status, "pending"),
						sql`employee_departure_blocked_reason(${employeeDeparture.organizationId}, ${employee.userId}, ${employeeDeparture.createdBy}) IS NULL`,
					),
				),
			),
		)
		.orderBy(desc(employeeDeparture.cutoffAt))
		.limit(1);
	if (!departure) return null;
	const cutoff = instantFromDate(departure.cutoffAt);
	return {
		cutoff,
		lastWorkingDay: departure.lastWorkingDay
			? Temporal.PlainDate.from(departure.lastWorkingDay)
			: cutoff.toZonedDateTimeISO(departure.timezone).toPlainDate(),
	};
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
