import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee, employeeAssignedLocation, location } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import type { WorkTransactionClient } from "../work-transaction";

/**
 * Active-assignment reads (#858, spec #761): which employees may clock at a
 * location's kiosks and appear on its who-is-in board. An assignment is active
 * while its location is active and its employee has organization access (active
 * and not past a due departure). Deactivating a location or a departure keeps
 * the assignment rows; they only drop out of these reads.
 *
 * Both reads take the caller's client, so a clock command can run them inside
 * its work transaction. Every query is filtered by `organizationId`.
 */
export type AssignedLocationReadClient = Pick<WorkTransactionClient, "select">;

/** An employee actively assigned to a location. */
export type ActiveAssignedEmployee = {
	employeeId: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	/** The user's display name, the fallback when the employee has no first or last name. */
	userName: string;
};

const displayName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${employee.firstName}, ${employee.lastName})), ''), ${user.name})`;

/** The active employees assigned to an active location, ordered by name. */
export async function listActiveEmployeesAssignedToLocation(
	client: AssignedLocationReadClient,
	input: { organizationId: string; locationId: string; now?: Instant },
): Promise<ActiveAssignedEmployee[]> {
	return client
		.select({
			employeeId: employee.id,
			userId: employee.userId,
			firstName: employee.firstName,
			lastName: employee.lastName,
			userName: user.name,
		})
		.from(employeeAssignedLocation)
		.innerJoin(
			location,
			and(
				eq(location.id, employeeAssignedLocation.locationId),
				eq(location.organizationId, employeeAssignedLocation.organizationId),
			),
		)
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
				eq(location.isActive, true),
				employeeHasOrganizationAccess(input.now),
			),
		)
		.orderBy(asc(sql`lower(${displayName})`), asc(employee.id));
}

/** True when the employee is actively assigned to the location in the organization. */
export async function isEmployeeActivelyAssignedToLocation(
	client: AssignedLocationReadClient,
	input: { organizationId: string; employeeId: string; locationId: string; now?: Instant },
): Promise<boolean> {
	const [row] = await client
		.select({ id: employeeAssignedLocation.id })
		.from(employeeAssignedLocation)
		.innerJoin(
			location,
			and(
				eq(location.id, employeeAssignedLocation.locationId),
				eq(location.organizationId, employeeAssignedLocation.organizationId),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeAssignedLocation.employeeId),
				eq(employee.organizationId, employeeAssignedLocation.organizationId),
			),
		)
		.where(
			and(
				eq(employeeAssignedLocation.organizationId, input.organizationId),
				eq(employeeAssignedLocation.employeeId, input.employeeId),
				eq(employeeAssignedLocation.locationId, input.locationId),
				eq(location.isActive, true),
				employeeHasOrganizationAccess(input.now),
			),
		)
		.limit(1);
	return row !== undefined;
}
