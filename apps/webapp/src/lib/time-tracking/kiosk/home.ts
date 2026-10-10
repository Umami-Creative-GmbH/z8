import "server-only";

import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import { listActiveEmployeesAssignedToLocation } from "@/lib/time-tracking/assigned-locations/queries";
import type { AuthenticatedKiosk } from "./authenticate";
import type { KioskEmployeeListing } from "./protocol";
import type { KioskClient } from "./kiosk-store";

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
	// The user's names (#858 reads them from the user, never the deprecated employee
	// columns), shaped as the clock endpoints name the employee after their PIN.
	return employees.map((assigned) => ({
		id: assigned.employeeId,
		name: buildDerivedUserName(
			assigned.firstName ?? "",
			assigned.lastName ?? "",
			assigned.userName,
		),
	}));
}
