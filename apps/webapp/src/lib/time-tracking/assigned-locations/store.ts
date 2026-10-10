import "server-only";

import { and, asc, eq, notExists, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, employeeAssignedLocation, location } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { WorkTransactionClient } from "../work-transaction";
import { AssignedLocationRefusal } from "./errors";

/**
 * Assigned-location settings reads and writes (#858). Every function takes the
 * caller's client: a transaction for writes, so each write and its audit entry
 * commit together; writes also take the caller's `AuditTrail`, which forwards
 * the entry to the external audit service after the commit. Every query is filtered by `organizationId`; the database
 * additionally refuses cross-organization rows through composite foreign keys.
 * Callers authorize: only organization owners and admins manage assignments.
 */
export type AssignedLocationClient = Pick<
	WorkTransactionClient,
	"select" | "insert" | "update" | "delete"
>;

export type AssignedLocationOfEmployee = { locationId: string; name: string; isActive: boolean };
export type AssignableLocation = { locationId: string; name: string };
export type AssignedEmployeeOfLocation = {
	employeeId: string;
	name: string;
	email: string;
	/** False for an inactive or departed employee, whose assignment the kiosk ignores. */
	isActive: boolean;
};
export type AssignableEmployee = { employeeId: string; name: string; email: string };

// The NOT EXISTS subqueries below name the outer row table-qualified: Drizzle
// renders bare column names in single-table selects, which would bind inside.
const employeeName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${user.firstName}, ${user.lastName})), ''), ${user.name})`;

/**
 * The employee's assigned locations (inactive ones included) and the active
 * locations of the organization it is not yet assigned to.
 */
export async function listEmployeeAssignedLocations(
	client: AssignedLocationClient,
	input: { organizationId: string; employeeId: string },
): Promise<{ assigned: AssignedLocationOfEmployee[]; available: AssignableLocation[] }> {
	await assertEmployeeInOrganization(client, input);
	const [assigned, available] = await Promise.all([
		client
			.select({ locationId: location.id, name: location.name, isActive: location.isActive })
			.from(employeeAssignedLocation)
			.innerJoin(
				location,
				and(
					eq(location.id, employeeAssignedLocation.locationId),
					eq(location.organizationId, employeeAssignedLocation.organizationId),
				),
			)
			.where(
				and(
					eq(employeeAssignedLocation.organizationId, input.organizationId),
					eq(employeeAssignedLocation.employeeId, input.employeeId),
				),
			)
			.orderBy(asc(location.name)),
		client
			.select({ locationId: location.id, name: location.name })
			.from(location)
			.where(
				and(
					eq(location.organizationId, input.organizationId),
					eq(location.isActive, true),
					notExists(
						client
							.select({ id: employeeAssignedLocation.id })
							.from(employeeAssignedLocation)
							.where(
								and(
									eq(employeeAssignedLocation.organizationId, input.organizationId),
									eq(employeeAssignedLocation.employeeId, input.employeeId),
									sql`${employeeAssignedLocation.locationId} = "location"."id"`,
								),
							),
					),
				),
			)
			.orderBy(asc(location.name)),
	]);
	return { assigned, available };
}

/**
 * The employees assigned to the location (inactive and departed ones included,
 * flagged) and the active employees of the organization not yet assigned to it.
 */
export async function listLocationAssignedEmployees(
	client: AssignedLocationClient,
	input: { organizationId: string; locationId: string },
): Promise<{ assigned: AssignedEmployeeOfLocation[]; available: AssignableEmployee[] }> {
	await assertLocationInOrganization(client, input);
	const [assigned, available] = await Promise.all([
		client
			.select({
				employeeId: employee.id,
				name: employeeName,
				email: user.email,
				isActive: employeeHasOrganizationAccess(),
			})
			.from(employeeAssignedLocation)
			.innerJoin(
				employee,
				and(
					eq(employee.id, employeeAssignedLocation.employeeId),
					eq(employee.organizationId, employeeAssignedLocation.organizationId),
				),
			)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employeeAssignedLocation.organizationId, input.organizationId),
					eq(employeeAssignedLocation.locationId, input.locationId),
				),
			)
			.orderBy(asc(sql`lower(${employeeName})`), asc(employee.id)),
		client
			.select({ employeeId: employee.id, name: employeeName, email: user.email })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(
					eq(employee.organizationId, input.organizationId),
					employeeHasOrganizationAccess(),
					notExists(
						client
							.select({ id: employeeAssignedLocation.id })
							.from(employeeAssignedLocation)
							.where(
								and(
									eq(employeeAssignedLocation.organizationId, input.organizationId),
									eq(employeeAssignedLocation.locationId, input.locationId),
									sql`${employeeAssignedLocation.employeeId} = "employee"."id"`,
								),
							),
					),
				),
			)
			.orderBy(asc(sql`lower(${employeeName})`), asc(employee.id)),
	]);
	return { assigned, available };
}

/** Assigns the employee to the location. Assigning again changes nothing. */
export async function addAssignedLocation(
	tx: AssignedLocationClient,
	audit: AuditTrail,
	input: { organizationId: string; actorUserId: string; employeeId: string; locationId: string },
): Promise<void> {
	await Promise.all([
		assertEmployeeInOrganization(tx, input),
		assertLocationInOrganization(tx, input),
	]);
	const [inserted] = await tx
		.insert(employeeAssignedLocation)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			locationId: input.locationId,
			createdBy: input.actorUserId,
		})
		.onConflictDoNothing({
			target: [employeeAssignedLocation.employeeId, employeeAssignedLocation.locationId],
		})
		.returning({ id: employeeAssignedLocation.id });
	if (!inserted) return;
	await audit.record(tx, {
		organizationId: input.organizationId,
		targetType: "employee_assigned_location",
		targetId: inserted.id,
		action: AuditAction.ASSIGNED_LOCATION_ADDED,
		actorUserId: input.actorUserId,
		employeeId: input.employeeId,
		changes: { from: null, to: { locationId: input.locationId } },
	});
}

/** Removes the employee's assignment to the location. Removing an absent one changes nothing. */
export async function removeAssignedLocation(
	tx: AssignedLocationClient,
	audit: AuditTrail,
	input: { organizationId: string; actorUserId: string; employeeId: string; locationId: string },
): Promise<void> {
	const [removed] = await tx
		.delete(employeeAssignedLocation)
		.where(
			and(
				eq(employeeAssignedLocation.organizationId, input.organizationId),
				eq(employeeAssignedLocation.employeeId, input.employeeId),
				eq(employeeAssignedLocation.locationId, input.locationId),
			),
		)
		.returning({ id: employeeAssignedLocation.id });
	if (!removed) return;
	await audit.record(tx, {
		organizationId: input.organizationId,
		targetType: "employee_assigned_location",
		targetId: removed.id,
		action: AuditAction.ASSIGNED_LOCATION_REMOVED,
		actorUserId: input.actorUserId,
		employeeId: input.employeeId,
		changes: { from: { locationId: input.locationId }, to: null },
	});
}

async function assertEmployeeInOrganization(
	client: AssignedLocationClient,
	input: { organizationId: string; employeeId: string },
): Promise<void> {
	const [row] = await client
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		)
		.limit(1);
	if (!row) throw new AssignedLocationRefusal("employee_not_found", "Employee not found");
}

async function assertLocationInOrganization(
	client: AssignedLocationClient,
	input: { organizationId: string; locationId: string },
): Promise<void> {
	const [row] = await client
		.select({ id: location.id })
		.from(location)
		.where(
			and(eq(location.organizationId, input.organizationId), eq(location.id, input.locationId)),
		)
		.limit(1);
	if (!row) throw new AssignedLocationRefusal("location_not_found", "Location not found");
}
