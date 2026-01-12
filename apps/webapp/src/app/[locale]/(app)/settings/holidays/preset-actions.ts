"use server";

import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
	employee,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
	team,
} from "@/db/schema";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type {
	HolidayPresetAssignmentFormValues,
	HolidayPresetFormValues,
	HolidayPresetHolidayFormValues,
} from "@/lib/holidays/validation";

// Type definitions for return values
type HolidayPresetListItem = {
	id: string;
	name: string;
	description: string | null;
	countryCode: string | null;
	stateCode: string | null;
	regionCode: string | null;
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

// ============================================
// PRESET QUERIES
// ============================================

/**
 * Get all holiday presets for an organization
 */
export async function getHolidayPresets(
	organizationId: string,
): Promise<ServerActionResult<HolidayPresetListItem[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const presets = yield* _(
			dbService.query("getHolidayPresets", async () => {
				const results = await dbService.db
					.select({
						id: holidayPreset.id,
						name: holidayPreset.name,
						description: holidayPreset.description,
						countryCode: holidayPreset.countryCode,
						stateCode: holidayPreset.stateCode,
						regionCode: holidayPreset.regionCode,
						color: holidayPreset.color,
						isActive: holidayPreset.isActive,
						createdAt: holidayPreset.createdAt,
					})
					.from(holidayPreset)
					.where(eq(holidayPreset.organizationId, organizationId))
					.orderBy(holidayPreset.name);

				// Get holiday counts and assignment counts for each preset
				const presetsWithCounts = await Promise.all(
					results.map(async (preset) => {
						const [holidayCountResult] = await dbService.db
							.select({ count: sql<number>`count(*)::int` })
							.from(holidayPresetHoliday)
							.where(eq(holidayPresetHoliday.presetId, preset.id));

						const [assignmentCountResult] = await dbService.db
							.select({ count: sql<number>`count(*)::int` })
							.from(holidayPresetAssignment)
							.where(
								and(
									eq(holidayPresetAssignment.presetId, preset.id),
									eq(holidayPresetAssignment.isActive, true),
								),
							);

						return {
							...preset,
							holidayCount: holidayCountResult?.count ?? 0,
							assignmentCount: assignmentCountResult?.count ?? 0,
						};
					}),
				);

				return presetsWithCounts;
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get a single holiday preset with its holidays
 */
export async function getHolidayPreset(
	presetId: string,
): Promise<ServerActionResult<HolidayPresetDetail>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify organization
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Fetch the preset
		const preset = yield* _(
			dbService.query("getPreset", async () => {
				const [p] = await dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Preset not found",
						entityType: "holiday_preset",
						entityId: presetId,
					}),
			),
		);

		// Fetch holidays
		const holidays = yield* _(
			dbService.query("getPresetHolidays", async () => {
				return await dbService.db
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
			}),
		);

		return { preset, holidays };
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset",
						action: "create",
					}),
				),
			);
		}

		// Check for existing preset with same location
		if (data.countryCode) {
			const existingConditions = [
				eq(holidayPreset.organizationId, organizationId),
				eq(holidayPreset.countryCode, data.countryCode),
			];

			if (data.stateCode) {
				existingConditions.push(eq(holidayPreset.stateCode, data.stateCode));
			} else {
				existingConditions.push(isNull(holidayPreset.stateCode));
			}

			if (data.regionCode) {
				existingConditions.push(eq(holidayPreset.regionCode, data.regionCode));
			} else {
				existingConditions.push(isNull(holidayPreset.regionCode));
			}

			const existing = yield* _(
				dbService.query("checkExisting", async () => {
					const [p] = await dbService.db
						.select()
						.from(holidayPreset)
						.where(and(...existingConditions))
						.limit(1);
					return p;
				}),
			);

			if (existing) {
				yield* _(
					Effect.fail(
						new ConflictError({
							message: "A preset for this location already exists",
							conflictType: "duplicate_location",
							details: { existingId: existing.id },
						}),
					),
				);
			}
		}

		// Create preset
		const newPreset = yield* _(
			dbService.query("createPreset", async () => {
				const [p] = await dbService.db
					.insert(holidayPreset)
					.values({
						organizationId,
						name: data.name,
						description: data.description || null,
						countryCode: data.countryCode || null,
						stateCode: data.stateCode || null,
						regionCode: data.regionCode || null,
						color: data.color || null,
						isActive: data.isActive ?? true,
						createdBy: session.user.id,
					})
					.returning();
				return p;
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Update a holiday preset
 */
export async function updateHolidayPreset(
	presetId: string,
	data: HolidayPresetFormValues,
): Promise<ServerActionResult<typeof holidayPreset.$inferSelect>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset",
						action: "update",
					}),
				),
			);
		}

		// Verify preset exists and belongs to organization
		yield* _(
			dbService.query("verifyPreset", async () => {
				const [p] = await dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Preset not found",
						entityType: "holiday_preset",
						entityId: presetId,
					}),
			),
		);

		// Update preset
		const updatedPreset = yield* _(
			dbService.query("updatePreset", async () => {
				const [p] = await dbService.db
					.update(holidayPreset)
					.set({
						name: data.name,
						description: data.description || null,
						countryCode: data.countryCode || null,
						stateCode: data.stateCode || null,
						regionCode: data.regionCode || null,
						color: data.color || null,
						isActive: data.isActive ?? true,
						updatedBy: session.user.id,
					})
					.where(eq(holidayPreset.id, presetId))
					.returning();
				return p;
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a holiday preset (soft delete)
 */
export async function deleteHolidayPreset(presetId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset",
						action: "delete",
					}),
				),
			);
		}

		// Verify preset exists
		yield* _(
			dbService.query("verifyPreset", async () => {
				const [p] = await dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Preset not found",
						entityType: "holiday_preset",
						entityId: presetId,
					}),
			),
		);

		// Check for active assignments
		const assignmentCount = yield* _(
			dbService.query("checkAssignments", async () => {
				const [result] = await dbService.db
					.select({ count: sql<number>`count(*)::int` })
					.from(holidayPresetAssignment)
					.where(
						and(
							eq(holidayPresetAssignment.presetId, presetId),
							eq(holidayPresetAssignment.isActive, true),
						),
					);
				return result?.count ?? 0;
			}),
		);

		if (assignmentCount > 0) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "Cannot delete preset with active assignments",
						conflictType: "preset_has_assignments",
						details: { assignmentCount },
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("deletePreset", async () => {
				await dbService.db
					.update(holidayPreset)
					.set({ isActive: false, updatedBy: session.user.id })
					.where(eq(holidayPreset.id, presetId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday preset",
						operation: "update",
						table: "holiday_preset",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset_holiday",
						action: "create",
					}),
				),
			);
		}

		// Verify preset exists and belongs to organization
		yield* _(
			dbService.query("verifyPreset", async () => {
				const [p] = await dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Preset not found",
						entityType: "holiday_preset",
						entityId: presetId,
					}),
			),
		);

		// Create holiday
		const newHoliday = yield* _(
			dbService.query("createHoliday", async () => {
				const [h] = await dbService.db
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
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Bulk add holidays to a preset
 */
export async function bulkAddHolidaysToPreset(
	presetId: string,
	holidays: Omit<HolidayPresetHolidayFormValues, "categoryId">[],
	categoryId?: string,
): Promise<ServerActionResult<{ added: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset_holiday",
						action: "create",
					}),
				),
			);
		}

		// Verify preset exists
		yield* _(
			dbService.query("verifyPreset", async () => {
				const [p] = await dbService.db
					.select()
					.from(holidayPreset)
					.where(
						and(
							eq(holidayPreset.id, presetId),
							eq(holidayPreset.organizationId, employeeRecord.organizationId),
						),
					)
					.limit(1);

				if (!p) throw new Error("Preset not found");
				return p;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Preset not found",
						entityType: "holiday_preset",
						entityId: presetId,
					}),
			),
		);

		// Bulk insert holidays
		const result = yield* _(
			dbService.query("bulkInsert", async () => {
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
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a holiday from a preset
 */
export async function deleteHolidayFromPreset(
	holidayId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset_holiday",
						action: "delete",
					}),
				),
			);
		}

		// Delete (hard delete since it's a preset holiday)
		yield* _(
			dbService.query("deleteHoliday", async () => {
				await dbService.db
					.delete(holidayPresetHoliday)
					.where(eq(holidayPresetHoliday.id, holidayId));
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const assignments = yield* _(
			dbService.query("getAssignments", async () => {
				return await dbService.db
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
							firstName: employee.firstName,
							lastName: employee.lastName,
						},
					})
					.from(holidayPresetAssignment)
					.innerJoin(holidayPreset, eq(holidayPresetAssignment.presetId, holidayPreset.id))
					.leftJoin(team, eq(holidayPresetAssignment.teamId, team.id))
					.leftJoin(employee, eq(holidayPresetAssignment.employeeId, employee.id))
					.where(
						and(
							eq(holidayPresetAssignment.organizationId, organizationId),
							eq(holidayPresetAssignment.isActive, true),
						),
					)
					.orderBy(holidayPresetAssignment.assignmentType, holidayPresetAssignment.createdAt);
			}),
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

		return assignments;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset_assignment",
						action: "create",
					}),
				),
			);
		}

		// Calculate priority based on assignment type
		const priority =
			data.assignmentType === "employee" ? 2 : data.assignmentType === "team" ? 1 : 0;

		// Check for existing assignment based on type
		const existingConditions: SQL[] = [
			eq(holidayPresetAssignment.organizationId, organizationId),
			eq(holidayPresetAssignment.isActive, true),
		];

		if (data.assignmentType === "organization") {
			existingConditions.push(eq(holidayPresetAssignment.assignmentType, "organization"));
		} else if (data.assignmentType === "team" && data.teamId) {
			existingConditions.push(eq(holidayPresetAssignment.teamId, data.teamId));
		} else if (data.assignmentType === "employee" && data.employeeId) {
			existingConditions.push(eq(holidayPresetAssignment.employeeId, data.employeeId));
		}

		const existing = yield* _(
			dbService.query("checkExisting", async () => {
				const [a] = await dbService.db
					.select()
					.from(holidayPresetAssignment)
					.where(and(...existingConditions))
					.limit(1);
				return a;
			}),
		);

		if (existing) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "An assignment already exists for this target",
						conflictType: "duplicate_assignment",
						details: { existingId: existing.id },
					}),
				),
			);
		}

		// Create assignment
		const newAssignment = yield* _(
			dbService.query("createAssignment", async () => {
				const [a] = await dbService.db
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
						createdBy: session.user.id,
					})
					.returning();
				return a;
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Delete a preset assignment
 */
export async function deletePresetAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee to verify admin role
		const employeeRecord = yield* _(
			dbService.query("getEmployeeRecord", async () => {
				const [emp] = await dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1);

				if (!emp) throw new Error("Employee not found");
				return emp;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		// Check admin role
		if (employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required",
						userId: session.user.id,
						resource: "holiday_preset_assignment",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete
		yield* _(
			dbService.query("deleteAssignment", async () => {
				await dbService.db
					.update(holidayPresetAssignment)
					.set({ isActive: false })
					.where(eq(holidayPresetAssignment.id, assignmentId));
			}),
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
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
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
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const teams = yield* _(
			dbService.query("getTeams", async () => {
				return await dbService.db
					.select({
						id: team.id,
						name: team.name,
					})
					.from(team)
					.where(eq(team.organizationId, organizationId))
					.orderBy(team.name);
			}),
		);

		return teams;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Get employees for assignment dropdown
 */
export async function getEmployeesForAssignment(
	organizationId: string,
): Promise<ServerActionResult<EmployeeListItem[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const employees = yield* _(
			dbService.query("getEmployees", async () => {
				return await dbService.db
					.select({
						id: employee.id,
						firstName: employee.firstName,
						lastName: employee.lastName,
						position: employee.position,
					})
					.from(employee)
					.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
					.orderBy(employee.firstName, employee.lastName);
			}),
		);

		return employees;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
