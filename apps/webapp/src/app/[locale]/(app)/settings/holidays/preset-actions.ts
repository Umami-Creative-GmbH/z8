"use server";

import { and, eq, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import {
	employee,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
	team,
} from "@/db/schema";
import { ConflictError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import {
	holidayPresetAssignmentFormSchema,
	holidayPresetHolidayFormSchema,
} from "@/lib/holidays/validation";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { filterAssignmentsForManagerHolidayScope, holidayScopeOf } from "./holiday-scope";
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

/**
 * A preset's details as the preset forms send them: blank text fields mean none,
 * so this is looser than the client-side `holidayPresetFormSchema`.
 */
const presetDetailsSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(255),
	description: z.string().nullish(),
	countryCode: z.string().nullish(),
	stateCode: z.string().nullish(),
	regionCode: z.string().nullish(),
	year: z.number().int().min(2000).max(2100).nullish(),
	color: z.string().nullish(),
	isActive: z.boolean().optional(),
});

const presetHolidaySchema = holidayPresetHolidayFormSchema.extend({
	description: z.string().nullish(),
	floatingRule: z.string().nullish(),
});

const bulkPresetHolidaysSchema = z.object({
	presetId: z.string().min(1),
	holidays: z.array(presetHolidaySchema.omit({ categoryId: true })),
	categoryId: z.uuid().optional(),
});

const idSchema = z.string().min(1);

export type HolidayPresetDetailsInput = z.input<typeof presetDetailsSchema>;

function dbError(message: string, operation: string, table: string) {
	return (cause: unknown) => new DatabaseError({ message, operation, table, cause });
}

function presetNotFound(presetId: string) {
	return Effect.fail(
		new NotFoundError({
			message: "Preset not found",
			entityType: "holiday_preset",
			entityId: presetId,
		}),
	);
}

function findPreset(presetId: string, organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [preset] = yield* dbService.query("holidayPresets.findPreset", () =>
			dbService.db
				.select()
				.from(holidayPreset)
				.where(
					and(eq(holidayPreset.id, presetId), eq(holidayPreset.organizationId, organizationId)),
				)
				.limit(1),
		);
		return preset ?? (yield* presetNotFound(presetId));
	});
}

function refuseForeignCategory(categoryId: string | undefined, organizationId: string) {
	return Effect.gen(function* () {
		if (!categoryId) return;
		const dbService = yield* DatabaseService;
		const [category] = yield* dbService.query("verifyHolidayCategory", () =>
			dbService.db
				.select({ id: holidayCategory.id })
				.from(holidayCategory)
				.where(
					and(
						eq(holidayCategory.id, categoryId),
						eq(holidayCategory.organizationId, organizationId),
					),
				)
				.limit(1),
		);
		if (!category) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Holiday category not found",
					entityType: "holiday_category",
					entityId: categoryId,
				}),
			);
		}
	});
}

function refuseDuplicatePresetLocation(conditions: SQL[], year: number | null | undefined) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [existing] = yield* dbService.query("holidayPresets.checkLocation", () =>
			dbService.db
				.select({ id: holidayPreset.id })
				.from(holidayPreset)
				.where(and(...conditions))
				.limit(1),
		);

		if (existing) {
			return yield* Effect.fail(
				new ConflictError({
					message: year
						? "A preset for this location and year already exists"
						: "A preset for this location already exists",
					conflictType: "duplicate_location",
					details: { existingId: existing.id, year: year ?? null },
				}),
			);
		}
	});
}

function presetAssignmentsQuery(
	db: DatabaseClient,
	conditions: SQL[],
): Promise<PresetAssignmentListItem[]> {
	return db
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
		.where(and(...conditions))
		.orderBy(holidayPresetAssignment.assignmentType, holidayPresetAssignment.createdAt) as Promise<
		PresetAssignmentListItem[]
	>;
}

// ============================================
// PRESET QUERIES
// ============================================

/**
 * The active organization's holiday presets
 */
export const getHolidayPresets = organizationAction(
	{ name: "holidayPresets.list", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("getHolidayPresets", async (): Promise<HolidayPresetListItem[]> => {
					const results = await dbService.db
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
						.where(eq(holidayPreset.organizationId, organizationId))
						.orderBy(holidayPreset.name);

					// Get holiday counts and assignment counts for each preset
					return await Promise.all(
						results.map(async (preset) => {
							const [[holidayCountResult], [assignmentCountResult]] = await Promise.all([
								dbService.db
									.select({ count: sql<number>`count(*)::int` })
									.from(holidayPresetHoliday)
									.where(eq(holidayPresetHoliday.presetId, preset.id)),
								dbService.db
									.select({ count: sql<number>`count(*)::int` })
									.from(holidayPresetAssignment)
									.where(
										and(
											eq(holidayPresetAssignment.organizationId, organizationId),
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
				})
				.pipe(
					Effect.mapError(dbError("Failed to fetch holiday presets", "select", "holiday_preset")),
				);
		}),
);

/**
 * A holiday preset of the active organization with its holidays. A scoped
 * manager sees only presets assigned within their scope.
 */
export const getHolidayPreset = organizationAction(
	{ name: "holidayPresets.get", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: presetId }) =>
		Effect.gen(function* () {
			const preset = yield* findPreset(presetId, organizationId);
			const scope = yield* holidayScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			if (scope.managedEmployeeIds) {
				const presetAssignments = yield* dbService.query("getPresetAssignmentsForScope", () =>
					presetAssignmentsQuery(dbService.db, [
						eq(holidayPresetAssignment.organizationId, organizationId),
						eq(holidayPresetAssignment.presetId, presetId),
						eq(holidayPresetAssignment.isActive, true),
					]),
				);

				if (filterAssignmentsForManagerHolidayScope(presetAssignments, scope).length === 0) {
					return yield* presetNotFound(presetId);
				}
			}

			const holidays = yield* dbService.query("getPresetHolidays", () =>
				dbService.db
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
					.orderBy(holidayPresetHoliday.month, holidayPresetHoliday.day),
			);

			return { preset, holidays } satisfies HolidayPresetDetail;
		}),
);

// ============================================
// PRESET MUTATIONS
// ============================================

/**
 * Create a new holiday preset
 */
export const createHolidayPreset = organizationAction(
	{ name: "holidayPresets.create", requires: "orgAdmin", schema: presetDetailsSchema },
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			yield* refuseDuplicatePresetLocation(
				buildPresetLocationConflictConditions(organizationId, data),
				data.year,
			);

			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("createPreset", async () => {
					const [preset] = await dbService.db
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
							createdBy: actor.userId,
						})
						.returning();
					return preset;
				})
				.pipe(
					Effect.mapError(dbError("Failed to create holiday preset", "insert", "holiday_preset")),
				);
		}),
);

/**
 * Update a holiday preset
 */
export const updateHolidayPreset = organizationAction(
	{
		name: "holidayPresets.update",
		requires: "orgAdmin",
		schema: z.object({ presetId: z.string().min(1), data: presetDetailsSchema }),
	},
	({ actor, organizationId, input: { presetId, data } }) =>
		Effect.gen(function* () {
			yield* findPreset(presetId, organizationId);
			yield* refuseDuplicatePresetLocation(
				buildPresetLocationConflictConditions(organizationId, data, { excludePresetId: presetId }),
				data.year,
			);

			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("updatePreset", async () => {
					const [preset] = await dbService.db
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
							updatedBy: actor.userId,
						})
						.where(
							and(eq(holidayPreset.id, presetId), eq(holidayPreset.organizationId, organizationId)),
						)
						.returning();
					return preset;
				})
				.pipe(
					Effect.mapError(dbError("Failed to update holiday preset", "update", "holiday_preset")),
				);
		}),
);

/**
 * Delete a holiday preset; refused while it has active assignments
 */
export const deleteHolidayPreset = organizationAction(
	{ name: "holidayPresets.delete", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: presetId }) =>
		Effect.gen(function* () {
			yield* findPreset(presetId, organizationId);

			const dbService = yield* DatabaseService;
			const deletedRows = yield* dbService
				.query("deletePreset", () =>
					dbService.db
						.delete(holidayPreset)
						.where(
							and(
								eq(holidayPreset.id, presetId),
								eq(holidayPreset.organizationId, organizationId),
								sql`not exists (
									select 1 from ${holidayPresetAssignment}
									where ${holidayPresetAssignment.presetId} = ${presetId}
									and ${holidayPresetAssignment.isActive} = true
								)`,
							),
						)
						.returning({ id: holidayPreset.id }),
				)
				.pipe(
					Effect.mapError(dbError("Failed to delete holiday preset", "delete", "holiday_preset")),
				);

			if (deletedRows.length === 0) {
				return yield* Effect.fail(
					new ConflictError({
						message: "Cannot delete preset with active assignments",
						conflictType: "preset_has_assignments",
						details: { presetId },
					}),
				);
			}
		}),
);

// ============================================
// PRESET HOLIDAY MUTATIONS
// ============================================

/**
 * Add a holiday to a preset
 */
export const addHolidayToPreset = organizationAction(
	{
		name: "holidayPresets.addHoliday",
		requires: "orgAdmin",
		schema: z.object({ presetId: z.string().min(1), data: presetHolidaySchema }),
	},
	({ organizationId, input: { presetId, data } }) =>
		Effect.gen(function* () {
			yield* findPreset(presetId, organizationId);
			yield* refuseForeignCategory(data.categoryId, organizationId);

			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("createHoliday", async () => {
					const [presetHoliday] = await dbService.db
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
					return presetHoliday;
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to add holiday to preset", "insert", "holiday_preset_holiday"),
					),
				);
		}),
);

/**
 * Bulk add holidays to a preset
 */
export const bulkAddHolidaysToPreset = organizationAction(
	{
		name: "holidayPresets.bulkAddHolidays",
		requires: "orgAdmin",
		schema: bulkPresetHolidaysSchema,
	},
	({ organizationId, input: { presetId, holidays, categoryId } }) =>
		Effect.gen(function* () {
			yield* findPreset(presetId, organizationId);
			yield* refuseForeignCategory(categoryId, organizationId);

			const dbService = yield* DatabaseService;
			return yield* dbService
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

					await dbService.db.insert(holidayPresetHoliday).values(values);
					return { added: values.length };
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to bulk add holidays to preset", "insert", "holiday_preset_holiday"),
					),
				);
		}),
);

/**
 * Delete a holiday from a preset
 */
export const deleteHolidayFromPreset = organizationAction(
	{ name: "holidayPresets.deleteHoliday", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: holidayId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [presetHoliday] = yield* dbService.query("verifyPresetHoliday", () =>
				dbService.db
					.select({ id: holidayPresetHoliday.id })
					.from(holidayPresetHoliday)
					.innerJoin(holidayPreset, eq(holidayPresetHoliday.presetId, holidayPreset.id))
					.where(
						and(
							eq(holidayPresetHoliday.id, holidayId),
							eq(holidayPreset.organizationId, organizationId),
						),
					)
					.limit(1),
			);

			if (!presetHoliday) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Preset holiday not found",
						entityType: "holiday_preset_holiday",
						entityId: holidayId,
					}),
				);
			}

			// Delete (hard delete since it's a preset holiday)
			yield* dbService
				.query("deleteHoliday", async () => {
					await dbService.db
						.delete(holidayPresetHoliday)
						.where(eq(holidayPresetHoliday.id, holidayId));
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to delete holiday from preset", "delete", "holiday_preset_holiday"),
					),
				);
		}),
);

// ============================================
// ASSIGNMENT QUERIES
// ============================================

/**
 * The active organization's preset assignments
 */
export const getPresetAssignments = organizationAction(
	{ name: "holidayPresets.listAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* holidayScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;
			const assignments = yield* dbService
				.query("getAssignments", () =>
					presetAssignmentsQuery(dbService.db, [
						eq(holidayPresetAssignment.organizationId, organizationId),
						eq(holidayPresetAssignment.isActive, true),
					]),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to fetch preset assignments", "select", "holiday_preset_assignment"),
					),
				);

			return filterAssignmentsForManagerHolidayScope(assignments, scope);
		}),
);

// ============================================
// ASSIGNMENT MUTATIONS
// ============================================

/**
 * Create a preset assignment
 */
export const createPresetAssignment = organizationAction(
	{
		name: "holidayPresets.createAssignment",
		requires: "orgAdmin",
		schema: holidayPresetAssignmentFormSchema,
		// A former employee gets no new holiday preset assignment (#1438).
		addsEmployees: (input) => (input.assignmentType === "employee" ? [input.employeeId] : []),
	},
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			yield* findPreset(data.presetId, organizationId);
			const dbService = yield* DatabaseService;

			if (data.assignmentType === "team") {
				const teamId = data.teamId ?? "";
				const [targetTeam] = yield* dbService.query("verifyAssignmentTeam", () =>
					dbService.db
						.select({ id: team.id })
						.from(team)
						.where(and(eq(team.id, teamId), eq(team.organizationId, organizationId)))
						.limit(1),
				);
				if (!targetTeam) {
					return yield* Effect.fail(
						new NotFoundError({ message: "Team not found", entityType: "team", entityId: teamId }),
					);
				}
			}

			if (data.assignmentType === "employee") {
				const employeeId = data.employeeId ?? "";
				const [targetEmployee] = yield* dbService.query("verifyAssignmentEmployee", () =>
					dbService.db
						.select({ id: employee.id })
						.from(employee)
						.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
						.limit(1),
				);
				if (!targetEmployee) {
					return yield* Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: employeeId,
						}),
					);
				}
			}

			// Calculate priority based on assignment type
			const priority =
				data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

			const targetConditions: SQL[] = [
				eq(holidayPresetAssignment.organizationId, organizationId),
				eq(holidayPresetAssignment.assignmentType, data.assignmentType),
				eq(holidayPresetAssignment.isActive, true),
			];

			if (data.assignmentType === "team" && data.teamId) {
				targetConditions.push(eq(holidayPresetAssignment.teamId, data.teamId));
			} else if (data.assignmentType === "employee" && data.employeeId) {
				targetConditions.push(eq(holidayPresetAssignment.employeeId, data.employeeId));
			}

			const existingAssignments = yield* dbService.query("checkExistingRange", () =>
				dbService.db
					.select()
					.from(holidayPresetAssignment)
					.where(and(...targetConditions)),
			);

			const overlappingAssignment = existingAssignments.find((assignment) =>
				assignmentRangesOverlap(
					assignment.effectiveFrom,
					assignment.effectiveUntil,
					data.effectiveFrom,
					data.effectiveUntil,
				),
			);

			if (overlappingAssignment) {
				return yield* Effect.fail(
					new ConflictError({
						message: "An assignment already exists for this target in the selected date range",
						conflictType: "duplicate_assignment_range",
						details: { existingId: overlappingAssignment.id },
					}),
				);
			}

			return yield* dbService
				.query("createAssignment", async () => {
					const [assignment] = await dbService.db
						.insert(holidayPresetAssignment)
						.values({
							presetId: data.presetId,
							organizationId,
							assignmentType: data.assignmentType,
							teamId: data.teamId || null,
							employeeId: data.employeeId || null,
							priority,
							effectiveFrom: data.effectiveFrom || null,
							effectiveUntil: data.effectiveUntil || null,
							isActive: data.isActive ?? true,
							createdBy: actor.userId,
						})
						.returning();
					return assignment;
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to create preset assignment", "insert", "holiday_preset_assignment"),
					),
				);
		}),
);

/**
 * Delete a preset assignment (soft delete)
 */
export const deletePresetAssignment = organizationAction(
	{ name: "holidayPresets.deleteAssignment", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [deletedAssignment] = yield* dbService
				.query("deleteAssignment", () =>
					dbService.db
						.update(holidayPresetAssignment)
						.set({ isActive: false })
						.where(
							and(
								eq(holidayPresetAssignment.id, assignmentId),
								eq(holidayPresetAssignment.organizationId, organizationId),
							),
						)
						.returning({ id: holidayPresetAssignment.id }),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to delete preset assignment", "update", "holiday_preset_assignment"),
					),
				);

			if (!deletedAssignment) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Preset assignment not found",
						entityType: "holiday_preset_assignment",
						entityId: assignmentId,
					}),
				);
			}
		}),
);

// ============================================
// HELPER QUERIES
// ============================================

/**
 * Teams of the active organization for assignment dropdowns
 */
export const getTeamsForAssignment = organizationAction(
	{ name: "holidayPresets.assignmentTeams", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"getTeams",
				(): Promise<TeamListItem[]> =>
					dbService.db
						.select({ id: team.id, name: team.name })
						.from(team)
						.where(eq(team.organizationId, organizationId))
						.orderBy(team.name),
			);
		}),
);

/**
 * Current employees of the active organization for assignment dropdowns
 */
export const getEmployeesForAssignment = organizationAction(
	{ name: "holidayPresets.assignmentEmployees", requires: "scopedManager", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"getEmployees",
				(): Promise<EmployeeListItem[]> =>
					dbService.db
						.select({
							id: employee.id,
							firstName: user.firstName,
							lastName: user.lastName,
							position: employee.position,
						})
						.from(employee)
						.innerJoin(user, eq(employee.userId, user.id))
						.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
						.orderBy(user.firstName, user.lastName),
			);
		}),
);
