"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import {
	employee,
	location,
	locationEmployee,
	locationSubarea,
	subareaEmployee,
} from "@/db/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import {
	type AssignLocationEmployee,
	type AssignSubareaEmployee,
	assignLocationEmployeeSchema,
	assignSubareaEmployeeSchema,
	type UpdateAssignment,
	updateAssignmentSchema,
} from "@/lib/validations/location";
import {
	getLocationSettingsActorContext,
	requireLocationOrgAdminAccess,
} from "./location-settings-actor";

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

// ============================================
// LOCATION EMPLOYEE ASSIGNMENTS
// ============================================

/**
 * Assign an employee to a location
 */
export async function assignLocationEmployee(
	input: AssignLocationEmployee,
): Promise<ServerActionResult<{ id: string }>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"assignLocationEmployee",
		{ attributes: { "location.id": input.locationId, "employee.id": input.employeeId } },
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Validate input
				const validationResult = assignLocationEmployeeSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* Effect.fail(
						new ValidationError({
							message: validationResult.error.issues[0]?.message || "Invalid input",
							field: validationResult.error.issues[0]?.path?.join(".") || "input",
						}),
					);
				}

				// Fetch location
				const loc = yield* dbService
					.query("getLocation", async () => {
						return await dbService.db.query.location.findFirst({
							where: eq(location.id, input.locationId),
						});
					})
					.pipe(
						Effect.flatMap((loc) =>
							loc
								? Effect.succeed(loc)
								: Effect.fail(
										new NotFoundError({
											message: "Location not found",
											entityType: "location",
											entityId: input.locationId,
										}),
									),
						),
					);

				const actor = yield* getLocationSettingsActorContext({
					organizationId: loc.organizationId,
					queryName: "assignLocationEmployeeActor",
				});
				yield* requireLocationOrgAdminAccess(actor, {
					message: "Only org admins can assign employees to locations",
					action: "create",
				});

				// Verify target employee exists and belongs to same org
				yield* dbService
					.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.id, input.employeeId),
								eq(employee.organizationId, loc.organizationId),
								eq(employee.isActive, true),
							),
						});
					})
					.pipe(
						Effect.flatMap((emp) =>
							emp
								? Effect.succeed(emp)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: input.employeeId,
										}),
									),
						),
					);

				// Check for existing assignment
				const existing = yield* dbService.query("checkExisting", async () => {
					return await dbService.db.query.locationEmployee.findFirst({
						where: and(
							eq(locationEmployee.locationId, input.locationId),
							eq(locationEmployee.employeeId, input.employeeId),
						),
					});
				});

				if (existing) {
					return yield* Effect.fail(
						new ConflictError({
							message: "Employee is already assigned to this location",
							conflictType: "duplicate_assignment",
							details: { field: "employeeId" },
						}),
					);
				}

				// Create assignment
				const [created] = yield* dbService.query("createAssignment", async () => {
					return await dbService.db
						.insert(locationEmployee)
						.values({
							locationId: input.locationId,
							employeeId: input.employeeId,
							isPrimary: input.isPrimary,
							createdBy: actor.session.user.id,
						})
						.returning({ id: locationEmployee.id });
				});

				revalidatePath(`/settings/locations/${input.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to assign employee to location");
						return yield* Effect.fail(error);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update a location employee assignment (isPrimary)
 */
export async function updateLocationEmployee(
	assignmentId: string,
	input: UpdateAssignment,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"updateLocationEmployee",
		{ attributes: { "assignment.id": assignmentId } },
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Validate input
				const validationResult = updateAssignmentSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* Effect.fail(
						new ValidationError({
							message: validationResult.error.issues[0]?.message || "Invalid input",
							field: validationResult.error.issues[0]?.path?.join(".") || "input",
						}),
					);
				}

				// Fetch assignment with location
				const assignment = yield* dbService
					.query("getAssignment", async () => {
						return await dbService.db.query.locationEmployee.findFirst({
							where: eq(locationEmployee.id, assignmentId),
							with: { location: true },
						});
					})
					.pipe(
						Effect.flatMap((a) =>
							a
								? Effect.succeed(a)
								: Effect.fail(
										new NotFoundError({
											message: "Assignment not found",
											entityType: "locationEmployee",
											entityId: assignmentId,
										}),
									),
						),
					);

				const typedAssignment = assignment as unknown as LocationAssignmentWithLocation;

				const actor = yield* getLocationSettingsActorContext({
					organizationId: typedAssignment.location.organizationId,
					queryName: "updateLocationEmployeeActor",
				});
				yield* requireLocationOrgAdminAccess(actor, {
					message: "Only org admins can update location assignments",
					action: "update",
				});

				// Update assignment
				yield* dbService.query("updateAssignment", async () => {
					return await dbService.db
						.update(locationEmployee)
						.set({ isPrimary: input.isPrimary })
						.where(eq(locationEmployee.id, assignmentId));
				});

				revalidatePath(`/settings/locations/${typedAssignment.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to update location assignment");
						return yield* Effect.fail(error);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Remove an employee from a location
 */
export async function removeLocationEmployee(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"removeLocationEmployee",
		{ attributes: { "assignment.id": assignmentId } },
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Fetch assignment with location
				const assignment = yield* dbService
					.query("getAssignment", async () => {
						return await dbService.db.query.locationEmployee.findFirst({
							where: eq(locationEmployee.id, assignmentId),
							with: { location: true },
						});
					})
					.pipe(
						Effect.flatMap((a) =>
							a
								? Effect.succeed(a)
								: Effect.fail(
										new NotFoundError({
											message: "Assignment not found",
											entityType: "locationEmployee",
											entityId: assignmentId,
										}),
									),
						),
					);

				const typedAssignment = assignment as unknown as LocationAssignmentWithLocation;

				const actor = yield* getLocationSettingsActorContext({
					organizationId: typedAssignment.location.organizationId,
					queryName: "removeLocationEmployeeActor",
				});
				yield* requireLocationOrgAdminAccess(actor, {
					message: "Only org admins can remove location assignments",
					action: "delete",
				});

				// Delete assignment
				yield* dbService.query("deleteAssignment", async () => {
					return await dbService.db
						.delete(locationEmployee)
						.where(eq(locationEmployee.id, assignmentId));
				});

				revalidatePath(`/settings/locations/${typedAssignment.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to remove location assignment");
						return yield* Effect.fail(error);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

// ============================================
// SUBAREA EMPLOYEE ASSIGNMENTS
// ============================================

/**
 * Assign an employee to a subarea
 */
export async function assignSubareaEmployee(
	input: AssignSubareaEmployee,
): Promise<ServerActionResult<{ id: string }>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"assignSubareaEmployee",
		{ attributes: { "subarea.id": input.subareaId, "employee.id": input.employeeId } },
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Validate input
				const validationResult = assignSubareaEmployeeSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* Effect.fail(
						new ValidationError({
							message: validationResult.error.issues[0]?.message || "Invalid input",
							field: validationResult.error.issues[0]?.path?.join(".") || "input",
						}),
					);
				}

				// Fetch subarea with location
				const subarea = yield* dbService
					.query("getSubarea", async () => {
						return await dbService.db.query.locationSubarea.findFirst({
							where: eq(locationSubarea.id, input.subareaId),
							with: { location: true },
						});
					})
					.pipe(
						Effect.flatMap((sub) =>
							sub
								? Effect.succeed(sub)
								: Effect.fail(
										new NotFoundError({
											message: "Subarea not found",
											entityType: "subarea",
											entityId: input.subareaId,
										}),
									),
						),
					);

				const typedSubarea = subarea as unknown as SubareaWithLocation;

				const actor = yield* getLocationSettingsActorContext({
					organizationId: typedSubarea.location.organizationId,
					queryName: "assignSubareaEmployeeActor",
				});
				yield* requireLocationOrgAdminAccess(actor, {
					message: "Only org admins can assign employees to subareas",
					action: "create",
				});

				// Verify target employee exists and belongs to same org
				yield* dbService
					.query("getTargetEmployee", async () => {
						return await dbService.db.query.employee.findFirst({
							where: and(
								eq(employee.id, input.employeeId),
								eq(employee.organizationId, typedSubarea.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					})
					.pipe(
						Effect.flatMap((emp) =>
							emp
								? Effect.succeed(emp)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: input.employeeId,
										}),
									),
						),
					);

				// Check for existing assignment
				const existing = yield* dbService.query("checkExisting", async () => {
					return await dbService.db.query.subareaEmployee.findFirst({
						where: and(
							eq(subareaEmployee.subareaId, input.subareaId),
							eq(subareaEmployee.employeeId, input.employeeId),
						),
					});
				});

				if (existing) {
					return yield* Effect.fail(
						new ConflictError({
							message: "Employee is already assigned to this subarea",
							conflictType: "duplicate_assignment",
							details: { field: "employeeId" },
						}),
					);
				}

				// Create assignment
				const [created] = yield* dbService.query("createAssignment", async () => {
					return await dbService.db
						.insert(subareaEmployee)
						.values({
							subareaId: input.subareaId,
							employeeId: input.employeeId,
							isPrimary: input.isPrimary,
							createdBy: actor.session.user.id,
						})
						.returning({ id: subareaEmployee.id });
				});

				revalidatePath(`/settings/locations/${subarea.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to assign employee to subarea");
						return yield* Effect.fail(error);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Update a subarea employee assignment (isPrimary)
 */
export async function updateSubareaEmployee(
	assignmentId: string,
	input: UpdateAssignment,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"updateSubareaEmployee",
		{ attributes: { "assignment.id": assignmentId } },
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Validate input
				const validationResult = updateAssignmentSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* Effect.fail(
						new ValidationError({
							message: validationResult.error.issues[0]?.message || "Invalid input",
							field: validationResult.error.issues[0]?.path?.join(".") || "input",
						}),
					);
				}

				// Fetch assignment with subarea and location
				const assignment = yield* dbService
					.query("getAssignment", async () => {
						return await dbService.db.query.subareaEmployee.findFirst({
							where: eq(subareaEmployee.id, assignmentId),
							with: {
								subarea: {
									with: { location: true },
								},
							},
						});
					})
					.pipe(
						Effect.flatMap((a) =>
							a
								? Effect.succeed(a)
								: Effect.fail(
										new NotFoundError({
											message: "Assignment not found",
											entityType: "subareaEmployee",
											entityId: assignmentId,
										}),
									),
						),
					);

				const typedAssignment = assignment as unknown as SubareaAssignmentWithLocation;

				const actor = yield* getLocationSettingsActorContext({
					organizationId: typedAssignment.subarea.location.organizationId,
					queryName: "updateSubareaEmployeeActor",
				});
				yield* requireLocationOrgAdminAccess(actor, {
					message: "Only org admins can update subarea assignments",
					action: "update",
				});

				// Update assignment
				yield* dbService.query("updateAssignment", async () => {
					return await dbService.db
						.update(subareaEmployee)
						.set({ isPrimary: input.isPrimary })
						.where(eq(subareaEmployee.id, assignmentId));
				});

				revalidatePath(`/settings/locations/${typedAssignment.subarea.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to update subarea assignment");
						return yield* Effect.fail(error);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Remove an employee from a subarea
 */
export async function removeSubareaEmployee(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"removeSubareaEmployee",
		{ attributes: { "assignment.id": assignmentId } },
		(span) => {
			return Effect.gen(function* () {
				const dbService = yield* DatabaseService;

				// Fetch assignment with subarea and location
				const assignment = yield* dbService
					.query("getAssignment", async () => {
						return await dbService.db.query.subareaEmployee.findFirst({
							where: eq(subareaEmployee.id, assignmentId),
							with: {
								subarea: {
									with: { location: true },
								},
							},
						});
					})
					.pipe(
						Effect.flatMap((a) =>
							a
								? Effect.succeed(a)
								: Effect.fail(
										new NotFoundError({
											message: "Assignment not found",
											entityType: "subareaEmployee",
											entityId: assignmentId,
										}),
									),
						),
					);

				const typedAssignment = assignment as unknown as SubareaAssignmentWithLocation;

				const actor = yield* getLocationSettingsActorContext({
					organizationId: typedAssignment.subarea.location.organizationId,
					queryName: "removeSubareaEmployeeActor",
				});
				yield* requireLocationOrgAdminAccess(actor, {
					message: "Only org admins can remove subarea assignments",
					action: "delete",
				});

				// Delete assignment
				yield* dbService.query("deleteAssignment", async () => {
					return await dbService.db
						.delete(subareaEmployee)
						.where(eq(subareaEmployee.id, assignmentId));
				});

				revalidatePath(`/settings/locations/${typedAssignment.subarea.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to remove subarea assignment");
						return yield* Effect.fail(error);
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
			);
		},
	);

	return runServerActionSafe(effect);
}
