"use server";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Effect } from "effect";
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
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	getEmployeeSettingsActorContext,
	getManagedEmployeeIdsForSettingsActor,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";

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

type WorkCategorySettingsActor = Awaited<ReturnType<typeof getEmployeeSettingsActorContext>> extends Effect.Effect<
	infer Success,
	any,
	any
>
	? Success
	: never;

type WorkCategoryAccessContext = {
	actor: WorkCategorySettingsActor;
	managedEmployeeIds: Set<string> | null;
	manageableTeamIds: Set<string> | null;
	manageableLocationIds: Set<string> | null;
	manageableSubareaIds: Set<string> | null;
	managedProjectIds: Set<string> | null;
};

function getScopedOrganizationWorkCategory(
	dbService: WorkCategorySettingsActor["dbService"],
	organizationId: string,
	categoryId: string,
	queryName: string,
) {
	return dbService.query(queryName, async () => {
		const [category] = await dbService.db
			.select({ id: workCategory.id })
			.from(workCategory)
			.where(
				and(
					eq(workCategory.id, categoryId),
					eq(workCategory.organizationId, organizationId),
				),
			)
			.limit(1);

		return category ?? null;
	});
}

function getScopedOrganizationWorkCategorySet(
	dbService: WorkCategorySettingsActor["dbService"],
	organizationId: string,
	setId: string,
	queryName: string,
) {
	return dbService.query(queryName, async () => {
		const [set] = await dbService.db
			.select({ id: workCategorySet.id })
			.from(workCategorySet)
			.where(
				and(eq(workCategorySet.id, setId), eq(workCategorySet.organizationId, organizationId)),
			)
			.limit(1);

		return set ?? null;
	});
}

function getScopedOrganizationSetAssignment(
	dbService: WorkCategorySettingsActor["dbService"],
	organizationId: string,
	assignmentId: string,
	queryName: string,
) {
	return dbService.query(queryName, async () => {
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
}

function ensureScopedCategoryIds(
	dbService: WorkCategorySettingsActor["dbService"],
	organizationId: string,
	categoryIds: string[],
	queryName: string,
) {
	return Effect.gen(function* (_) {
		if (categoryIds.length === 0) {
			return;
		}

		const rows = yield* _(
			dbService.query(queryName, async () => {
				return await dbService.db
					.select({ id: workCategory.id })
					.from(workCategory)
					.where(
						and(
							eq(workCategory.organizationId, organizationId),
							inArray(workCategory.id, categoryIds),
						),
					);
			}),
		);

		if (rows.length !== new Set(categoryIds).size) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "One or more work categories were not found in this organization",
						entityType: "work_category",
						entityId: categoryIds.join(","),
					}),
				),
			);
		}
	});
}

function getScopedWorkCategoryAccessContext(organizationId: string | undefined, queryName: string) {
	return Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext({ organizationId, queryName }));
		const scopedOrganizationId = actor.organizationId;

		if (actor.accessTier === "orgAdmin") {
			return {
				actor,
				managedEmployeeIds: null,
				manageableTeamIds: null,
				manageableLocationIds: null,
				manageableSubareaIds: null,
				managedProjectIds: null,
			} satisfies WorkCategoryAccessContext;
		}

		const managedEmployeeIds = yield* _(getManagedEmployeeIdsForSettingsActor(actor));
		const [teamPermissionRows, managedProjects, managerLocationAssignments, managerSubareaAssignments] =
			actor.currentEmployee
				? yield* _(
						Effect.all([
							actor.dbService.query(`${queryName}:teamPermissions`, async () => {
								return await actor.dbService.db.query.teamPermissions.findMany({
									where: and(
										eq(teamPermissions.employeeId, actor.currentEmployee?.id ?? ""),
										eq(teamPermissions.organizationId, scopedOrganizationId),
									),
									columns: { teamId: true, canManageTeamSettings: true },
								});
							}),
							actor.dbService.query(`${queryName}:managedProjects`, async () => {
								return await actor.dbService.db.query.projectManager.findMany({
									where: eq(projectManager.employeeId, actor.currentEmployee?.id ?? ""),
									columns: { projectId: true },
								});
							}),
							actor.dbService.query(`${queryName}:locationAssignments`, async () => {
								return await actor.dbService.db.query.locationEmployee.findMany({
									where: eq(locationEmployee.employeeId, actor.currentEmployee?.id ?? ""),
									columns: { locationId: true },
								});
							}),
							actor.dbService.query(`${queryName}:subareaAssignments`, async () => {
								return await actor.dbService.db.query.subareaEmployee.findMany({
									where: eq(subareaEmployee.employeeId, actor.currentEmployee?.id ?? ""),
									columns: { subareaId: true },
								});
							}),
						]),
				  )
				: [[], [], [], []];

		const manageableLocationIds = new Set(
			managerLocationAssignments
				.map((assignment) => assignment.locationId)
				.filter((locationId): locationId is string => Boolean(locationId)),
		);
		const manageableSubareaIds = new Set(
			managerSubareaAssignments
				.map((assignment) => assignment.subareaId)
				.filter((subareaId): subareaId is string => Boolean(subareaId)),
		);

		return {
			actor,
			managedEmployeeIds,
			manageableTeamIds: new Set(
				teamPermissionRows
					.filter((permission) => permission.canManageTeamSettings && permission.teamId)
					.map((permission) => permission.teamId as string),
			),
			manageableLocationIds,
			manageableSubareaIds,
			managedProjectIds: new Set(managedProjects.map((managedProject) => managedProject.projectId)),
		} satisfies WorkCategoryAccessContext;
	});
}

function getScopedEmployeeIds(accessContext: WorkCategoryAccessContext, queryName: string) {
	return Effect.gen(function* (_) {
		if (accessContext.actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		const teamIds = accessContext.manageableTeamIds ? [...accessContext.manageableTeamIds] : [];
		const locationIds = accessContext.manageableLocationIds ? [...accessContext.manageableLocationIds] : [];
		const subareaIds = accessContext.manageableSubareaIds ? [...accessContext.manageableSubareaIds] : [];

		const [teamEmployees, locationAreaEmployees, subareaAreaEmployees] = yield* _(
			Effect.all([
				teamIds.length > 0
					? accessContext.actor.dbService.query(`${queryName}:teamEmployees`, async () => {
						return await accessContext.actor.dbService.db.query.employee.findMany({
							where: and(
								eq(employee.organizationId, accessContext.actor.organizationId),
								inArray(employee.teamId, teamIds),
							),
							columns: { id: true },
						});
					})
					: Effect.succeed([] as Array<{ id: string }>),
				locationIds.length > 0
					? accessContext.actor.dbService.query(`${queryName}:locationAreaEmployees`, async () => {
						return await accessContext.actor.dbService.db.query.locationEmployee.findMany({
							where: inArray(locationEmployee.locationId, locationIds),
							columns: { employeeId: true },
						});
					})
					: Effect.succeed([] as Array<{ employeeId: string }>),
				subareaIds.length > 0
					? accessContext.actor.dbService.query(`${queryName}:subareaAreaEmployees`, async () => {
						return await accessContext.actor.dbService.db.query.subareaEmployee.findMany({
							where: inArray(subareaEmployee.subareaId, subareaIds),
							columns: { employeeId: true },
						});
					})
					: Effect.succeed([] as Array<{ employeeId: string }>),
			]),
		);

		return new Set([
			...(accessContext.managedEmployeeIds ? [...accessContext.managedEmployeeIds] : []),
			...teamEmployees.map((employeeRecord) => employeeRecord.id),
			...locationAreaEmployees.map((assignment) => assignment.employeeId),
			...subareaAreaEmployees.map((assignment) => assignment.employeeId),
		]);
	});
}

function getVisibleCategoryIds(accessContext: WorkCategoryAccessContext, queryName: string) {
	return Effect.gen(function* (_) {
		if (accessContext.actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		const scopedEmployeeIds = yield* _(getScopedEmployeeIds(accessContext, `${queryName}:employees`));
		const employeeIds = scopedEmployeeIds ? [...scopedEmployeeIds] : [];
		const projectIds = accessContext.managedProjectIds ? [...accessContext.managedProjectIds] : [];

		const [employeeCategoryRows, projectCategoryRows] = yield* _(
			Effect.all([
				employeeIds.length > 0
					? accessContext.actor.dbService.query(`${queryName}:employeeCategoryIds`, async () => {
						return await accessContext.actor.dbService.db
							.select({ workCategoryId: workPeriod.workCategoryId })
							.from(workPeriod)
							.where(
								and(
									eq(workPeriod.organizationId, accessContext.actor.organizationId),
									inArray(workPeriod.employeeId, employeeIds),
								),
							);
					})
					: Effect.succeed([] as Array<{ workCategoryId: string | null }>),
				projectIds.length > 0
					? accessContext.actor.dbService.query(`${queryName}:projectCategoryIds`, async () => {
						return await accessContext.actor.dbService.db
							.select({ workCategoryId: workPeriod.workCategoryId })
							.from(workPeriod)
							.where(
								and(
									eq(workPeriod.organizationId, accessContext.actor.organizationId),
									inArray(workPeriod.projectId, projectIds),
								),
							);
					})
					: Effect.succeed([] as Array<{ workCategoryId: string | null }>),
			]),
		);

		return new Set(
			[...employeeCategoryRows, ...projectCategoryRows]
				.map((row) => row.workCategoryId)
				.filter((categoryId): categoryId is string => Boolean(categoryId)),
		);
	});
}

function getVisibleSetIds(accessContext: WorkCategoryAccessContext, queryName: string) {
	return Effect.gen(function* (_) {
		if (accessContext.actor.accessTier === "orgAdmin") {
			return null as Set<string> | null;
		}

		const visibleCategoryIds = yield* _(getVisibleCategoryIds(accessContext, `${queryName}:categories`));
		const categoryIds = visibleCategoryIds ? [...visibleCategoryIds] : [];

		if (categoryIds.length === 0) {
			return new Set<string>();
		}

		const setLinks = yield* _(
			accessContext.actor.dbService.query(`${queryName}:setLinks`, async () => {
				return await accessContext.actor.dbService.db
					.select({ setId: workCategorySetCategory.setId, categoryId: workCategorySetCategory.categoryId })
					.from(workCategorySetCategory)
					.where(inArray(workCategorySetCategory.categoryId, categoryIds));
			}),
		);

		return new Set(setLinks.map((link) => link.setId));
	});
}

function filterAssignmentsByManagerScope(
	assignments: SetAssignmentListItem[],
	manageableTeamIds: Set<string> | null,
	scopedEmployeeIds: Set<string> | null,
) {
	return assignments.filter((assignment) => {
		if (assignment.assignmentType === "team") {
			return assignment.teamId ? manageableTeamIds?.has(assignment.teamId) ?? false : false;
		}

		if (assignment.assignmentType === "employee") {
			return assignment.employeeId ? scopedEmployeeIds?.has(assignment.employeeId) ?? false : false;
		}

		return false;
	});
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
		const accessContext = yield* _(
			getScopedWorkCategoryAccessContext(organizationId, "getOrganizationCategories:actor"),
		);
		const dbService = accessContext.actor.dbService;

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

		if (accessContext.actor.accessTier === "orgAdmin") {
			return categories;
		}

		const visibleCategoryIds = yield* _(
			getVisibleCategoryIds(accessContext, "getOrganizationCategories:visible"),
		);

		return categories.filter((category) => visibleCategoryIds?.has(category.id));
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
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: input.organizationId,
				queryName: "createOrganizationCategory:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to create work categories",
				resource: "work_category",
				action: "create",
			}),
		);
		const dbService = actor.dbService;

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
							createdBy: actor.session.user.id,
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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "updateOrganizationCategory:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to update work categories",
				resource: "work_category",
				action: "update",
			}),
		);
		const dbService = actor.dbService;
		const scopedCategory = yield* _(
			getScopedOrganizationWorkCategory(
				dbService,
				actor.organizationId,
				input.categoryId,
				"updateOrganizationCategory:scopedCategory",
			),
		);

		if (!scopedCategory) {
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
							updatedBy: actor.session.user.id,
						})
						.where(
							and(
								eq(workCategory.id, input.categoryId),
								eq(workCategory.organizationId, actor.organizationId),
							),
						)
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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "deleteOrganizationCategory:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to delete work categories",
				resource: "work_category",
				action: "delete",
			}),
		);
		const dbService = actor.dbService;
		const scopedCategory = yield* _(
			getScopedOrganizationWorkCategory(
				dbService,
				actor.organizationId,
				categoryId,
				"deleteOrganizationCategory:scopedCategory",
			),
		);

		if (!scopedCategory) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category not found",
						entityType: "work_category",
						entityId: categoryId,
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
						.set({ isActive: false, updatedBy: actor.session.user.id })
						.where(
							and(
								eq(workCategory.id, categoryId),
								eq(workCategory.organizationId, actor.organizationId),
							),
						),
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
		const accessContext = yield* _(
			getScopedWorkCategoryAccessContext(organizationId, "getWorkCategorySets:actor"),
		);
		const dbService = accessContext.actor.dbService;

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

		if (accessContext.actor.accessTier === "orgAdmin") {
			return sets;
		}

		const visibleSetIds = yield* _(
			getVisibleSetIds(accessContext, "getWorkCategorySets:visibleSets"),
		);

		return sets.filter((set) => visibleSetIds?.has(set.id));
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
		const accessContext = yield* _(
			getScopedWorkCategoryAccessContext(undefined, "getWorkCategorySetDetail:actor"),
		);
		const dbService = accessContext.actor.dbService;
		const visibleCategoryIds =
			accessContext.actor.accessTier === "orgAdmin"
				? null
				: yield* _(getVisibleCategoryIds(accessContext, "getWorkCategorySetDetail:visibleCategories"));

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

		if (accessContext.actor.accessTier !== "orgAdmin") {
			if (set.organizationId !== accessContext.actor.organizationId) {
				yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "Cannot access work category set from different organization",
							userId: accessContext.actor.session.user.id,
							resource: "work_category_set",
							action: "read",
						}),
					),
				);
			}

			const visibleSetIds = visibleCategoryIds
				? new Set(
						(
							yield* _(
								accessContext.actor.dbService.query("getWorkCategorySetDetail:visibleSetLinks", async () => {
									return await accessContext.actor.dbService.db
										.select({ setId: workCategorySetCategory.setId })
										.from(workCategorySetCategory)
										.where(inArray(workCategorySetCategory.categoryId, [...visibleCategoryIds]));
								}),
							)
						).map((link) => link.setId),
				)
				: new Set<string>();

			if (!visibleSetIds?.has(setId)) {
				yield* _(
					Effect.fail(
						new AuthorizationError({
							message: "You do not have access to this work category set",
							userId: accessContext.actor.session.user.id,
							resource: "work_category_set",
							action: "read",
						}),
					),
				);
			}
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

		if (accessContext.actor.accessTier !== "orgAdmin") {
			return {
				set,
				categories: categories.filter((category) => visibleCategoryIds?.has(category.id)),
			};
		}

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
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: input.organizationId,
				queryName: "createWorkCategorySet:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to create work category sets",
				resource: "work_category_set",
				action: "create",
			}),
		);
		const dbService = actor.dbService;
		yield* _(
			ensureScopedCategoryIds(
				dbService,
				input.organizationId,
				input.categoryIds ?? [],
				"createWorkCategorySet:scopedCategoryIds",
			),
		);

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
							createdBy: actor.session.user.id,
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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "updateWorkCategorySet:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to update work category sets",
				resource: "work_category_set",
				action: "update",
			}),
		);
		const dbService = actor.dbService;
		const scopedSet = yield* _(
			getScopedOrganizationWorkCategorySet(
				dbService,
				actor.organizationId,
				input.setId,
				"updateWorkCategorySet:scopedSet",
			),
		);

		if (!scopedSet) {
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

		// Update the set
		const [updated] = yield* _(
			Effect.tryPromise({
				try: async () =>
					dbService.db
						.update(workCategorySet)
						.set({
							name: input.name,
							description: input.description,
							updatedBy: actor.session.user.id,
						})
						.where(
							and(
								eq(workCategorySet.id, input.setId),
								eq(workCategorySet.organizationId, actor.organizationId),
							),
						)
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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "deleteWorkCategorySet:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to delete work category sets",
				resource: "work_category_set",
				action: "delete",
			}),
		);
		const dbService = actor.dbService;
		const scopedSet = yield* _(
			getScopedOrganizationWorkCategorySet(
				dbService,
				actor.organizationId,
				setId,
				"deleteWorkCategorySet:scopedSet",
			),
		);

		if (!scopedSet) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category set not found",
						entityType: "work_category_set",
						entityId: setId,
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
						.set({ isActive: false, updatedBy: actor.session.user.id })
						.where(
							and(
								eq(workCategorySet.id, setId),
								eq(workCategorySet.organizationId, actor.organizationId),
							),
						),
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
						.where(
							and(
								eq(workCategorySetAssignment.setId, setId),
								eq(workCategorySetAssignment.organizationId, actor.organizationId),
							),
						),
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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "updateSetCategories:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to update set categories",
				resource: "work_category_set_category",
				action: "update",
			}),
		);
		const dbService = actor.dbService;
		const scopedSet = yield* _(
			getScopedOrganizationWorkCategorySet(
				dbService,
				actor.organizationId,
				setId,
				"updateSetCategories:scopedSet",
			),
		);

		if (!scopedSet) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category set not found",
						entityType: "work_category_set",
						entityId: setId,
					}),
				),
			);
		}
		yield* _(
			ensureScopedCategoryIds(
				dbService,
				actor.organizationId,
				categoryIds,
				"updateSetCategories:scopedCategoryIds",
			),
		);

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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "reorderSetCategories:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to reorder categories",
				resource: "work_category_set_category",
				action: "update",
			}),
		);
		const dbService = actor.dbService;
		const scopedSet = yield* _(
			getScopedOrganizationWorkCategorySet(
				dbService,
				actor.organizationId,
				setId,
				"reorderSetCategories:scopedSet",
			),
		);

		if (!scopedSet) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category set not found",
						entityType: "work_category_set",
						entityId: setId,
					}),
				),
			);
		}
		yield* _(
			ensureScopedCategoryIds(
				dbService,
				actor.organizationId,
				categoryIds,
				"reorderSetCategories:scopedCategoryIds",
			),
		);

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
		const accessContext = yield* _(
			getScopedWorkCategoryAccessContext(organizationId, "getWorkCategorySetAssignments:actor"),
		);
		const dbService = accessContext.actor.dbService;

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

		if (accessContext.actor.accessTier === "orgAdmin") {
			return assignments;
		}

		const visibleSetIds = yield* _(
			getVisibleSetIds(accessContext, "getWorkCategorySetAssignments:visibleSets"),
		);
		const scopedEmployeeIds = yield* _(
			getScopedEmployeeIds(accessContext, "getWorkCategorySetAssignments:scopedEmployees"),
		);

		return filterAssignmentsByManagerScope(
			assignments.filter((assignment) => visibleSetIds?.has(assignment.setId)),
			accessContext.manageableTeamIds,
			scopedEmployeeIds,
		);
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
		const actor = yield* _(
			getEmployeeSettingsActorContext({
				organizationId: input.organizationId,
				queryName: "createSetAssignment:actor",
			}),
		);
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to create set assignments",
				resource: "work_category_set_assignment",
				action: "create",
			}),
		);
		const dbService = actor.dbService;
		const scopedSet = yield* _(
			getScopedOrganizationWorkCategorySet(
				dbService,
				input.organizationId,
				input.setId,
				"createSetAssignment:scopedSet",
			),
		);

		if (!scopedSet) {
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
							createdBy: actor.session.user.id,
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
		const actor = yield* _(getEmployeeSettingsActorContext({ queryName: "deleteSetAssignment:actor" }));
		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Admin access required to delete set assignments",
				resource: "work_category_set_assignment",
				action: "delete",
			}),
		);
		const dbService = actor.dbService;
		const scopedAssignment = yield* _(
			getScopedOrganizationSetAssignment(
				dbService,
				actor.organizationId,
				assignmentId,
				"deleteSetAssignment:scopedAssignment",
			),
		);

		if (!scopedAssignment) {
			yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Work category set assignment not found",
						entityType: "work_category_set_assignment",
						entityId: assignmentId,
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
						.where(
							and(
								eq(workCategorySetAssignment.id, assignmentId),
								eq(workCategorySetAssignment.organizationId, actor.organizationId),
							),
						),
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
