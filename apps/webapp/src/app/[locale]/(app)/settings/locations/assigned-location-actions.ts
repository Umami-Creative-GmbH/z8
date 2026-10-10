"use server";

import { revalidatePath } from "next/cache";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import { runAssignedLocationAction } from "@/lib/time-tracking/assigned-locations/action-runner";
import {
	type AssignedLocationActionResult,
	AssignedLocationRefusal,
} from "@/lib/time-tracking/assigned-locations/errors";
import {
	type AssignableEmployee,
	type AssignableLocation,
	type AssignedEmployeeOfLocation,
	type AssignedLocationOfEmployee,
	addAssignedLocation,
	listEmployeeAssignedLocations,
	listLocationAssignedEmployees,
	removeAssignedLocation,
} from "@/lib/time-tracking/assigned-locations/store";

/**
 * Assigned locations (#858): the locations an employee works at, managed by
 * organization owners and admins from the employee's and the location's
 * settings. Distinct from location supervisors (`assignment-actions.ts`).
 */

export type EmployeeAssignedLocationsData = {
	assigned: AssignedLocationOfEmployee[];
	available: AssignableLocation[];
};

export type LocationAssignedEmployeesData = {
	assigned: AssignedEmployeeOfLocation[];
	available: AssignableEmployee[];
};

export type AssignedLocationInput = { employeeId: string; locationId: string };

export async function getEmployeeAssignedLocationsAction(input: {
	employeeId: string;
}): Promise<AssignedLocationActionResult<EmployeeAssignedLocationsData>> {
	return runAssignedLocationAction("assignedLocations.ofEmployee", async (db) => {
		const { organizationId } = await requireAssignedLocationAdmin();
		return listEmployeeAssignedLocations(db, {
			organizationId,
			employeeId: parseUuid(input?.employeeId, "employeeId"),
		});
	});
}

export async function getLocationAssignedEmployeesAction(input: {
	locationId: string;
}): Promise<AssignedLocationActionResult<LocationAssignedEmployeesData>> {
	return runAssignedLocationAction("assignedLocations.ofLocation", async (db) => {
		const { organizationId } = await requireAssignedLocationAdmin();
		return listLocationAssignedEmployees(db, {
			organizationId,
			locationId: parseUuid(input?.locationId, "locationId"),
		});
	});
}

export async function addAssignedLocationAction(
	input: AssignedLocationInput,
): Promise<AssignedLocationActionResult<AssignedLocationInput>> {
	return runAssignedLocationAction("assignedLocations.add", async (db) => {
		const { organizationId, userId } = await requireAssignedLocationAdmin();
		const target = parseInput(input);
		await db.transaction((tx) =>
			addAssignedLocation(tx, { organizationId, actorUserId: userId, ...target }),
		);
		revalidateAssignedLocationPaths(target);
		return target;
	});
}

export async function removeAssignedLocationAction(
	input: AssignedLocationInput,
): Promise<AssignedLocationActionResult<AssignedLocationInput>> {
	return runAssignedLocationAction("assignedLocations.remove", async (db) => {
		const { organizationId, userId } = await requireAssignedLocationAdmin();
		const target = parseInput(input);
		await db.transaction((tx) =>
			removeAssignedLocation(tx, { organizationId, actorUserId: userId, ...target }),
		);
		revalidateAssignedLocationPaths(target);
		return target;
	});
}

/** Organization owners and admins of the active organization only. */
async function requireAssignedLocationAdmin(): Promise<{ organizationId: string; userId: string }> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId || !(await canManageCurrentOrganizationSettings())) {
		throw new AssignedLocationRefusal(
			"admin_only",
			"Only organization owners and admins can manage assigned locations.",
		);
	}
	return { organizationId, userId: authContext.user.id };
}

function revalidateAssignedLocationPaths(target: AssignedLocationInput) {
	revalidatePath(`/settings/locations/${target.locationId}`);
	revalidatePath(`/settings/employees/${target.employeeId}`);
}

function parseInput(input: AssignedLocationInput): AssignedLocationInput {
	return {
		employeeId: parseUuid(input?.employeeId, "employeeId"),
		locationId: parseUuid(input?.locationId, "locationId"),
	};
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseUuid(value: unknown, field: string): string {
	if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
		throw new AssignedLocationRefusal("invalid_selection", `Invalid selection: ${field}.`);
	}
	return value;
}
