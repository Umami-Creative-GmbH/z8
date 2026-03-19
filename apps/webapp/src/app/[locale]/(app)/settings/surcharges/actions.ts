"use server";

import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	employee,
	locationEmployee,
	projectManager,
	surchargeCalculation,
	surchargeModel,
	surchargeModelAssignment,
	surchargeRule,
	subareaEmployee,
	team,
	teamPermissions,
	workPeriod,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	isSettingsAccessMembershipRole,
	resolveSettingsAccessTier,
	type SettingsAccessTier,
} from "@/lib/settings-access";
import type {
	SurchargeAssignmentFormData,
	SurchargeAssignmentWithDetails,
	SurchargeCalculationWithDetails,
	SurchargeModelFormData,
	SurchargeModelWithRules,
	SurchargeRuleFormData,
	UpdateSurchargeModelData,
} from "@/lib/surcharges/validation";
import {
	surchargeAssignmentFormSchema,
	surchargeModelFormSchema,
	surchargeRuleSchema,
	updateSurchargeModelSchema,
} from "@/lib/surcharges/validation";

// ============================================
// TYPES
// ============================================

export type ServerActionResult<T> = { success: true; data: T } | { success: false; error: string };

type SurchargeSettingsActor = {
	accessTier: SettingsAccessTier;
	organizationId: string;
	userId: string;
	currentEmployee: {
		id: string;
		organizationId: string;
		role: "admin" | "manager" | "employee";
	} | null;
};

type SurchargeScopeContext = {
	actor: SurchargeSettingsActor;
	manageableTeamIds: Set<string> | null;
	scopedEmployeeIds: Set<string> | null;
	manageableLocationIds: Set<string> | null;
	manageableSubareaIds: Set<string> | null;
	managedProjectIds: Set<string> | null;
};

type ScopedWorkPeriodSummary = {
	id: string;
	organizationId: string;
	projectId: string | null;
	locationId: string | null;
	subareaId: string | null;
};

async function getSurchargeSettingsActor(
	organizationId?: string,
): Promise<SurchargeSettingsActor | null> {
	const authContext = await getAuthContext();
	const scopedOrganizationId = organizationId ?? authContext?.session.activeOrganizationId ?? null;

	if (!authContext || !scopedOrganizationId) {
		return null;
	}

	const membershipRecord = await db.query.member.findFirst({
		where: and(eq(member.userId, authContext.user.id), eq(member.organizationId, scopedOrganizationId)),
		columns: { role: true },
	});
	const employeeRole =
		authContext.employee?.organizationId === scopedOrganizationId ? authContext.employee.role : null;
	const accessTier = resolveSettingsAccessTier({
		activeOrganizationId: scopedOrganizationId,
		membershipRole: isSettingsAccessMembershipRole(membershipRecord?.role) ? membershipRecord.role : null,
		employeeRole,
	});

	if (accessTier === "member") {
		return null;
	}

	return {
		accessTier,
		organizationId: scopedOrganizationId,
		userId: authContext.user.id,
		currentEmployee:
			authContext.employee?.organizationId === scopedOrganizationId ? authContext.employee : null,
	};
}

async function getSurchargeScopeContext(organizationId: string): Promise<SurchargeScopeContext | null> {
	const actor = await getSurchargeSettingsActor(organizationId);

	if (!actor) {
		return null;
	}

	if (actor.accessTier === "orgAdmin") {
		return {
			actor,
			manageableTeamIds: null,
			scopedEmployeeIds: null,
			manageableLocationIds: null,
			manageableSubareaIds: null,
			managedProjectIds: null,
		};
	}

	if (!actor.currentEmployee) {
		return null;
	}

	const [teamPermissionRows, managerLocationAssignments, managerSubareaAssignments, managedProjects] =
		await Promise.all([
			db.query.teamPermissions.findMany({
				where: and(
					eq(teamPermissions.employeeId, actor.currentEmployee.id),
					eq(teamPermissions.organizationId, organizationId),
				),
				columns: { teamId: true, canManageTeamSettings: true },
			}),
			db.query.locationEmployee.findMany({
				where: eq(locationEmployee.employeeId, actor.currentEmployee.id),
				columns: { locationId: true },
			}),
			db.query.subareaEmployee.findMany({
				where: eq(subareaEmployee.employeeId, actor.currentEmployee.id),
				columns: { subareaId: true },
			}),
			db.query.projectManager.findMany({
				where: eq(projectManager.employeeId, actor.currentEmployee.id),
				columns: { projectId: true },
			}),
		]);

	const manageableTeamIds = new Set(
		teamPermissionRows
			.filter((permission) => permission.canManageTeamSettings && permission.teamId)
			.map((permission) => permission.teamId as string),
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

	const scopedEmployeeIds = new Set<string>([
		...teamEmployees.map((employeeRecord) => employeeRecord.id),
		...locationEmployees.map((assignment) => assignment.employeeId),
		...subareaEmployees.map((assignment) => assignment.employeeId),
	]);

	return {
		actor,
		manageableTeamIds,
		scopedEmployeeIds,
		manageableLocationIds,
		manageableSubareaIds,
		managedProjectIds,
	};
}

function filterAssignmentsForManagerScope<T extends SurchargeAssignmentWithDetails>(
	assignments: T[],
	manageableTeamIds: Set<string> | null,
	scopedEmployeeIds: Set<string> | null,
) {
	if (!manageableTeamIds || !scopedEmployeeIds) {
		return assignments;
	}

	return assignments
		.filter((assignment) => {
			if (assignment.assignmentType === "organization") {
				return true;
			}

			if (assignment.assignmentType === "team") {
				return assignment.teamId ? manageableTeamIds.has(assignment.teamId) : false;
			}

			return assignment.employeeId ? scopedEmployeeIds.has(assignment.employeeId) : false;
		})
		.sort((left, right) => {
			if (left.priority !== right.priority) {
				return right.priority - left.priority;
			}

			return right.createdAt.getTime() - left.createdAt.getTime();
		});
}

async function getScopedWorkPeriodsById(
	organizationId: string,
	workPeriodIds: string[],
): Promise<Map<string, ScopedWorkPeriodSummary>> {
	if (workPeriodIds.length === 0) {
		return new Map();
	}

	const workPeriods = await db.query.workPeriod.findMany({
		where: and(eq(workPeriod.organizationId, organizationId), inArray(workPeriod.id, workPeriodIds)),
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

function canManagerAccessSurchargeWorkPeriod(
	scopeContext: SurchargeScopeContext,
	workPeriodSummary: ScopedWorkPeriodSummary | undefined,
) {
	if (!workPeriodSummary || workPeriodSummary.organizationId !== scopeContext.actor.organizationId) {
		return false;
	}

	return Boolean(
		(workPeriodSummary.projectId && scopeContext.managedProjectIds?.has(workPeriodSummary.projectId)) ||
			(workPeriodSummary.locationId &&
				scopeContext.manageableLocationIds?.has(workPeriodSummary.locationId)) ||
			(workPeriodSummary.subareaId &&
				scopeContext.manageableSubareaIds?.has(workPeriodSummary.subareaId)),
	);
}

async function getVisibleModelIdsForManagerScope(scopeContext: SurchargeScopeContext) {
	if (scopeContext.actor.accessTier === "orgAdmin") {
		return null;
	}

	const visibleModelIds = new Set<string>();
	const assignments = await db.query.surchargeModelAssignment.findMany({
		where: and(
			eq(surchargeModelAssignment.organizationId, scopeContext.actor.organizationId),
			eq(surchargeModelAssignment.isActive, true),
		),
		with: {
			model: { columns: { id: true, name: true } },
			team: { columns: { id: true, name: true } },
			employee: { columns: { id: true, firstName: true, lastName: true } },
		},
		orderBy: [desc(surchargeModelAssignment.priority), desc(surchargeModelAssignment.createdAt)],
	}) as SurchargeAssignmentWithDetails[];

	for (const assignment of filterAssignmentsForManagerScope(
		assignments,
		scopeContext.manageableTeamIds,
		scopeContext.scopedEmployeeIds,
	)) {
		visibleModelIds.add(assignment.modelId);
	}

	const calculations = await db.query.surchargeCalculation.findMany({
		where: eq(surchargeCalculation.organizationId, scopeContext.actor.organizationId),
		columns: {
			surchargeModelId: true,
			workPeriodId: true,
			employeeId: true,
		},
	});
	const scopedWorkPeriodsById = await getScopedWorkPeriodsById(
		scopeContext.actor.organizationId,
		calculations.map((calculation) => calculation.workPeriodId),
	);

	for (const calculation of calculations) {
		if (!calculation.surchargeModelId) {
			continue;
		}

		if (calculation.employeeId && scopeContext.scopedEmployeeIds?.has(calculation.employeeId)) {
			visibleModelIds.add(calculation.surchargeModelId);
			continue;
		}

		if (
			canManagerAccessSurchargeWorkPeriod(
				scopeContext,
				scopedWorkPeriodsById.get(calculation.workPeriodId),
			)
		) {
			visibleModelIds.add(calculation.surchargeModelId);
		}
	}

	return visibleModelIds;
}

async function requireOrgAdminSurchargeActor(organizationId?: string) {
	const actor = await getSurchargeSettingsActor(organizationId);
	if (!actor || actor.accessTier !== "orgAdmin") {
		return null;
	}

	return actor;
}

async function getScopedSurchargeModelRecord(organizationId: string, modelId: string) {
	return await db.query.surchargeModel.findFirst({
		where: and(eq(surchargeModel.id, modelId), eq(surchargeModel.organizationId, organizationId)),
		with: { rules: true },
	});
}

async function getScopedSurchargeRuleRecord(organizationId: string, ruleId: string) {
	const rule = await db.query.surchargeRule.findFirst({
		where: eq(surchargeRule.id, ruleId),
	});

	if (!rule) {
		return null;
	}

	const model = await db.query.surchargeModel.findFirst({
		where: and(eq(surchargeModel.id, rule.modelId), eq(surchargeModel.organizationId, organizationId)),
		columns: { id: true },
	});

	if (!model) {
		return null;
	}

	return rule;
}

async function getScopedSurchargeAssignmentRecord(organizationId: string, assignmentId: string) {
	return await db.query.surchargeModelAssignment.findFirst({
		where: and(
			eq(surchargeModelAssignment.id, assignmentId),
			eq(surchargeModelAssignment.organizationId, organizationId),
		),
		columns: { id: true, modelId: true },
	});
}

// ============================================
// MODEL CRUD
// ============================================

/**
 * Get all surcharge models for an organization
 */
export async function getSurchargeModels(
	organizationId: string,
): Promise<ServerActionResult<SurchargeModelWithRules[]>> {
	try {
		const scopeContext = await getSurchargeScopeContext(organizationId);
		if (!scopeContext) {
			return { success: false, error: "Unauthorized" };
		}

		const models = await db.query.surchargeModel.findMany({
			where: eq(surchargeModel.organizationId, organizationId),
			with: {
				rules: true,
			},
			orderBy: [desc(surchargeModel.createdAt)],
		});

		if (scopeContext.actor.accessTier === "orgAdmin") {
			return { success: true, data: models as SurchargeModelWithRules[] };
		}

		const visibleModelIds = await getVisibleModelIdsForManagerScope(scopeContext);
		const scopedModels = models.filter((model) => visibleModelIds?.has(model.id));

		return { success: true, data: scopedModels as SurchargeModelWithRules[] };
	} catch (error) {
		console.error("Error fetching surcharge models:", error);
		return { success: false, error: "Failed to fetch surcharge models" };
	}
}

/**
 * Get a single surcharge model by ID
 */
export async function getSurchargeModel(
	modelId: string,
): Promise<ServerActionResult<SurchargeModelWithRules>> {
	try {
		const actor = await getSurchargeSettingsActor();
		if (!actor) {
			return { success: false, error: "Unauthorized" };
		}

		const model = await db.query.surchargeModel.findFirst({
			where: eq(surchargeModel.id, modelId),
			with: {
				rules: true,
			},
		});

		if (!model || model.organizationId !== actor.organizationId) {
			return { success: false, error: "Surcharge model not found" };
		}

		if (actor.accessTier === "manager") {
			const scopeContext = await getSurchargeScopeContext(actor.organizationId);
			const visibleModelIds = scopeContext ? await getVisibleModelIdsForManagerScope(scopeContext) : null;
			if (!visibleModelIds?.has(model.id)) {
				return { success: false, error: "Unauthorized" };
			}
		}

		return { success: true, data: model as SurchargeModelWithRules };
	} catch (error) {
		console.error("Error fetching surcharge model:", error);
		return { success: false, error: "Failed to fetch surcharge model" };
	}
}

/**
 * Create a new surcharge model with rules
 */
export async function createSurchargeModel(
	organizationId: string,
	data: SurchargeModelFormData,
): Promise<ServerActionResult<{ id: string }>> {
	try {
		const actor = await requireOrgAdminSurchargeActor(organizationId);

		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		// Validate input
		const validated = surchargeModelFormSchema.safeParse(data);
		if (!validated.success) {
			return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
		}

		const { rules, ...modelData } = validated.data;

		// Create model
		const [newModel] = await db
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

		if (!newModel) {
			return { success: false, error: "Failed to create surcharge model" };
		}

		// Create rules
		if (rules.length > 0) {
			await db.insert(surchargeRule).values(
				rules.map((rule, index) => ({
					modelId: newModel.id,
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
					priority: rule.priority ?? index,
					validFrom: rule.validFrom,
					validUntil: rule.validUntil,
					isActive: rule.isActive,
					createdBy: actor.userId,
				})),
			);
		}

		revalidatePath("/settings/surcharges");
		return { success: true, data: { id: newModel.id } };
	} catch (error) {
		console.error("Error creating surcharge model:", error);
		return { success: false, error: "Failed to create surcharge model" };
	}
}

/**
 * Update a surcharge model
 */
export async function updateSurchargeModel(
	modelId: string,
	data: UpdateSurchargeModelData,
): Promise<ServerActionResult<void>> {
	try {
		const actor = await requireOrgAdminSurchargeActor();
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const existingModel = await getScopedSurchargeModelRecord(actor.organizationId, modelId);
		if (!existingModel) {
			return { success: false, error: "Surcharge model not found" };
		}

		// Validate input
		const validated = updateSurchargeModelSchema.safeParse(data);
		if (!validated.success) {
			return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
		}

		await db
			.update(surchargeModel)
			.set({
				...validated.data,
				updatedBy: actor.userId,
				updatedAt: new Date(),
			})
			.where(eq(surchargeModel.id, modelId));

		revalidatePath("/settings/surcharges");
		return { success: true, data: undefined };
	} catch (error) {
		console.error("Error updating surcharge model:", error);
		return { success: false, error: "Failed to update surcharge model" };
	}
}

/**
 * Delete a surcharge model (soft delete by setting isActive = false)
 */
export async function deleteSurchargeModel(modelId: string): Promise<ServerActionResult<void>> {
	try {
		const actor = await requireOrgAdminSurchargeActor();
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const existingModel = await getScopedSurchargeModelRecord(actor.organizationId, modelId);
		if (!existingModel) {
			return { success: false, error: "Surcharge model not found" };
		}

		await db
			.update(surchargeModel)
			.set({
				isActive: false,
				updatedBy: actor.userId,
				updatedAt: new Date(),
			})
			.where(eq(surchargeModel.id, modelId));

		// Also deactivate all assignments for this model
		await db
			.update(surchargeModelAssignment)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(surchargeModelAssignment.modelId, modelId));

		revalidatePath("/settings/surcharges");
		return { success: true, data: undefined };
	} catch (error) {
		console.error("Error deleting surcharge model:", error);
		return { success: false, error: "Failed to delete surcharge model" };
	}
}

// ============================================
// RULE CRUD
// ============================================

/**
 * Add a rule to an existing model
 */
export async function addSurchargeRule(
	modelId: string,
	data: SurchargeRuleFormData,
): Promise<ServerActionResult<{ id: string }>> {
	try {
		const actor = await requireOrgAdminSurchargeActor();
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const existingModel = await getScopedSurchargeModelRecord(actor.organizationId, modelId);
		if (!existingModel) {
			return { success: false, error: "Surcharge model not found" };
		}

		// Validate input
		const validated = surchargeRuleSchema.safeParse(data);
		if (!validated.success) {
			return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
		}

		const rule = validated.data;

		const [newRule] = await db
			.insert(surchargeRule)
			.values({
				modelId,
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
					priority: rule.priority ?? 0,
					validFrom: rule.validFrom,
					validUntil: rule.validUntil,
					isActive: rule.isActive,
					createdBy: actor.userId,
				})
			.returning({ id: surchargeRule.id });

		if (!newRule) {
			return { success: false, error: "Failed to create rule" };
		}

		// Update model's updatedAt
		await db
			.update(surchargeModel)
			.set({
				updatedBy: actor.userId,
				updatedAt: new Date(),
			})
			.where(eq(surchargeModel.id, modelId));

		revalidatePath("/settings/surcharges");
		return { success: true, data: { id: newRule.id } };
	} catch (error) {
		console.error("Error adding surcharge rule:", error);
		return { success: false, error: "Failed to add rule" };
	}
}

/**
 * Update a surcharge rule
 */
export async function updateSurchargeRule(
	ruleId: string,
	data: Partial<SurchargeRuleFormData>,
): Promise<ServerActionResult<void>> {
	try {
		const actor = await requireOrgAdminSurchargeActor();
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		// Get existing rule to determine model
		const existingRule = await getScopedSurchargeRuleRecord(actor.organizationId, ruleId);

		if (!existingRule) {
			return { success: false, error: "Rule not found" };
		}

		// Build update object
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
			await db.update(surchargeRule).set(updateData).where(eq(surchargeRule.id, ruleId));

			// Update model's updatedAt
			await db
				.update(surchargeModel)
				.set({
					updatedBy: actor.userId,
					updatedAt: new Date(),
				})
				.where(eq(surchargeModel.id, existingRule.modelId));
		}

		revalidatePath("/settings/surcharges");
		return { success: true, data: undefined };
	} catch (error) {
		console.error("Error updating surcharge rule:", error);
		return { success: false, error: "Failed to update rule" };
	}
}

/**
 * Delete a surcharge rule
 */
export async function deleteSurchargeRule(ruleId: string): Promise<ServerActionResult<void>> {
	try {
		const actor = await requireOrgAdminSurchargeActor();
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		// Get existing rule to determine model
		const existingRule = await getScopedSurchargeRuleRecord(actor.organizationId, ruleId);

		if (!existingRule) {
			return { success: false, error: "Rule not found" };
		}

		await db.delete(surchargeRule).where(eq(surchargeRule.id, ruleId));

		// Update model's updatedAt
		await db
			.update(surchargeModel)
			.set({
				updatedBy: actor.userId,
				updatedAt: new Date(),
			})
			.where(eq(surchargeModel.id, existingRule.modelId));

		revalidatePath("/settings/surcharges");
		return { success: true, data: undefined };
	} catch (error) {
		console.error("Error deleting surcharge rule:", error);
		return { success: false, error: "Failed to delete rule" };
	}
}

// ============================================
// ASSIGNMENT CRUD
// ============================================

/**
 * Get all assignments for an organization
 */
export async function getSurchargeAssignments(
	organizationId: string,
): Promise<ServerActionResult<SurchargeAssignmentWithDetails[]>> {
	try {
		const scopeContext = await getSurchargeScopeContext(organizationId);
		if (!scopeContext) {
			return { success: false, error: "Unauthorized" };
		}

		const assignments = await db.query.surchargeModelAssignment.findMany({
			where: eq(surchargeModelAssignment.organizationId, organizationId),
			with: {
				model: {
					columns: {
						id: true,
						name: true,
					},
				},
				team: {
					columns: {
						id: true,
						name: true,
					},
				},
				employee: {
					columns: {
						id: true,
						firstName: true,
						lastName: true,
					},
				},
			},
			orderBy: [desc(surchargeModelAssignment.priority), desc(surchargeModelAssignment.createdAt)],
		});

		if (scopeContext.actor.accessTier === "orgAdmin") {
			return { success: true, data: assignments as SurchargeAssignmentWithDetails[] };
		}

		const scopedAssignments = filterAssignmentsForManagerScope(
			assignments as SurchargeAssignmentWithDetails[],
			scopeContext.manageableTeamIds,
			scopeContext.scopedEmployeeIds,
		);

		return { success: true, data: scopedAssignments as SurchargeAssignmentWithDetails[] };
	} catch (error) {
		console.error("Error fetching surcharge assignments:", error);
		return { success: false, error: "Failed to fetch assignments" };
	}
}

/**
 * Create a surcharge assignment
 */
export async function createSurchargeAssignment(
	organizationId: string,
	data: SurchargeAssignmentFormData,
): Promise<ServerActionResult<{ id: string }>> {
	try {
		const actor = await requireOrgAdminSurchargeActor(organizationId);
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const existingModel = await getScopedSurchargeModelRecord(actor.organizationId, data.modelId);
		if (!existingModel) {
			return { success: false, error: "Surcharge model not found" };
		}

		// Validate input
		const validated = surchargeAssignmentFormSchema.safeParse(data);
		if (!validated.success) {
			return { success: false, error: validated.error.issues[0]?.message ?? "Invalid data" };
		}

		const { modelId, assignmentType, teamId, employeeId, effectiveFrom, effectiveUntil, isActive } =
			validated.data;

		// Determine priority based on assignment type
		const priority = assignmentType === "employee" ? 2 : assignmentType === "team" ? 1 : 0;

		const [newAssignment] = await db
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

		if (!newAssignment) {
			return { success: false, error: "Failed to create assignment" };
		}

		revalidatePath("/settings/surcharges");
		return { success: true, data: { id: newAssignment.id } };
	} catch (error) {
		console.error("Error creating surcharge assignment:", error);
		// Check for unique constraint violation
		if ((error as Error).message?.includes("unique")) {
			return {
				success: false,
				error: "An active assignment already exists for this target",
			};
		}
		return { success: false, error: "Failed to create assignment" };
	}
}

/**
 * Delete a surcharge assignment
 */
export async function deleteSurchargeAssignment(
	assignmentId: string,
): Promise<ServerActionResult<void>> {
	try {
		const actor = await requireOrgAdminSurchargeActor();
		if (!actor) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const existingAssignment = await getScopedSurchargeAssignmentRecord(
			actor.organizationId,
			assignmentId,
		);
		if (!existingAssignment) {
			return { success: false, error: "Surcharge assignment not found" };
		}

		await db
			.update(surchargeModelAssignment)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(surchargeModelAssignment.id, assignmentId));

		revalidatePath("/settings/surcharges");
		return { success: true, data: undefined };
	} catch (error) {
		console.error("Error deleting surcharge assignment:", error);
		return { success: false, error: "Failed to delete assignment" };
	}
}

// ============================================
// CALCULATIONS / REPORTS
// ============================================

/**
 * Get surcharge calculations for a period
 */
export async function getSurchargeCalculationsForPeriod(
	organizationId: string,
	startDate: Date,
	endDate: Date,
	employeeId?: string,
): Promise<ServerActionResult<SurchargeCalculationWithDetails[]>> {
	try {
		const scopeContext = await getSurchargeScopeContext(organizationId);
		if (!scopeContext) {
			return { success: false, error: "Unauthorized" };
		}

		const targetEmployeeId =
			scopeContext.actor.accessTier === "orgAdmin" ? employeeId : employeeId;

		const conditions = [
			eq(surchargeCalculation.organizationId, organizationId),
			gte(surchargeCalculation.calculationDate, startDate),
			lte(surchargeCalculation.calculationDate, endDate),
		];

		if (targetEmployeeId) {
			conditions.push(eq(surchargeCalculation.employeeId, targetEmployeeId));
		}

		const calculations = await db.query.surchargeCalculation.findMany({
			where: and(...conditions),
			with: {
				employee: {
					columns: {
						id: true,
						firstName: true,
						lastName: true,
					},
				},
			},
			orderBy: [desc(surchargeCalculation.calculationDate)],
		});

		if (scopeContext.actor.accessTier === "orgAdmin") {
			return { success: true, data: calculations as SurchargeCalculationWithDetails[] };
		}

		const scopedWorkPeriodsById = await getScopedWorkPeriodsById(
			scopeContext.actor.organizationId,
			calculations.map((calculation) => calculation.workPeriodId),
		);
		const scopedCalculations = calculations.filter((calculation) => {
			if (calculation.employeeId && scopeContext.scopedEmployeeIds?.has(calculation.employeeId)) {
				return true;
			}

			return canManagerAccessSurchargeWorkPeriod(
				scopeContext,
				scopedWorkPeriodsById.get(calculation.workPeriodId),
			);
		});

		return { success: true, data: scopedCalculations as SurchargeCalculationWithDetails[] };
	} catch (error) {
		console.error("Error fetching surcharge calculations:", error);
		return { success: false, error: "Failed to fetch calculations" };
	}
}

/**
 * Get teams for assignment dropdown
 */
export async function getTeamsForAssignment(
	organizationId: string,
): Promise<ServerActionResult<Array<{ id: string; name: string }>>> {
	try {
		if (!(await requireOrgAdminSurchargeActor(organizationId))) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const teams = await db.query.team.findMany({
			where: eq(team.organizationId, organizationId),
			columns: {
				id: true,
				name: true,
			},
			orderBy: [team.name],
		});

		return { success: true, data: teams };
	} catch (error) {
		console.error("Error fetching teams:", error);
		return { success: false, error: "Failed to fetch teams" };
	}
}

/**
 * Get employees for assignment dropdown
 */
export async function getEmployeesForAssignment(
	organizationId: string,
): Promise<
	ServerActionResult<Array<{ id: string; firstName: string | null; lastName: string | null }>>
> {
	try {
		if (!(await requireOrgAdminSurchargeActor(organizationId))) {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const employees = await db.query.employee.findMany({
			where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
			columns: {
				id: true,
				firstName: true,
				lastName: true,
			},
			orderBy: [employee.lastName, employee.firstName],
		});

		return { success: true, data: employees };
	} catch (error) {
		console.error("Error fetching employees:", error);
		return { success: false, error: "Failed to fetch employees" };
	}
}
