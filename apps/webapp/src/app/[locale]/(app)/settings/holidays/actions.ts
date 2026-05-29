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
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
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

function runHolidayServerAction<T>(effect: Effect.Effect<T, AnyAppError, never>) {
	return runServerActionSafe(effect);
}

function getVisibleScopedHolidayIds(
	actor: ScopedHolidaySettingsActor,
	organizationId: string,
	manageableTeamIds: Set<string> | null,
	managedEmployeeIds: Set<string> | null,
	queryName: string,
) {
	return Effect.gen(function* (_) {
		if (!manageableTeamIds || !managedEmployeeIds) {
			return null;
		}

		const assignmentRows = (yield* _(
			actor.dbService.query(queryName, async () => {
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
			}),
		)) as HolidayAssignmentRecord[];

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

	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedHolidayAccessContext(organizationId, "getHolidays:actor"),
		);
		const visibleHolidayIds = yield* _(
			getVisibleScopedHolidayIds(
				actor,
				organizationId,
				manageableTeamIds,
				managedEmployeeIds,
				"getHolidays:visibleAssignments",
			),
		);

		if (visibleHolidayIds && visibleHolidayIds.length === 0) {
			return { data: [], total: 0, hasMore: false };
		}

		const holidays = (yield* _(
			actor.dbService.query("getHolidays", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holidays",
						operation: "select",
						table: "holiday",
						cause: error,
					}),
			),
		)) as HolidayWithCategory[];

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
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Get all holiday categories for an organization using Effect pattern
 */
export async function getHolidayCategories(
	organizationId: string,
): Promise<ServerActionResult<HolidayCategoryItem[]>> {
	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedHolidayAccessContext(organizationId, "getHolidayCategories:actor"),
		);
		const visibleHolidayIds = yield* _(
			getVisibleScopedHolidayIds(
				actor,
				organizationId,
				manageableTeamIds,
				managedEmployeeIds,
				"getHolidayCategories:visibleAssignments",
			),
		);

		if (visibleHolidayIds && visibleHolidayIds.length === 0) {
			return [] satisfies HolidayCategoryItem[];
		}

		const categories = (yield* _(
			actor.dbService.query("getHolidayCategories", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday categories",
						operation: "select",
						table: "holiday_category",
						cause: error,
					}),
			),
		)) as HolidayCategoryItem[];

		return categories;
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Delete a holiday using Effect pattern
 */
export async function deleteHoliday(holidayId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "deleteHoliday:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can delete holidays",
				resource: "holiday",
				action: "delete",
			}),
		);

		const _existingHoliday = yield* _(
			actor.dbService.query("verifyHoliday", async () => {
				const [h] = await actor.dbService.db
					.select()
					.from(holiday)
					.where(and(eq(holiday.id, holidayId), eq(holiday.organizationId, actor.organizationId)))
					.limit(1);

				if (!h) {
					throw new Error("Holiday not found");
				}

				return h;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: holidayId,
					}),
			),
		);

		yield* _(
			actor.dbService.query("deleteHoliday", async () => {
				await actor.dbService.db
					.delete(holiday)
					.where(and(eq(holiday.id, holidayId), eq(holiday.organizationId, actor.organizationId)));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday",
						operation: "delete",
						table: "holiday",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Bulk delete holidays using Effect pattern
 */
export async function bulkDeleteHolidays(
	holidayIds: string[],
): Promise<ServerActionResult<{ deleted: number }>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "bulkDeleteHolidays:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can delete holidays",
				resource: "holiday",
				action: "bulk_delete",
			}),
		);

		const result = yield* _(
			actor.dbService.query("bulkDeleteHolidays", async () => {
				const deleteResult = await actor.dbService.db
					.delete(holiday)
					.where(
						and(inArray(holiday.id, holidayIds), eq(holiday.organizationId, actor.organizationId)),
					)
					.returning({ id: holiday.id });

				return { deleted: deleteResult.length };
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to bulk delete holidays",
						operation: "delete",
						table: "holiday",
						cause: error,
					}),
			),
		);

		return result;
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Delete a category (soft delete, but check if any holidays use it first) using Effect pattern
 */
export async function deleteCategory(categoryId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "deleteCategory:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can delete holiday categories",
				resource: "holiday_category",
				action: "delete",
			}),
		);

		const _existingCategory = yield* _(
			actor.dbService.query("verifyCategory", async () => {
				const [cat] = await actor.dbService.db
					.select()
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, categoryId),
							eq(holidayCategory.organizationId, actor.organizationId),
						),
					)
					.limit(1);

				if (!cat) {
					throw new Error("Category not found");
				}

				return cat;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Category not found",
						entityType: "holiday_category",
						entityId: categoryId,
					}),
			),
		);

		const holidaysUsingCategory = yield* _(
			actor.dbService.query("checkHolidaysUsingCategory", async () => {
				return await actor.dbService.db
					.select()
					.from(holiday)
					.where(and(eq(holiday.categoryId, categoryId), eq(holiday.isActive, true)))
					.limit(1);
			}),
		);

		if (holidaysUsingCategory.length > 0) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "Cannot delete category - it is being used by active holidays",
						conflictType: "category_in_use",
						details: { categoryId, holidayCount: holidaysUsingCategory.length },
					}),
				),
			);
		}

		yield* _(
			actor.dbService.query("deleteCategory", async () => {
				await actor.dbService.db
					.update(holidayCategory)
					.set({ isActive: false })
					.where(eq(holidayCategory.id, categoryId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete category",
						operation: "update",
						table: "holiday_category",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

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
	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedHolidayAccessContext(organizationId, "getHolidayAssignments:actor"),
		);

		const assignments = yield* _(
			actor.dbService.query("getHolidayAssignments", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday assignments",
						operation: "select",
						table: "holiday_assignment",
						cause: error,
					}),
			),
		);

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
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Get all holiday category assignments for an organization
 */
export async function getHolidayCategoryAssignments(
	organizationId: string,
): Promise<ServerActionResult<HolidayCategoryAssignmentRecord[]>> {
	const effect = Effect.gen(function* (_) {
		const { actor, managedEmployeeIds, manageableTeamIds } = yield* _(
			getScopedHolidayAccessContext(organizationId, "getHolidayCategoryAssignments:actor"),
		);

		const assignments = yield* _(
			actor.dbService.query("getHolidayCategoryAssignments", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to fetch holiday category assignments",
						operation: "select",
						table: "holiday_category_assignment",
						cause: error,
					}),
			),
		);

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
	}).pipe(Effect.provide(AppLayer));

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
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "createHolidayCategoryAssignment:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can create holiday category assignments",
				resource: "holiday_category_assignment",
				action: "create",
			}),
		);

		const [existingCategory] = yield* _(
			actor.dbService.query("verifyHolidayCategory", async () => {
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
			}),
		);

		if (!existingCategory) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Holiday category not found",
						entityType: "holiday_category",
						entityId: data.categoryId,
					}),
				),
			);
		}

		if (data.assignmentType === "team") {
			const assignmentTeamId = data.teamId;
			if (assignmentTeamId) {
				const [existingTeam] = yield* _(
					actor.dbService.query("verifyHolidayCategoryAssignmentTeam", async () => {
						return await actor.dbService.db
							.select()
							.from(team)
							.where(
								and(eq(team.id, assignmentTeamId), eq(team.organizationId, actor.organizationId)),
							)
							.limit(1);
					}),
				);

				if (!existingTeam) {
					yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Team not found",
								entityType: "team",
								entityId: assignmentTeamId,
							}),
						),
					);
				}
			} else {
				yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Team not found",
							entityType: "team",
							entityId: "",
						}),
					),
				);
			}
		}

		if (data.assignmentType === "employee") {
			const assignmentEmployeeId = data.employeeId;
			if (assignmentEmployeeId) {
				const [existingEmployee] = yield* _(
					actor.dbService.query("verifyHolidayCategoryAssignmentEmployee", async () => {
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
					}),
				);

				if (!existingEmployee) {
					yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Employee not found",
								entityType: "employee",
								entityId: assignmentEmployeeId,
							}),
						),
					);
				}
			} else {
				yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Employee not found",
							entityType: "employee",
							entityId: "",
						}),
					),
				);
			}
		}

		const newAssignment = yield* _(
			actor.dbService.query("createHolidayCategoryAssignment", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create holiday category assignment",
						operation: "insert",
						table: "holiday_category_assignment",
						cause: error,
					}),
			),
		);

		return newAssignment;
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Delete a holiday category assignment (soft delete)
 */
export async function deleteHolidayCategoryAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteHolidayCategoryAssignment:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can delete holiday category assignments",
				resource: "holiday_category_assignment",
				action: "delete",
			}),
		);

		const updatedAssignments = yield* _(
			actor.dbService.query("deleteHolidayCategoryAssignment", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday category assignment",
						operation: "update",
						table: "holiday_category_assignment",
						cause: error,
					}),
			),
		);

		if (updatedAssignments.length === 0) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Holiday category assignment not found",
						entityType: "holiday_category_assignment",
						entityId: assignmentId,
					}),
				),
			);
		}
	}).pipe(Effect.provide(AppLayer));

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
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "createHolidayAssignment:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can create holiday assignments",
				resource: "holiday_assignment",
				action: "create",
			}),
		);

		const _existingHoliday = yield* _(
			actor.dbService.query("verifyHoliday", async () => {
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
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: data.holidayId,
					}),
			),
		);

		const newAssignment = yield* _(
			actor.dbService.query("createHolidayAssignment", async () => {
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
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to create holiday assignment",
						operation: "insert",
						table: "holiday_assignment",
						cause: error,
					}),
			),
		);

		return newAssignment;
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}

/**
 * Delete a holiday assignment (soft delete)
 */
export async function deleteHolidayAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(
			getEmployeeSettingsActorContext({ queryName: "deleteHolidayAssignment:actor" }),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can delete holiday assignments",
				resource: "holiday_assignment",
				action: "delete",
			}),
		);

		const _existingAssignment = yield* _(
			actor.dbService.query("verifyAssignment", async () => {
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
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Holiday assignment not found",
						entityType: "holiday_assignment",
						entityId: assignmentId,
					}),
			),
		);

		yield* _(
			actor.dbService.query("deleteHolidayAssignment", async () => {
				await actor.dbService.db
					.update(holidayAssignment)
					.set({ isActive: false })
					.where(eq(holidayAssignment.id, assignmentId));
			}),
			Effect.mapError(
				(error) =>
					new DatabaseError({
						message: "Failed to delete holiday assignment",
						operation: "update",
						table: "holiday_assignment",
						cause: error,
					}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runHolidayServerAction(effect);
}
