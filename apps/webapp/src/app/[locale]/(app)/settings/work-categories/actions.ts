"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Effect } from "effect";
import {
	employee,
	team,
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
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

// ============================================
// Type definitions
// ============================================

type WorkCategorySetListItem = {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date;
	categoryCount: number;
	assignmentCount: number;
};

// Org-level category item (no setId, no sortOrder)
type OrganizationCategoryItem = {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	factor: string;
	color: string | null;
	isActive: boolean;
	createdAt: Date;
	usedInSetsCount: number;
};

// Category item within a set (includes sortOrder from junction)
type SetCategoryItem = {
	id: string;
	name: string;
	description: string | null;
	factor: string;
	color: string | null;
	sortOrder: number;
	isActive: boolean;
};

type WorkCategorySetDetail = {
	set: typeof workCategorySet.$inferSelect;
	categories: SetCategoryItem[];
};

type SetAssignmentListItem = {
	id: string;
	setId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	set: {
		id: string;
		name: string;
		description: string | null;
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
// Input types
// ============================================

interface CreateWorkCategorySetInput {
	organizationId: string;
	name: string;
	description?: string | null;
	categoryIds?: string[]; // Optional initial categories
}

interface UpdateWorkCategorySetInput {
	setId: string;
	name?: string;
	description?: string | null;
}

interface CreateOrganizationCategoryInput {
	organizationId: string;
	name: string;
	description?: string | null;
	factor: string;
	color?: string | null;
}

interface UpdateOrganizationCategoryInput {
	categoryId: string;
	name?: string;
	description?: string | null;
	factor?: string;
	color?: string | null;
}

interface CreateSetAssignmentInput {
	setId: string;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId?: string | null;
	employeeId?: string | null;
	effectiveFrom?: Date | null;
	effectiveUntil?: Date | null;
}

// ============================================
// ORGANIZATION CATEGORY QUERIES
// ============================================

/**
 * Get all work categories for an organization (org-level, independent of sets)
 */
export async function getOrganizationCategories(
	organizationId: string,
): Promise<ServerActionResult<OrganizationCategoryItem[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const categories = yield* _(
			dbService.query("getOrganizationCategories", async () => {
				const results = await dbService.db
					.select({
						id: workCategory.id,
						organizationId: workCategory.organizationId,
						name: workCategory.name,
						description: workCategory.description,
						factor: workCategory.factor,
						color: workCategory.color,
						isActive: workCategory.isActive,
						createdAt: workCategory.createdAt,
					})
					.from(workCategory)
					.where(
						and(eq(workCategory.organizationId, organizationId), eq(workCategory.isActive, true)),
					)
					.orderBy(asc(workCategory.name));

				// Get usage count for each category
				const categoriesWithUsage = await Promise.all(
					results.map(async (cat) => {
						const [usageResult] = await dbService.db
							.select({ count: sql<number>`count(*)::int` })
							.from(workCategorySetCategory)
							.where(eq(workCategorySetCategory.categoryId, cat.id));

						return {
							...cat,
							usedInSetsCount: usageResult?.count ?? 0,
						};
					}),
				);

				return categoriesWithUsage;
			}),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch organization categories",
						operation: "select",
						table: "work_category",
					}),
			),
		);

		return categories;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// ORGANIZATION CATEGORY MUTATIONS
// ============================================

/**
 * Create a new org-level work category
 */
export async function createOrganizationCategory(
	input: CreateOrganizationCategoryInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee record not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to create work categories",
						userId: session.user.id,
						resource: "work_category",
						action: "create",
					}),
				),
			);
		}

		// Validate factor is within range
		const factor = parseFloat(input.factor);
		if (Number.isNaN(factor) || factor < 0 || factor > 2) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: "Factor must be between 0 and 2",
						conflictType: "invalid_factor",
					}),
				),
			);
		}

		// Check for existing category with same name
		const [existing] = yield* _(
			dbService.query("checkExistingCategory", async () =>
				dbService.db
					.select({ id: workCategory.id })
					.from(workCategory)
					.where(
						and(
							eq(workCategory.organizationId, input.organizationId),
							eq(workCategory.name, input.name),
							eq(workCategory.isActive, true),
						),
					)
					.limit(1),
			),
		);

		if (existing) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: `A category named "${input.name}" already exists`,
						conflictType: "duplicate_name",
					}),
				),
			);
		}

		// Create the category
		const [created] = yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.insert(workCategory)
						.values({
							organizationId: input.organizationId,
							name: input.name,
							description: input.description ?? null,
							factor: input.factor,
							color: input.color ?? null,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning(),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to create work category",
						operation: "insert",
						table: "work_category",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		revalidatePath("/settings/work-categories");

		return { id: created.id };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Update an org-level work category
 */
export async function updateOrganizationCategory(
	input: UpdateOrganizationCategoryInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to update work categories",
						userId: session.user.id,
						resource: "work_category",
						action: "update",
					}),
				),
			);
		}

		// Validate factor if provided
		if (input.factor !== undefined) {
			const factor = parseFloat(input.factor);
			if (Number.isNaN(factor) || factor < 0 || factor > 2) {
				yield* _(
					Effect.fail(
						new ConflictError({
							message: "Factor must be between 0 and 2",
							conflictType: "invalid_factor",
						}),
					),
				);
			}
		}

		// Update the category
		const [updated] = yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategory)
						.set({
							...(input.name !== undefined && { name: input.name }),
							...(input.description !== undefined && { description: input.description }),
							...(input.factor !== undefined && { factor: input.factor }),
							...(input.color !== undefined && { color: input.color }),
							updatedBy: session.user.id,
						})
						.where(eq(workCategory.id, input.categoryId))
						.returning(),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to update work category",
						operation: "update",
						table: "work_category",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		if (!updated) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category not found",
						entityType: "work_category",
						entityId: input.categoryId,
					}),
				),
			);
		}

		revalidatePath("/settings/work-categories");

		return { id: updated.id };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete an org-level work category (soft delete)
 */
export async function deleteOrganizationCategory(
	categoryId: string,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to delete work categories",
						userId: session.user.id,
						resource: "work_category",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete the category
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategory)
						.set({ isActive: false, updatedBy: session.user.id })
						.where(eq(workCategory.id, categoryId)),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to delete work category",
						operation: "update",
						table: "work_category",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		// Remove from all sets (delete junction entries)
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.delete(workCategorySetCategory)
						.where(eq(workCategorySetCategory.categoryId, categoryId)),
				catch: () =>
					new DatabaseError({
						message: "Failed to remove category from sets",
						operation: "delete",
						table: "work_category_set_category",
					}),
			}),
		);

		revalidatePath("/settings/work-categories");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// CATEGORY SET QUERIES
// ============================================

/**
 * Get all work category sets for an organization
 */
export async function getWorkCategorySets(
	organizationId: string,
): Promise<ServerActionResult<WorkCategorySetListItem[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const sets = yield* _(
			dbService.query("getWorkCategorySets", async () => {
				const results = await dbService.db
					.select({
						id: workCategorySet.id,
						name: workCategorySet.name,
						description: workCategorySet.description,
						isActive: workCategorySet.isActive,
						createdAt: workCategorySet.createdAt,
					})
					.from(workCategorySet)
					.where(
						and(
							eq(workCategorySet.organizationId, organizationId),
							eq(workCategorySet.isActive, true),
						),
					)
					.orderBy(asc(workCategorySet.name));

				// Get category counts and assignment counts for each set
				const setsWithCounts = await Promise.all(
					results.map(async (set) => {
						// Count categories through junction table
						const [categoryCountResult] = await dbService.db
							.select({ count: sql<number>`count(*)::int` })
							.from(workCategorySetCategory)
							.innerJoin(
								workCategory,
								and(
									eq(workCategorySetCategory.categoryId, workCategory.id),
									eq(workCategory.isActive, true),
								),
							)
							.where(eq(workCategorySetCategory.setId, set.id));

						const [assignmentCountResult] = await dbService.db
							.select({ count: sql<number>`count(*)::int` })
							.from(workCategorySetAssignment)
							.where(
								and(
									eq(workCategorySetAssignment.setId, set.id),
									eq(workCategorySetAssignment.isActive, true),
								),
							);

						return {
							...set,
							categoryCount: categoryCountResult?.count ?? 0,
							assignmentCount: assignmentCountResult?.count ?? 0,
						};
					}),
				);

				return setsWithCounts;
			}),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch work category sets",
						operation: "select",
						table: "work_category_set",
					}),
			),
		);

		return sets;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get a work category set with all its categories (via junction table)
 */
export async function getWorkCategorySetDetail(
	setId: string,
): Promise<ServerActionResult<WorkCategorySetDetail>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const [set] = yield* _(
			dbService.query("getWorkCategorySet", async () =>
				dbService.db.select().from(workCategorySet).where(eq(workCategorySet.id, setId)).limit(1),
			),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch work category set",
						operation: "select",
						table: "work_category_set",
					}),
			),
		);

		if (!set) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category set not found",
						entityType: "work_category_set",
						entityId: setId,
					}),
				),
			);
			// TypeScript doesn't know yield* Effect.fail never returns
			throw new Error("unreachable");
		}

		// Get categories through junction table
		const categories = yield* _(
			dbService.query("getSetCategories", async () =>
				dbService.db
					.select({
						id: workCategory.id,
						name: workCategory.name,
						description: workCategory.description,
						factor: workCategory.factor,
						color: workCategory.color,
						isActive: workCategory.isActive,
						sortOrder: workCategorySetCategory.sortOrder,
					})
					.from(workCategorySetCategory)
					.innerJoin(workCategory, eq(workCategorySetCategory.categoryId, workCategory.id))
					.where(and(eq(workCategorySetCategory.setId, setId), eq(workCategory.isActive, true)))
					.orderBy(asc(workCategorySetCategory.sortOrder), asc(workCategory.name)),
			),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch set categories",
						operation: "select",
						table: "work_category_set_category",
					}),
			),
		);

		return { set, categories };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// CATEGORY SET MUTATIONS
// ============================================

/**
 * Create a new work category set
 */
export async function createWorkCategorySet(
	input: CreateWorkCategorySetInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee record not found",
						entityType: "employee",
						entityId: session.user.id,
					}),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to create work category sets",
						userId: session.user.id,
						resource: "work_category_set",
						action: "create",
					}),
				),
			);
		}

		// Check for existing set with same name
		const [existing] = yield* _(
			dbService.query("checkExistingSet", async () =>
				dbService.db
					.select({ id: workCategorySet.id })
					.from(workCategorySet)
					.where(
						and(
							eq(workCategorySet.organizationId, input.organizationId),
							eq(workCategorySet.name, input.name),
							eq(workCategorySet.isActive, true),
						),
					)
					.limit(1),
			),
		);

		if (existing) {
			yield* _(
				Effect.fail(
					new ConflictError({
						message: `A work category set named "${input.name}" already exists`,
						conflictType: "duplicate_name",
					}),
				),
			);
		}

		// Create the set
		const [created] = yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.insert(workCategorySet)
						.values({
							organizationId: input.organizationId,
							name: input.name,
							description: input.description ?? null,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning(),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to create work category set",
						operation: "insert",
						table: "work_category_set",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		// If initial category IDs provided, add them to the set
		if (input.categoryIds && input.categoryIds.length > 0) {
			yield* _(
				Effect.tryPromise({
					try: async () => {
						const junctionEntries = input.categoryIds!.map((categoryId, index) => ({
							setId: created.id,
							categoryId,
							sortOrder: index,
						}));
						return dbService.db.insert(workCategorySetCategory).values(junctionEntries);
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to add categories to set",
							operation: "insert",
							table: "work_category_set_category",
							cause: error instanceof Error ? error : undefined,
						}),
				}),
			);
		}

		revalidatePath("/settings/work-categories");

		return { id: created.id };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Update a work category set
 */
export async function updateWorkCategorySet(
	input: UpdateWorkCategorySetInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to update work category sets",
						userId: session.user.id,
						resource: "work_category_set",
						action: "update",
					}),
				),
			);
		}

		// Update the set
		const [updated] = yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategorySet)
						.set({
							name: input.name,
							description: input.description,
							updatedBy: session.user.id,
						})
						.where(eq(workCategorySet.id, input.setId))
						.returning(),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to update work category set",
						operation: "update",
						table: "work_category_set",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		if (!updated) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category set not found",
						entityType: "work_category_set",
						entityId: input.setId,
					}),
				),
			);
		}

		revalidatePath("/settings/work-categories");

		return { id: updated.id };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete a work category set (soft delete)
 */
export async function deleteWorkCategorySet(
	setId: string,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to delete work category sets",
						userId: session.user.id,
						resource: "work_category_set",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete the set
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategorySet)
						.set({ isActive: false, updatedBy: session.user.id })
						.where(eq(workCategorySet.id, setId)),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to delete work category set",
						operation: "update",
						table: "work_category_set",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		// Also soft delete all assignments for this set
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategorySetAssignment)
						.set({ isActive: false })
						.where(eq(workCategorySetAssignment.setId, setId)),
				catch: () =>
					new DatabaseError({
						message: "Failed to delete set assignments",
						operation: "update",
						table: "work_category_set_assignment",
					}),
			}),
		);

		// Remove junction table entries
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.delete(workCategorySetCategory)
						.where(eq(workCategorySetCategory.setId, setId)),
				catch: () =>
					new DatabaseError({
						message: "Failed to remove set categories",
						operation: "delete",
						table: "work_category_set_category",
					}),
			}),
		);

		revalidatePath("/settings/work-categories");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Update which categories belong to a set (replace all)
 */
export async function updateSetCategories(
	setId: string,
	categoryIds: string[],
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to update set categories",
						userId: session.user.id,
						resource: "work_category_set_category",
						action: "update",
					}),
				),
			);
		}

		// Delete existing junction entries
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.delete(workCategorySetCategory)
						.where(eq(workCategorySetCategory.setId, setId)),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to clear set categories",
						operation: "delete",
						table: "work_category_set_category",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		// Insert new junction entries with order
		if (categoryIds.length > 0) {
			yield* _(
				Effect.tryPromise({
					try: async () => {
						const junctionEntries = categoryIds.map((categoryId, index) => ({
							setId,
							categoryId,
							sortOrder: index,
						}));
						return dbService.db.insert(workCategorySetCategory).values(junctionEntries);
					},
					catch: (error) =>
						new DatabaseError({
							message: "Failed to add categories to set",
							operation: "insert",
							table: "work_category_set_category",
							cause: error instanceof Error ? error : undefined,
						}),
				}),
			);
		}

		revalidatePath("/settings/work-categories");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Reorder categories within a set (updates sortOrder in junction table)
 */
export async function reorderSetCategories(
	setId: string,
	categoryIds: string[],
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to reorder categories",
						userId: session.user.id,
						resource: "work_category_set_category",
						action: "update",
					}),
				),
			);
		}

		// Update sort order for each category in the junction table
		yield* _(
			Effect.tryPromise({
				try: async () => {
					for (let i = 0; i < categoryIds.length; i++) {
						await dbService.db
							.update(workCategorySetCategory)
							.set({ sortOrder: i })
							.where(
								and(
									eq(workCategorySetCategory.setId, setId),
									eq(workCategorySetCategory.categoryId, categoryIds[i]),
								),
							);
					}
				},
				catch: (error) =>
					new DatabaseError({
						message: "Failed to reorder categories",
						operation: "update",
						table: "work_category_set_category",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		revalidatePath("/settings/work-categories");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// ASSIGNMENT QUERIES & MUTATIONS
// ============================================

/**
 * Get all set assignments for an organization
 */
export async function getWorkCategorySetAssignments(
	organizationId: string,
): Promise<ServerActionResult<SetAssignmentListItem[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		const assignments = yield* _(
			dbService.query("getSetAssignments", async () => {
				const results = await dbService.db.query.workCategorySetAssignment.findMany({
					where: and(
						eq(workCategorySetAssignment.organizationId, organizationId),
						eq(workCategorySetAssignment.isActive, true),
					),
					with: {
						set: true,
						team: true,
						employee: true,
					},
					orderBy: [
						asc(workCategorySetAssignment.assignmentType),
						desc(workCategorySetAssignment.createdAt),
					],
				});

				return results.map((a) => ({
					id: a.id,
					setId: a.setId,
					assignmentType: a.assignmentType,
					teamId: a.teamId,
					employeeId: a.employeeId,
					priority: a.priority,
					effectiveFrom: a.effectiveFrom,
					effectiveUntil: a.effectiveUntil,
					isActive: a.isActive,
					createdAt: a.createdAt,
					set: {
						id: a.set.id,
						name: a.set.name,
						description: a.set.description,
					},
					team: a.team
						? {
								id: a.team.id,
								name: a.team.name,
							}
						: null,
					employee: a.employee
						? {
								id: a.employee.id,
								firstName: a.employee.firstName,
								lastName: a.employee.lastName,
							}
						: null,
				}));
			}),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch set assignments",
						operation: "select",
						table: "work_category_set_assignment",
					}),
			),
		);

		return assignments;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Create a set assignment (org/team/employee)
 */
export async function createSetAssignment(
	input: CreateSetAssignmentInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to create set assignments",
						userId: session.user.id,
						resource: "work_category_set_assignment",
						action: "create",
					}),
				),
			);
		}

		// Calculate priority based on assignment type
		const priority =
			input.assignmentType === "employee" ? 2 : input.assignmentType === "team" ? 1 : 0;

		// Create the assignment
		const [created] = yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.insert(workCategorySetAssignment)
						.values({
							setId: input.setId,
							organizationId: input.organizationId,
							assignmentType: input.assignmentType,
							teamId: input.teamId ?? null,
							employeeId: input.employeeId ?? null,
							priority,
							effectiveFrom: input.effectiveFrom ?? null,
							effectiveUntil: input.effectiveUntil ?? null,
							createdBy: session.user.id,
							updatedAt: new Date(),
						})
						.returning(),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to create set assignment",
						operation: "insert",
						table: "work_category_set_assignment",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		revalidatePath("/settings/work-categories");

		return { id: created.id };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Delete a set assignment (soft delete)
 */
export async function deleteSetAssignment(
	assignmentId: string,
): Promise<ServerActionResult<{ success: boolean }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee record and verify admin role
		const [employeeRecord] = yield* _(
			dbService.query("getEmployeeRecord", async () =>
				dbService.db
					.select()
					.from(employee)
					.where(and(eq(employee.userId, session.user.id), eq(employee.isActive, true)))
					.limit(1),
			),
		);

		if (!employeeRecord || employeeRecord.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Admin access required to delete set assignments",
						userId: session.user.id,
						resource: "work_category_set_assignment",
						action: "delete",
					}),
				),
			);
		}

		// Soft delete the assignment
		yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategorySetAssignment)
						.set({ isActive: false })
						.where(eq(workCategorySetAssignment.id, assignmentId)),
				catch: (error) =>
					new DatabaseError({
						message: "Failed to delete set assignment",
						operation: "update",
						table: "work_category_set_assignment",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
		);

		revalidatePath("/settings/work-categories");

		return { success: true };
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

// ============================================
// HELPER QUERIES FOR SELECTORS
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
			dbService.query("getTeams", async () =>
				dbService.db
					.select({
						id: team.id,
						name: team.name,
					})
					.from(team)
					.where(eq(team.organizationId, organizationId))
					.orderBy(asc(team.name)),
			),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch teams",
						operation: "select",
						table: "team",
					}),
			),
		);

		return teams;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
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
			dbService.query("getEmployees", async () =>
				dbService.db
					.select({
						id: employee.id,
						firstName: employee.firstName,
						lastName: employee.lastName,
						position: employee.position,
					})
					.from(employee)
					.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
					.orderBy(asc(employee.firstName), asc(employee.lastName)),
			),
			Effect.mapError(
				() =>
					new DatabaseError({
						message: "Failed to fetch employees",
						operation: "select",
						table: "employee",
					}),
			),
		);

		return employees;
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}

/**
 * Get available categories for an employee (for clock-out dropdown)
 * Queries through junction table
 */
export async function getAvailableCategoriesForEmployee(
	employeeId: string,
): Promise<ServerActionResult<SetCategoryItem[]>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		yield* _(authService.getSession());

		const dbService = yield* _(DatabaseService);

		// Get employee with team info
		const [employeeRecord] = yield* _(
			dbService.query("getEmployee", async () =>
				dbService.db
					.select({
						id: employee.id,
						organizationId: employee.organizationId,
						teamId: employee.teamId,
					})
					.from(employee)
					.where(eq(employee.id, employeeId))
					.limit(1),
			),
		);

		if (!employeeRecord) {
			return [];
		}

		// Resolve effective assignment using hierarchy
		// 1. Employee-specific
		// 2. Team-specific (if employee has team)
		// 3. Organization default

		// Check employee assignment
		const [empAssignment] = yield* _(
			dbService.query("checkEmployeeAssignment", async () =>
				dbService.db.query.workCategorySetAssignment.findMany({
					where: and(
						eq(workCategorySetAssignment.employeeId, employeeId),
						eq(workCategorySetAssignment.assignmentType, "employee"),
						eq(workCategorySetAssignment.isActive, true),
					),
					with: { set: true },
					limit: 1,
				}),
			),
		);

		if (empAssignment?.set?.isActive) {
			const categories = yield* _(
				dbService.query("getCategoriesFromEmpSet", async () =>
					dbService.db
						.select({
							id: workCategory.id,
							name: workCategory.name,
							description: workCategory.description,
							factor: workCategory.factor,
							color: workCategory.color,
							isActive: workCategory.isActive,
							sortOrder: workCategorySetCategory.sortOrder,
						})
						.from(workCategorySetCategory)
						.innerJoin(workCategory, eq(workCategorySetCategory.categoryId, workCategory.id))
						.where(
							and(
								eq(workCategorySetCategory.setId, empAssignment.setId),
								eq(workCategory.isActive, true),
							),
						)
						.orderBy(asc(workCategorySetCategory.sortOrder), asc(workCategory.name)),
				),
			);
			return categories;
		}

		// Check team assignment if employee has a team
		if (employeeRecord.teamId) {
			const [teamAssignment] = yield* _(
				dbService.query("checkTeamAssignment", async () =>
					dbService.db.query.workCategorySetAssignment.findMany({
						where: and(
							eq(workCategorySetAssignment.teamId, employeeRecord.teamId!),
							eq(workCategorySetAssignment.assignmentType, "team"),
							eq(workCategorySetAssignment.isActive, true),
						),
						with: { set: true },
						limit: 1,
					}),
				),
			);

			if (teamAssignment?.set?.isActive) {
				const categories = yield* _(
					dbService.query("getCategoriesFromTeamSet", async () =>
						dbService.db
							.select({
								id: workCategory.id,
								name: workCategory.name,
								description: workCategory.description,
								factor: workCategory.factor,
								color: workCategory.color,
								isActive: workCategory.isActive,
								sortOrder: workCategorySetCategory.sortOrder,
							})
							.from(workCategorySetCategory)
							.innerJoin(workCategory, eq(workCategorySetCategory.categoryId, workCategory.id))
							.where(
								and(
									eq(workCategorySetCategory.setId, teamAssignment.setId),
									eq(workCategory.isActive, true),
								),
							)
							.orderBy(asc(workCategorySetCategory.sortOrder), asc(workCategory.name)),
					),
				);
				return categories;
			}
		}

		// Check org assignment
		const [orgAssignment] = yield* _(
			dbService.query("checkOrgAssignment", async () =>
				dbService.db.query.workCategorySetAssignment.findMany({
					where: and(
						eq(workCategorySetAssignment.organizationId, employeeRecord.organizationId),
						eq(workCategorySetAssignment.assignmentType, "organization"),
						eq(workCategorySetAssignment.isActive, true),
					),
					with: { set: true },
					limit: 1,
				}),
			),
		);

		if (orgAssignment?.set?.isActive) {
			const categories = yield* _(
				dbService.query("getCategoriesFromOrgSet", async () =>
					dbService.db
						.select({
							id: workCategory.id,
							name: workCategory.name,
							description: workCategory.description,
							factor: workCategory.factor,
							color: workCategory.color,
							isActive: workCategory.isActive,
							sortOrder: workCategorySetCategory.sortOrder,
						})
						.from(workCategorySetCategory)
						.innerJoin(workCategory, eq(workCategorySetCategory.categoryId, workCategory.id))
						.where(
							and(
								eq(workCategorySetCategory.setId, orgAssignment.setId),
								eq(workCategory.isActive, true),
							),
						)
						.orderBy(asc(workCategorySetCategory.sortOrder), asc(workCategory.name)),
				),
			);
			return categories;
		}

		// No assignment found
		return [];
	});

	return runServerActionSafe(effect.pipe(Effect.provide(AppLayer)));
}
