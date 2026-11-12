"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import {
	employee,
	location,
	locationEmployee,
	locationSubarea,
	subareaEmployee,
} from "@/db/schema";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import {
	assignLocationEmployeeSchema,
	assignSubareaEmployeeSchema,
	updateAssignmentSchema,
} from "@/lib/validations/location";

/**
 * Location supervisors: the employees assigned to a location or a subarea, for
 * org admins. Distinct from assigned locations (`assigned-location-actions.ts`).
 */

type LocationAssignmentWithLocation = typeof locationEmployee.$inferSelect & {
	location: Pick<typeof location.$inferSelect, "organizationId">;
};

type SubareaWithLocation = typeof locationSubarea.$inferSelect & {
	location: Pick<typeof location.$inferSelect, "organizationId">;
};

type SubareaAssignmentWithLocation = typeof subareaEmployee.$inferSelect & {
	subarea: Pick<typeof locationSubarea.$inferSelect, "locationId"> & {
		location: Pick<typeof location.$inferSelect, "organizationId">;
	};
};

const updateAssignmentInput = z.strictObject({
	assignmentId: z.uuid(),
	...updateAssignmentSchema.shape,
});

function notFound(entityType: string, entityId: string, message: string) {
	return new NotFoundError({ message, entityType, entityId });
}

function alreadyAssigned(message: string) {
	return new ConflictError({
		message,
		conflictType: "duplicate_assignment",
		details: { field: "employeeId" },
	});
}

/** The employee `employeeId` of the session's organization. */
function checkEmployeeInOrganization(organizationId: string, employeeId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("locations.getTargetEmployee", () =>
			dbService.db.query.employee.findFirst({
				where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
			}),
		);
		if (!row) return yield* Effect.fail(notFound("employee", employeeId, "Employee not found"));
	});
}

/** A location assignment of a location of the session's organization. */
function loadLocationAssignment(organizationId: string, assignmentId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = (yield* dbService.query("locations.getLocationAssignment", () =>
			dbService.db.query.locationEmployee.findFirst({
				where: eq(locationEmployee.id, assignmentId),
				with: { location: { columns: { organizationId: true } } },
			}),
		)) as LocationAssignmentWithLocation | undefined;
		if (!row || row.location?.organizationId !== organizationId) {
			return yield* Effect.fail(notFound("locationEmployee", assignmentId, "Assignment not found"));
		}
		return row;
	});
}

/** A subarea assignment of a location of the session's organization. */
function loadSubareaAssignment(organizationId: string, assignmentId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = (yield* dbService.query("locations.getSubareaAssignment", () =>
			dbService.db.query.subareaEmployee.findFirst({
				where: eq(subareaEmployee.id, assignmentId),
				with: {
					subarea: {
						columns: { locationId: true },
						with: { location: { columns: { organizationId: true } } },
					},
				},
			}),
		)) as SubareaAssignmentWithLocation | undefined;
		if (!row || row.subarea?.location?.organizationId !== organizationId) {
			return yield* Effect.fail(notFound("subareaEmployee", assignmentId, "Assignment not found"));
		}
		return row;
	});
}

// ============================================
// LOCATION EMPLOYEE ASSIGNMENTS
// ============================================

/** Assigns an employee of the session's organization to one of its locations. */
export const assignLocationEmployee = organizationAction(
	{
		name: "locations.assignLocationEmployee",
		requires: "orgAdmin",
		schema: z.strictObject(assignLocationEmployeeSchema.shape),
		// A former employee gets no new location (#1438).
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const loc = yield* dbService.query("locations.get", () =>
				dbService.db.query.location.findFirst({
					where: and(
						eq(location.id, input.locationId),
						eq(location.organizationId, organizationId),
					),
				}),
			);
			if (!loc) {
				return yield* Effect.fail(notFound("location", input.locationId, "Location not found"));
			}
			yield* checkEmployeeInOrganization(organizationId, input.employeeId);

			const existing = yield* dbService.query("locations.checkLocationAssignment", () =>
				dbService.db.query.locationEmployee.findFirst({
					where: and(
						eq(locationEmployee.locationId, input.locationId),
						eq(locationEmployee.employeeId, input.employeeId),
					),
				}),
			);
			if (existing) {
				return yield* Effect.fail(alreadyAssigned("Employee is already assigned to this location"));
			}

			const [created] = yield* dbService.query("locations.createLocationAssignment", () =>
				dbService.db
					.insert(locationEmployee)
					.values({
						locationId: input.locationId,
						employeeId: input.employeeId,
						isPrimary: input.isPrimary,
						createdBy: actor.userId,
					})
					.returning({ id: locationEmployee.id }),
			);

			revalidatePath(`/settings/locations/${input.locationId}`);
			return { id: created.id };
		}),
);

/** Changes whether a location assignment is the employee's primary one. */
export const updateLocationEmployee = organizationAction(
	{ name: "locations.updateLocationEmployee", requires: "orgAdmin", schema: updateAssignmentInput },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const assignment = yield* loadLocationAssignment(organizationId, input.assignmentId);

			yield* dbService.query("locations.updateLocationAssignment", () =>
				dbService.db
					.update(locationEmployee)
					.set({ isPrimary: input.isPrimary })
					.where(eq(locationEmployee.id, input.assignmentId)),
			);

			revalidatePath(`/settings/locations/${assignment.locationId}`);
		}),
);

/** Removes an employee from a location. */
export const removeLocationEmployee = organizationAction(
	{ name: "locations.removeLocationEmployee", requires: "orgAdmin", schema: z.uuid() },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const assignment = yield* loadLocationAssignment(organizationId, assignmentId);

			yield* dbService.query("locations.deleteLocationAssignment", () =>
				dbService.db.delete(locationEmployee).where(eq(locationEmployee.id, assignmentId)),
			);

			revalidatePath(`/settings/locations/${assignment.locationId}`);
		}),
);

// ============================================
// SUBAREA EMPLOYEE ASSIGNMENTS
// ============================================

/** Assigns an employee of the session's organization to a subarea of one of its locations. */
export const assignSubareaEmployee = organizationAction(
	{
		name: "locations.assignSubareaEmployee",
		requires: "orgAdmin",
		schema: z.strictObject(assignSubareaEmployeeSchema.shape),
		// A former employee gets no new subarea (#1438).
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const subarea = (yield* dbService.query("locations.getSubarea", () =>
				dbService.db.query.locationSubarea.findFirst({
					where: eq(locationSubarea.id, input.subareaId),
					with: { location: { columns: { organizationId: true } } },
				}),
			)) as SubareaWithLocation | undefined;
			if (!subarea || subarea.location?.organizationId !== organizationId) {
				return yield* Effect.fail(notFound("subarea", input.subareaId, "Subarea not found"));
			}
			yield* checkEmployeeInOrganization(organizationId, input.employeeId);

			const existing = yield* dbService.query("locations.checkSubareaAssignment", () =>
				dbService.db.query.subareaEmployee.findFirst({
					where: and(
						eq(subareaEmployee.subareaId, input.subareaId),
						eq(subareaEmployee.employeeId, input.employeeId),
					),
				}),
			);
			if (existing) {
				return yield* Effect.fail(alreadyAssigned("Employee is already assigned to this subarea"));
			}

			const [created] = yield* dbService.query("locations.createSubareaAssignment", () =>
				dbService.db
					.insert(subareaEmployee)
					.values({
						subareaId: input.subareaId,
						employeeId: input.employeeId,
						isPrimary: input.isPrimary,
						createdBy: actor.userId,
					})
					.returning({ id: subareaEmployee.id }),
			);

			revalidatePath(`/settings/locations/${subarea.locationId}`);
			return { id: created.id };
		}),
);

/** Changes whether a subarea assignment is the employee's primary one. */
export const updateSubareaEmployee = organizationAction(
	{ name: "locations.updateSubareaEmployee", requires: "orgAdmin", schema: updateAssignmentInput },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const assignment = yield* loadSubareaAssignment(organizationId, input.assignmentId);

			yield* dbService.query("locations.updateSubareaAssignment", () =>
				dbService.db
					.update(subareaEmployee)
					.set({ isPrimary: input.isPrimary })
					.where(eq(subareaEmployee.id, input.assignmentId)),
			);

			revalidatePath(`/settings/locations/${assignment.subarea.locationId}`);
		}),
);

/** Removes an employee from a subarea. */
export const removeSubareaEmployee = organizationAction(
	{ name: "locations.removeSubareaEmployee", requires: "orgAdmin", schema: z.uuid() },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const assignment = yield* loadSubareaAssignment(organizationId, assignmentId);

			yield* dbService.query("locations.deleteSubareaAssignment", () =>
				dbService.db.delete(subareaEmployee).where(eq(subareaEmployee.id, assignmentId)),
			);

			revalidatePath(`/settings/locations/${assignment.subarea.locationId}`);
		}),
);
