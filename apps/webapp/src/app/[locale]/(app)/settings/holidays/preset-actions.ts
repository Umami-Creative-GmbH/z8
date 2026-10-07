"use server";

import { and, eq, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { user } from "@/db/auth-schema";
import {
	employee,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
	team,
} from "@/db/schema";
import { type AnyAppError, ConflictError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import type {
	HolidayPresetAssignmentFormValues,
	HolidayPresetFormValues,
	HolidayPresetHolidayFormValues,
} from "@/lib/holidays/validation";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";
import {
	filterAssignmentsForManagerHolidayScope,
	getScopedHolidayAccessContext,
} from "./holiday-scope";
import {
	assignmentRangesOverlap,
	buildPresetLocationConflictConditions,
} from "./preset-scheduling";

// Type definitions for return values
type HolidayPresetListItem = {
	id: string;
	name: string;
	description: string | null;
	countryCode: string | null;
	stateCode: string | null;
	regionCode: string | null;
	year: number | null;
	color: string | null;
	isActive: boolean;
	createdAt: Date;
	holidayCount: number;
	assignmentCount: number;
};

type HolidayPresetHolidayItem = {
	id: string;
	name: string;
	description: string | null;
	month: number;
	day: number;
	durationDays: number;
	holidayType: string | null;
	isFloating: boolean;
	floatingRule: string | null;
	categoryId: string | null;
	isActive: boolean;
	category: { id: string; name: string; color: string | null } | null;
};

type HolidayPresetDetail = {
	preset: typeof holidayPreset.$inferSelect;
	holidays: HolidayPresetHolidayItem[];
};

type PresetAssignmentListItem = {
	id: string;
	presetId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	preset: {
		id: string;
		name: string;
		year: number | null;
		color: string | null;
		countryCode: string | null;
		stateCode: string | null;
	};
	team: { id: string; name: string } | null;
	employee: { id: string; firstName: string | null; lastName: string | null } | null;
};

type TeamListItem = { id: string; name: string };
type EmployeeListItem = {
	id: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
};

function runPresetServerAction<T>(effect: Effect.Effect<T, AnyAppError, AppServices>) {
	return runServerActionSafe(effect);
}

function filterPresetAssignmentsForScope(
	assignments: PresetAssignmentListItem[],
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
) {
	return filterAssignmentsForManagerHolidayScope(
		assignments,
		manageableTeamIds,
		managedEmployeeIds,
	);
}

// ============================================
// PRESET QUERIES
// ============================================

/**
 * Get all holiday presets for an organization
 */
export async function getHolidayPresets(
	organizationId: string,
): Promise<ServerActionResult<HolidayPresetListItem[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getHolidayPresets:actor",
		});

		const presets = yield* actor.dbService
			.query("getHolidayPresets", async () => {
				const results = await actor.dbService.db
					.select({
						id: holidayPreset.id,
						name: holidayPreset.name,
						description: holidayPreset.description,
						countryCode: holidayPreset.countryCode,
						stateCode: holidayPreset.stateCode,
						regionCode: holidayPreset.regionCode,
						year: holidayPreset.year,
						color: holidayPreset.color,
						isActive: holidayPreset.isActive,
						createdAt: holidayPreset.createdAt,
					})
					.from(holidayPreset)
					.where(eq(holidayPreset.organizationId, actor.organizationId))
					.orderBy(holidayPreset.name);

				// Get holiday counts and assignment counts for each preset
				const presetsWithCounts = await Promise.all(
					results.map(async (preset) => {
						const [[holidayCountResult], [assignmentCountResult]] = await Promise.all([
							actor.dbService.db
								.select({ count: sql<number>`count(*)::int` })
								.from(holidayPresetHoliday)
								.where(eq(holidayPresetHoliday.presetId, preset.id)),
							actor.dbService.db
								.select({ count: sql<number>`count(*)::int` })
								.from(holidayPresetAssignment)
								.where(
									and(
										eq(holidayPresetAssignment.organizationId, actor.organizationId),
										eq(holidayPresetAssignment.presetId, preset.id),
										eq(holidayPresetAssignment.isActive, true),
									),
								),
						]);

						return {
							...preset,
							holidayCount: holidayCountResult?.count ?? 0,
							assignmentCount: assignmentCountResult?.count ?? 0,
						};
					}),
				);

				return presetsWithCounts;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to fetch holiday presets",
							operation: "select",
							table: "holiday_preset",
							cause: error,
						}),
				),
			);

		return presets;
	});

	return runServerActionSafe(effect);
}

/**
 * Get a single holiday preset with its holidays
 */
export async function getHolidayPreset(
	presetId: string,
): Promise<ServerActionResult<HolidayPresetDetail>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "getHolidayPreset:actor" });

		// Fetch the preset
		const preset = yield* actor.dbService
			.query("getPreset", async () => {
				const [p] = await actor.dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset not found",
							entityType: "holiday_preset",
							entityId: presetId,
						}),
				),
			);

		if (actor.accessTier === "manager") {
			const { manageableTeamIds, managedEmployeeIds } = yield* getScopedHolidayAccessContext(
				actor.organizationId,
				"getHolidayPreset:scope",
			);

			const presetAssignments = yield* actor.dbService.query(
				"getPresetAssignmentsForScope",
				async () => {
					return await actor.dbService.db
						.select({
							id: holidayPresetAssignment.id,
							presetId: holidayPresetAssignment.presetId,
							assignmentType: holidayPresetAssignment.assignmentType,
							teamId: holidayPresetAssignment.teamId,
							employeeId: holidayPresetAssignment.employeeId,
							priority: holidayPresetAssignment.priority,
							effectiveFrom: holidayPresetAssignment.effectiveFrom,
							effectiveUntil: holidayPresetAssignment.effectiveUntil,
							isActive: holidayPresetAssignment.isActive,
							createdAt: holidayPresetAssignment.createdAt,
							preset: {
								id: holidayPreset.id,
								name: holidayPreset.name,
								year: holidayPreset.year,
								color: holidayPreset.color,
								countryCode: holidayPreset.countryCode,
								stateCode: holidayPreset.stateCode,
							},
							team: {
								id: team.id,
								name: team.name,
							},
							employee: {
								id: employee.id,
								firstName: user.firstName,
								lastName: user.lastName,
							},
						})
						.from(holidayPresetAssignment)
						.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
						.leftJoin(team, eq(holidayPresetAssignment.teamId, team.id))
						.leftJoin(employee, eq(holidayPresetAssignment.employeeId, employee.id))
						.leftJoin(user, eq(employee.userId, user.id))
						.where(
							and(
								eq(holidayPresetAssignment.organizationId, actor.organizationId),
								eq(holidayPresetAssignment.presetId, presetId),
								eq(holidayPresetAssignment.isActive, true),
							),
						)
						.orderBy(holidayPresetAssignment.createdAt);
				},
			);

			const visibleAssignments = filterPresetAssignmentsForScope(
				presetAssignments as PresetAssignmentListItem[],
				manageableTeamIds,
				managedEmployeeIds,
			);

			if (visibleAssignments.length === 0) {
				yield* Effect.fail(
					new NotFoundError({
						message: "Preset not found",
						entityType: "holiday_preset",
						entityId: presetId,
					}),
				);
			}
		}

		// Fetch holidays
		const holidays = yield* actor.dbService.query("getPresetHolidays", async () => {
			return await actor.dbService.db
				.select({
					id: holidayPresetHoliday.id,
					name: holidayPresetHoliday.name,
					description: holidayPresetHoliday.description,
					month: holidayPresetHoliday.month,
					day: holidayPresetHoliday.day,
					durationDays: holidayPresetHoliday.durationDays,
					holidayType: holidayPresetHoliday.holidayType,
					isFloating: holidayPresetHoliday.isFloating,
					floatingRule: holidayPresetHoliday.floatingRule,
					categoryId: holidayPresetHoliday.categoryId,
					isActive: holidayPresetHoliday.isActive,
					category: {
						id: holidayCategory.id,
						name: holidayCategory.name,
						color: holidayCategory.color,
					},
				})
				.from(holidayPresetHoliday)
				.leftJoin(holidayCategory, eq(holidayPresetHoliday.categoryId, holidayCategory.id))
				.where(eq(holidayPresetHoliday.presetId, presetId))
				.orderBy(holidayPresetHoliday.month, holidayPresetHoliday.day);
		});

		return { preset, holidays };
	});

	return runPresetServerAction(effect);
}

// ============================================
// PRESET MUTATIONS
// ============================================

/**
 * Create a new holiday preset
 */
export async function createHolidayPreset(
	organizationId: string,
	data: HolidayPresetFormValues,
): Promise<ServerActionResult<typeof holidayPreset.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "createHolidayPreset:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can create holiday presets",
			resource: "holiday_preset",
			action: "create",
		});

		const existingConditions = buildPresetLocationConflictConditions(organizationId, data);

		const existing = yield* actor.dbService.query("checkExisting", async () => {
			const [p] = await actor.dbService.db
				.select()
				.from(holidayPreset)
				.where(and(...existingConditions))
				.limit(1);
			return p;
		});

		if (existing) {
			yield* Effect.fail(
				new ConflictError({
					message: data.year
						? "A preset for this location and year already exists"
						: "A preset for this location already exists",
					conflictType: "duplicate_location",
					details: { existingId: existing.id, year: data.year ?? null },
				}),
			);
		}

		// Create preset
		const newPreset = yield* actor.dbService
			.query("createPreset", async () => {
				const [p] = await actor.dbService.db
					.insert(holidayPreset)
					.values({
						organizationId,
						name: data.name,
						description: data.description || null,
						countryCode: data.countryCode || null,
						stateCode: data.stateCode || null,
						regionCode: data.regionCode || null,
						year: data.year ?? null,
						color: data.color || null,
						isActive: data.isActive ?? true,
						createdBy: actor.session.user.id,
					})
					.returning();
				return p;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to create holiday preset",
							operation: "insert",
							table: "holiday_preset",
							cause: error,
						}),
				),
			);

		return newPreset;
	});

	return runPresetServerAction(effect);
}

/**
 * Update a holiday preset
 */
export async function updateHolidayPreset(
	presetId: string,
	data: HolidayPresetFormValues,
): Promise<ServerActionResult<typeof holidayPreset.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "updateHolidayPreset:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can update holiday presets",
			resource: "holiday_preset",
			action: "update",
		});

		// Verify preset exists and belongs to organization
		yield* actor.dbService
			.query("verifyPreset", async () => {
				const [p] = await actor.dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset not found",
							entityType: "holiday_preset",
							entityId: presetId,
						}),
				),
			);

		const existingConditions = buildPresetLocationConflictConditions(actor.organizationId, data, {
			excludePresetId: presetId,
		});

		const existing = yield* actor.dbService.query("checkExistingUpdate", async () => {
			const [p] = await actor.dbService.db
				.select()
				.from(holidayPreset)
				.where(and(...existingConditions))
				.limit(1);
			return p;
		});

		if (existing) {
			yield* Effect.fail(
				new ConflictError({
					message: data.year
						? "A preset for this location and year already exists"
						: "A preset for this location already exists",
					conflictType: "duplicate_location",
					details: { existingId: existing.id, year: data.year ?? null },
				}),
			);
		}

		// Update preset
		const updatedPreset = yield* actor.dbService
			.query("updatePreset", async () => {
				const [p] = await actor.dbService.db
					.update(holidayPreset)
					.set({
						name: data.name,
						description: data.description || null,
						countryCode: data.countryCode || null,
						stateCode: data.stateCode || null,
						regionCode: data.regionCode || null,
						year: data.year ?? null,
						color: data.color || null,
						isActive: data.isActive ?? true,
						updatedBy: actor.session.user.id,
					})
					.where(eq(holidayPreset.id, presetId))
					.returning();
				return p;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to update holiday preset",
							operation: "update",
							table: "holiday_preset",
							cause: error,
						}),
				),
			);

		return updatedPreset;
	});

	return runPresetServerAction(effect);
}

/**
 * Delete a holiday preset (soft delete)
 */
export async function deleteHolidayPreset(presetId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "deleteHolidayPreset:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete holiday presets",
			resource: "holiday_preset",
			action: "delete",
		});

		// Verify preset exists
		yield* actor.dbService
			.query("verifyPreset", async () => {
				const [p] = await actor.dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset not found",
							entityType: "holiday_preset",
							entityId: presetId,
						}),
				),
			);

		const deletedRows = yield* actor.dbService
			.query("deletePreset", async () => {
				return await actor.dbService.db
					.delete(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
							sql`not exists (
								select 1 from ${holidayPresetAssignment}
								where ${holidayPresetAssignment.presetId} = ${presetId}
								and ${holidayPresetAssignment.isActive} = true
							)`,
						),
					)
					.returning({ id: holidayPreset.id });
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to delete holiday preset",
							operation: "delete",
							table: "holiday_preset",
							cause: error,
						}),
				),
			);

		if (deletedRows.length === 0) {
			yield* Effect.fail(
				new ConflictError({
					message: "Cannot delete preset with active assignments",
					conflictType: "preset_has_assignments",
					details: { presetId },
				}),
			);
		}
	});

	return runPresetServerAction(effect);
}

// ============================================
// PRESET HOLIDAY MUTATIONS
// ============================================

/**
 * Add a holiday to a preset
 */
export async function addHolidayToPreset(
	presetId: string,
	data: HolidayPresetHolidayFormValues,
): Promise<ServerActionResult<typeof holidayPresetHoliday.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "addHolidayToPreset:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can add preset holidays",
			resource: "holiday_preset_holiday",
			action: "create",
		});

		// Verify preset exists and belongs to organization
		yield* actor.dbService
			.query("verifyPreset", async () => {
				const [p] = await actor.dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset not found",
							entityType: "holiday_preset",
							entityId: presetId,
						}),
				),
			);

		if (data.categoryId) {
			const categoryId = data.categoryId;
			const category = yield* actor.dbService.query("verifyHolidayCategory", async () => {
				const [row] = await actor.dbService.db
					.select({ id: holidayCategory.id })
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, categoryId),
							eq(holidayCategory.organizationId, actor.organizationId),
						),
					)
					.limit(1);
				return row;
			});

			if (!category) {
				yield* Effect.fail(
					new NotFoundError({
						message: "Holiday category not found",
						entityType: "holiday_category",
						entityId: categoryId,
					}),
				);
			}
		}

		// Create holiday
		const newHoliday = yield* actor.dbService
			.query("createHoliday", async () => {
				const [h] = await actor.dbService.db
					.insert(holidayPresetHoliday)
					.values({
						presetId,
						name: data.name,
						description: data.description || null,
						month: data.month,
						day: data.day,
						durationDays: data.durationDays ?? 1,
						holidayType: data.holidayType || null,
						isFloating: data.isFloating ?? false,
						floatingRule: data.floatingRule || null,
						categoryId: data.categoryId || null,
						isActive: data.isActive ?? true,
					})
					.returning();
				return h;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to add holiday to preset",
							operation: "insert",
							table: "holiday_preset_holiday",
							cause: error,
						}),
				),
			);

		return newHoliday;
	});

	return runPresetServerAction(effect);
}

/**
 * Bulk add holidays to a preset
 */
export async function bulkAddHolidaysToPreset(
	presetId: string,
	holidays: Omit<HolidayPresetHolidayFormValues, "categoryId">[],
	categoryId?: string,
): Promise<ServerActionResult<{ added: number }>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "bulkAddHolidaysToPreset:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can add preset holidays",
			resource: "holiday_preset_holiday",
			action: "create",
		});

		// Verify preset exists
		yield* actor.dbService
			.query("verifyPreset", async () => {
				const [p] = await actor.dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset not found",
							entityType: "holiday_preset",
							entityId: presetId,
						}),
				),
			);

		if (categoryId) {
			const holidayCategoryId = categoryId;
			const category = yield* actor.dbService.query("verifyHolidayCategory", async () => {
				const [row] = await actor.dbService.db
					.select({ id: holidayCategory.id })
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, holidayCategoryId),
							eq(holidayCategory.organizationId, actor.organizationId),
						),
					)
					.limit(1);
				return row;
			});

			if (!category) {
				yield* Effect.fail(
					new NotFoundError({
						message: "Holiday category not found",
						entityType: "holiday_category",
						entityId: holidayCategoryId,
					}),
				);
			}
		}

		// Bulk insert holidays
		const result = yield* actor.dbService
			.query("bulkInsert", async () => {
				const values = holidays.map((h) => ({
					presetId,
					name: h.name,
					description: h.description || null,
					month: h.month,
					day: h.day,
					durationDays: h.durationDays ?? 1,
					holidayType: h.holidayType || null,
					isFloating: h.isFloating ?? false,
					floatingRule: h.floatingRule || null,
					categoryId: categoryId || null,
					isActive: h.isActive ?? true,
				}));

				await actor.dbService.db.insert(holidayPresetHoliday).values(values);
				return { added: values.length };
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to bulk add holidays to preset",
							operation: "insert",
							table: "holiday_preset_holiday",
							cause: error,
						}),
				),
			);

		return result;
	});

	return runPresetServerAction(effect);
}

/**
 * Delete a holiday from a preset
 */
export async function deleteHolidayFromPreset(
	holidayId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "deleteHolidayFromPreset:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete preset holidays",
			resource: "holiday_preset_holiday",
			action: "delete",
		});

		const presetHoliday = yield* actor.dbService
			.query("verifyPresetHoliday", async () => {
				const [row] = await actor.dbService.db
					.select({ id: holidayPresetHoliday.id })
					.from(holidayPresetHoliday)
					.innerJoin(holidayPreset, eq(holidayPresetHoliday.presetId, holidayPreset.id))
					.where(
						and(
							eq(holidayPresetHoliday.id, holidayId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);
				return row;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset holiday not found",
							entityType: "holiday_preset_holiday",
							entityId: holidayId,
						}),
				),
			);

		if (!presetHoliday) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Preset holiday not found",
					entityType: "holiday_preset_holiday",
					entityId: holidayId,
				}),
			);
		}

		// Delete (hard delete since it's a preset holiday)
		yield* actor.dbService
			.query("deleteHoliday", async () => {
				await actor.dbService.db
					.delete(holidayPresetHoliday)
					.where(eq(holidayPresetHoliday.id, holidayId));
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to delete holiday from preset",
							operation: "delete",
							table: "holiday_preset_holiday",
							cause: error,
						}),
				),
			);
	});

	return runPresetServerAction(effect);
}

// ============================================
// ASSIGNMENT QUERIES
// ============================================

/**
 * Get all preset assignments for an organization
 */
export async function getPresetAssignments(
	organizationId: string,
): Promise<ServerActionResult<PresetAssignmentListItem[]>> {
	const effect = Effect.gen(function* () {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* getScopedHolidayAccessContext(
			organizationId,
			"getPresetAssignments:actor",
		);

		const assignments = yield* actor.dbService
			.query("getAssignments", async () => {
				return await actor.dbService.db
					.select({
						id: holidayPresetAssignment.id,
						presetId: holidayPresetAssignment.presetId,
						assignmentType: holidayPresetAssignment.assignmentType,
						teamId: holidayPresetAssignment.teamId,
						employeeId: holidayPresetAssignment.employeeId,
						priority: holidayPresetAssignment.priority,
						effectiveFrom: holidayPresetAssignment.effectiveFrom,
						effectiveUntil: holidayPresetAssignment.effectiveUntil,
						isActive: holidayPresetAssignment.isActive,
						createdAt: holidayPresetAssignment.createdAt,
						preset: {
							id: holidayPreset.id,
							name: holidayPreset.name,
							year: holidayPreset.year,
							color: holidayPreset.color,
							countryCode: holidayPreset.countryCode,
							stateCode: holidayPreset.stateCode,
						},
						team: {
							id: team.id,
							name: team.name,
						},
						employee: {
							id: employee.id,
							firstName: user.firstName,
							lastName: user.lastName,
						},
					})
					.from(holidayPresetAssignment)
					.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
					.leftJoin(team, eq(holidayPresetAssignment.teamId, team.id))
					.leftJoin(employee, eq(holidayPresetAssignment.employeeId, employee.id))
					.leftJoin(user, eq(employee.userId, user.id))
					.where(
						and(
							eq(holidayPresetAssignment.organizationId, organizationId),
							eq(holidayPresetAssignment.isActive, true),
						),
					)
					.orderBy(holidayPresetAssignment.assignmentType, holidayPresetAssignment.createdAt);
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to fetch preset assignments",
							operation: "select",
							table: "holiday_preset_assignment",
							cause: error,
						}),
				),
			);

		return filterPresetAssignmentsForScope(
			assignments as PresetAssignmentListItem[],
			manageableTeamIds,
			managedEmployeeIds,
		);
	});

	return runPresetServerAction(effect);
}

// ============================================
// ASSIGNMENT MUTATIONS
// ============================================

/**
 * Create a preset assignment
 */
export async function createPresetAssignment(
	organizationId: string,
	data: HolidayPresetAssignmentFormValues,
): Promise<ServerActionResult<typeof holidayPresetAssignment.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "createPresetAssignment:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can create preset assignments",
			resource: "holiday_preset_assignment",
			action: "create",
		});

		const preset = yield* actor.dbService
			.query("verifyAssignmentPreset", async () => {
				const [p] = await actor.dbService.db
					.select({ id: holidayPreset.id })
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, data.presetId),
							eq(holidayPreset.organizationId, actor.organizationId),
						),
					)
					.limit(1);
				return p;
			})
			.pipe(
				Effect.mapError(
					() =>
						new NotFoundError({
							message: "Preset not found",
							entityType: "holiday_preset",
							entityId: data.presetId,
						}),
				),
			);

		if (!preset) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Preset not found",
					entityType: "holiday_preset",
					entityId: data.presetId,
				}),
			);
		}

		if (data.assignmentType === "team") {
			const targetTeam = yield* actor.dbService
				.query("verifyAssignmentTeam", async () => {
					const [row] = await actor.dbService.db
						.select({ id: team.id })
						.from(team)
						.where(
							and(eq(team.id, data.teamId ?? ""), eq(team.organizationId, actor.organizationId)),
						)
						.limit(1);
					return row;
				})
				.pipe(
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Team not found",
								entityType: "team",
								entityId: data.teamId ?? "",
							}),
					),
				);

			if (!targetTeam) {
				yield* Effect.fail(
					new NotFoundError({
						message: "Team not found",
						entityType: "team",
						entityId: data.teamId ?? "",
					}),
				);
			}
		}

		if (data.assignmentType === "employee") {
			const targetEmployee = yield* actor.dbService
				.query("verifyAssignmentEmployee", async () => {
					const [row] = await actor.dbService.db
						.select({ id: employee.id })
						.from(employee)
						.where(
							and(
								eq(employee.id, data.employeeId ?? ""),
								eq(employee.organizationId, actor.organizationId),
							),
						)
						.limit(1);
					return row;
				})
				.pipe(
					Effect.mapError(
						() =>
							new NotFoundError({
								message: "Employee not found",
								entityType: "employee",
								entityId: data.employeeId ?? "",
							}),
					),
				);

			if (!targetEmployee) {
				yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: data.employeeId ?? "",
					}),
				);
			}
		}

		// Calculate priority based on assignment type
		const priority =
			data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

		const targetConditions: SQL[] = [
			eq(holidayPresetAssignment.organizationId, actor.organizationId),
			eq(holidayPresetAssignment.assignmentType, data.assignmentType),
			eq(holidayPresetAssignment.isActive, true),
		];

		if (data.assignmentType === "team" && data.teamId) {
			targetConditions.push(eq(holidayPresetAssignment.teamId, data.teamId));
		} else if (data.assignmentType === "employee" && data.employeeId) {
			targetConditions.push(eq(holidayPresetAssignment.employeeId, data.employeeId));
		}

		const existingAssignments = yield* actor.dbService.query("checkExistingRange", async () => {
			return await actor.dbService.db
				.select()
				.from(holidayPresetAssignment)
				.where(and(...targetConditions));
		});

		const overlappingAssignment = existingAssignments.find((assignment) =>
			assignmentRangesOverlap(
				assignment.effectiveFrom,
				assignment.effectiveUntil,
				data.effectiveFrom,
				data.effectiveUntil,
			),
		);

		if (overlappingAssignment) {
			yield* Effect.fail(
				new ConflictError({
					message: "An assignment already exists for this target in the selected date range",
					conflictType: "duplicate_assignment_range",
					details: { existingId: overlappingAssignment.id },
				}),
			);
		}

		// Create assignment
		const newAssignment = yield* actor.dbService
			.query("createAssignment", async () => {
				const [a] = await actor.dbService.db
					.insert(holidayPresetAssignment)
					.values({
						presetId: data.presetId,
						organizationId: actor.organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId || null,
						employeeId: data.employeeId || null,
						priority,
						effectiveFrom: data.effectiveFrom || null,
						effectiveUntil: data.effectiveUntil || null,
						isActive: data.isActive ?? true,
						createdBy: actor.session.user.id,
					})
					.returning();
				return a;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to create preset assignment",
							operation: "insert",
							table: "holiday_preset_assignment",
							cause: error,
						}),
				),
			);

		return newAssignment;
	});

	return runPresetServerAction(effect);
}

/**
 * Delete a preset assignment
 */
export async function deletePresetAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "deletePresetAssignment:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete preset assignments",
			resource: "holiday_preset_assignment",
			action: "delete",
		});

		// Soft delete
		const deletedAssignment = yield* actor.dbService
			.query("deleteAssignment", async () => {
				const [assignment] = await actor.dbService.db
					.update(holidayPresetAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(holidayPresetAssignment.id, assignmentId),
							eq(holidayPresetAssignment.organizationId, actor.organizationId),
						),
					)
					.returning({ id: holidayPresetAssignment.id });
				return assignment;
			})
			.pipe(
				Effect.mapError(
					(error) =>
						new DatabaseError({
							message: "Failed to delete preset assignment",
							operation: "update",
							table: "holiday_preset_assignment",
							cause: error,
						}),
				),
			);

		if (!deletedAssignment) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Preset assignment not found",
					entityType: "holiday_preset_assignment",
					entityId: assignmentId,
				}),
			);
		}
	});

	return runPresetServerAction(effect);
}

// ============================================
// HELPER QUERIES
// ============================================

/**
 * Get teams for assignment dropdown
 */
export async function getTeamsForAssignment(
	organizationId: string,
): Promise<ServerActionResult<TeamListItem[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getTeamsForAssignment:actor",
		});

		const teams = yield* actor.dbService.query("getTeams", async () => {
			return await actor.dbService.db
				.select({
					id: team.id,
					name: team.name,
				})
				.from(team)
				.where(eq(team.organizationId, actor.organizationId))
				.orderBy(team.name);
		});

		return teams;
	});

	return runServerActionSafe(effect);
}

/**
 * Get employees for assignment dropdown
 */
export async function getEmployeesForAssignment(
	organizationId: string,
): Promise<ServerActionResult<EmployeeListItem[]>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			organizationId,
			queryName: "getEmployeesForAssignment:actor",
		});

		const employees = yield* actor.dbService.query("getEmployees", async () => {
			return await actor.dbService.db
				.select({
					id: employee.id,
					firstName: user.firstName,
					lastName: user.lastName,
					position: employee.position,
				})
				.from(employee)
				.innerJoin(user, eq(employee.userId, user.id))
				.where(and(eq(employee.organizationId, actor.organizationId), eq(employee.isActive, true)))
				.orderBy(user.firstName, user.lastName);
		});

		return employees;
	});

	return runServerActionSafe(effect);
}
