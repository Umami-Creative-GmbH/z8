"use server";

import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import {
	employee,
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayCategoryAssignment,
	team,
} from "@/db/schema";
import type { PaginatedParams, PaginatedResponse } from "@/lib/data-table/types";
import { ConflictError, DatabaseError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { withOrganizationConfigurationMutation } from "@/lib/time-tracking/work-transaction/ranks";
import {
	filterAssignmentsForManagerHolidayScope,
	type HolidayScope,
	holidayScopeOf,
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

const holidayListParamsSchema = z
	.object({
		categoryId: z.string().optional(),
		search: z.string().optional(),
		limit: z.number().int().positive().optional(),
		offset: z.number().int().min(0).optional(),
		sortBy: z.string().optional(),
		sortOrder: z.enum(["asc", "desc"]).optional(),
	})
	.default({});

const assignmentTargetSchema = {
	assignmentType: z.enum(["organization", "team", "employee"]),
	teamId: z.string().optional(),
	employeeId: z.string().optional(),
};

const createHolidayCategoryAssignmentSchema = z.object({
	categoryId: z.string().min(1),
	...assignmentTargetSchema,
});

const createHolidayAssignmentSchema = z.object({
	holidayId: z.string().min(1),
	...assignmentTargetSchema,
});

const idSchema = z.string().min(1);

function dbError(message: string, operation: string, table: string) {
	return (cause: unknown) => new DatabaseError({ message, operation, table, cause });
}

function visibleScopedHolidayIds(organizationId: string, scope: HolidayScope) {
	return Effect.gen(function* () {
		if (!scope.manageableTeamIds || !scope.managedEmployeeIds) {
			return null;
		}

		const dbService = yield* DatabaseService;
		const assignmentRows = yield* dbService.query("holidays.scope.assignments", () =>
			dbService.db.query.holidayAssignment.findMany({
				where: and(
					eq(holidayAssignment.organizationId, organizationId),
					eq(holidayAssignment.isActive, true),
				),
				columns: { holidayId: true, assignmentType: true, teamId: true, employeeId: true },
			}),
		);

		return [
			...new Set(
				filterAssignmentsForManagerHolidayScope(assignmentRows, scope).map(
					(assignment) => assignment.holidayId,
				),
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
 * The active organization's holidays, paginated, searched and filtered. A
 * scoped manager sees those assigned to the organization, their teams or reports.
 */
export const getHolidays = organizationAction(
	{ name: "holidays.list", requires: "scopedManager", schema: holidayListParamsSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { search, categoryId, limit = 20, offset = 0, sortBy, sortOrder = "asc" } = input;
			const scope = yield* holidayScopeOf(actor, organizationId);
			const visibleHolidayIds = yield* visibleScopedHolidayIds(organizationId, scope);

			if (visibleHolidayIds && visibleHolidayIds.length === 0) {
				return { data: [], total: 0, hasMore: false } satisfies PaginatedResponse<HolidayWithCategory>;
			}

			const dbService = yield* DatabaseService;
			const holidays = (yield* dbService
				.query("getHolidays", () => {
					const conditions = [eq(holiday.organizationId, organizationId), eq(holiday.isActive, true)];
					if (visibleHolidayIds) {
						conditions.push(inArray(holiday.id, visibleHolidayIds));
					}

					return dbService.db.query.holiday.findMany({
						where: and(...conditions),
						with: {
							category: {
								columns: { id: true, name: true, type: true, color: true },
							},
						},
					});
				})
				.pipe(
					Effect.mapError(dbError("Failed to fetch holidays", "select", "holiday")),
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
			} satisfies PaginatedResponse<HolidayWithCategory>;
		}),
);

/**
 * The active organization's holiday categories; a scoped manager sees the
 * categories of the holidays they see.
 */
export const getHolidayCategories = organizationAction(
	{ name: "holidays.listCategories", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* holidayScopeOf(actor, organizationId);
			const visibleHolidayIds = yield* visibleScopedHolidayIds(organizationId, scope);

			if (visibleHolidayIds && visibleHolidayIds.length === 0) {
				return [] satisfies HolidayCategoryItem[];
			}

			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("getHolidayCategories", async (): Promise<HolidayCategoryItem[]> => {
					const conditions = [
						eq(holidayCategory.organizationId, organizationId),
						eq(holidayCategory.isActive, true),
					];

					if (visibleHolidayIds) {
						const visibleHolidays = await dbService.db.query.holiday.findMany({
							where: and(
								eq(holiday.organizationId, organizationId),
								eq(holiday.isActive, true),
								inArray(holiday.id, visibleHolidayIds),
							),
							columns: { categoryId: true },
						});
						const visibleCategoryIds = [...new Set(visibleHolidays.map((item) => item.categoryId))];

						if (visibleCategoryIds.length === 0) {
							return [];
						}

						conditions.push(inArray(holidayCategory.id, visibleCategoryIds));
					}

					return await dbService.db.query.holidayCategory.findMany({
						where: and(...conditions),
					});
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to fetch holiday categories", "select", "holiday_category"),
					),
				);
		}),
);

/**
 * Delete a holiday
 */
export const deleteHoliday = organizationAction(
	{ name: "holidays.delete", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: holidayId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			// Manual submissions read organization holidays under the configuration guard.
			const deleted = yield* dbService
				.query("deleteHoliday", () =>
					withOrganizationConfigurationMutation(dbService.db, organizationId, (tx) =>
						tx
							.delete(holiday)
							.where(and(eq(holiday.id, holidayId), eq(holiday.organizationId, organizationId)))
							.returning({ id: holiday.id }),
					),
				)
				.pipe(Effect.mapError(dbError("Failed to delete holiday", "delete", "holiday")));

			if (deleted.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: holidayId,
					}),
				);
			}
		}),
);

/**
 * Bulk delete holidays
 */
export const bulkDeleteHolidays = organizationAction(
	{ name: "holidays.bulkDelete", requires: "orgAdmin", schema: z.array(z.string().min(1)) },
	({ organizationId, input: holidayIds }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService
				.query("bulkDeleteHolidays", async () => {
					// Manual submissions read organization holidays under the configuration guard.
					const deleteResult = await withOrganizationConfigurationMutation(
						dbService.db,
						organizationId,
						(tx) =>
							tx
								.delete(holiday)
								.where(
									and(inArray(holiday.id, holidayIds), eq(holiday.organizationId, organizationId)),
								)
								.returning({ id: holiday.id }),
					);

					return { deleted: deleteResult.length };
				})
				.pipe(Effect.mapError(dbError("Failed to bulk delete holidays", "delete", "holiday")));
		}),
);

/**
 * Delete a category (soft delete, refused while active holidays use it)
 */
export const deleteCategory = organizationAction(
	{ name: "holidays.deleteCategory", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: categoryId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			// Existence, the in-use check and the soft delete share one transaction under
			// the configuration guard that manual submissions read blocking categories under.
			const outcome = yield* dbService
				.query("deleteCategory", () =>
					withOrganizationConfigurationMutation(dbService.db, organizationId, async (tx) => {
						const [category] = await tx
							.select({ id: holidayCategory.id })
							.from(holidayCategory)
							.where(
								and(
									eq(holidayCategory.id, categoryId),
									eq(holidayCategory.organizationId, organizationId),
								),
							)
							.limit(1);
						if (!category) return "not_found" as const;

						const [holidayUsingCategory] = await tx
							.select({ id: holiday.id })
							.from(holiday)
							.where(
								and(
									eq(holiday.organizationId, organizationId),
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
									eq(holidayCategory.organizationId, organizationId),
								),
							);
						return "deleted" as const;
					}),
				)
				.pipe(Effect.mapError(dbError("Failed to delete category", "update", "holiday_category")));

			if (outcome === "not_found") {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Category not found",
						entityType: "holiday_category",
						entityId: categoryId,
					}),
				);
			}
			if (outcome === "in_use") {
				return yield* Effect.fail(
					new ConflictError({
						message: "Cannot delete category - it is being used by active holidays",
						conflictType: "category_in_use",
						details: { categoryId },
					}),
				);
			}
		}),
);

// ============================================
// HOLIDAY ASSIGNMENTS (Custom holidays to org/team/employee)
// ============================================

function withAuthNames<
	T extends {
		employee: { id: string; user: { firstName: string | null; lastName: string | null } | null } | null;
	},
>(assignment: T) {
	return {
		...assignment,
		employee: assignment.employee
			? {
					id: assignment.employee.id,
					firstName: assignment.employee.user?.firstName ?? null,
					lastName: assignment.employee.user?.lastName ?? null,
					user: assignment.employee.user,
				}
			: null,
	};
}

/**
 * The active organization's holiday assignments
 */
export const getHolidayAssignments = organizationAction(
	{ name: "holidays.listAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* holidayScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;
			const assignments = yield* dbService
				.query("getHolidayAssignments", () =>
					dbService.db.query.holidayAssignment.findMany({
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
					}),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to fetch holiday assignments", "select", "holiday_assignment"),
					),
				);

			return filterAssignmentsForManagerHolidayScope(
				assignments.map(withAuthNames) satisfies HolidayAssignmentRecord[],
				scope,
			);
		}),
);

/**
 * The active organization's holiday category assignments
 */
export const getHolidayCategoryAssignments = organizationAction(
	{ name: "holidays.listCategoryAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* holidayScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;
			const assignments = yield* dbService
				.query("getHolidayCategoryAssignments", () =>
					dbService.db.query.holidayCategoryAssignment.findMany({
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
					}),
				)
				.pipe(
					Effect.mapError(
						dbError(
							"Failed to fetch holiday category assignments",
							"select",
							"holiday_category_assignment",
						),
					),
				);

			return filterAssignmentsForManagerHolidayScope(
				assignments.map(withAuthNames) satisfies HolidayCategoryAssignmentRecord[],
				scope,
			);
		}),
);

function teamNotFound(teamId: string) {
	return Effect.fail(new NotFoundError({ message: "Team not found", entityType: "team", entityId: teamId }));
}

function employeeNotFound(employeeId: string) {
	return Effect.fail(
		new NotFoundError({ message: "Employee not found", entityType: "employee", entityId: employeeId }),
	);
}

/**
 * Create a holiday category assignment
 */
export const createHolidayCategoryAssignment = organizationAction(
	{
		name: "holidays.createCategoryAssignment",
		requires: "orgAdmin",
		schema: createHolidayCategoryAssignmentSchema,
		addsEmployees: (input) => (input.assignmentType === "employee" ? [input.employeeId] : []),
	},
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [existingCategory] = yield* dbService.query("verifyHolidayCategory", () =>
				dbService.db
					.select({ id: holidayCategory.id })
					.from(holidayCategory)
					.where(
						and(
							eq(holidayCategory.id, data.categoryId),
							eq(holidayCategory.organizationId, organizationId),
							eq(holidayCategory.isActive, true),
						),
					)
					.limit(1),
			);

			if (!existingCategory) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Holiday category not found",
						entityType: "holiday_category",
						entityId: data.categoryId,
					}),
				);
			}

			if (data.assignmentType === "team") {
				const assignmentTeamId = data.teamId;
				if (!assignmentTeamId) return yield* teamNotFound("");
				const [existingTeam] = yield* dbService.query("verifyHolidayCategoryAssignmentTeam", () =>
					dbService.db
						.select({ id: team.id })
						.from(team)
						.where(and(eq(team.id, assignmentTeamId), eq(team.organizationId, organizationId)))
						.limit(1),
				);
				if (!existingTeam) return yield* teamNotFound(assignmentTeamId);
			}

			if (data.assignmentType === "employee") {
				const assignmentEmployeeId = data.employeeId;
				if (!assignmentEmployeeId) return yield* employeeNotFound("");
				const [existingEmployee] = yield* dbService.query(
					"verifyHolidayCategoryAssignmentEmployee",
					() =>
						dbService.db
							.select({ id: employee.id })
							.from(employee)
							.where(
								and(eq(employee.id, assignmentEmployeeId), eq(employee.organizationId, organizationId)),
							)
							.limit(1),
				);
				if (!existingEmployee) return yield* employeeNotFound(assignmentEmployeeId);
			}

			return yield* dbService
				.query("createHolidayCategoryAssignment", async () => {
					const [assignment] = await dbService.db
						.insert(holidayCategoryAssignment)
						.values({
							categoryId: data.categoryId,
							organizationId,
							assignmentType: data.assignmentType,
							teamId: data.assignmentType === "team" ? (data.teamId ?? null) : null,
							employeeId: data.assignmentType === "employee" ? (data.employeeId ?? null) : null,
							createdBy: actor.userId,
						})
						.returning();

					return assignment;
				})
				.pipe(
					Effect.mapError(
						dbError(
							"Failed to create holiday category assignment",
							"insert",
							"holiday_category_assignment",
						),
					),
				);
		}),
);

/**
 * Delete a holiday category assignment (soft delete)
 */
export const deleteHolidayCategoryAssignment = organizationAction(
	{ name: "holidays.deleteCategoryAssignment", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const updatedAssignments = yield* dbService
				.query("deleteHolidayCategoryAssignment", () =>
					dbService.db
						.update(holidayCategoryAssignment)
						.set({ isActive: false })
						.where(
							and(
								eq(holidayCategoryAssignment.id, assignmentId),
								eq(holidayCategoryAssignment.organizationId, organizationId),
							),
						)
						.returning({ id: holidayCategoryAssignment.id }),
				)
				.pipe(
					Effect.mapError(
						dbError(
							"Failed to delete holiday category assignment",
							"update",
							"holiday_category_assignment",
						),
					),
				);

			if (updatedAssignments.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Holiday category assignment not found",
						entityType: "holiday_category_assignment",
						entityId: assignmentId,
					}),
				);
			}
		}),
);

/**
 * Create a holiday assignment
 */
export const createHolidayAssignment = organizationAction(
	{
		name: "holidays.createAssignment",
		requires: "orgAdmin",
		schema: createHolidayAssignmentSchema,
		// Only an employee of this organization's current roster can be named (#1438).
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input: data }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const [existingHoliday] = yield* dbService.query("verifyHoliday", () =>
				dbService.db
					.select({ id: holiday.id })
					.from(holiday)
					.where(
						and(
							eq(holiday.id, data.holidayId),
							eq(holiday.organizationId, organizationId),
							eq(holiday.isActive, true),
						),
					)
					.limit(1),
			);
			if (!existingHoliday) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Holiday not found",
						entityType: "holiday",
						entityId: data.holidayId,
					}),
				);
			}

			return yield* dbService
				.query("createHolidayAssignment", async () => {
					const [assignment] = await dbService.db
						.insert(holidayAssignment)
						.values({
							holidayId: data.holidayId,
							organizationId,
							assignmentType: data.assignmentType,
							teamId: data.teamId || null,
							employeeId: data.employeeId || null,
							createdBy: actor.userId,
						})
						.returning();

					return assignment;
				})
				.pipe(
					Effect.mapError(
						dbError("Failed to create holiday assignment", "insert", "holiday_assignment"),
					),
				);
		}),
);

/**
 * Delete a holiday assignment (soft delete)
 */
export const deleteHolidayAssignment = organizationAction(
	{ name: "holidays.deleteAssignment", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const updated = yield* dbService
				.query("deleteHolidayAssignment", () =>
					dbService.db
						.update(holidayAssignment)
						.set({ isActive: false })
						.where(
							and(
								eq(holidayAssignment.id, assignmentId),
								eq(holidayAssignment.organizationId, organizationId),
							),
						)
						.returning({ id: holidayAssignment.id }),
				)
				.pipe(
					Effect.mapError(
						dbError("Failed to delete holiday assignment", "update", "holiday_assignment"),
					),
				);

			if (updated.length === 0) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Holiday assignment not found",
						entityType: "holiday_assignment",
						entityId: assignmentId,
					}),
				);
			}
		}),
);
