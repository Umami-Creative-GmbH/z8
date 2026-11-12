"use server";

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { user } from "@/db/auth-schema";
import {
	employee,
	locationEmployee,
	projectManager,
	subareaEmployee,
	surchargeCalculation,
	surchargeModel,
	surchargeModelAssignment,
	surchargeRule,
	team,
	teamPermissions,
	workPeriod,
} from "@/db/schema";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import type {
	SurchargeAssignmentWithDetails,
	SurchargeCalculationWithDetails,
	SurchargeModelWithRules,
} from "@/lib/surcharges/validation";
import {
	dayOfWeekRuleSchema,
	surchargeAssignmentFormSchema,
	surchargeModelFormSchema,
	surchargeRuleSchema,
	timeWindowRuleSchema,
	updateSurchargeModelSchema,
} from "@/lib/surcharges/validation";

// ============================================
// SCOPE OF A SCOPED MANAGER
// ============================================

/**
 * What a scoped manager sees of surcharges: the teams whose settings they
 * manage, the locations, subareas and projects they are assigned to, and the
 * employees of those teams, locations and subareas. Null for an org admin, who
 * sees the whole organization.
 */
type SurchargeScope = {
	manageableTeamIds: Set<string>;
	scopedEmployeeIds: Set<string>;
	manageableLocationIds: Set<string>;
	manageableSubareaIds: Set<string>;
	managedProjectIds: Set<string>;
};

type ScopedWorkPeriodSummary = {
	id: string;
	organizationId: string;
	projectId: string | null;
	locationId: string | null;
	subareaId: string | null;
};

const EMPTY_SCOPE: SurchargeScope = {
	manageableTeamIds: new Set(),
	scopedEmployeeIds: new Set(),
	manageableLocationIds: new Set(),
	manageableSubareaIds: new Set(),
	managedProjectIds: new Set(),
};

function surchargeScopeOf(actor: OrganizationActor, organizationId: string) {
	if (actor.settingsAccess !== "scopedManager") return Effect.succeed(null);
	const managerId = actor.employee?.id;
	if (!managerId) return Effect.succeed(EMPTY_SCOPE);
	return storeStep("surcharges.managerScope", (db) =>
		loadSurchargeScope(db, organizationId, managerId),
	);
}

async function loadSurchargeScope(
	db: DatabaseClient,
	organizationId: string,
	managerId: string,
): Promise<SurchargeScope> {
	const [
		teamPermissionRows,
		managerLocationAssignments,
		managerSubareaAssignments,
		managedProjects,
	] = await Promise.all([
		db.query.teamPermissions.findMany({
			where: and(
				eq(teamPermissions.employeeId, managerId),
				eq(teamPermissions.organizationId, organizationId),
			),
			columns: { teamId: true, canManageTeamSettings: true },
		}),
		db.query.locationEmployee.findMany({
			where: eq(locationEmployee.employeeId, managerId),
			columns: { locationId: true },
		}),
		db.query.subareaEmployee.findMany({
			where: eq(subareaEmployee.employeeId, managerId),
			columns: { subareaId: true },
		}),
		db.query.projectManager.findMany({
			where: eq(projectManager.employeeId, managerId),
			columns: { projectId: true },
		}),
	]);

	const manageableTeamIds = new Set(
		teamPermissionRows.flatMap((permission) =>
			permission.canManageTeamSettings && permission.teamId ? [permission.teamId] : [],
		),
	);
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
	const managedProjectIds = new Set(managedProjects.map((assignment) => assignment.projectId));

	const [teamEmployees, locationEmployees, subareaEmployees] = await Promise.all([
		manageableTeamIds.size
			? db.query.employee.findMany({
					where: and(
						eq(employee.organizationId, organizationId),
						eq(employee.isActive, true),
						inArray(employee.teamId, [...manageableTeamIds]),
					),
					columns: { id: true },
				})
			: Promise.resolve([]),
		manageableLocationIds.size
			? db.query.locationEmployee.findMany({
					where: inArray(locationEmployee.locationId, [...manageableLocationIds]),
					columns: { employeeId: true },
				})
			: Promise.resolve([]),
		manageableSubareaIds.size
			? db.query.subareaEmployee.findMany({
					where: inArray(subareaEmployee.subareaId, [...manageableSubareaIds]),
					columns: { employeeId: true },
				})
			: Promise.resolve([]),
	]);

	return {
		manageableTeamIds,
		scopedEmployeeIds: new Set<string>([
			...teamEmployees.map((employeeRecord) => employeeRecord.id),
			...locationEmployees.map((assignment) => assignment.employeeId),
			...subareaEmployees.map((assignment) => assignment.employeeId),
		]),
		manageableLocationIds,
		manageableSubareaIds,
		managedProjectIds,
	};
}

function filterAssignmentsForManagerScope<T extends SurchargeAssignmentWithDetails>(
	assignments: T[],
	scope: SurchargeScope,
) {
	return assignments
		.filter((assignment) => {
			if (assignment.assignmentType === "organization") {
				return true;
			}

			if (assignment.assignmentType === "team") {
				return assignment.teamId ? scope.manageableTeamIds.has(assignment.teamId) : false;
			}

			return assignment.employeeId ? scope.scopedEmployeeIds.has(assignment.employeeId) : false;
		})
		.sort((left, right) => {
			if (left.priority !== right.priority) {
				return right.priority - left.priority;
			}

			return right.createdAt.getTime() - left.createdAt.getTime();
		});
}

async function getScopedWorkPeriodsById(
	db: DatabaseClient,
	organizationId: string,
	workPeriodIds: string[],
): Promise<Map<string, ScopedWorkPeriodSummary>> {
	if (workPeriodIds.length === 0) {
		return new Map();
	}

	const workPeriods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, organizationId),
			inArray(workPeriod.id, workPeriodIds),
		),
		columns: {
			id: true,
			organizationId: true,
			projectId: true,
		},
	});

	return new Map(
		workPeriods.map((period) => [
			period.id,
			{
				...period,
				locationId: null,
				subareaId: null,
			},
		]),
	);
}

function workPeriodInScope(
	scope: SurchargeScope,
	organizationId: string,
	workPeriodSummary: ScopedWorkPeriodSummary | undefined,
) {
	if (!workPeriodSummary || workPeriodSummary.organizationId !== organizationId) {
		return false;
	}

	return Boolean(
		(workPeriodSummary.projectId && scope.managedProjectIds.has(workPeriodSummary.projectId)) ||
			(workPeriodSummary.locationId &&
				scope.manageableLocationIds.has(workPeriodSummary.locationId)) ||
			(workPeriodSummary.subareaId && scope.manageableSubareaIds.has(workPeriodSummary.subareaId)),
	);
}

async function loadAssignmentsWithNames(
	db: DatabaseClient,
	organizationId: string,
	activeOnly: boolean,
) {
	const assignments = await db.query.surchargeModelAssignment.findMany({
		where: activeOnly
			? and(
					eq(surchargeModelAssignment.organizationId, organizationId),
					eq(surchargeModelAssignment.isActive, true),
				)
			: eq(surchargeModelAssignment.organizationId, organizationId),
		with: {
			model: { columns: { id: true, name: true } },
			team: { columns: { id: true, name: true } },
			employee: {
				columns: { id: true },
				with: { user: { columns: { firstName: true, lastName: true } } },
			},
		},
		orderBy: [desc(surchargeModelAssignment.priority), desc(surchargeModelAssignment.createdAt)],
	});
	return assignments.map((assignment) => ({
		...assignment,
		employee: assignment.employee
			? {
					id: assignment.employee.id,
					firstName: assignment.employee.user?.firstName ?? null,
					lastName: assignment.employee.user?.lastName ?? null,
				}
			: null,
	})) as SurchargeAssignmentWithDetails[];
}

/** The models a scoped manager sees: assigned in their scope, or calculated for it. */
async function visibleModelIdsForScope(
	db: DatabaseClient,
	organizationId: string,
	scope: SurchargeScope,
) {
	const visibleModelIds = new Set<string>();
	const assignments = await loadAssignmentsWithNames(db, organizationId, true);

	for (const assignment of filterAssignmentsForManagerScope(assignments, scope)) {
		visibleModelIds.add(assignment.modelId);
	}

	const calculations = await db.query.surchargeCalculation.findMany({
		where: eq(surchargeCalculation.organizationId, organizationId),
		columns: {
			surchargeModelId: true,
			workPeriodId: true,
			employeeId: true,
		},
	});
	const scopedWorkPeriodsById = await getScopedWorkPeriodsById(
		db,
		organizationId,
		calculations.map((calculation) => calculation.workPeriodId),
	);

	for (const calculation of calculations) {
		if (!calculation.surchargeModelId) {
			continue;
		}

		if (calculation.employeeId && scope.scopedEmployeeIds.has(calculation.employeeId)) {
			visibleModelIds.add(calculation.surchargeModelId);
			continue;
		}

		if (
			workPeriodInScope(scope, organizationId, scopedWorkPeriodsById.get(calculation.workPeriodId))
		) {
			visibleModelIds.add(calculation.surchargeModelId);
		}
	}

	return visibleModelIds;
}

// ============================================
// ROWS BY ID AND THE SESSION'S ORGANIZATION
// ============================================

const modelNotFound = (modelId: string) =>
	new NotFoundError({
		message: "Surcharge model not found",
		entityType: "surchargeModel",
		entityId: modelId,
	});

function loadModel(organizationId: string, modelId: string) {
	return storeStep("surcharges.getModel", (db) =>
		db.query.surchargeModel.findFirst({
			where: and(eq(surchargeModel.id, modelId), eq(surchargeModel.organizationId, organizationId)),
			with: { rules: true },
		}),
	).pipe(
		Effect.flatMap((model) =>
			model ? Effect.succeed(model) : Effect.fail(modelNotFound(modelId)),
		),
	);
}

function loadRule(organizationId: string, ruleId: string) {
	return storeStep("surcharges.getRule", async (db) => {
		const rule = await db.query.surchargeRule.findFirst({ where: eq(surchargeRule.id, ruleId) });
		if (!rule) return null;
		const model = await db.query.surchargeModel.findFirst({
			where: and(
				eq(surchargeModel.id, rule.modelId),
				eq(surchargeModel.organizationId, organizationId),
			),
			columns: { id: true },
		});
		return model ? rule : null;
	}).pipe(
		Effect.flatMap((rule) =>
			rule
				? Effect.succeed(rule)
				: Effect.fail(
						new NotFoundError({
							message: "Rule not found",
							entityType: "surchargeRule",
							entityId: ruleId,
						}),
					),
		),
	);
}

function loadAssignment(organizationId: string, assignmentId: string) {
	return storeStep("surcharges.getAssignment", (db) =>
		db.query.surchargeModelAssignment.findFirst({
			where: and(
				eq(surchargeModelAssignment.id, assignmentId),
				eq(surchargeModelAssignment.organizationId, organizationId),
			),
			columns: { id: true, modelId: true },
		}),
	).pipe(
		Effect.flatMap((assignment) =>
			assignment
				? Effect.succeed(assignment)
				: Effect.fail(
						new NotFoundError({
							message: "Surcharge assignment not found",
							entityType: "surchargeAssignment",
							entityId: assignmentId,
						}),
					),
		),
	);
}

const id = z.string().min(1);

// ============================================
// MODEL CRUD
// ============================================

/** The organization's surcharge models; a scoped manager sees those of their scope. */
export const getSurchargeModels = organizationAction(
	{ name: "surcharges.listModels", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* surchargeScopeOf(actor, organizationId);
			return yield* storeStep("surcharges.listModels", async (db) => {
				const models = (await db.query.surchargeModel.findMany({
					where: eq(surchargeModel.organizationId, organizationId),
					with: { rules: true },
					orderBy: [desc(surchargeModel.createdAt)],
				})) as SurchargeModelWithRules[];
				if (!scope) return models;
				const visibleModelIds = await visibleModelIdsForScope(db, organizationId, scope);
				return models.filter((model) => visibleModelIds.has(model.id));
			});
		}),
);

/** One surcharge model of the organization. */
export const getSurchargeModel = organizationAction(
	{ name: "surcharges.getModel", requires: "scopedManager", schema: id },
	({ actor, organizationId, input: modelId }) =>
		Effect.gen(function* () {
			const model = yield* loadModel(organizationId, modelId);
			const scope = yield* surchargeScopeOf(actor, organizationId);
			if (scope) {
				const visibleModelIds = yield* storeStep("surcharges.visibleModels", (db) =>
					visibleModelIdsForScope(db, organizationId, scope),
				);
				if (!visibleModelIds.has(model.id)) {
					return yield* Effect.fail(
						new AuthorizationError({
							message: "This surcharge model is outside your scope",
							userId: actor.userId,
							resource: "surchargeModel",
							action: "read",
						}),
					);
				}
			}
			return model as SurchargeModelWithRules;
		}),
);

function ruleValues(rule: z.output<typeof surchargeRuleSchema>, priority: number) {
	return {
		name: rule.name,
		description: rule.description,
		ruleType: rule.ruleType,
		percentage: rule.percentage.toString(),
		dayOfWeek: rule.ruleType === "day_of_week" ? rule.dayOfWeek : null,
		windowStartTime: rule.ruleType === "time_window" ? rule.windowStartTime : null,
		windowEndTime: rule.ruleType === "time_window" ? rule.windowEndTime : null,
		specificDate: rule.ruleType === "date_based" ? rule.specificDate : null,
		dateRangeStart: rule.ruleType === "date_based" ? rule.dateRangeStart : null,
		dateRangeEnd: rule.ruleType === "date_based" ? rule.dateRangeEnd : null,
		priority: rule.priority ?? priority,
		validFrom: rule.validFrom,
		validUntil: rule.validUntil,
		isActive: rule.isActive,
	};
}

/** Creates a surcharge model with its rules. */
export const createSurchargeModel = organizationAction(
	{ name: "surcharges.createModel", requires: "orgAdmin", schema: surchargeModelFormSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { rules, ...modelData } = input;
			const newModel = yield* storeStep("surcharges.createModel", async (db) => {
				const [created] = await db
					.insert(surchargeModel)
					.values({
						organizationId,
						name: modelData.name,
						description: modelData.description,
						isActive: modelData.isActive,
						createdBy: actor.userId,
						updatedAt: new Date(),
					})
					.returning({ id: surchargeModel.id });
				if (created && rules.length > 0) {
					await db.insert(surchargeRule).values(
						rules.map((rule, index) => ({
							modelId: created.id,
							...ruleValues(rule, index),
							createdBy: actor.userId,
						})),
					);
				}
				return created;
			});
			if (!newModel) {
				return yield* Effect.fail(
					new ValidationError({ message: "Failed to create surcharge model", field: "name" }),
				);
			}
			revalidatePath("/settings/surcharges");
			return { id: newModel.id };
		}),
);

/** Updates a surcharge model's name, description or status. */
export const updateSurchargeModel = organizationAction(
	{
		name: "surcharges.updateModel",
		requires: "orgAdmin",
		schema: z.strictObject({ modelId: id, data: updateSurchargeModelSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* loadModel(organizationId, input.modelId);
			yield* storeStep("surcharges.updateModel", (db) =>
				db
					.update(surchargeModel)
					.set({ ...input.data, updatedBy: actor.userId, updatedAt: new Date() })
					.where(
						and(
							eq(surchargeModel.id, input.modelId),
							eq(surchargeModel.organizationId, organizationId),
						),
					),
			);
			revalidatePath("/settings/surcharges");
		}),
);

/** Deactivates a surcharge model and its assignments. */
export const deleteSurchargeModel = organizationAction(
	{ name: "surcharges.deleteModel", requires: "orgAdmin", schema: id },
	({ actor, organizationId, input: modelId }) =>
		Effect.gen(function* () {
			yield* loadModel(organizationId, modelId);
			yield* storeStep("surcharges.deleteModel", async (db) => {
				await db
					.update(surchargeModel)
					.set({ isActive: false, updatedBy: actor.userId, updatedAt: new Date() })
					.where(
						and(eq(surchargeModel.id, modelId), eq(surchargeModel.organizationId, organizationId)),
					);
				await db
					.update(surchargeModelAssignment)
					.set({ isActive: false, updatedAt: new Date() })
					.where(
						and(
							eq(surchargeModelAssignment.modelId, modelId),
							eq(surchargeModelAssignment.organizationId, organizationId),
						),
					);
			});
			revalidatePath("/settings/surcharges");
		}),
);

// ============================================
// RULE CRUD
// ============================================

function touchModel(db: DatabaseClient, modelId: string, userId: string) {
	return db
		.update(surchargeModel)
		.set({ updatedBy: userId, updatedAt: new Date() })
		.where(eq(surchargeModel.id, modelId));
}

/** Adds a rule to a surcharge model. */
export const addSurchargeRule = organizationAction(
	{
		name: "surcharges.addRule",
		requires: "orgAdmin",
		schema: z.strictObject({ modelId: id, rule: surchargeRuleSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* loadModel(organizationId, input.modelId);
			const newRule = yield* storeStep("surcharges.addRule", async (db) => {
				const [created] = await db
					.insert(surchargeRule)
					.values({
						modelId: input.modelId,
						...ruleValues(input.rule, 0),
						createdBy: actor.userId,
					})
					.returning({ id: surchargeRule.id });
				if (created) await touchModel(db, input.modelId, actor.userId);
				return created;
			});
			if (!newRule) {
				return yield* Effect.fail(
					new ValidationError({ message: "Failed to create rule", field: "rule" }),
				);
			}
			revalidatePath("/settings/surcharges");
			return { id: newRule.id };
		}),
);

/** The fields a rule change may carry; type-specific ones apply with their `ruleType`. */
const surchargeRulePatchSchema = z.strictObject({
	ruleType: z.enum(["day_of_week", "time_window", "date_based"]).optional(),
	name: z.string().min(1, "Name is required").max(255).optional(),
	description: z.string().max(1000).nullable().optional(),
	percentage: dayOfWeekRuleSchema.shape.percentage.optional(),
	dayOfWeek: dayOfWeekRuleSchema.shape.dayOfWeek.optional(),
	windowStartTime: timeWindowRuleSchema.shape.windowStartTime.optional(),
	windowEndTime: timeWindowRuleSchema.shape.windowEndTime.optional(),
	specificDate: z.date().nullable().optional(),
	dateRangeStart: z.date().nullable().optional(),
	dateRangeEnd: z.date().nullable().optional(),
	priority: z.number().int().min(0).optional(),
	validFrom: z.date().nullable().optional(),
	validUntil: z.date().nullable().optional(),
	isActive: z.boolean().optional(),
});

/** Updates a rule of a surcharge model. */
export const updateSurchargeRule = organizationAction(
	{
		name: "surcharges.updateRule",
		requires: "orgAdmin",
		schema: z.strictObject({ ruleId: id, data: surchargeRulePatchSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const existingRule = yield* loadRule(organizationId, input.ruleId);
			const data = input.data;

			const updateData: Record<string, unknown> = {};
			if (data.name !== undefined) updateData.name = data.name;
			if (data.description !== undefined) updateData.description = data.description;
			if (data.percentage !== undefined) updateData.percentage = data.percentage.toString();
			if (data.priority !== undefined) updateData.priority = data.priority;
			if (data.validFrom !== undefined) updateData.validFrom = data.validFrom;
			if (data.validUntil !== undefined) updateData.validUntil = data.validUntil;
			if (data.isActive !== undefined) updateData.isActive = data.isActive;

			// Type-specific fields
			if (data.ruleType === "day_of_week" && "dayOfWeek" in data) {
				updateData.dayOfWeek = data.dayOfWeek;
			}
			if (data.ruleType === "time_window") {
				if ("windowStartTime" in data) updateData.windowStartTime = data.windowStartTime;
				if ("windowEndTime" in data) updateData.windowEndTime = data.windowEndTime;
			}
			if (data.ruleType === "date_based") {
				if ("specificDate" in data) updateData.specificDate = data.specificDate;
				if ("dateRangeStart" in data) updateData.dateRangeStart = data.dateRangeStart;
				if ("dateRangeEnd" in data) updateData.dateRangeEnd = data.dateRangeEnd;
			}

			if (Object.keys(updateData).length > 0) {
				yield* storeStep("surcharges.updateRule", async (db) => {
					await db.update(surchargeRule).set(updateData).where(eq(surchargeRule.id, input.ruleId));
					await touchModel(db, existingRule.modelId, actor.userId);
				});
			}
			revalidatePath("/settings/surcharges");
		}),
);

/** Deletes a rule of a surcharge model. */
export const deleteSurchargeRule = organizationAction(
	{ name: "surcharges.deleteRule", requires: "orgAdmin", schema: id },
	({ actor, organizationId, input: ruleId }) =>
		Effect.gen(function* () {
			const existingRule = yield* loadRule(organizationId, ruleId);
			yield* storeStep("surcharges.deleteRule", async (db) => {
				await db.delete(surchargeRule).where(eq(surchargeRule.id, ruleId));
				await touchModel(db, existingRule.modelId, actor.userId);
			});
			revalidatePath("/settings/surcharges");
		}),
);

// ============================================
// ASSIGNMENT CRUD
// ============================================

/** The organization's surcharge assignments; a scoped manager sees those of their scope. */
export const getSurchargeAssignments = organizationAction(
	{ name: "surcharges.listAssignments", requires: "scopedManager", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const scope = yield* surchargeScopeOf(actor, organizationId);
			const assignments = yield* storeStep("surcharges.listAssignments", (db) =>
				loadAssignmentsWithNames(db, organizationId, false),
			);
			return scope ? filterAssignmentsForManagerScope(assignments, scope) : assignments;
		}),
);

const DUPLICATE_ASSIGNMENT = "duplicate";

/** Assigns a surcharge model to the organization, a team or an employee on the current roster. */
export const createSurchargeAssignment = organizationAction(
	{
		name: "surcharges.createAssignment",
		requires: "orgAdmin",
		schema: surchargeAssignmentFormSchema,
		// Only an employee of this organization's current roster can be named (#1438).
		addsEmployees: (input) => (input.assignmentType === "employee" ? [input.employeeId] : []),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* loadModel(organizationId, input.modelId);
			const {
				modelId,
				assignmentType,
				teamId,
				employeeId,
				effectiveFrom,
				effectiveUntil,
				isActive,
			} = input;
			const priority = assignmentType === "employee" ? 2 : assignmentType === "team" ? 1 : 0;

			const created = yield* storeStep("surcharges.createAssignment", async (db) => {
				try {
					const [row] = await db
						.insert(surchargeModelAssignment)
						.values({
							modelId,
							organizationId,
							assignmentType,
							teamId: teamId ?? null,
							employeeId: employeeId ?? null,
							priority,
							effectiveFrom,
							effectiveUntil,
							isActive,
							createdBy: actor.userId,
							updatedAt: new Date(),
						})
						.returning({ id: surchargeModelAssignment.id });
					return row ?? null;
				} catch (error) {
					if (isUniqueViolation(error)) return DUPLICATE_ASSIGNMENT;
					throw error;
				}
			});
			if (created === DUPLICATE_ASSIGNMENT) {
				return yield* Effect.fail(
					new ValidationError({
						message: "An active assignment already exists for this target",
						field: "assignmentType",
					}),
				);
			}
			if (!created) {
				return yield* Effect.fail(
					new ValidationError({ message: "Failed to create assignment", field: "modelId" }),
				);
			}
			revalidatePath("/settings/surcharges");
			return { id: created.id };
		}),
);

function isUniqueViolation(error: unknown): boolean {
	const cause = (error as { cause?: { code?: string } } | null)?.cause;
	return (
		cause?.code === "23505" ||
		(error as { code?: string } | null)?.code === "23505" ||
		Boolean((error as Error | null)?.message?.includes("unique"))
	);
}

/** Deactivates a surcharge assignment. */
export const deleteSurchargeAssignment = organizationAction(
	{ name: "surcharges.deleteAssignment", requires: "orgAdmin", schema: id },
	({ organizationId, input: assignmentId }) =>
		Effect.gen(function* () {
			yield* loadAssignment(organizationId, assignmentId);
			yield* storeStep("surcharges.deleteAssignment", (db) =>
				db
					.update(surchargeModelAssignment)
					.set({ isActive: false, updatedAt: new Date() })
					.where(
						and(
							eq(surchargeModelAssignment.id, assignmentId),
							eq(surchargeModelAssignment.organizationId, organizationId),
						),
					),
			);
			revalidatePath("/settings/surcharges");
		}),
);

// ============================================
// CALCULATIONS / REPORTS
// ============================================

const SURCHARGE_REPORT_ROW_LIMIT = 500;
const SURCHARGE_REPORT_BATCH_SIZE = 500;
const SURCHARGE_REPORT_MANAGER_SCAN_LIMIT = SURCHARGE_REPORT_ROW_LIMIT * 10;

function normalizeSurchargeCalculationDetails(
	details: unknown,
): SurchargeCalculationWithDetails["calculationDetails"] {
	if (typeof details !== "string") {
		return details as SurchargeCalculationWithDetails["calculationDetails"];
	}

	try {
		const parsedDetails = JSON.parse(details) as unknown;
		if (
			parsedDetails &&
			typeof parsedDetails === "object" &&
			!Array.isArray(parsedDetails) &&
			Array.isArray((parsedDetails as { rulesApplied?: unknown }).rulesApplied)
		) {
			return parsedDetails as SurchargeCalculationWithDetails["calculationDetails"];
		}
	} catch {
		return null;
	}

	return null;
}

/** Surcharge calculations of a period, at most 500; a scoped manager sees those of their scope. */
export const getSurchargeCalculationsForPeriod = organizationAction(
	{
		name: "surcharges.calculationsForPeriod",
		requires: "scopedManager",
		schema: z.strictObject({
			startDate: z.date(),
			endDate: z.date(),
			employeeId: z.string().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* surchargeScopeOf(actor, organizationId);
			const conditions = [
				eq(surchargeCalculation.organizationId, organizationId),
				gte(surchargeCalculation.calculationDate, input.startDate),
				lte(surchargeCalculation.calculationDate, input.endDate),
			];
			if (input.employeeId) {
				conditions.push(eq(surchargeCalculation.employeeId, input.employeeId));
			}

			return yield* storeStep("surcharges.calculationsForPeriod", async (db) => {
				const fetchCalculationBatch = async (offset?: number) => {
					const calculations = await db.query.surchargeCalculation.findMany({
						where: and(...conditions),
						with: {
							employee: {
								columns: { id: true },
								with: {
									user: { columns: { firstName: true, lastName: true, name: true, email: true } },
								},
							},
						},
						orderBy: [
							desc(surchargeCalculation.calculationDate),
							desc(surchargeCalculation.createdAt),
							desc(surchargeCalculation.id),
						],
						limit: SURCHARGE_REPORT_BATCH_SIZE,
						...(offset === undefined ? {} : { offset }),
					});

					return calculations.map((calculation) => ({
						...calculation,
						calculationDetails: normalizeSurchargeCalculationDetails(
							calculation.calculationDetails,
						),
						employee: calculation.employee
							? {
									id: calculation.employee.id,
									firstName: calculation.employee.user?.firstName ?? null,
									lastName: calculation.employee.user?.lastName ?? null,
									name: calculation.employee.user?.name ?? null,
									email: calculation.employee.user?.email ?? null,
								}
							: calculation.employee,
					})) as SurchargeCalculationWithDetails[];
				};

				if (!scope) {
					return await fetchCalculationBatch();
				}

				const scopedCalculations: SurchargeCalculationWithDetails[] = [];
				let offset = 0;

				while (
					scopedCalculations.length < SURCHARGE_REPORT_ROW_LIMIT &&
					offset < SURCHARGE_REPORT_MANAGER_SCAN_LIMIT
				) {
					const calculationsWithAuthNames = await fetchCalculationBatch(offset);
					if (calculationsWithAuthNames.length === 0) {
						break;
					}

					const scopedWorkPeriodsById = await getScopedWorkPeriodsById(
						db,
						organizationId,
						calculationsWithAuthNames.map((calculation) => calculation.workPeriodId),
					);
					for (const calculation of calculationsWithAuthNames) {
						if (scopedCalculations.length >= SURCHARGE_REPORT_ROW_LIMIT) {
							break;
						}

						if (calculation.employeeId && scope.scopedEmployeeIds.has(calculation.employeeId)) {
							scopedCalculations.push(calculation);
							continue;
						}

						if (
							workPeriodInScope(
								scope,
								organizationId,
								scopedWorkPeriodsById.get(calculation.workPeriodId),
							)
						) {
							scopedCalculations.push(calculation);
						}
					}

					if (calculationsWithAuthNames.length < SURCHARGE_REPORT_BATCH_SIZE) {
						break;
					}

					offset += SURCHARGE_REPORT_BATCH_SIZE;
				}

				return scopedCalculations;
			});
		}),
);

/** The organization's teams, for the assignment picker. */
export const getTeamsForAssignment = organizationAction(
	{ name: "surcharges.teamsForAssignment", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("surcharges.teamsForAssignment", (db) =>
			db.query.team.findMany({
				where: eq(team.organizationId, organizationId),
				columns: { id: true, name: true },
				orderBy: [team.name],
			}),
		),
);

/** The organization's active employees, for the assignment picker. */
export const getEmployeesForAssignment = organizationAction(
	{ name: "surcharges.employeesForAssignment", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("surcharges.employeesForAssignment", (db) =>
			db
				.select({
					id: employee.id,
					firstName: user.firstName,
					lastName: user.lastName,
				})
				.from(employee)
				.innerJoin(user, eq(employee.userId, user.id))
				.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
				.orderBy(user.lastName, user.firstName),
		),
);
