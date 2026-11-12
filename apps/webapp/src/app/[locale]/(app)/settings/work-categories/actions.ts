"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { user } from "@/db/auth-schema";
import {
	employee,
	locationEmployee,
	projectManager,
	subareaEmployee,
	team,
	teamPermissions,
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
	workPeriod,
} from "@/db/schema";
import {
	AuthorizationError,
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { assertOnCurrentRoster } from "@/lib/employee-lifecycle/current-roster-guard";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import {
	type Transaction,
	withOrganizationConfigurationMutation,
} from "@/lib/time-tracking/work-transaction";

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

type WorkCategorySetAssignmentWithRelations = typeof workCategorySetAssignment.$inferSelect & {
	set: Pick<typeof workCategorySet.$inferSelect, "id" | "name" | "description">;
	team: Pick<typeof team.$inferSelect, "id" | "name"> | null;
	employee:
		| (Pick<typeof employee.$inferSelect, "id"> & {
				user: { firstName: string | null; lastName: string | null } | null;
		  })
		| null;
};

type EffectiveWorkCategorySetAssignment = typeof workCategorySetAssignment.$inferSelect & {
	set: Pick<typeof workCategorySet.$inferSelect, "isActive"> | null;
};

type TeamListItem = { id: string; name: string };
type EmployeeListItem = {
	id: string;
	firstName: string | null;
	lastName: string | null;
	position: string | null;
};

// ============================================
// Input schemas
// ============================================

const factorSchema = z.string().refine((value) => {
	const factor = Number.parseFloat(value);
	return !Number.isNaN(factor) && factor >= 0 && factor <= 2;
}, "Factor must be between 0 and 2");

const createOrganizationCategorySchema = z.strictObject({
	name: z.string().trim().min(1, "Category name is required"),
	description: z.string().nullish(),
	factor: factorSchema,
	color: z.string().nullish(),
});

const updateOrganizationCategorySchema = z.strictObject({
	categoryId: z.string().min(1),
	name: z.string().trim().min(1, "Category name is required").optional(),
	description: z.string().nullish(),
	factor: factorSchema.optional(),
	color: z.string().nullish(),
});

const createWorkCategorySetSchema = z.strictObject({
	name: z.string().trim().min(1, "Set name is required"),
	description: z.string().nullish(),
	/** Optional initial categories. */
	categoryIds: z.array(z.string().min(1)).optional(),
});

const updateWorkCategorySetSchema = z.strictObject({
	setId: z.string().min(1),
	name: z.string().trim().min(1, "Set name is required").optional(),
	description: z.string().nullish(),
});

const setCategoriesSchema = z.strictObject({
	setId: z.string().min(1),
	categoryIds: z.array(z.string().min(1)),
});

const createSetAssignmentSchema = z.strictObject({
	setId: z.string().min(1),
	assignmentType: z.enum(["organization", "team", "employee"]),
	teamId: z.string().nullish(),
	employeeId: z.string().nullish(),
	effectiveFrom: z.date().nullish(),
	effectiveUntil: z.date().nullish(),
});

const idSchema = z.string().min(1);

export type CreateOrganizationCategoryInput = z.input<typeof createOrganizationCategorySchema>;
export type UpdateOrganizationCategoryInput = z.input<typeof updateOrganizationCategorySchema>;
export type CreateWorkCategorySetInput = z.input<typeof createWorkCategorySetSchema>;
export type UpdateWorkCategorySetInput = z.input<typeof updateWorkCategorySetSchema>;
export type CreateSetAssignmentInput = z.input<typeof createSetAssignmentSchema>;

/** Whom a scoped manager sees work categories for; all null for an org admin. */
type WorkCategoryScope = {
	organizationId: string;
	managedEmployeeIds: ReadonlySet<string> | null;
	/** Teams whose settings the manager may manage. */
	manageableTeamIds: ReadonlySet<string> | null;
	manageableLocationIds: ReadonlySet<string> | null;
	manageableSubareaIds: ReadonlySet<string> | null;
	managedProjectIds: ReadonlySet<string> | null;
};

function findOrganizationWorkCategory(organizationId: string, categoryId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("workCategories.findCategory", async () => {
			const [category] = await dbService.db
				.select({ id: workCategory.id })
				.from(workCategory)
				.where(and(eq(workCategory.id, categoryId), eq(workCategory.organizationId, organizationId)))
				.limit(1);

			return category ?? null;
		});
	});
}

function findOrganizationWorkCategorySet(organizationId: string, setId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("workCategories.findSet", async () => {
			const [set] = await dbService.db
				.select({ id: workCategorySet.id })
				.from(workCategorySet)
				.where(and(eq(workCategorySet.id, setId), eq(workCategorySet.organizationId, organizationId)))
				.limit(1);

			return set ?? null;
		});
	});
}

function findOrganizationSetAssignment(organizationId: string, assignmentId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("workCategories.findAssignment", async () => {
			const [assignment] = await dbService.db
				.select({ id: workCategorySetAssignment.id, setId: workCategorySetAssignment.setId })
				.from(workCategorySetAssignment)
				.where(
					and(
						eq(workCategorySetAssignment.id, assignmentId),
						eq(workCategorySetAssignment.organizationId, organizationId),
					),
				)
				.limit(1);

			return assignment ?? null;
		});
	});
}

function ensureOrganizationCategoryIds(organizationId: string, categoryIds: string[]) {
	return Effect.gen(function* () {
		if (categoryIds.length === 0) {
			return;
		}

		const dbService = yield* DatabaseService;
		const rows = yield* dbService.query("workCategories.ensureCategoryIds", async () => {
			return await dbService.db
				.select({ id: workCategory.id })
				.from(workCategory)
				.where(
					and(eq(workCategory.organizationId, organizationId), inArray(workCategory.id, categoryIds)),
				);
		});

		if (rows.length !== new Set(categoryIds).size) {
			yield* Effect.fail(
				new NotFoundError({
					message: "One or more work categories were not found in this organization",
					entityType: "work_category",
					entityId: categoryIds.join(","),
				}),
			);
		}
	});
}

function notFound(entityType: string, entityId: string, message: string) {
	return Effect.fail(new NotFoundError({ message, entityType, entityId }));
}

/**
 * Category, set-content and effective-assignment writes decide which categories
 * manual preparation accepts (#315). Each runs in one transaction under exclusive
 * organization configuration protection; failures raised inside keep their type.
 */
function runWorkCategoryEligibilityMutation<T>(
	organizationId: string,
	write: (tx: Transaction) => Promise<T>,
	name: string,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService
			.query(name, () => withOrganizationConfigurationMutation(dbService.db, organizationId, write))
			.pipe(
				Effect.mapError((error) =>
					error.cause instanceof NotFoundError || error.cause instanceof ValidationError
						? error.cause
						: error,
				),
			);
	});
}

function workCategoryScopeOf(actor: OrganizationActor, organizationId: string) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		if (scope.organizationWide) {
			return {
				organizationId,
				managedEmployeeIds: null,
				manageableTeamIds: null,
				manageableLocationIds: null,
				manageableSubareaIds: null,
				managedProjectIds: null,
			} satisfies WorkCategoryScope;
		}

		const dbService = yield* DatabaseService;
		const managerId = actor.employee?.id;
		const [
			teamPermissionRows,
			managedProjects,
			managerLocationAssignments,
			managerSubareaAssignments,
		] = managerId
			? yield* Effect.all([
					dbService.query("workCategories.scope.teamPermissions", () =>
						dbService.db.query.teamPermissions.findMany({
							where: and(
								eq(teamPermissions.employeeId, managerId),
								eq(teamPermissions.organizationId, organizationId),
							),
							columns: { teamId: true, canManageTeamSettings: true },
						}),
					),
					dbService.query("workCategories.scope.managedProjects", () =>
						dbService.db.query.projectManager.findMany({
							where: eq(projectManager.employeeId, managerId),
							columns: { projectId: true },
						}),
					),
					dbService.query("workCategories.scope.locationAssignments", () =>
						dbService.db.query.locationEmployee.findMany({
							where: eq(locationEmployee.employeeId, managerId),
							columns: { locationId: true },
						}),
					),
					dbService.query("workCategories.scope.subareaAssignments", () =>
						dbService.db.query.subareaEmployee.findMany({
							where: eq(subareaEmployee.employeeId, managerId),
							columns: { subareaId: true },
						}),
					),
				])
			: [[], [], [], []];

		return {
			organizationId,
			managedEmployeeIds: scope.employeeIds,
			manageableTeamIds: new Set(
				teamPermissionRows.flatMap((permission) =>
					permission.canManageTeamSettings && permission.teamId ? [permission.teamId] : [],
				),
			),
			manageableLocationIds: new Set(
				managerLocationAssignments
					.map((assignment) => assignment.locationId)
					.filter((locationId): locationId is string => Boolean(locationId)),
			),
			manageableSubareaIds: new Set(
				managerSubareaAssignments
					.map((assignment) => assignment.subareaId)
					.filter((subareaId): subareaId is string => Boolean(subareaId)),
			),
			managedProjectIds: new Set(managedProjects.map((managedProject) => managedProject.projectId)),
		} satisfies WorkCategoryScope;
	});
}

function isOrganizationWide(scope: WorkCategoryScope) {
	return scope.managedEmployeeIds === null;
}

function scopedEmployeeIdsOf(scope: WorkCategoryScope) {
	return Effect.gen(function* () {
		if (isOrganizationWide(scope)) {
			return null as Set<string> | null;
		}

		const teamIds = scope.manageableTeamIds ? [...scope.manageableTeamIds] : [];
		const locationIds = scope.manageableLocationIds ? [...scope.manageableLocationIds] : [];
		const subareaIds = scope.manageableSubareaIds ? [...scope.manageableSubareaIds] : [];
		const dbService = yield* DatabaseService;

		const [teamEmployees, locationAreaEmployees, subareaAreaEmployees] = yield* Effect.all([
			teamIds.length > 0
				? dbService.query("workCategories.scope.teamEmployees", () =>
						dbService.db.query.employee.findMany({
							where: and(
								eq(employee.organizationId, scope.organizationId),
								inArray(employee.teamId, teamIds),
							),
							columns: { id: true },
						}),
					)
				: Effect.succeed([] as Array<{ id: string }>),
			locationIds.length > 0
				? dbService.query("workCategories.scope.locationAreaEmployees", () =>
						dbService.db.query.locationEmployee.findMany({
							where: inArray(locationEmployee.locationId, locationIds),
							columns: { employeeId: true },
						}),
					)
				: Effect.succeed([] as Array<{ employeeId: string }>),
			subareaIds.length > 0
				? dbService.query("workCategories.scope.subareaAreaEmployees", () =>
						dbService.db.query.subareaEmployee.findMany({
							where: inArray(subareaEmployee.subareaId, subareaIds),
							columns: { employeeId: true },
						}),
					)
				: Effect.succeed([] as Array<{ employeeId: string }>),
		]);

		return new Set([
			...(scope.managedEmployeeIds ? [...scope.managedEmployeeIds] : []),
			...teamEmployees.map((employeeRecord) => employeeRecord.id),
			...locationAreaEmployees.map((assignment) => assignment.employeeId),
			...subareaAreaEmployees.map((assignment) => assignment.employeeId),
		]);
	});
}

function visibleCategoryIdsOf(scope: WorkCategoryScope) {
	return Effect.gen(function* () {
		if (isOrganizationWide(scope)) {
			return null as Set<string> | null;
		}

		const scopedEmployeeIds = yield* scopedEmployeeIdsOf(scope);
		const employeeIds = scopedEmployeeIds ? [...scopedEmployeeIds] : [];
		const projectIds = scope.managedProjectIds ? [...scope.managedProjectIds] : [];
		const dbService = yield* DatabaseService;

		const [employeeCategoryRows, projectCategoryRows] = yield* Effect.all([
			employeeIds.length > 0
				? dbService.query("workCategories.scope.employeeCategoryIds", () =>
						dbService.db
							.select({ workCategoryId: workPeriod.workCategoryId })
							.from(workPeriod)
							.where(
								and(
									eq(workPeriod.organizationId, scope.organizationId),
									inArray(workPeriod.employeeId, employeeIds),
								),
							),
					)
				: Effect.succeed([] as Array<{ workCategoryId: string | null }>),
			projectIds.length > 0
				? dbService.query("workCategories.scope.projectCategoryIds", () =>
						dbService.db
							.select({ workCategoryId: workPeriod.workCategoryId })
							.from(workPeriod)
							.where(
								and(
									eq(workPeriod.organizationId, scope.organizationId),
									inArray(workPeriod.projectId, projectIds),
								),
							),
					)
				: Effect.succeed([] as Array<{ workCategoryId: string | null }>),
		]);

		return new Set(
			[...employeeCategoryRows, ...projectCategoryRows]
				.map((row) => row.workCategoryId)
				.filter((categoryId): categoryId is string => Boolean(categoryId)),
		);
	});
}

function setIdsContaining(categoryIds: ReadonlySet<string>) {
	return Effect.gen(function* () {
		if (categoryIds.size === 0) {
			return new Set<string>();
		}

		const dbService = yield* DatabaseService;
		const setLinks = yield* dbService.query("workCategories.scope.setLinks", () =>
			dbService.db
				.select({
					setId: workCategorySetCategory.setId,
					categoryId: workCategorySetCategory.categoryId,
				})
				.from(workCategorySetCategory)
				.where(inArray(workCategorySetCategory.categoryId, [...categoryIds])),
		);

		return new Set(setLinks.map((link) => link.setId));
	});
}

function visibleSetIdsOf(scope: WorkCategoryScope) {
	return Effect.gen(function* () {
		const visibleCategoryIds = yield* visibleCategoryIdsOf(scope);
		return visibleCategoryIds ? yield* setIdsContaining(visibleCategoryIds) : null;
	});
}

function filterAssignmentsByManagerScope(
	assignments: SetAssignmentListItem[],
	manageableTeamIds: ReadonlySet<string> | null,
	scopedEmployeeIds: ReadonlySet<string> | null,
) {
	return assignments.filter((assignment) => {
		if (assignment.assignmentType === "team") {
			return assignment.teamId ? (manageableTeamIds?.has(assignment.teamId) ?? false) : false;
		}

		if (assignment.assignmentType === "employee") {
			return assignment.employeeId
				? (scopedEmployeeIds?.has(assignment.employeeId) ?? false)
				: false;
		}

		return false;
	});
}

function failedRead(message: string, table: string) {
	return () => new DatabaseError({ message, operation: "select", table });
}

// ============================================
// ORGANIZATION CATEGORY QUERIES
// ============================================

/**
 * Get all work categories of the active organization (org-level, independent of sets)
 */
export const getOrganizationCategories = organizationAction(
	{ name: "workCategories.listCategories", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* workCategoryScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			const categories: OrganizationCategoryItem[] = yield* dbService
				.query("getOrganizationCategories", async () => {
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
					return await Promise.all(
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
				})
				.pipe(
					Effect.mapError(failedRead("Failed to fetch organization categories", "work_category")),
				);

			const visibleCategoryIds = yield* visibleCategoryIdsOf(scope);
			if (!visibleCategoryIds) {
				return categories;
			}

			return categories.filter((category) => visibleCategoryIds.has(category.id));
		}),
);

// ============================================
// ORGANIZATION CATEGORY MUTATIONS
// ============================================

/**
 * Create a new org-level work category
 */
export const createOrganizationCategory = organizationAction(
	{
		name: "workCategories.createCategory",
		requires: "orgAdmin",
		schema: createOrganizationCategorySchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			// Check for existing category with same name
			const [existing] = yield* dbService.query("checkExistingCategory", async () =>
				dbService.db
					.select({ id: workCategory.id })
					.from(workCategory)
					.where(
						and(
							eq(workCategory.organizationId, organizationId),
							eq(workCategory.name, input.name),
							eq(workCategory.isActive, true),
						),
					)
					.limit(1),
			);

			if (existing) {
				return yield* Effect.fail(
					new ConflictError({
						message: `A category named "${input.name}" already exists`,
						conflictType: "duplicate_name",
					}),
				);
			}

			const [created] = yield* dbService.query("workCategory.create", async () =>
				dbService.db
					.insert(workCategory)
					.values({
						organizationId,
						name: input.name,
						description: input.description ?? null,
						factor: input.factor,
						color: input.color ?? null,
						createdBy: actor.userId,
						updatedAt: new Date(),
					})
					.returning(),
			);

			revalidatePath("/settings/work-categories");

			return { id: created.id };
		}),
);

/**
 * Update an org-level work category
 */
export const updateOrganizationCategory = organizationAction(
	{
		name: "workCategories.updateCategory",
		requires: "orgAdmin",
		schema: updateOrganizationCategorySchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scopedCategory = yield* findOrganizationWorkCategory(organizationId, input.categoryId);
			if (!scopedCategory) {
				return yield* notFound("work_category", input.categoryId, "Work category not found");
			}

			const dbService = yield* DatabaseService;
			const [updated] = yield* dbService.query("workCategory.update", async () =>
				dbService.db
					.update(workCategory)
					.set({
						...(input.name !== undefined && { name: input.name }),
						...(input.description !== undefined && { description: input.description }),
						...(input.factor !== undefined && { factor: input.factor }),
						...(input.color !== undefined && { color: input.color }),
						updatedBy: actor.userId,
					})
					.where(
						and(
							eq(workCategory.id, input.categoryId),
							eq(workCategory.organizationId, organizationId),
						),
					)
					.returning(),
			);

			if (!updated) {
				return yield* notFound("work_category", input.categoryId, "Work category not found");
			}

			revalidatePath("/settings/work-categories");

			return { id: updated.id };
		}),
);

/**
 * Delete an org-level work category (soft delete)
 */
export const deleteOrganizationCategory = organizationAction(
	{ name: "workCategories.deleteCategory", requires: "orgAdmin", schema: idSchema },
	({ actor, organizationId, input: categoryId }) =>
		Effect.gen(function* () {
			const scopedCategory = yield* findOrganizationWorkCategory(organizationId, categoryId);
			if (!scopedCategory) {
				return yield* notFound("work_category", categoryId, "Work category not found");
			}

			// Soft delete the category and remove it from every set, together.
			yield* runWorkCategoryEligibilityMutation(
				organizationId,
				async (tx) => {
					const deactivated = await tx
						.update(workCategory)
						.set({ isActive: false, updatedBy: actor.userId })
						.where(
							and(
								eq(workCategory.id, categoryId),
								eq(workCategory.organizationId, organizationId),
								eq(workCategory.isActive, true),
							),
						)
						.returning({ id: workCategory.id });
					if (deactivated.length === 0) {
						throw new NotFoundError({
							message: "Work category not found",
							entityType: "work_category",
							entityId: categoryId,
						});
					}
					await tx
						.delete(workCategorySetCategory)
						.where(eq(workCategorySetCategory.categoryId, categoryId));
				},
				"workCategory.delete",
			);

			revalidatePath("/settings/work-categories");

			return { success: true };
		}),
);

// ============================================
// CATEGORY SET QUERIES
// ============================================

/**
 * Get all work category sets of the active organization
 */
export const getWorkCategorySets = organizationAction(
	{ name: "workCategories.listSets", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* workCategoryScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			const sets: WorkCategorySetListItem[] = yield* dbService
				.query("getWorkCategorySets", async () => {
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
					return await Promise.all(
						results.map(async (set) => {
							const [[categoryCountResult], [assignmentCountResult]] = await Promise.all([
								dbService.db
									.select({ count: sql<number>`count(*)::int` })
									.from(workCategorySetCategory)
									.innerJoin(
										workCategory,
										and(
											eq(workCategorySetCategory.categoryId, workCategory.id),
											eq(workCategory.isActive, true),
										),
									)
									.where(eq(workCategorySetCategory.setId, set.id)),
								dbService.db
									.select({ count: sql<number>`count(*)::int` })
									.from(workCategorySetAssignment)
									.where(
										and(
											eq(workCategorySetAssignment.setId, set.id),
											eq(workCategorySetAssignment.isActive, true),
										),
									),
							]);

							return {
								...set,
								categoryCount: categoryCountResult?.count ?? 0,
								assignmentCount: assignmentCountResult?.count ?? 0,
							};
						}),
					);
				})
				.pipe(Effect.mapError(failedRead("Failed to fetch work category sets", "work_category_set")));

			const visibleSetIds = yield* visibleSetIdsOf(scope);
			if (!visibleSetIds) {
				return sets;
			}

			return sets.filter((set) => visibleSetIds.has(set.id));
		}),
);

/**
 * Get a work category set with all its categories (via junction table)
 */
export const getWorkCategorySetDetail = organizationAction(
	{ name: "workCategories.getSet", requires: "scopedManager", schema: idSchema },
	({ actor, organizationId, input: setId }) =>
		Effect.gen(function* () {
			const scope = yield* workCategoryScopeOf(actor, organizationId);
			const visibleCategoryIds = yield* visibleCategoryIdsOf(scope);
			const dbService = yield* DatabaseService;

			const [set] = yield* dbService
				.query("getWorkCategorySet", async () =>
					dbService.db
						.select()
						.from(workCategorySet)
						.where(
							and(eq(workCategorySet.id, setId), eq(workCategorySet.organizationId, organizationId)),
						)
						.limit(1),
				)
				.pipe(Effect.mapError(failedRead("Failed to fetch work category set", "work_category_set")));

			if (!set) {
				return yield* notFound("work_category_set", setId, "Work category set not found");
			}

			if (visibleCategoryIds) {
				const visibleSetIds = yield* setIdsContaining(visibleCategoryIds);
				if (!visibleSetIds.has(setId)) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "You do not have access to this work category set",
							userId: actor.userId,
							resource: "work_category_set",
							action: "read",
						}),
					);
				}
			}

			const categories = yield* dbService
				.query("getSetCategories", async () =>
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
				)
				.pipe(
					Effect.mapError(
						failedRead("Failed to fetch set categories", "work_category_set_category"),
					),
				);

			return {
				set,
				categories: visibleCategoryIds
					? categories.filter((category) => visibleCategoryIds.has(category.id))
					: categories,
			} satisfies WorkCategorySetDetail;
		}),
);

// ============================================
// CATEGORY SET MUTATIONS
// ============================================

/**
 * Create a new work category set
 */
export const createWorkCategorySet = organizationAction(
	{ name: "workCategories.createSet", requires: "orgAdmin", schema: createWorkCategorySetSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const categoryIds = input.categoryIds ?? [];
			yield* ensureOrganizationCategoryIds(organizationId, categoryIds);
			const dbService = yield* DatabaseService;

			// Check for existing set with same name
			const [existing] = yield* dbService.query("checkExistingSet", async () =>
				dbService.db
					.select({ id: workCategorySet.id })
					.from(workCategorySet)
					.where(
						and(
							eq(workCategorySet.organizationId, organizationId),
							eq(workCategorySet.name, input.name),
							eq(workCategorySet.isActive, true),
						),
					)
					.limit(1),
			);

			if (existing) {
				return yield* Effect.fail(
					new ConflictError({
						message: `A work category set named "${input.name}" already exists`,
						conflictType: "duplicate_name",
					}),
				);
			}

			const [created] = yield* dbService.query("workCategorySet.create", async () =>
				dbService.db
					.insert(workCategorySet)
					.values({
						organizationId,
						name: input.name,
						description: input.description ?? null,
						createdBy: actor.userId,
						updatedAt: new Date(),
					})
					.returning(),
			);

			// If initial category IDs provided, add them to the set
			if (categoryIds.length > 0) {
				yield* dbService.query("workCategorySet.addCategories", async () =>
					dbService.db.insert(workCategorySetCategory).values(
						categoryIds.map((categoryId, index) => ({
							setId: created.id,
							categoryId,
							sortOrder: index,
						})),
					),
				);
			}

			revalidatePath("/settings/work-categories");

			return { id: created.id };
		}),
);

/**
 * Update a work category set
 */
export const updateWorkCategorySet = organizationAction(
	{ name: "workCategories.updateSet", requires: "orgAdmin", schema: updateWorkCategorySetSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scopedSet = yield* findOrganizationWorkCategorySet(organizationId, input.setId);
			if (!scopedSet) {
				return yield* notFound("work_category_set", input.setId, "Work category set not found");
			}

			const dbService = yield* DatabaseService;
			const [updated] = yield* dbService.query("workCategorySet.update", async () =>
				dbService.db
					.update(workCategorySet)
					.set({
						name: input.name,
						description: input.description,
						updatedBy: actor.userId,
					})
					.where(
						and(
							eq(workCategorySet.id, input.setId),
							eq(workCategorySet.organizationId, organizationId),
						),
					)
					.returning(),
			);

			if (!updated) {
				return yield* notFound("work_category_set", input.setId, "Work category set not found");
			}

			revalidatePath("/settings/work-categories");

			return { id: updated.id };
		}),
);

/**
 * Delete a work category set (soft delete)
 */
export const deleteWorkCategorySet = organizationAction(
	{ name: "workCategories.deleteSet", requires: "orgAdmin", schema: idSchema },
	({ actor, organizationId, input: setId }) =>
		Effect.gen(function* () {
			const scopedSet = yield* findOrganizationWorkCategorySet(organizationId, setId);
			if (!scopedSet) {
				return yield* notFound("work_category_set", setId, "Work category set not found");
			}

			// Soft delete the set and its assignments, and remove its contents, together.
			yield* runWorkCategoryEligibilityMutation(
				organizationId,
				async (tx) => {
					const deactivated = await tx
						.update(workCategorySet)
						.set({ isActive: false, updatedBy: actor.userId })
						.where(
							and(
								eq(workCategorySet.id, setId),
								eq(workCategorySet.organizationId, organizationId),
								eq(workCategorySet.isActive, true),
							),
						)
						.returning({ id: workCategorySet.id });
					if (deactivated.length === 0) {
						throw new NotFoundError({
							message: "Work category set not found",
							entityType: "work_category_set",
							entityId: setId,
						});
					}
					await tx
						.update(workCategorySetAssignment)
						.set({ isActive: false })
						.where(
							and(
								eq(workCategorySetAssignment.setId, setId),
								eq(workCategorySetAssignment.organizationId, organizationId),
							),
						);
					await tx.delete(workCategorySetCategory).where(eq(workCategorySetCategory.setId, setId));
				},
				"workCategorySet.delete",
			);

			revalidatePath("/settings/work-categories");

			return { success: true };
		}),
);

/**
 * Update which categories belong to a set (replace all)
 */
export const updateSetCategories = organizationAction(
	{ name: "workCategories.updateSetCategories", requires: "orgAdmin", schema: setCategoriesSchema },
	({ organizationId, input: { setId, categoryIds } }) =>
		Effect.gen(function* () {
			// Validate and replace the set's contents in one protected transaction.
			yield* runWorkCategoryEligibilityMutation(
				organizationId,
				async (tx) => {
					const [activeSet] = await tx
						.select({ id: workCategorySet.id })
						.from(workCategorySet)
						.where(
							and(
								eq(workCategorySet.id, setId),
								eq(workCategorySet.organizationId, organizationId),
								eq(workCategorySet.isActive, true),
							),
						)
						.limit(1);
					if (!activeSet) {
						throw new NotFoundError({
							message: "Work category set not found",
							entityType: "work_category_set",
							entityId: setId,
						});
					}
					const requestedIds = [...new Set(categoryIds)];
					if (requestedIds.length > 0) {
						const scopedCategories = await tx
							.select({ id: workCategory.id })
							.from(workCategory)
							.where(
								and(
									eq(workCategory.organizationId, organizationId),
									inArray(workCategory.id, requestedIds),
								),
							);
						if (scopedCategories.length !== requestedIds.length) {
							throw new NotFoundError({
								message: "One or more work categories were not found in this organization",
								entityType: "work_category",
								entityId: requestedIds.join(","),
							});
						}
					}
					await tx.delete(workCategorySetCategory).where(eq(workCategorySetCategory.setId, setId));
					if (categoryIds.length > 0) {
						await tx.insert(workCategorySetCategory).values(
							categoryIds.map((categoryId, index) => ({
								setId,
								categoryId,
								sortOrder: index,
							})),
						);
					}
				},
				"workCategorySet.updateCategories",
			);

			revalidatePath("/settings/work-categories");

			return { success: true };
		}),
);

/**
 * Reorder categories within a set (updates sortOrder in junction table)
 */
export const reorderSetCategories = organizationAction(
	{ name: "workCategories.reorderSetCategories", requires: "orgAdmin", schema: setCategoriesSchema },
	({ organizationId, input: { setId, categoryIds } }) =>
		Effect.gen(function* () {
			const scopedSet = yield* findOrganizationWorkCategorySet(organizationId, setId);
			if (!scopedSet) {
				return yield* notFound("work_category_set", setId, "Work category set not found");
			}
			yield* ensureOrganizationCategoryIds(organizationId, categoryIds);

			const dbService = yield* DatabaseService;
			yield* dbService.query("workCategorySet.reorderCategories", async () => {
				await Promise.all(
					categoryIds.map((categoryId, sortOrder) =>
						dbService.db
							.update(workCategorySetCategory)
							.set({ sortOrder })
							.where(
								and(
									eq(workCategorySetCategory.setId, setId),
									eq(workCategorySetCategory.categoryId, categoryId),
								),
							),
					),
				);
			});

			revalidatePath("/settings/work-categories");

			return { success: true };
		}),
);

// ============================================
// ASSIGNMENT QUERIES & MUTATIONS
// ============================================

/**
 * Get all set assignments of the active organization
 */
export const getWorkCategorySetAssignments = organizationAction(
	{ name: "workCategories.listAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* workCategoryScopeOf(actor, organizationId);
			const dbService = yield* DatabaseService;

			const assignments: SetAssignmentListItem[] = yield* dbService
				.query("getSetAssignments", async () => {
					const results = await dbService.db.query.workCategorySetAssignment.findMany({
						where: and(
							eq(workCategorySetAssignment.organizationId, organizationId),
							eq(workCategorySetAssignment.isActive, true),
						),
						with: {
							set: true,
							team: true,
							employee: {
								columns: { id: true },
								with: { user: { columns: { firstName: true, lastName: true } } },
							},
						},
						orderBy: [
							asc(workCategorySetAssignment.assignmentType),
							desc(workCategorySetAssignment.createdAt),
						],
					});

					const typedResults = results as unknown as WorkCategorySetAssignmentWithRelations[];

					return typedResults.map((a) => ({
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
						team: a.team ? { id: a.team.id, name: a.team.name } : null,
						employee: a.employee
							? {
									id: a.employee.id,
									firstName: a.employee.user?.firstName ?? null,
									lastName: a.employee.user?.lastName ?? null,
								}
							: null,
					}));
				})
				.pipe(
					Effect.mapError(
						failedRead("Failed to fetch set assignments", "work_category_set_assignment"),
					),
				);

			const visibleSetIds = yield* visibleSetIdsOf(scope);
			if (!visibleSetIds) {
				return assignments;
			}
			const scopedEmployeeIds = yield* scopedEmployeeIdsOf(scope);

			return filterAssignmentsByManagerScope(
				assignments.filter((assignment) => visibleSetIds.has(assignment.setId)),
				scope.manageableTeamIds,
				scopedEmployeeIds,
			);
		}),
);

/**
 * Create a set assignment (org/team/employee)
 */
export const createSetAssignment = organizationAction(
	{
		name: "workCategories.createAssignment",
		requires: "orgAdmin",
		schema: createSetAssignmentSchema,
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scopedSet = yield* findOrganizationWorkCategorySet(organizationId, input.setId);
			if (!scopedSet) {
				return yield* notFound("work_category_set", input.setId, "Work category set not found");
			}

			// Calculate priority based on assignment type
			const priority =
				input.assignmentType === "employee" ? 2 : input.assignmentType === "team" ? 1 : 0;
			// An unselected target (empty or absent) names none.
			const teamId = input.teamId || null;
			const employeeId = input.employeeId || null;

			// A level names exactly its own target: none for the organization default.
			const levelMatchesTarget =
				input.assignmentType === "organization"
					? teamId === null && employeeId === null
					: input.assignmentType === "team"
						? teamId !== null && employeeId === null
						: employeeId !== null && teamId === null;
			if (!levelMatchesTarget) {
				return yield* Effect.fail(
					new ValidationError({
						message: "The assignment target does not match its level",
						field: input.assignmentType === "team" ? "teamId" : "employeeId",
					}),
				);
			}

			// Target validation and the insert serialize with manual preparation.
			const created = yield* runWorkCategoryEligibilityMutation(
				organizationId,
				async (tx) => {
					const [activeSet] = await tx
						.select({ id: workCategorySet.id })
						.from(workCategorySet)
						.where(
							and(
								eq(workCategorySet.id, input.setId),
								eq(workCategorySet.organizationId, organizationId),
								eq(workCategorySet.isActive, true),
							),
						)
						.limit(1);
					if (!activeSet) {
						throw new NotFoundError({
							message: "Work category set not found",
							entityType: "work_category_set",
							entityId: input.setId,
						});
					}
					if (teamId !== null) {
						const [scopedTeam] = await tx
							.select({ id: team.id })
							.from(team)
							.where(and(eq(team.id, teamId), eq(team.organizationId, organizationId)))
							.limit(1);
						if (!scopedTeam) {
							throw new ValidationError({
								message: "Team not found in this organization",
								field: "teamId",
							});
						}
					}
					if (employeeId !== null) {
						// A former employee gets no new work category set (#1438), also when
						// they leave between the roster check and this write.
						await assertOnCurrentRoster(tx, {
							organizationId,
							employeeIds: [employeeId],
							field: "employeeId",
						});
					}

					const [inserted] = await tx
						.insert(workCategorySetAssignment)
						.values({
							setId: input.setId,
							organizationId,
							assignmentType: input.assignmentType,
							teamId,
							employeeId,
							priority,
							effectiveFrom: input.effectiveFrom ?? null,
							effectiveUntil: input.effectiveUntil ?? null,
							createdBy: actor.userId,
							updatedAt: new Date(),
						})
						.returning({ id: workCategorySetAssignment.id });
					return inserted;
				},
				"workCategorySetAssignment.create",
			);

			revalidatePath("/settings/work-categories");

			return { id: created.id };
		}),
);

/**
 * Delete a set assignment (soft delete)
 */
export const deleteSetAssignment = organizationAction(
	{ name: "workCategories.deleteAssignment", requires: "orgAdmin", schema: idSchema },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			const scopedAssignment = yield* findOrganizationSetAssignment(organizationId, assignmentId);
			if (!scopedAssignment) {
				return yield* notFound(
					"work_category_set_assignment",
					assignmentId,
					"Work category set assignment not found",
				);
			}

			yield* runWorkCategoryEligibilityMutation(
				organizationId,
				async (tx) => {
					const deactivated = await tx
						.update(workCategorySetAssignment)
						.set({ isActive: false })
						.where(
							and(
								eq(workCategorySetAssignment.id, assignmentId),
								eq(workCategorySetAssignment.organizationId, organizationId),
								eq(workCategorySetAssignment.isActive, true),
							),
						)
						.returning({ id: workCategorySetAssignment.id });
					if (deactivated.length === 0) {
						throw new NotFoundError({
							message: "Work category set assignment not found",
							entityType: "work_category_set_assignment",
							entityId: assignmentId,
						});
					}
				},
				"workCategorySetAssignment.delete",
			);

			revalidatePath("/settings/work-categories");

			return { success: true };
		}),
);

// ============================================
// HELPER QUERIES FOR SELECTORS
// ============================================

/**
 * Teams for the assignment dropdown: every team for an org admin, else the teams
 * whose members or settings the manager may manage.
 */
export const getTeamsForAssignment = organizationAction(
	{ name: "workCategories.assignmentTeams", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;

			const teams: TeamListItem[] = yield* dbService
				.query("getTeams", async () =>
					dbService.db
						.select({ id: team.id, name: team.name })
						.from(team)
						.where(eq(team.organizationId, organizationId))
						.orderBy(asc(team.name)),
				)
				.pipe(Effect.mapError(failedRead("Failed to fetch teams", "team")));

			return scope.organizationWide
				? teams
				: teams.filter((teamRecord) => scope.teamIds.has(teamRecord.id));
		}),
);

/**
 * Current employees for the assignment dropdown: all of them for an org admin,
 * else the manager's reports.
 */
export const getEmployeesForAssignment = organizationAction(
	{ name: "workCategories.assignmentEmployees", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			const dbService = yield* DatabaseService;

			const employees: EmployeeListItem[] = yield* dbService
				.query("getEmployees", async () =>
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
						.orderBy(asc(user.firstName), asc(user.lastName)),
				)
				.pipe(Effect.mapError(failedRead("Failed to fetch employees", "employee")));

			return scope.organizationWide
				? employees
				: employees.filter((employeeRecord) => scope.employeeIds.has(employeeRecord.id));
		}),
);

function categoriesOfSet(setId: string, queryName: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query(queryName, async () =>
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
		);
	});
}

/**
 * The categories an employee of the active organization may pick when clocking
 * out: their employee set, else their team's, else the organization default.
 * Any member may read them; an employee of another organization has none.
 */
export const getAvailableCategoriesForEmployee = organizationAction(
	{ name: "workCategories.availableForEmployee", requires: "member", schema: idSchema },
	({ organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const [employeeRecord] = yield* dbService.query("getEmployee", async () =>
				dbService.db
					.select({ id: employee.id, teamId: employee.teamId })
					.from(employee)
					.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
					.limit(1),
			);

			if (!employeeRecord) {
				return [] as SetCategoryItem[];
			}

			const [empAssignment] = yield* dbService.query("checkEmployeeAssignment", async () =>
				dbService.db.query.workCategorySetAssignment.findMany({
					where: and(
						eq(workCategorySetAssignment.organizationId, organizationId),
						eq(workCategorySetAssignment.employeeId, employeeId),
						eq(workCategorySetAssignment.assignmentType, "employee"),
						eq(workCategorySetAssignment.isActive, true),
					),
					with: { set: true },
					limit: 1,
				}),
			);
			const typedEmpAssignment = empAssignment as EffectiveWorkCategorySetAssignment | undefined;

			if (typedEmpAssignment?.set?.isActive) {
				return yield* categoriesOfSet(typedEmpAssignment.setId, "getCategoriesFromEmpSet");
			}

			const teamId = employeeRecord.teamId;
			if (teamId) {
				const [teamAssignment] = yield* dbService.query("checkTeamAssignment", async () =>
					dbService.db.query.workCategorySetAssignment.findMany({
						where: and(
							eq(workCategorySetAssignment.organizationId, organizationId),
							eq(workCategorySetAssignment.teamId, teamId),
							eq(workCategorySetAssignment.assignmentType, "team"),
							eq(workCategorySetAssignment.isActive, true),
						),
						with: { set: true },
						limit: 1,
					}),
				);
				const typedTeamAssignment = teamAssignment as EffectiveWorkCategorySetAssignment | undefined;

				if (typedTeamAssignment?.set?.isActive) {
					return yield* categoriesOfSet(typedTeamAssignment.setId, "getCategoriesFromTeamSet");
				}
			}

			const [orgAssignment] = yield* dbService.query("checkOrgAssignment", async () =>
				dbService.db.query.workCategorySetAssignment.findMany({
					where: and(
						eq(workCategorySetAssignment.organizationId, organizationId),
						eq(workCategorySetAssignment.assignmentType, "organization"),
						eq(workCategorySetAssignment.isActive, true),
					),
					with: { set: true },
					limit: 1,
				}),
			);
			const typedOrgAssignment = orgAssignment as EffectiveWorkCategorySetAssignment | undefined;

			if (typedOrgAssignment?.set?.isActive) {
				return yield* categoriesOfSet(typedOrgAssignment.setId, "getCategoriesFromOrgSet");
			}

			return [] as SetCategoryItem[];
		}),
);
