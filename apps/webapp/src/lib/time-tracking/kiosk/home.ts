import "server-only";

import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import { type Clock, instantToCanonicalString, systemClock } from "@/lib/datetime/temporal-core";
import { listActiveEmployeesAssignedToLocation } from "@/lib/time-tracking/assigned-locations/queries";
import { readClockPresence } from "@/lib/time-tracking/clock-presence";
import type { VehicleUseClient } from "@/lib/time-tracking/vehicle-use/store";
import type { AuthenticatedKiosk } from "./authenticate";
import { kioskStateOf } from "./employee-state";
import { type KioskClient, readKioskOfflineMode } from "./kiosk-store";
import type {
	KioskEmployeeListing,
	KioskEmployeesResponse,
	KioskOfflineStates,
	KioskVehicleUse,
} from "./protocol";
import { readKioskVehicleUse } from "./vehicle-use-context";

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
 * "as of" the instant read here. Never a day total. With it comes the vehicle
 * use each employee is asked (#1292), which the vehicle step needs offline. A
 * kiosk without offline mode gets the list alone, as before.
 */
export async function readKioskEmployeesResponse(
	client: Pick<KioskClient, "select"> & VehicleUseClient,
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
	client: Pick<KioskClient, "select"> & VehicleUseClient,
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
	const vehicleUse = await readKioskOfflineVehicleUse(client, kiosk, employees);
	return {
		learnedAt,
		states: Object.fromEntries(
			employees.map((employee) => [employee.id, kioskStateOf(byEmployee.get(employee.id))]),
		),
		...(Object.keys(vehicleUse).length > 0 ? { vehicleUse } : {}),
	};
}

/**
 * The vehicle use each employee is asked, only for those whose vehicle use is
 * asked or expected: the same context a live PIN check answers (#1123), read
 * one employee after the other so a large location does not take every pooled
 * connection at once.
 */
async function readKioskOfflineVehicleUse(
	client: VehicleUseClient,
	kiosk: Pick<AuthenticatedKiosk, "organizationId">,
	employees: KioskEmployeeListing[],
): Promise<Record<string, KioskVehicleUse>> {
	const byEmployee: Record<string, KioskVehicleUse> = {};
	for (const employee of employees) {
		const context = await readKioskVehicleUse(client, {
			organizationId: kiosk.organizationId,
			employeeId: employee.id,
		});
		if (context) byEmployee[employee.id] = context;
	}
	return byEmployee;
}
