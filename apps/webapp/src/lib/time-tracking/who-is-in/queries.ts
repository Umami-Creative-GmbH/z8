import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { employee, employeeManagers, location, timeEntry, workPeriod } from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { listActiveEmployeesAssignedToLocation } from "../assigned-locations/queries";
import { readClockPresence } from "../clock-presence";
import type { WorkTransactionClient } from "../work-transaction";
import {
	isInWhoIsInScope,
	type KioskBoardEntry,
	type LocationPresenceEntry,
	toKioskBoard,
	toLocationPresence,
	type WhoIsInScope,
} from "./shape";

/**
 * Who-is-in reads (#863). Every read is filtered by `organizationId` and by
 * the location's active assignments (#858); live work and breaks in progress
 * come from `readClockPresence` (#861). Authorization of the viewer happens in
 * the caller (kiosk token, or the manager view's scope).
 */
export type WhoIsInReadClient = Pick<WorkTransactionClient, "select">;

/** The kiosk board of a kiosk's location: short names and states only. */
export async function readKioskBoard(
	client: WhoIsInReadClient,
	input: { organizationId: string; locationId: string; now?: Instant },
): Promise<KioskBoardEntry[]> {
	const assigned = await listActiveEmployeesAssignedToLocation(client, input);
	const presence = await readClockPresence(client, {
		organizationId: input.organizationId,
		employeeIds: assigned.map((person) => person.employeeId),
	});
	return toKioskBoard(assigned, presence);
}

/** The manager view of one location, limited to the viewer's scope. */
export async function readLocationPresence(
	client: WhoIsInReadClient,
	input: { organizationId: string; locationId: string; scope: WhoIsInScope; now?: Instant },
): Promise<LocationPresenceEntry[]> {
	if (input.scope.kind === "none") return [];
	const assigned = (await listActiveEmployeesAssignedToLocation(client, input)).filter((person) =>
		isInWhoIsInScope(input.scope, person.employeeId),
	);
	const presence = await readClockPresence(client, {
		organizationId: input.organizationId,
		employeeIds: assigned.map((person) => person.employeeId),
	});
	const clockInOffsets = await readClockInOffsets(client, {
		organizationId: input.organizationId,
		workPeriodIds: presence
			.filter((row) => row.state === "clocked_in")
			.map((row) => row.workPeriodId),
	});
	return toLocationPresence({ assigned, presence, clockInOffsets, scope: input.scope });
}

/** The UTC offset captured on each live work period's clock-in entry. */
async function readClockInOffsets(
	client: WhoIsInReadClient,
	input: { organizationId: string; workPeriodIds: readonly string[] },
): Promise<Map<string, number>> {
	if (input.workPeriodIds.length === 0) return new Map();
	const rows = await client
		.select({ workPeriodId: workPeriod.id, utcOffsetMinutes: timeEntry.utcOffsetMinutes })
		.from(workPeriod)
		.innerJoin(
			timeEntry,
			and(
				eq(timeEntry.id, workPeriod.clockInId),
				eq(timeEntry.organizationId, workPeriod.organizationId),
			),
		)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.id, [...input.workPeriodIds]),
			),
		);
	return new Map(rows.map((row) => [row.workPeriodId, row.utcOffsetMinutes]));
}

/** The employees a manager manages in the organization (`employee_managers`). */
export async function listManagedEmployeeIds(
	client: WhoIsInReadClient,
	input: { organizationId: string; managerEmployeeId: string },
): Promise<string[]> {
	const rows = await client
		.select({ employeeId: employeeManagers.employeeId })
		.from(employeeManagers)
		.innerJoin(employee, eq(employee.id, employeeManagers.employeeId))
		.where(
			and(
				eq(employeeManagers.managerId, input.managerEmployeeId),
				eq(employee.organizationId, input.organizationId),
				employeeHasOrganizationAccess(),
			),
		);
	return rows.map((row) => row.employeeId);
}

export type WhoIsInLocation = { id: string; name: string };

/** The organization's active locations, for choosing a location in the manager view. */
export async function listWhoIsInLocations(
	client: WhoIsInReadClient,
	input: { organizationId: string },
): Promise<WhoIsInLocation[]> {
	return client
		.select({ id: location.id, name: location.name })
		.from(location)
		.where(and(eq(location.organizationId, input.organizationId), eq(location.isActive, true)))
		.orderBy(asc(location.name), asc(location.id));
}

/** One active location of the organization, or null. */
export async function findWhoIsInLocation(
	client: WhoIsInReadClient,
	input: { organizationId: string; locationId: string },
): Promise<WhoIsInLocation | null> {
	const [row] = await client
		.select({ id: location.id, name: location.name })
		.from(location)
		.where(
			and(
				eq(location.organizationId, input.organizationId),
				eq(location.id, input.locationId),
				eq(location.isActive, true),
			),
		)
		.limit(1);
	return row ?? null;
}
