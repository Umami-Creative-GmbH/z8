import "server-only";

import { listActiveEmployeesAssignedToLocation } from "@/lib/time-tracking/assigned-locations/queries";
import type { AuthenticatedKiosk } from "./authenticate";
import type { KioskEmployeeListing } from "./protocol";
import type { KioskClient } from "./store";

/**
 * The kiosk home screen's employee list (#862): who may clock at the kiosk's
 * location (#858's active assignments), as id and display name only. The
 * device keeps it only while the home screen shows.
 */
export async function readKioskEmployees(
	client: Pick<KioskClient, "select">,
	kiosk: Pick<AuthenticatedKiosk, "organizationId" | "locationId">,
): Promise<KioskEmployeeListing[]> {
	const employees = await listActiveEmployeesAssignedToLocation(client, {
		organizationId: kiosk.organizationId,
		locationId: kiosk.locationId,
	});
	return employees.map((employee) => ({
		id: employee.employeeId,
		name: displayName(employee),
	}));
}

function displayName(employee: {
	firstName: string | null;
	lastName: string | null;
	userName: string;
}): string {
	const structured = [employee.firstName, employee.lastName]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");
	return structured || employee.userName;
}
