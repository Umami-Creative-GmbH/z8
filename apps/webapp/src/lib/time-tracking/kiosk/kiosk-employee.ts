import "server-only";

import { and, eq } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	type AssignedLocationReadClient,
	isEmployeeActivelyAssignedToLocation,
} from "@/lib/time-tracking/assigned-locations/queries";
import type { AuthenticatedKiosk } from "./authenticate";

/** An employee who may use a kiosk, named as on its list. */
export type KioskEmployee = { id: string; userId: string; name: string };

/**
 * The kiosk's employee by id, when active and assigned to the kiosk's location
 * (the kiosk's name list, `readKioskEmployees`); another organization's
 * employee, an inactive one and an unassigned one read alike (null). The one
 * eligibility rule of PIN and badge clocking (#860, #1366) and kiosk fobs
 * (#1505).
 */
export async function readKioskEmployee(
	client: AssignedLocationReadClient,
	kiosk: Pick<AuthenticatedKiosk, "organizationId" | "locationId">,
	employeeId: string,
	now: Instant,
): Promise<KioskEmployee | null> {
	const [subject] = await client
		.select({
			id: employee.id,
			userId: employee.userId,
			name: user.name,
			firstName: user.firstName,
			lastName: user.lastName,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, kiosk.organizationId)))
		.limit(1);
	if (
		!subject ||
		!(await isEmployeeActivelyAssignedToLocation(client, {
			organizationId: kiosk.organizationId,
			employeeId: subject.id,
			locationId: kiosk.locationId,
			now,
		}))
	) {
		return null;
	}
	return {
		id: subject.id,
		userId: subject.userId,
		// The same name as on the kiosk's list (`readKioskEmployees`).
		name: buildDerivedUserName(subject.firstName ?? "", subject.lastName ?? "", subject.name),
	};
}
