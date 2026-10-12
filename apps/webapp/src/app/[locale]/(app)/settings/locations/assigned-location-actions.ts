"use server";

import { revalidatePath } from "next/cache";
import { withAuditTrail } from "@/lib/audit-trail";
import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { runRefusalAction } from "@/lib/effect/refusal-action";
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
import { isUuid } from "@/lib/validations/uuid";

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
	return runRefusalAction("assignedLocations.ofEmployee", AssignedLocationRefusal, async (db) => {
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
	return runRefusalAction("assignedLocations.ofLocation", AssignedLocationRefusal, async (db) => {
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
	return runRefusalAction("assignedLocations.add", AssignedLocationRefusal, async (db) => {
		const { organizationId, userId } = await requireAssignedLocationAdmin();
		const target = parseInput(input);
		await withAuditTrail((audit) =>
			db.transaction((tx) =>
				addAssignedLocation(tx, audit, { organizationId, actorUserId: userId, ...target }),
			),
		);
		revalidateAssignedLocationPaths(target);
		return target;
	});
}

export async function removeAssignedLocationAction(
	input: AssignedLocationInput,
): Promise<AssignedLocationActionResult<AssignedLocationInput>> {
	return runRefusalAction("assignedLocations.remove", AssignedLocationRefusal, async (db) => {
		const { organizationId, userId } = await requireAssignedLocationAdmin();
		const target = parseInput(input);
		await withAuditTrail((audit) =>
			db.transaction((tx) =>
				removeAssignedLocation(tx, audit, { organizationId, actorUserId: userId, ...target }),
			),
		);
		revalidateAssignedLocationPaths(target);
		return target;
	});
}

/** Organization owners and admins of the active organization only. */
function requireAssignedLocationAdmin() {
	return requireOrganizationAdmin(
		() =>
			new AssignedLocationRefusal(
				"admin_only",
				"Only organization owners and admins can manage assigned locations.",
			),
	);
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

function parseUuid(value: unknown, field: string): string {
	if (!isUuid(value)) {
		throw new AssignedLocationRefusal("invalid_selection", `Invalid selection: ${field}.`);
	}
	return value;
}
