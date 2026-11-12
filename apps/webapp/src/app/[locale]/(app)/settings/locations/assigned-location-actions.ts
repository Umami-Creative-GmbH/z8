"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { withAuditTrail } from "@/lib/audit-trail";
import { ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { AssignedLocationRefusal } from "@/lib/time-tracking/assigned-locations/errors";
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
 * org admins from the employee's and the location's settings. Distinct from
 * location supervisors (`assignment-actions.ts`). A store refusal comes back
 * as a `ValidationError` whose `refusal` is its `AssignedLocationErrorCode`.
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

const invalidSelection = (field: string) => ({
	error: `Invalid selection: ${field}.`,
});

const assignedLocationInput = z.strictObject({
	employeeId: z.uuid(invalidSelection("employeeId")),
	locationId: z.uuid(invalidSelection("locationId")),
});

/** Runs store work; an `AssignedLocationRefusal` it throws becomes a `ValidationError`. */
function storeWork<T>(name: string, work: (db: DatabaseClient) => Promise<T>) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query(name, () =>
			work(dbService.db).then(
				(data) => ({ refusal: null, data }),
				(error: unknown) => {
					if (error instanceof AssignedLocationRefusal) return { refusal: error, data: null };
					throw error;
				},
			),
		);
		if (outcome.refusal) {
			return yield* Effect.fail(
				new ValidationError({
					message: outcome.refusal.message,
					field: name,
					refusal: outcome.refusal.code,
				}),
			);
		}
		return outcome.data as T;
	});
}

export const getEmployeeAssignedLocationsAction = organizationAction(
	{
		name: "assignedLocations.ofEmployee",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: assignedLocationInput.shape.employeeId }),
	},
	({ organizationId, input }) =>
		storeWork<EmployeeAssignedLocationsData>("assignedLocations.ofEmployee", (db) =>
			listEmployeeAssignedLocations(db, { organizationId, employeeId: input.employeeId }),
		),
);

export const getLocationAssignedEmployeesAction = organizationAction(
	{
		name: "assignedLocations.ofLocation",
		requires: "orgAdmin",
		schema: z.strictObject({ locationId: assignedLocationInput.shape.locationId }),
	},
	({ organizationId, input }) =>
		storeWork<LocationAssignedEmployeesData>("assignedLocations.ofLocation", (db) =>
			listLocationAssignedEmployees(db, { organizationId, locationId: input.locationId }),
		),
);

export const addAssignedLocationAction = organizationAction(
	{
		name: "assignedLocations.add",
		requires: "orgAdmin",
		schema: assignedLocationInput,
		// A former employee gets no new assigned location (#1438).
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		storeWork("assignedLocations.add", (db) =>
			withAuditTrail((audit) =>
				db.transaction((tx) =>
					addAssignedLocation(tx, audit, { organizationId, actorUserId: actor.userId, ...input }),
				),
			),
		).pipe(Effect.map(() => revalidated(input))),
);

export const removeAssignedLocationAction = organizationAction(
	{ name: "assignedLocations.remove", requires: "orgAdmin", schema: assignedLocationInput },
	({ actor, organizationId, input }) =>
		storeWork("assignedLocations.remove", (db) =>
			withAuditTrail((audit) =>
				db.transaction((tx) =>
					removeAssignedLocation(tx, audit, {
						organizationId,
						actorUserId: actor.userId,
						...input,
					}),
				),
			),
		).pipe(Effect.map(() => revalidated(input))),
);

function revalidated(target: AssignedLocationInput): AssignedLocationInput {
	revalidatePath(`/settings/locations/${target.locationId}`);
	revalidatePath(`/settings/employees/${target.employeeId}`);
	return target;
}
