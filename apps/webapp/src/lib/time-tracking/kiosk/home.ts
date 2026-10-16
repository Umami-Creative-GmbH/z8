import "server-only";

import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import { type Clock, instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { listActiveEmployeesAssignedToLocation } from "@/lib/time-tracking/assigned-locations/queries";
import { readClockPresence } from "@/lib/time-tracking/clock-presence";
import type { AuthenticatedKiosk } from "./authenticate";
import { kioskStateOf } from "./employee-state";
import { type KioskClient, readKioskOfflineMode } from "./kiosk-store";
import type { KioskEmployeeListing, KioskEmployeesResponse, KioskOfflineStates } from "./protocol";

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

/**
 * `GET /api/kiosk/employees`: the list, plus each listed employee's state for
 * a kiosk whose offline mode is in effect (#1291), so it can show them offline
 * "as of" the instant read here. Never a day total. A kiosk without offline
 * mode gets the list alone, as before.
 */
export async function readKioskEmployeesResponse(
	client: Pick<KioskClient, "select">,
	kiosk: Pick<AuthenticatedKiosk, "organizationId" | "locationId" | "kioskId">,
	clock: Clock = systemClock,
): Promise<KioskEmployeesResponse> {
	const [employees, offlineMode] = await Promise.all([
		readKioskEmployees(client, kiosk),
		readKioskOfflineMode(client, { organizationId: kiosk.organizationId, kioskId: kiosk.kioskId }),
	]);
	if (!offlineMode) return { employees };
	return { employees, offline: await readKioskOfflineStates(client, kiosk, employees, clock) };
}

async function readKioskOfflineStates(
	client: Pick<KioskClient, "select">,
	kiosk: Pick<AuthenticatedKiosk, "organizationId">,
	employees: KioskEmployeeListing[],
	clock: Clock,
): Promise<KioskOfflineStates> {
	const learnedAt = instantToCanonicalString(clock.nowInstant());
	const presence = await readClockPresence(client, {
		organizationId: kiosk.organizationId,
		employeeIds: employees.map((employee) => employee.id),
	});
	const byEmployee = new Map(presence.map((row) => [row.employeeId, row]));
	return {
		learnedAt,
		states: Object.fromEntries(
			employees.map((employee) => [employee.id, kioskStateOf(byEmployee.get(employee.id))]),
		),
	};
}
