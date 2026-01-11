"use server";

import { and, desc, eq, gte, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	employee,
	surchargeCalculation,
	surchargeModel,
	surchargeModelAssignment,
	surchargeRule,
	team,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const models = await db.query.surchargeModel.findMany({
			where: eq(surchargeModel.organizationId, organizationId),
			with: {
				rules: true,
			},
			orderBy: [desc(surchargeModel.createdAt)],
		});

		return { success: true, data: models as SurchargeModelWithRules[] };
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		const model = await db.query.surchargeModel.findFirst({
			where: eq(surchargeModel.id, modelId),
			with: {
				rules: true,
			},
		});

		if (!model) {
			return { success: false, error: "Surcharge model not found" };
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
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
				createdBy: authContext.user.id,
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
					createdBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
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
				updatedBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		await db
			.update(surchargeModel)
			.set({
				isActive: false,
				updatedBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
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
				createdBy: authContext.user.id,
			})
			.returning({ id: surchargeRule.id });

		if (!newRule) {
			return { success: false, error: "Failed to create rule" };
		}

		// Update model's updatedAt
		await db
			.update(surchargeModel)
			.set({
				updatedBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		// Get existing rule to determine model
		const existingRule = await db.query.surchargeRule.findFirst({
			where: eq(surchargeRule.id, ruleId),
		});

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
					updatedBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
		}

		// Get existing rule to determine model
		const existingRule = await db.query.surchargeRule.findFirst({
			where: eq(surchargeRule.id, ruleId),
		});

		if (!existingRule) {
			return { success: false, error: "Rule not found" };
		}

		await db.delete(surchargeRule).where(eq(surchargeRule.id, ruleId));

		// Update model's updatedAt
		await db
			.update(surchargeModel)
			.set({
				updatedBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
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

		return { success: true, data: assignments as SurchargeAssignmentWithDetails[] };
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
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
				createdBy: authContext.user.id,
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
			return { success: false, error: "Unauthorized: Admin access required" };
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
		const authContext = await getAuthContext();
		if (!authContext?.employee) {
			return { success: false, error: "Unauthorized" };
		}

		// Non-admins can only see their own calculations
		const targetEmployeeId =
			authContext.employee.role === "admin" ? employeeId : authContext.employee.id;

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

		return { success: true, data: calculations as SurchargeCalculationWithDetails[] };
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
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
		const authContext = await getAuthContext();
		if (!authContext?.employee || authContext.employee.role !== "admin") {
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
