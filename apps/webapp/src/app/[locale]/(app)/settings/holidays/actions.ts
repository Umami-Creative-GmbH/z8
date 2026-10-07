"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import {
	employee,
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayCategoryAssignment,
	team,
} from "@/db/schema";
import type { PaginatedParams, PaginatedResponse } from "@/lib/data-table/types";
import { type AnyAppError, ConflictError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
import {
	type AppServices,
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction/ranks";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";
import {
	filterAssignmentsForManagerHolidayScope,
	getScopedHolidayAccessContext,
	type ScopedHolidaySettingsActor,
} from "./holiday-scope";

// Types for holiday list
export interface HolidayListParams extends PaginatedParams {
	categoryId?: string;
}

export interface HolidayWithCategory {
	id: string;
	name: string;
	description: string | null;
	startDate: Date;
	endDate: Date;
	recurrenceType: string;
	recurrenceRule: string | null;
	recurrenceEndDate: Date | null;
	isActive: boolean;
	categoryId: string;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
}

type HolidayAssignmentRecord = {
	id: string;
	holidayId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	holiday: {
		id: string;
		name: string;
		description: string | null;
		startDate: Date;
		endDate: Date;
		recurrenceType: string;
	};
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user?: { firstName: string | null; lastName: string | null } | null;
	} | null;
};

export type HolidayCategoryAssignmentRecord = {
	id: string;
	categoryId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
		user?: { firstName: string | null; lastName: string | null } | null;
	} | null;
};

type HolidayCategoryItem = typeof holidayCategory.$inferSelect;

function runHolidayServerAction<T>(effect: Effect.Effect<T, AnyAppError, AppServices>) {
	return runServerActionSafe(effect);
}

function getVisibleScopedHolidayIds(
	actor: ScopedHolidaySettingsActor,
	organizationId: string,
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
	queryName: string,
) {
	return Effect.gen(function* () {
		if (!manageableTeamIds || !managedEmployeeIds) {
			return null;
		}

		const assignmentRows = (yield* actor.dbService.query(queryName, async () => {
			return await actor.dbService.db.query.holidayAssignment.findMany({
				where: and(
					eq(holidayAssignment.organizationId, organizationId),
					eq(holidayAssignment.isActive, true),
				),
				columns: {
					id: true,
					holidayId: true,
					organizationId: true,
					assignmentType: true,
					teamId: true,
					employeeId: true,
					isActive: true,
					createdAt: true,
				},
			});
		})) as HolidayAssignmentRecord[];

		return [
			...new Set(
				filterAssignmentsForManagerHolidayScope(
					assignmentRows,
					manageableTeamIds,
					managedEmployeeIds,
				).map((assignment) => assignment.holidayId),
			),
		];
	});
}

function sortHolidayRows(
	holidays: HolidayWithCategory[],
	sortBy?: string,
	sortOrder: "asc" | "desc" = "asc",
) {
	const direction = sortOrder === "desc" ? -1 : 1;
	const sorted = [...holidays];

	sorted.sort((left, right) => {
		const leftValue = sortBy === "name" ? left.name.toLowerCase() : left.startDate.getTime();
		const rightValue = sortBy === "name" ? right.name.toLowerCase() : right.startDate.getTime();

		if (leftValue < rightValue) return -1 * direction;
		if (leftValue > rightValue) return 1 * direction;
		return 0;
	});

	return sorted;
}

/**
 * Get all holidays for an organization using Effect pattern
 * Supports pagination, search, and filtering
 */
export async function getHolidays(
	organizationId: string,
	params: HolidayListParams = {},
): Promise<ServerActionResult<PaginatedResponse<HolidayWithCategory>>> {
	const { search, categoryId, limit = 20, offset = 0, sortBy, sortOrder = "asc" } = params;

	const effect = Effect.gen(function* () {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* getScopedHolidayAccessContext(organizationId, "getHolidays:actor");
		const visibleHolidayIds = yield* getVisibleScopedHolidayIds(
			actor,
			organizationId,
			manageableTeamIds,
			managedEmployeeIds,
			"getHolidays:visibleAssignments",
		);

		if (visibleHolidayIds && visibleHolidayIds.length === 0) {
			return { data: [], total: 0, hasMore: false };
		}

		const holidays = (yield* actor.dbService.query("getHolidays", async () => {
				const conditions = [eq(holiday.organizationId, organizationId), eq(holiday.isActive, true)];
				if (visibleHolidayIds) {
					conditions.push(inArray(holiday.id, visibleHolidayIds));
				}

				return await actor.dbService.db.query.holiday.findMany({
					where: and(...conditions),
					with: {
						category: {
							columns: {
								id: true,
								name: true,
								type: true,
								color: true,
							},
						},
					},
				});
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holidays",
						operation: "select",
						table: "holiday",
						cause: error,
					}),
			))) as HolidayWithCategory[];

		const searchQuery = search?.trim().toLowerCase() ?? "";
		const filteredHolidays = sortHolidayRows(
			holidays.filter((currentHoliday) => {
				if (categoryId && currentHoliday.categoryId !== categoryId) {
					return false;
				}

				if (!searchQuery) {
					return true;
				}

				return (
					currentHoliday.name.toLowerCase().includes(searchQuery) ||
					(currentHoliday.description?.toLowerCase().includes(searchQuery) ?? false)
				);
			}),
			sortBy,
			sortOrder,
		);

		const totalResult = filteredHolidays.length;
		const paginatedHolidays = filteredHolidays.slice(offset, offset + limit);

		return {
			data: paginatedHolidays,
			total: totalResult,
			hasMore: offset + paginatedHolidays.length < totalResult,
		};
	});

	return runHolidayServerAction(effect);
}

/**
 * Get all holiday categories for an organization using Effect pattern
 */
export async function getHolidayCategories(
	organizationId: string,
): Promise<ServerActionResult<HolidayCategoryItem[]>> {
	const effect = Effect.gen(function* () {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* getScopedHolidayAccessContext(organizationId, "getHolidayCategories:actor");
		const visibleHolidayIds = yield* getVisibleScopedHolidayIds(
			actor,
			organizationId,
			manageableTeamIds,
			managedEmployeeIds,
			"getHolidayCategories:visibleAssignments",
		);

		if (visibleHolidayIds && visibleHolidayIds.length === 0) {
			return [] satisfies HolidayCategoryItem[];
		}

		const categories = (yield* actor.dbService.query("getHolidayCategories", async () => {
				const conditions = [
					eq(holidayCategory.organizationId, organizationId),
					eq(holidayCategory.isActive, true),
				];

				if (visibleHolidayIds) {
					const visibleHolidays = await actor.dbService.db.query.holiday.findMany({
						where: and(
							eq(holiday.organizationId, organizationId),
							eq(holiday.isActive, true),
							inArray(holiday.id, visibleHolidayIds),
						),
						columns: { categoryId: true },
					});
					const visibleCategoryIds = [...new Set(visibleHolidays.map((item) => item.categoryId))];

					if (visibleCategoryIds.length === 0) {
						return [] satisfies HolidayCategoryItem[];
					}

					conditions.push(inArray(holidayCategory.id, visibleCategoryIds));
				}

				return await actor.dbService.db.query.holidayCategory.findMany({
					where: and(...conditions),
				});
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday categories",
						operation: "select",
						table: "holiday_category",
						cause: error,
					}),
			))) as HolidayCategoryItem[];

		return categories;
	});

	return runHolidayServerAction(effect);
}

/**
 * Delete a holiday using Effect pattern
 */
export async function deleteHoliday(holidayId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "deleteHoliday:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete holidays",
			resource: "holiday",
			action: "delete",
		});

		// Manual submissions read organization holidays under the configuration guard.
		const deleted = yield* actor.dbService.query("deleteHoliday", () =>
				withOrganizationConfigurationMutation(actor.dbService.db, actor.organizationId, (tx) =>
					tx
						.delete(holiday)
						.where(and(eq(holiday.id, holidayId), eq(holiday.organizationId, actor.organizationId)))
						.returning({ id: holiday.id }),
				),
			).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday",
						operation: "delete",
						table: "holiday",
						cause: error,
					}),
			));

		if (deleted.length === 0) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Holiday not found",
					entityType: "holiday",
					entityId: holidayId,
				}),
			);
		}
	});

	return runHolidayServerAction(effect);
}

/**
 * Bulk delete holidays using Effect pattern
 */
export async function bulkDeleteHolidays(
	holidayIds: string[],
): Promise<ServerActionResult<{ deleted: number }>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "bulkDeleteHolidays:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete holidays",
			resource: "holiday",
			action: "bulk_delete",
		});

		const result = yield* actor.dbService.query("bulkDeleteHolidays", async () => {
				// Manual submissions read organization holidays under the configuration guard.
				const deleteResult = await withOrganizationConfigurationMutation(
					actor.dbService.db,
					actor.organizationId,
					(tx) =>
						tx
							.delete(holiday)
							.where(
								and(
									inArray(holiday.id, holidayIds),
									eq(holiday.organizationId, actor.organizationId),
								),
							)
							.returning({ id: holiday.id }),
				);

				return { deleted: deleteResult.length };
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to bulk delete holidays",
						operation: "delete",
						table: "holiday",
						cause: error,
					}),
			));

		return result;
	});

	return runHolidayServerAction(effect);
}

/**
 * Delete a category (soft delete, but check if any holidays use it first) using Effect pattern
 */
export async function deleteCategory(categoryId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "deleteCategory:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete holiday categories",
			resource: "holiday_category",
			action: "delete",
		});

		// Existence, the in-use check and the soft delete share one transaction under
		// the configuration guard that manual submissions read blocking categories under.
		const outcome = yield* actor.dbService.query("deleteCategory", () =>
				withOrganizationConfigurationMutation(actor.dbService.db, actor.organizationId, async (tx) => {
					const [category] = await tx
						.select({ id: holidayCategory.id })
						.from(holidayCategory)
						.where(
							and(
								eq(holidayCategory.id, categoryId),
								eq(holidayCategory.organizationId, actor.organizationId),
							),
						)
						.limit(1);
					if (!category) return "not_found" as const;

					const [holidayUsingCategory] = await tx
						.select({ id: holiday.id })
						.from(holiday)
						.where(
							and(
								eq(holiday.organizationId, actor.organizationId),
								eq(holiday.categoryId, categoryId),
								eq(holiday.isActive, true),
							),
						)
						.limit(1);
					if (holidayUsingCategory) return "in_use" as const;

					await tx
						.update(holidayCategory)
						.set({ isActive: false })
						.where(
							and(
								eq(holidayCategory.id, categoryId),
								eq(holidayCategory.organizationId, actor.organizationId),
							),
						);
					return "deleted" as const;
				}),
			).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete category",
						operation: "update",
						table: "holiday_category",
						cause: error,
					}),
			));

		if (outcome === "not_found") {
			yield* Effect.fail(
				new NotFoundError({
					message: "Category not found",
					entityType: "holiday_category",
					entityId: categoryId,
				}),
			);
		}
		if (outcome === "in_use") {
			yield* Effect.fail(
				new ConflictError({
					message: "Cannot delete category - it is being used by active holidays",
					conflictType: "category_in_use",
					details: { categoryId },
				}),
			);
		}
	});

	return runHolidayServerAction(effect);
}

// ============================================
// HOLIDAY ASSIGNMENTS (Custom holidays to org/team/employee)
// ============================================

/**
 * Get all holiday assignments for an organization
 */
export async function getHolidayAssignments(
	organizationId: string,
): Promise<ServerActionResult<HolidayAssignmentRecord[]>> {
	const effect = Effect.gen(function* () {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* getScopedHolidayAccessContext(organizationId, "getHolidayAssignments:actor");

		const assignments = yield* actor.dbService.query("getHolidayAssignments", async () => {
				return await actor.dbService.db.query.holidayAssignment.findMany({
					where: and(
						eq(holidayAssignment.organizationId, organizationId),
						eq(holidayAssignment.isActive, true),
					),
					with: {
						holiday: {
							columns: {
								id: true,
								name: true,
								description: true,
								startDate: true,
								endDate: true,
								recurrenceType: true,
							},
						},
						team: { columns: { id: true, name: true } },
						employee: {
							columns: { id: true },
							with: { user: { columns: { firstName: true, lastName: true } } },
						},
					},
				});
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday assignments",
						operation: "select",
						table: "holiday_assignment",
						cause: error,
					}),
			));

		const assignmentsWithAuthNames = assignments.map((assignment) => ({
			...assignment,
			employee: assignment.employee
				? {
						id: assignment.employee.id,
						firstName: assignment.employee.user?.firstName ?? null,
						lastName: assignment.employee.user?.lastName ?? null,
						user: assignment.employee.user,
					}
				: null,
		})) satisfies HolidayAssignmentRecord[];

		return filterAssignmentsForManagerHolidayScope(
			assignmentsWithAuthNames,
			manageableTeamIds,
			managedEmployeeIds,
		);
	});

	return runHolidayServerAction(effect);
}

/**
 * Get all holiday category assignments for an organization
 */
export async function getHolidayCategoryAssignments(
	organizationId: string,
): Promise<ServerActionResult<HolidayCategoryAssignmentRecord[]>> {
	const effect = Effect.gen(function* () {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* getScopedHolidayAccessContext(organizationId, "getHolidayCategoryAssignments:actor");

		const assignments = yield* actor.dbService.query("getHolidayCategoryAssignments", async () => {
				return await actor.dbService.db.query.holidayCategoryAssignment.findMany({
					where: and(
						eq(holidayCategoryAssignment.organizationId, organizationId),
						eq(holidayCategoryAssignment.isActive, true),
					),
					with: {
						category: { columns: { id: true, name: true, type: true, color: true } },
						team: { columns: { id: true, name: true } },
						employee: {
							columns: { id: true },
							with: { user: { columns: { firstName: true, lastName: true } } },
						},
					},
				});
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday category assignments",
						operation: "select",
						table: "holiday_category_assignment",
						cause: error,
					}),
			));

		const assignmentsWithAuthNames = assignments.map((assignment) => ({
			...assignment,
			employee: assignment.employee
				? {
						id: assignment.employee.id,
						firstName: assignment.employee.user?.firstName ?? null,
						lastName: assignment.employee.user?.lastName ?? null,
						user: assignment.employee.user,
					}
				: null,
		})) satisfies HolidayCategoryAssignmentRecord[];

		return filterAssignmentsForManagerHolidayScope(
			assignmentsWithAuthNames,
			manageableTeamIds,
			managedEmployeeIds,
		);
	});

	return runHolidayServerAction(effect);
}

/**
 * Create a holiday category assignment
 */
export async function createHolidayCategoryAssignment(data: {
	categoryId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
}): Promise<ServerActionResult<typeof holidayCategoryAssignment.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "createHolidayCategoryAssignment:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can create holiday category assignments",
			resource: "holiday_category_assignment",
			action: "create",
		});

		const [existingCategory] = yield* actor.dbService.query("verifyHolidayCategory", async () => {
			return await actor.dbService.db
				.select()
				.from(holidayCategory)
				.where(
					and(
						eq(holidayCategory.id, data.categoryId),
						eq(holidayCategory.organizationId, actor.organizationId),
						eq(holidayCategory.isActive, true),
					),
				)
				.limit(1);
		});

		if (!existingCategory) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Holiday category not found",
					entityType: "holiday_category",
					entityId: data.categoryId,
				}),
			);
		}

		if (data.assignmentType === "team") {
			const assignmentTeamId = data.teamId;
			if (assignmentTeamId) {
				const [existingTeam] = yield* actor.dbService.query("verifyHolidayCategoryAssignmentTeam", async () => {
					return await actor.dbService.db
						.select()
						.from(team)
						.where(
							and(eq(team.id, assignmentTeamId), eq(team.organizationId, actor.organizationId)),
						)
						.limit(1);
				});

				if (!existingTeam) {
					yield* Effect.fail(
						new NotFoundError({
							message: "Team not found",
							entityType: "team",
							entityId: assignmentTeamId,
						}),
					);
				}
			} else {
				yield* Effect.fail(
					new NotFoundError({
						message: "Team not found",
						entityType: "team",
						entityId: "",
					}),
				);
			}
		}

		if (data.assignmentType === "employee") {
			const assignmentEmployeeId = data.employeeId;
			if (assignmentEmployeeId) {
				const [existingEmployee] = yield* actor.dbService.query("verifyHolidayCategoryAssignmentEmployee", async () => {
					return await actor.dbService.db
						.select()
						.from(employee)
						.where(
							and(
								eq(employee.id, assignmentEmployeeId),
								eq(employee.organizationId, actor.organizationId),
							),
						)
						.limit(1);
				});

				if (!existingEmployee) {
					yield* Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: assignmentEmployeeId,
						}),
					);
				}
			} else {
				yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: "",
					}),
				);
			}
		}

		const newAssignment = yield* actor.dbService.query("createHolidayCategoryAssignment", async () => {
				const [assignment] = await actor.dbService.db
					.insert(holidayCategoryAssignment)
					.values({
						categoryId: data.categoryId,
						organizationId: actor.organizationId,
						assignmentType: data.assignmentType,
						teamId: data.assignmentType === "team" ? (data.teamId ?? null) : null,
						employeeId: data.assignmentType === "employee" ? (data.employeeId ?? null) : null,
						createdBy: actor.session.user.id,
					})
					.returning();

				return assignment;
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create holiday category assignment",
						operation: "insert",
						table: "holiday_category_assignment",
						cause: error,
					}),
			));

		return newAssignment;
	});

	return runHolidayServerAction(effect);
}

/**
 * Delete a holiday category assignment (soft delete)
 */
export async function deleteHolidayCategoryAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "deleteHolidayCategoryAssignment:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete holiday category assignments",
			resource: "holiday_category_assignment",
			action: "delete",
		});

		const updatedAssignments = yield* actor.dbService.query("deleteHolidayCategoryAssignment", async () => {
				return await actor.dbService.db
					.update(holidayCategoryAssignment)
					.set({ isActive: false })
					.where(
						and(
							eq(holidayCategoryAssignment.id, assignmentId),
							eq(holidayCategoryAssignment.organizationId, actor.organizationId),
						),
					)
					.returning({ id: holidayCategoryAssignment.id });
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday category assignment",
						operation: "update",
						table: "holiday_category_assignment",
						cause: error,
					}),
			));

		if (updatedAssignments.length === 0) {
			yield* Effect.fail(
				new NotFoundError({
					message: "Holiday category assignment not found",
					entityType: "holiday_category_assignment",
					entityId: assignmentId,
				}),
			);
		}
	});

	return runHolidayServerAction(effect);
}

/**
 * Create a holiday assignment
 */
export async function createHolidayAssignment(data: {
	holidayId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string;
	employeeId?: string;
}): Promise<ServerActionResult<typeof holidayAssignment.$inferSelect>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "createHolidayAssignment:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can create holiday assignments",
			resource: "holiday_assignment",
			action: "create",
		});

		const _existingHoliday = yield* actor.dbService.query("verifyHoliday", async () => {
				const [h] = await actor.dbService.db
					.select()
					.from(holiday)
					.where(
						and(
							eq(holiday.id, data.holidayId),
							eq(holiday.organizationId, actor.organizationId),
							eq(holiday.isActive, true),
						),
					)
					.limit(1);

				if (!h) {
					throw new Error("Holiday not found");
				}

				return h;
			}).pipe(Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: data.holidayId,
					}),
			));

		const newAssignment = yield* actor.dbService.query("createHolidayAssignment", async () => {
				const [assignment] = await actor.dbService.db
					.insert(holidayAssignment)
					.values({
						holidayId: data.holidayId,
						organizationId: actor.organizationId,
						assignmentType: data.assignmentType,
						teamId: data.teamId || null,
						employeeId: data.employeeId || null,
						createdBy: actor.session.user.id,
					})
					.returning();

				return assignment;
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create holiday assignment",
						operation: "insert",
						table: "holiday_assignment",
						cause: error,
					}),
			));

		return newAssignment;
	});

	return runHolidayServerAction(effect);
}

/**
 * Delete a holiday assignment (soft delete)
 */
export async function deleteHolidayAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({ queryName: "deleteHolidayAssignment:actor" });
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only org admins can delete holiday assignments",
			resource: "holiday_assignment",
			action: "delete",
		});

		const _existingAssignment = yield* actor.dbService.query("verifyAssignment", async () => {
				const [a] = await actor.dbService.db
					.select()
					.from(holidayAssignment)
					.where(
						and(
							eq(holidayAssignment.id, assignmentId),
							eq(holidayAssignment.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!a) {
					throw new Error("Assignment not found");
				}

				return a;
			}).pipe(Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday assignment not found",
						entityType: "holiday_assignment",
						entityId: assignmentId,
					}),
			));

		yield* actor.dbService.query("deleteHolidayAssignment", async () => {
				await actor.dbService.db
					.update(holidayAssignment)
					.set({ isActive: false })
					.where(eq(holidayAssignment.id, assignmentId));
			}).pipe(Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday assignment",
						operation: "update",
						table: "holiday_assignment",
						cause: error,
					}),
			));
	});

	return runHolidayServerAction(effect);
}
