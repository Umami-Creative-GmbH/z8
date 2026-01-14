"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	employee,
	location,
	locationEmployee,
	locationSubarea,
	subareaEmployee,
} from "@/db/schema";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import {
	assignLocationEmployeeSchema,
	assignSubareaEmployeeSchema,
	updateAssignmentSchema,
	type AssignLocationEmployee,
	type AssignSubareaEmployee,
	type UpdateAssignment,
} from "@/lib/validations/location";

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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = assignLocationEmployeeSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message:
									validationResult.error.issues[0]?.message || "Invalid input",
								field:
									validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch location
				const loc = yield* _(
					dbService.query("getLocation", async () => {
						return await db.query.location.findFirst({
							where: eq(location.id, input.locationId),
						});
					}),
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

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, loc.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can assign employees to locations",
										userId: session.user.id,
										resource: "locationEmployee",
										action: "create",
									}),
								),
					),
				);

				// Verify target employee exists and belongs to same org
				yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.id, input.employeeId),
								eq(employee.organizationId, loc.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
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
				const existing = yield* _(
					dbService.query("checkExisting", async () => {
						return await db.query.locationEmployee.findFirst({
							where: and(
								eq(locationEmployee.locationId, input.locationId),
								eq(locationEmployee.employeeId, input.employeeId),
							),
						});
					}),
				);

				if (existing) {
					return yield* _(
						Effect.fail(
							new ConflictError({
								message: "Employee is already assigned to this location",
								conflictType: "duplicate_assignment",
								details: { field: "employeeId" },
							}),
						),
					);
				}

				// Create assignment
				const [created] = yield* _(
					dbService.query("createAssignment", async () => {
						return await db
							.insert(locationEmployee)
							.values({
								locationId: input.locationId,
								employeeId: input.employeeId,
								isPrimary: input.isPrimary,
								createdBy: session.user.id,
							})
							.returning({ id: locationEmployee.id });
					}),
				);

				revalidatePath(`/settings/locations/${input.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to assign employee to location");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = updateAssignmentSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message:
									validationResult.error.issues[0]?.message || "Invalid input",
								field:
									validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch assignment with location
				const assignment = yield* _(
					dbService.query("getAssignment", async () => {
						return await db.query.locationEmployee.findFirst({
							where: eq(locationEmployee.id, assignmentId),
							with: { location: true },
						});
					}),
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

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, assignment.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can update location assignments",
										userId: session.user.id,
										resource: "locationEmployee",
										action: "update",
									}),
								),
					),
				);

				// Update assignment
				yield* _(
					dbService.query("updateAssignment", async () => {
						return await db
							.update(locationEmployee)
							.set({ isPrimary: input.isPrimary })
							.where(eq(locationEmployee.id, assignmentId));
					}),
				);

				revalidatePath(`/settings/locations/${assignment.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to update location assignment");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Fetch assignment with location
				const assignment = yield* _(
					dbService.query("getAssignment", async () => {
						return await db.query.locationEmployee.findFirst({
							where: eq(locationEmployee.id, assignmentId),
							with: { location: true },
						});
					}),
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

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, assignment.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can remove location assignments",
										userId: session.user.id,
										resource: "locationEmployee",
										action: "delete",
									}),
								),
					),
				);

				// Delete assignment
				yield* _(
					dbService.query("deleteAssignment", async () => {
						return await db
							.delete(locationEmployee)
							.where(eq(locationEmployee.id, assignmentId));
					}),
				);

				revalidatePath(`/settings/locations/${assignment.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to remove location assignment");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = assignSubareaEmployeeSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message:
									validationResult.error.issues[0]?.message || "Invalid input",
								field:
									validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch subarea with location
				const subarea = yield* _(
					dbService.query("getSubarea", async () => {
						return await db.query.locationSubarea.findFirst({
							where: eq(locationSubarea.id, input.subareaId),
							with: { location: true },
						});
					}),
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

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, subarea.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can assign employees to subareas",
										userId: session.user.id,
										resource: "subareaEmployee",
										action: "create",
									}),
								),
					),
				);

				// Verify target employee exists and belongs to same org
				yield* _(
					dbService.query("getTargetEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.id, input.employeeId),
								eq(employee.organizationId, subarea.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
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
				const existing = yield* _(
					dbService.query("checkExisting", async () => {
						return await db.query.subareaEmployee.findFirst({
							where: and(
								eq(subareaEmployee.subareaId, input.subareaId),
								eq(subareaEmployee.employeeId, input.employeeId),
							),
						});
					}),
				);

				if (existing) {
					return yield* _(
						Effect.fail(
							new ConflictError({
								message: "Employee is already assigned to this subarea",
								conflictType: "duplicate_assignment",
								details: { field: "employeeId" },
							}),
						),
					);
				}

				// Create assignment
				const [created] = yield* _(
					dbService.query("createAssignment", async () => {
						return await db
							.insert(subareaEmployee)
							.values({
								subareaId: input.subareaId,
								employeeId: input.employeeId,
								isPrimary: input.isPrimary,
								createdBy: session.user.id,
							})
							.returning({ id: subareaEmployee.id });
					}),
				);

				revalidatePath(`/settings/locations/${subarea.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to assign employee to subarea");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = updateAssignmentSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message:
									validationResult.error.issues[0]?.message || "Invalid input",
								field:
									validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch assignment with subarea and location
				const assignment = yield* _(
					dbService.query("getAssignment", async () => {
						return await db.query.subareaEmployee.findFirst({
							where: eq(subareaEmployee.id, assignmentId),
							with: {
								subarea: {
									with: { location: true },
								},
							},
						});
					}),
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

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, assignment.subarea.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can update subarea assignments",
										userId: session.user.id,
										resource: "subareaEmployee",
										action: "update",
									}),
								),
					),
				);

				// Update assignment
				yield* _(
					dbService.query("updateAssignment", async () => {
						return await db
							.update(subareaEmployee)
							.set({ isPrimary: input.isPrimary })
							.where(eq(subareaEmployee.id, assignmentId));
					}),
				);

				revalidatePath(`/settings/locations/${assignment.subarea.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to update subarea assignment");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
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
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Fetch assignment with subarea and location
				const assignment = yield* _(
					dbService.query("getAssignment", async () => {
						return await db.query.subareaEmployee.findFirst({
							where: eq(subareaEmployee.id, assignmentId),
							with: {
								subarea: {
									with: { location: true },
								},
							},
						});
					}),
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

				// Verify admin access
				yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(
								eq(employee.userId, session.user.id),
								eq(employee.organizationId, assignment.subarea.location.organizationId),
								eq(employee.isActive, true),
							),
						});
					}),
					Effect.flatMap((emp) =>
						emp?.role === "admin"
							? Effect.succeed(emp)
							: Effect.fail(
									new AuthorizationError({
										message: "Only admins can remove subarea assignments",
										userId: session.user.id,
										resource: "subareaEmployee",
										action: "delete",
									}),
								),
					),
				);

				// Delete assignment
				yield* _(
					dbService.query("deleteAssignment", async () => {
						return await db
							.delete(subareaEmployee)
							.where(eq(subareaEmployee.id, assignmentId));
					}),
				);

				revalidatePath(`/settings/locations/${assignment.subarea.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to remove subarea assignment");
						return yield* _(Effect.fail(error));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
