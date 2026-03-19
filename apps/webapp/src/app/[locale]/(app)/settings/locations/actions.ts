"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath, revalidateTag } from "next/cache";
import {
	employee,
	location,
	locationEmployee,
	locationSubarea,
	subareaEmployee,
	teamPermissions,
} from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { logger } from "@/lib/logger";
import { type SettingsAccessTier } from "@/lib/settings-access";
import {
	createLocationSchema,
	updateLocationSchema,
	createSubareaSchema,
	updateSubareaSchema,
	type CreateLocation,
	type UpdateLocation,
	type CreateSubarea,
	 type UpdateSubarea,
} from "@/lib/validations/location";
import {
	getLocationSettingsActorContext,
	requireLocationOrgAdminAccess,
} from "./location-settings-actor";

// ============================================
// TYPES
// ============================================

export interface LocationEmployeeData {
	id: string;
	employeeId: string;
	isPrimary: boolean;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user: {
			name: string | null;
			email: string;
		};
	};
}

export interface SubareaWithEmployees {
	id: string;
	locationId: string;
	name: string;
	isActive: boolean;
	createdAt: Date;
	employeeCount: number;
	employees: LocationEmployeeData[];
}

export interface LocationWithDetails {
	id: string;
	organizationId: string;
	name: string;
	street: string | null;
	city: string | null;
	postalCode: string | null;
	country: string | null;
	isActive: boolean;
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
	subareas: SubareaWithEmployees[];
	employees: LocationEmployeeData[];
	subareaCount: number;
	employeeCount: number;
}

export interface LocationListItem {
	id: string;
	name: string;
	city: string | null;
	country: string | null;
	isActive: boolean;
	subareaCount: number;
	employeeCount: number;
}

function getScopedLocationSubareas<T extends { id: string }>(
	locationId: string,
	accessTier: SettingsAccessTier,
	manageableLocationIds: Set<string> | null,
	manageableSubareaIds: Set<string> | null,
	subareas: T[],
) {
	if (accessTier === "orgAdmin") {
		return subareas;
	}

	if (manageableLocationIds?.has(locationId)) {
		return subareas;
	}

	if (!manageableSubareaIds) {
		return subareas;
	}

	return subareas.filter((subarea) => manageableSubareaIds.has(subarea.id));
}

// ============================================
// LOCATION CRUD
// ============================================

/**
 * Get all locations for an organization
 */
export async function getLocations(
	organizationId: string,
): Promise<ServerActionResult<LocationListItem[]>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"getLocations",
		{ attributes: { "organization.id": organizationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const actor = yield* _(
					getLocationSettingsActorContext({ organizationId, queryName: "getLocationsActor" }),
				);

				// Fetch all locations with relations
				const locations = yield* _(
					actor.dbService.query("getLocations", async () => {
						return await actor.dbService.db.query.location.findMany({
							where: eq(location.organizationId, organizationId),
							orderBy: [desc(location.createdAt)],
							with: {
								subareas: true,
								employees: true,
							},
						});
					}),
				);

				// Map to list items
				const result: LocationListItem[] = locations
					.map((loc) => ({
						...loc,
						subareas: getScopedLocationSubareas(
							loc.id,
							actor.accessTier,
							actor.manageableLocationIds,
							actor.manageableSubareaIds,
							loc.subareas,
						),
					}))
					.filter(
						(loc) =>
							actor.accessTier === "orgAdmin" ||
							actor.manageableLocationIds?.has(loc.id) ||
							loc.subareas.length > 0,
					)
					.map((loc) => ({
						id: loc.id,
						name: loc.name,
						city: loc.city,
						country: loc.country,
						isActive: loc.isActive,
						subareaCount: loc.subareas.length,
						employeeCount: loc.employees.length,
					}));

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to get locations");
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
 * Get a single location with all details
 */
export async function getLocation(
	locationId: string,
): Promise<ServerActionResult<LocationWithDetails>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"getLocation",
		{ attributes: { "location.id": locationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);
				// Fetch location with relations
				const loc = yield* _(
					dbService.query("getLocation", async () => {
						return await dbService.db.query.location.findFirst({
							where: eq(location.id, locationId),
							with: {
								subareas: {
									with: {
										employees: {
											with: {
												employee: {
													with: { user: true },
												},
											},
										},
									},
								},
								employees: {
									with: {
										employee: {
											with: { user: true },
										},
									},
								},
							},
						});
					}),
					Effect.flatMap((loc) =>
						loc
							? Effect.succeed(loc)
							: Effect.fail(
									new NotFoundError({
										message: "Location not found",
										entityType: "location",
										entityId: locationId,
									}),
								),
					),
				);

				const actor = yield* _(
					getLocationSettingsActorContext({
						organizationId: loc.organizationId,
						queryName: "getLocationActor",
					}),
				);
				const scopedSubareas = getScopedLocationSubareas(
					loc.id,
					actor.accessTier,
					actor.manageableLocationIds,
					actor.manageableSubareaIds,
					loc.subareas,
				);

				if (
					actor.accessTier !== "orgAdmin" &&
					!actor.manageableLocationIds?.has(loc.id) &&
					scopedSubareas.length === 0
				) {
					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only org admins can manage locations",
								userId: actor.session.user.id,
								resource: "location",
								action: "read",
							}),
						),
					);
				}

				// Map to LocationWithDetails
				const result: LocationWithDetails = {
					id: loc.id,
					organizationId: loc.organizationId,
					name: loc.name,
					street: loc.street,
					city: loc.city,
					postalCode: loc.postalCode,
					country: loc.country,
					isActive: loc.isActive,
					createdAt: loc.createdAt,
					createdBy: loc.createdBy,
					updatedAt: loc.updatedAt,
					updatedBy: loc.updatedBy,
					subareas: scopedSubareas.map((sub) => ({
						id: sub.id,
						locationId: sub.locationId,
						name: sub.name,
						isActive: sub.isActive,
						createdAt: sub.createdAt,
						employeeCount: sub.employees.length,
						employees: sub.employees.map((e) => ({
							id: e.id,
							employeeId: e.employeeId,
							isPrimary: e.isPrimary,
							employee: {
								id: e.employee.id,
								firstName: e.employee.firstName,
								lastName: e.employee.lastName,
								user: {
									name: e.employee.user.name,
									email: e.employee.user.email,
								},
							},
						})),
					})),
					employees: loc.employees.map((e) => ({
						id: e.id,
						employeeId: e.employeeId,
						isPrimary: e.isPrimary,
						employee: {
							id: e.employee.id,
							firstName: e.employee.firstName,
							lastName: e.employee.lastName,
							user: {
								name: e.employee.user.name,
								email: e.employee.user.email,
							},
						},
					})),
					subareaCount: scopedSubareas.length,
					employeeCount: loc.employees.length,
				};

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to get location");
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
 * Create a new location
 */
export async function createLocation(
	input: CreateLocation,
): Promise<ServerActionResult<{ id: string }>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"createLocation",
		{ attributes: { "organization.id": input.organizationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const actor = yield* _(
					getLocationSettingsActorContext({ organizationId: input.organizationId, queryName: "createLocationActor" }),
				);

				// Validate input
				const validationResult = createLocationSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can create locations",
						action: "create",
					}),
				);

				// Check for duplicate name
				const existing = yield* _(
					actor.dbService.query("checkDuplicate", async () => {
						return await actor.dbService.db.query.location.findFirst({
							where: and(
								eq(location.organizationId, input.organizationId),
								eq(location.name, input.name),
							),
						});
					}),
				);

				if (existing) {
					return yield* _(
						Effect.fail(
							new ConflictError({
								message: "A location with this name already exists",
								conflictType: "duplicate_name",
								details: { field: "name" },
							}),
						),
					);
				}

				// Create location
				const [created] = yield* _(
					actor.dbService.query("createLocation", async () => {
						return await actor.dbService.db
							.insert(location)
							.values({
								organizationId: input.organizationId,
								name: input.name,
								street: input.street,
								city: input.city,
								postalCode: input.postalCode,
								country: input.country,
								createdBy: actor.session.user.id,
								updatedAt: new Date(),
							})
							.returning({ id: location.id });
					}),
				);

				// Log audit
				logAudit({
					action: AuditAction.LOCATION_CREATED,
					actorId: actor.session.user.id,
					targetId: created.id,
					targetType: "location",
					organizationId: input.organizationId,
					changes: { name: input.name },
					metadata: { locationName: input.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				// Invalidate locations cache
				revalidateTag(CACHE_TAGS.LOCATIONS(input.organizationId), "max");

				revalidatePath("/settings/locations");
				span.setStatus({ code: SpanStatusCode.OK });
				return { id: created.id };
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to create location");
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
 * Update a location
 */
export async function updateLocation(
	locationId: string,
	input: UpdateLocation,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"updateLocation",
		{ attributes: { "location.id": locationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = updateLocationSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch existing location
				const existing = yield* _(
					dbService.query("getLocation", async () => {
						return await dbService.db.query.location.findFirst({
							where: eq(location.id, locationId),
						});
					}),
					Effect.flatMap((loc) =>
						loc
							? Effect.succeed(loc)
							: Effect.fail(
									new NotFoundError({
										message: "Location not found",
										entityType: "location",
										entityId: locationId,
									}),
								),
					),
				);

				const actor = yield* _(
					getLocationSettingsActorContext({
						organizationId: existing.organizationId,
						queryName: "updateLocationActor",
					}),
				);
				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can update locations",
						action: "update",
					}),
				);

				// Check for duplicate name if name is being changed
				if (input.name && input.name !== existing.name) {
					const duplicate = yield* _(
						actor.dbService.query("checkDuplicate", async () => {
							return await actor.dbService.db.query.location.findFirst({
								where: and(
									eq(location.organizationId, existing.organizationId),
									eq(location.name, input.name!),
								),
							});
						}),
					);

					if (duplicate) {
						return yield* _(
							Effect.fail(
								new ConflictError({
									message: "A location with this name already exists",
									conflictType: "duplicate_name",
									details: { field: "name" },
								}),
							),
						);
					}
				}

				// Update location
				yield* _(
					actor.dbService.query("updateLocation", async () => {
						return await actor.dbService.db
							.update(location)
							.set({
								...input,
								updatedBy: actor.session.user.id,
							})
							.where(eq(location.id, locationId));
					}),
				);

				// Log audit
				logAudit({
					action: AuditAction.LOCATION_UPDATED,
					actorId: actor.session.user.id,
					targetId: locationId,
					targetType: "location",
					organizationId: existing.organizationId,
					changes: input,
					metadata: { locationName: input.name || existing.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				// Invalidate locations cache
				revalidateTag(CACHE_TAGS.LOCATIONS(existing.organizationId), "max");

				revalidatePath("/settings/locations");
				revalidatePath(`/settings/locations/${locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to update location");
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
 * Delete a location (cascades to subareas and assignments)
 */
export async function deleteLocation(locationId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"deleteLocation",
		{ attributes: { "location.id": locationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Fetch existing location
				const existing = yield* _(
					dbService.query("getLocation", async () => {
						return await dbService.db.query.location.findFirst({
							where: eq(location.id, locationId),
						});
					}),
					Effect.flatMap((loc) =>
						loc
							? Effect.succeed(loc)
							: Effect.fail(
									new NotFoundError({
										message: "Location not found",
										entityType: "location",
										entityId: locationId,
									}),
								),
					),
				);

				const actor = yield* _(
					getLocationSettingsActorContext({
						organizationId: existing.organizationId,
						queryName: "deleteLocationActor",
					}),
				);
				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can delete locations",
						action: "delete",
					}),
				);

				// Delete location (cascade handles subareas and assignments)
				yield* _(
					actor.dbService.query("deleteLocation", async () => {
						return await actor.dbService.db.delete(location).where(eq(location.id, locationId));
					}),
				);

				// Log audit
				logAudit({
					action: AuditAction.LOCATION_DELETED,
					actorId: actor.session.user.id,
					targetId: locationId,
					targetType: "location",
					organizationId: existing.organizationId,
					changes: { deleted: true },
					metadata: { locationName: existing.name },
					timestamp: new Date(),
				}).catch((err) => logger.error({ err }, "Failed to log audit"));

				// Invalidate locations cache
				revalidateTag(CACHE_TAGS.LOCATIONS(existing.organizationId), "max");

				revalidatePath("/settings/locations");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to delete location");
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
// SUBAREA CRUD
// ============================================

/**
 * Create a new subarea
 */
export async function createSubarea(
	input: CreateSubarea,
): Promise<ServerActionResult<{ id: string }>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"createSubarea",
		{ attributes: { "location.id": input.locationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = createSubareaSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch location to verify ownership
				const loc = yield* _(
					dbService.query("getLocation", async () => {
						return await dbService.db.query.location.findFirst({
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

				const actor = yield* _(
					getLocationSettingsActorContext({
						organizationId: loc.organizationId,
						queryName: "createSubareaActor",
					}),
				);
				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can create subareas",
						action: "create",
					}),
				);

				// Check for duplicate name within location
				const existing = yield* _(
					actor.dbService.query("checkDuplicate", async () => {
						return await actor.dbService.db.query.locationSubarea.findFirst({
							where: and(
								eq(locationSubarea.locationId, input.locationId),
								eq(locationSubarea.name, input.name),
							),
						});
					}),
				);

				if (existing) {
					return yield* _(
						Effect.fail(
							new ConflictError({
								message: "A subarea with this name already exists in this location",
								conflictType: "duplicate_name",
								details: { field: "name" },
							}),
						),
					);
				}

				// Create subarea
				const [created] = yield* _(
					actor.dbService.query("createSubarea", async () => {
						return await actor.dbService.db
							.insert(locationSubarea)
							.values({
								locationId: input.locationId,
								name: input.name,
								createdBy: actor.session.user.id,
								updatedAt: new Date(),
							})
							.returning({ id: locationSubarea.id });
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
						logger.error({ error }, "Failed to create subarea");
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
 * Update a subarea
 */
export async function updateSubarea(
	subareaId: string,
	input: UpdateSubarea,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"updateSubarea",
		{ attributes: { "subarea.id": subareaId } },
		(span) => {
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Validate input
				const validationResult = updateSubareaSchema.safeParse(input);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "input",
							}),
						),
					);
				}

				// Fetch existing subarea with location
				const existing = yield* _(
					dbService.query("getSubarea", async () => {
						return await dbService.db.query.locationSubarea.findFirst({
							where: eq(locationSubarea.id, subareaId),
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
										entityId: subareaId,
									}),
								),
					),
				);

				const actor = yield* _(
					getLocationSettingsActorContext({
						organizationId: existing.location.organizationId,
						queryName: "updateSubareaActor",
					}),
				);
				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can update subareas",
						action: "update",
					}),
				);

				// Check for duplicate name if name is being changed
				if (input.name && input.name !== existing.name) {
					const duplicate = yield* _(
						actor.dbService.query("checkDuplicate", async () => {
							return await actor.dbService.db.query.locationSubarea.findFirst({
								where: and(
									eq(locationSubarea.locationId, existing.locationId),
									eq(locationSubarea.name, input.name!),
								),
							});
						}),
					);

					if (duplicate) {
						return yield* _(
							Effect.fail(
								new ConflictError({
									message: "A subarea with this name already exists in this location",
									conflictType: "duplicate_name",
									details: { field: "name" },
								}),
							),
						);
					}
				}

				// Update subarea
				yield* _(
					actor.dbService.query("updateSubarea", async () => {
						return await actor.dbService.db
							.update(locationSubarea)
							.set({
								...input,
								updatedBy: actor.session.user.id,
							})
							.where(eq(locationSubarea.id, subareaId));
					}),
				);

				revalidatePath(`/settings/locations/${existing.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to update subarea");
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
 * Delete a subarea
 */
export async function deleteSubarea(subareaId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"deleteSubarea",
		{ attributes: { "subarea.id": subareaId } },
		(span) => {
			return Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);

				// Fetch existing subarea with location
				const existing = yield* _(
					dbService.query("getSubarea", async () => {
						return await dbService.db.query.locationSubarea.findFirst({
							where: eq(locationSubarea.id, subareaId),
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
										entityId: subareaId,
									}),
								),
					),
				);

				const actor = yield* _(
					getLocationSettingsActorContext({
						organizationId: existing.location.organizationId,
						queryName: "deleteSubareaActor",
					}),
				);
				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can delete subareas",
						action: "delete",
					}),
				);

				// Delete subarea (cascade handles employee assignments)
				yield* _(
					actor.dbService.query("deleteSubarea", async () => {
						return await actor.dbService.db.delete(locationSubarea).where(eq(locationSubarea.id, subareaId));
					}),
				);

				revalidatePath(`/settings/locations/${existing.locationId}`);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to delete subarea");
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
 * Get available employees for assignment (not already assigned to the location/subarea)
 */
export async function getAvailableEmployees(
	organizationId: string,
	excludeLocationId?: string,
	excludeSubareaId?: string,
): Promise<
	ServerActionResult<
		Array<{
			id: string;
			firstName: string | null;
			lastName: string | null;
			user: { name: string | null; email: string };
		}>
	>
> {
	const tracer = trace.getTracer("locations");

	const effect = tracer.startActiveSpan(
		"getAvailableEmployees",
		{ attributes: { "organization.id": organizationId } },
		(span) => {
			return Effect.gen(function* (_) {
				const actor = yield* _(
					getLocationSettingsActorContext({ organizationId, queryName: "getAvailableEmployeesActor" }),
				);
				yield* _(
					requireLocationOrgAdminAccess(actor, {
						message: "Only org admins can view employees",
						action: "create",
					}),
				);

				// Get all active employees
				const employees = yield* _(
					actor.dbService.query("getEmployees", async () => {
						return await actor.dbService.db.query.employee.findMany({
							where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
							with: { user: true },
						});
					}),
				);

				// Get already assigned employee IDs
				let assignedIds: string[] = [];

				if (excludeLocationId) {
					const assignments = yield* _(
						actor.dbService.query("getLocationAssignments", async () => {
							return await actor.dbService.db.query.locationEmployee.findMany({
								where: eq(locationEmployee.locationId, excludeLocationId),
							});
						}),
					);
					assignedIds = assignments.map((a) => a.employeeId);
				}

				if (excludeSubareaId) {
					const assignments = yield* _(
						actor.dbService.query("getSubareaAssignments", async () => {
							return await actor.dbService.db.query.subareaEmployee.findMany({
								where: eq(subareaEmployee.subareaId, excludeSubareaId),
							});
						}),
					);
					assignedIds = assignments.map((a) => a.employeeId);
				}

				// Filter out assigned employees
				const available = employees
					.filter((e) => !assignedIds.includes(e.id))
					.map((e) => ({
						id: e.id,
						firstName: e.firstName,
						lastName: e.lastName,
						user: {
							name: e.user.name,
							email: e.user.email,
						},
					}));

				span.setStatus({ code: SpanStatusCode.OK });
				return available;
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR });
						logger.error({ error }, "Failed to get available employees");
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
