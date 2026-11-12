"use server";

import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath, revalidateTag } from "next/cache";
import * as z from "zod";
import {
	employee,
	location,
	locationEmployee,
	locationSubarea,
	subareaEmployee,
} from "@/db/schema";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { AuthorizationError, ConflictError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import {
	locationSchema,
	subareaSchema,
	updateLocationSchema,
	updateSubareaSchema,
} from "@/lib/validations/location";
import { loadLocationScope, reachesLocation, subareasInScope } from "./location-scope";

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

type LocationListRow = typeof location.$inferSelect & {
	subareas: Pick<typeof locationSubarea.$inferSelect, "id">[];
	employees: unknown[];
};

type LocationEmployeeRow = typeof locationEmployee.$inferSelect & {
	employee: Pick<typeof employee.$inferSelect, "id"> & {
		user: { firstName: string | null; lastName: string | null; name: string | null; email: string };
	};
};

type LocationSubareaRow = typeof locationSubarea.$inferSelect & {
	employees: LocationEmployeeRow[];
};

type LocationDetailRow = typeof location.$inferSelect & {
	subareas: LocationSubareaRow[];
	employees: LocationEmployeeRow[];
};

type SubareaWithLocation = typeof locationSubarea.$inferSelect & {
	location: Pick<typeof location.$inferSelect, "organizationId">;
};

function toEmployeeData(row: LocationEmployeeRow): LocationEmployeeData {
	return {
		id: row.id,
		employeeId: row.employeeId,
		isPrimary: row.isPrimary,
		employee: {
			id: row.employee.id,
			firstName: row.employee.user.firstName,
			lastName: row.employee.user.lastName,
			user: { name: row.employee.user.name, email: row.employee.user.email },
		},
	};
}

function locationNotFound(locationId: string) {
	return new NotFoundError({
		message: "Location not found",
		entityType: "location",
		entityId: locationId,
	});
}

function subareaNotFound(subareaId: string) {
	return new NotFoundError({
		message: "Subarea not found",
		entityType: "subarea",
		entityId: subareaId,
	});
}

/** The location `locationId` of the session's organization; another organization's is not found. */
function loadLocation(organizationId: string, locationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = yield* dbService.query("locations.get", () =>
			dbService.db.query.location.findFirst({
				where: and(eq(location.id, locationId), eq(location.organizationId, organizationId)),
			}),
		);
		return row ?? (yield* Effect.fail(locationNotFound(locationId)));
	});
}

/** The subarea `subareaId` of a location of the session's organization. */
function loadSubarea(organizationId: string, subareaId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const row = (yield* dbService.query("locations.getSubarea", () =>
			dbService.db.query.locationSubarea.findFirst({
				where: eq(locationSubarea.id, subareaId),
				with: { location: { columns: { organizationId: true } } },
			}),
		)) as SubareaWithLocation | undefined;
		if (!row || row.location?.organizationId !== organizationId) {
			return yield* Effect.fail(subareaNotFound(subareaId));
		}
		return row;
	});
}

function duplicateName(message: string) {
	return new ConflictError({
		message,
		conflictType: "duplicate_name",
		details: { field: "name" },
	});
}

function audit(entry: Parameters<typeof logAudit>[0]) {
	logAudit(entry).catch((err) => logger.error({ err }, "Failed to log audit"));
}

// ============================================
// LOCATION CRUD
// ============================================

/** The locations of the session's organization the caller reaches. */
export const getLocations = organizationAction(
	{ name: "locations.list", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const scope = yield* loadLocationScope(actor, organizationId);
			const locations = (yield* dbService.query("locations.list", () =>
				dbService.db.query.location.findMany({
					where: eq(location.organizationId, organizationId),
					orderBy: [desc(location.createdAt)],
					with: { subareas: true, employees: true },
				}),
			)) as unknown as LocationListRow[];

			return locations.flatMap((loc): LocationListItem[] => {
				const subareas = subareasInScope(scope, loc.id, loc.subareas);
				if (!reachesLocation(scope, loc.id, subareas)) return [];
				return [
					{
						id: loc.id,
						name: loc.name,
						city: loc.city,
						country: loc.country,
						isActive: loc.isActive,
						subareaCount: subareas.length,
						employeeCount: loc.employees.length,
					},
				];
			});
		}),
);

/** A location with its subareas and employees, narrowed to the caller's scope. */
export const getLocation = organizationAction(
	{ name: "locations.get", requires: "scopedManager", schema: z.uuid() },
	({ actor, organizationId, input: locationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const loc = (yield* dbService.query("locations.getDetail", () =>
				dbService.db.query.location.findFirst({
					where: and(eq(location.id, locationId), eq(location.organizationId, organizationId)),
					with: {
						subareas: {
							with: { employees: { with: { employee: { with: { user: true } } } } },
						},
						employees: { with: { employee: { with: { user: true } } } },
					},
				}),
			)) as unknown as LocationDetailRow | undefined;
			if (!loc) return yield* Effect.fail(locationNotFound(locationId));

			const scope = yield* loadLocationScope(actor, organizationId);
			const subareas = subareasInScope(scope, loc.id, loc.subareas);
			if (!reachesLocation(scope, loc.id, subareas)) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Only org admins can manage locations",
						userId: actor.userId,
						resource: "location",
						action: "read",
					}),
				);
			}

			return {
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
				subareas: subareas.map((sub) => ({
					id: sub.id,
					locationId: sub.locationId,
					name: sub.name,
					isActive: sub.isActive,
					createdAt: sub.createdAt,
					employeeCount: sub.employees.length,
					employees: sub.employees.map(toEmployeeData),
				})),
				employees: loc.employees.map(toEmployeeData),
				subareaCount: subareas.length,
				employeeCount: loc.employees.length,
			} satisfies LocationWithDetails;
		}),
);

/** Creates a location in the session's organization. */
export const createLocation = organizationAction(
	{
		name: "locations.create",
		requires: "orgAdmin",
		schema: z.strictObject(locationSchema.shape),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const existing = yield* dbService.query("locations.checkDuplicate", () =>
				dbService.db.query.location.findFirst({
					where: and(eq(location.organizationId, organizationId), eq(location.name, input.name)),
				}),
			);
			if (existing) {
				return yield* Effect.fail(duplicateName("A location with this name already exists"));
			}

			const [created] = yield* dbService.query("locations.create", () =>
				dbService.db
					.insert(location)
					.values({
						organizationId,
						name: input.name,
						street: input.street,
						city: input.city,
						postalCode: input.postalCode,
						country: input.country,
						createdBy: actor.userId,
						updatedAt: new Date(),
					})
					.returning({ id: location.id }),
			);

			audit({
				action: AuditAction.LOCATION_CREATED,
				actorId: actor.userId,
				targetId: created.id,
				targetType: "location",
				organizationId,
				changes: { name: input.name },
				metadata: { locationName: input.name },
				timestamp: new Date(),
			});
			revalidateTag(CACHE_TAGS.LOCATIONS(organizationId), "max");
			revalidatePath("/settings/locations");
			return { id: created.id };
		}),
);

/** Updates a location of the session's organization. */
export const updateLocation = organizationAction(
	{
		name: "locations.update",
		requires: "orgAdmin",
		schema: z.strictObject({
			locationId: z.uuid(),
			data: z.strictObject(updateLocationSchema.shape),
		}),
	},
	({ actor, organizationId, input: { locationId, data } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const existing = yield* loadLocation(organizationId, locationId);

			if (data.name && data.name !== existing.name) {
				const name = data.name;
				const duplicate = yield* dbService.query("locations.checkDuplicate", () =>
					dbService.db.query.location.findFirst({
						where: and(eq(location.organizationId, organizationId), eq(location.name, name)),
					}),
				);
				if (duplicate) {
					return yield* Effect.fail(duplicateName("A location with this name already exists"));
				}
			}

			yield* dbService.query("locations.update", () =>
				dbService.db
					.update(location)
					.set({ ...data, updatedBy: actor.userId })
					.where(and(eq(location.id, locationId), eq(location.organizationId, organizationId))),
			);

			audit({
				action: AuditAction.LOCATION_UPDATED,
				actorId: actor.userId,
				targetId: locationId,
				targetType: "location",
				organizationId,
				changes: data,
				metadata: { locationName: data.name || existing.name },
				timestamp: new Date(),
			});
			revalidateTag(CACHE_TAGS.LOCATIONS(organizationId), "max");
			revalidatePath("/settings/locations");
			revalidatePath(`/settings/locations/${locationId}`);
		}),
);

/** Deletes a location of the session's organization (cascades to subareas and assignments). */
export const deleteLocation = organizationAction(
	{ name: "locations.delete", requires: "orgAdmin", schema: z.uuid() },
	({ actor, organizationId, input: locationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const existing = yield* loadLocation(organizationId, locationId);

			yield* dbService.query("locations.delete", () =>
				dbService.db
					.delete(location)
					.where(and(eq(location.id, locationId), eq(location.organizationId, organizationId))),
			);

			audit({
				action: AuditAction.LOCATION_DELETED,
				actorId: actor.userId,
				targetId: locationId,
				targetType: "location",
				organizationId,
				changes: { deleted: true },
				metadata: { locationName: existing.name },
				timestamp: new Date(),
			});
			revalidateTag(CACHE_TAGS.LOCATIONS(organizationId), "max");
			revalidatePath("/settings/locations");
		}),
);

// ============================================
// SUBAREA CRUD
// ============================================

/** Creates a subarea of a location of the session's organization. */
export const createSubarea = organizationAction(
	{
		name: "locations.createSubarea",
		requires: "orgAdmin",
		schema: z.strictObject({ ...subareaSchema.shape, locationId: z.uuid("Invalid location ID") }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* loadLocation(organizationId, input.locationId);

			const existing = yield* dbService.query("locations.checkDuplicateSubarea", () =>
				dbService.db.query.locationSubarea.findFirst({
					where: and(
						eq(locationSubarea.locationId, input.locationId),
						eq(locationSubarea.name, input.name),
					),
				}),
			);
			if (existing) {
				return yield* Effect.fail(
					duplicateName("A subarea with this name already exists in this location"),
				);
			}

			const [created] = yield* dbService.query("locations.createSubarea", () =>
				dbService.db
					.insert(locationSubarea)
					.values({
						locationId: input.locationId,
						name: input.name,
						createdBy: actor.userId,
						updatedAt: new Date(),
					})
					.returning({ id: locationSubarea.id }),
			);

			revalidatePath(`/settings/locations/${input.locationId}`);
			return { id: created.id };
		}),
);

/** Updates a subarea of a location of the session's organization. */
export const updateSubarea = organizationAction(
	{
		name: "locations.updateSubarea",
		requires: "orgAdmin",
		schema: z.strictObject({
			subareaId: z.uuid(),
			data: z.strictObject(updateSubareaSchema.shape),
		}),
	},
	({ actor, organizationId, input: { subareaId, data } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const existing = yield* loadSubarea(organizationId, subareaId);

			if (data.name && data.name !== existing.name) {
				const name = data.name;
				const duplicate = yield* dbService.query("locations.checkDuplicateSubarea", () =>
					dbService.db.query.locationSubarea.findFirst({
						where: and(
							eq(locationSubarea.locationId, existing.locationId),
							eq(locationSubarea.name, name),
						),
					}),
				);
				if (duplicate) {
					return yield* Effect.fail(
						duplicateName("A subarea with this name already exists in this location"),
					);
				}
			}

			yield* dbService.query("locations.updateSubarea", () =>
				dbService.db
					.update(locationSubarea)
					.set({ ...data, updatedBy: actor.userId })
					.where(eq(locationSubarea.id, subareaId)),
			);

			revalidatePath(`/settings/locations/${existing.locationId}`);
		}),
);

/** Deletes a subarea of a location of the session's organization. */
export const deleteSubarea = organizationAction(
	{ name: "locations.deleteSubarea", requires: "orgAdmin", schema: z.uuid() },
	({ organizationId, input: subareaId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const existing = yield* loadSubarea(organizationId, subareaId);

			yield* dbService.query("locations.deleteSubarea", () =>
				dbService.db.delete(locationSubarea).where(eq(locationSubarea.id, subareaId)),
			);

			revalidatePath(`/settings/locations/${existing.locationId}`);
		}),
);

/**
 * The active employees of the session's organization not yet assigned to the
 * given location or subarea.
 */
export const getAvailableEmployees = organizationAction(
	{
		name: "locations.availableEmployees",
		requires: "orgAdmin",
		schema: z.strictObject({
			excludeLocationId: z.uuid().optional(),
			excludeSubareaId: z.uuid().optional(),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const employees = yield* dbService.query("locations.availableEmployees", () =>
				dbService.db.query.employee.findMany({
					where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
					with: { user: true },
				}),
			);

			let assignedIds: string[] = [];
			const { excludeLocationId, excludeSubareaId } = input;
			if (excludeLocationId) {
				const assignments = yield* dbService.query("locations.locationAssignments", () =>
					dbService.db.query.locationEmployee.findMany({
						where: eq(locationEmployee.locationId, excludeLocationId),
					}),
				);
				assignedIds = assignments.map((a) => a.employeeId);
			}
			if (excludeSubareaId) {
				const assignments = yield* dbService.query("locations.subareaAssignments", () =>
					dbService.db.query.subareaEmployee.findMany({
						where: eq(subareaEmployee.subareaId, excludeSubareaId),
					}),
				);
				assignedIds = assignments.map((a) => a.employeeId);
			}

			const assignedIdSet = new Set(assignedIds);
			return employees.flatMap((e) =>
				assignedIdSet.has(e.id)
					? []
					: [
							{
								id: e.id,
								firstName: e.user.firstName,
								lastName: e.user.lastName,
								user: {
									firstName: e.user.firstName,
									lastName: e.user.lastName,
									name: e.user.name,
									email: e.user.email,
								},
							},
						],
			);
		}),
);
