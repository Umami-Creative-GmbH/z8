"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
	absenceCategory,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	employee,
	employeeGroup,
	employeeGroupMember,
	location,
	team,
} from "@/db/schema";
import {
	firstZodError,
	normalizeApprovalPolicyInputForTest,
	type PolicyInput,
	uniqueValues,
	upsertPolicyInputSchema,
} from "./action-helpers";

const employeeGroupInputSchema = z.object({
	id: z.string().optional(),
	name: z.string().trim().min(1, "Employee group name is required."),
	description: z.string().trim().optional(),
	isActive: z.boolean(),
	employeeIds: z.array(z.string().trim().min(1)),
});

type DatabaseApproverType = Exclude<PolicyInput["stages"][number]["approverType"], "team_lead">;
type OvertimeRiskValue = "none" | "warning" | "violation";

function isOvertimeRiskValue(value: string): value is OvertimeRiskValue {
	return value === "none" || value === "warning" || value === "violation";
}

function valuesForReferenceCondition(condition: PolicyInput["conditions"][number]) {
	if (condition.operator === "equals") {
		return condition.value ? [condition.value] : [];
	}

	if (condition.operator === "in") {
		return uniqueValues(condition.values ?? []);
	}

	return [];
}

async function requirePolicyAdmin() {
	const { getCurrentEmployee } = await import("@/app/[locale]/(app)/absences/current-employee");
	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee || currentEmployee.role !== "admin") {
		throw new Error("Only organization admins can manage approval policies.");
	}

	return currentEmployee;
}

async function existingPolicyForOrganization(policyId: string, organizationId: string) {
	return db.query.approvalPolicy.findFirst({
		where: and(eq(approvalPolicy.id, policyId), eq(approvalPolicy.organizationId, organizationId)),
		columns: { id: true },
	});
}

async function existingEmployeeGroupForOrganization(groupId: string, organizationId: string) {
	return db.query.employeeGroup.findFirst({
		where: and(eq(employeeGroup.id, groupId), eq(employeeGroup.organizationId, organizationId)),
		columns: { id: true },
	});
}

async function findMissingOrganizationReferences(
	organizationId: string,
	ids: string[],
	table: typeof team | typeof location | typeof absenceCategory | typeof employeeGroup | typeof employee,
) {
	const uniqueIds = uniqueValues(ids);
	if (uniqueIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({ id: table.id })
		.from(table)
		.where(and(eq(table.organizationId, organizationId), inArray(table.id, uniqueIds)));
	const foundIds = new Set(rows.map((row) => row.id));

	return uniqueIds.filter((id) => !foundIds.has(id));
}

async function findMissingActiveOrganizationEmployees(organizationId: string, ids: string[]) {
	const uniqueIds = uniqueValues(ids);
	if (uniqueIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true), inArray(employee.id, uniqueIds)));
	const foundIds = new Set(rows.map((row) => row.id));

	return uniqueIds.filter((id) => !foundIds.has(id));
}

async function findMissingActiveEmployeeGroups(organizationId: string, ids: string[]) {
	const uniqueIds = uniqueValues(ids);
	if (uniqueIds.length === 0) {
		return [];
	}

	const rows = await db
		.select({ id: employeeGroup.id })
		.from(employeeGroup)
		.where(and(eq(employeeGroup.organizationId, organizationId), eq(employeeGroup.isActive, true), inArray(employeeGroup.id, uniqueIds)));
	const foundIds = new Set(rows.map((row) => row.id));

	return uniqueIds.filter((id) => !foundIds.has(id));
}

async function validatePolicyReferences(organizationId: string, input: PolicyInput) {
	const teamIds: string[] = [];
	const locationIds: string[] = [];
	const absenceCategoryIds: string[] = [];
	const employeeGroupIds: string[] = [];

	for (const condition of input.conditions) {
		const ids = valuesForReferenceCondition(condition);
		if (condition.conditionType === "team") {
			teamIds.push(...ids);
		} else if (condition.conditionType === "location") {
			locationIds.push(...ids);
		} else if (condition.conditionType === "absence_category") {
			absenceCategoryIds.push(...ids);
		} else if (condition.conditionType === "employee_group") {
			employeeGroupIds.push(...ids);
		}
	}

	const specificApproverIds = input.stages
		.filter((stage) => stage.approverType === "specific_employee" && stage.approverEmployeeId)
		.map((stage) => stage.approverEmployeeId as string);

	const [missingTeams, missingLocations, missingAbsenceCategories, missingGroups, missingApprovers] = await Promise.all([
		findMissingOrganizationReferences(organizationId, teamIds, team),
		findMissingOrganizationReferences(organizationId, locationIds, location),
		findMissingOrganizationReferences(organizationId, absenceCategoryIds, absenceCategory),
		findMissingActiveEmployeeGroups(organizationId, employeeGroupIds),
		findMissingActiveOrganizationEmployees(organizationId, specificApproverIds),
	]);

	if (
		missingTeams.length > 0 ||
		missingLocations.length > 0 ||
		missingAbsenceCategories.length > 0 ||
		missingGroups.length > 0 ||
		missingApprovers.length > 0
	) {
		return "One or more policy references are invalid.";
	}

	return null;
}

function conditionInsertValue(
	organizationId: string,
	policyId: string,
	condition: PolicyInput["conditions"][number],
) {
	const valueJson = { value: condition.value, values: condition.values };
	const equalValue = condition.operator === "equals" ? condition.value : undefined;
	const overtimeRisk = isOvertimeRiskValue(equalValue ?? "")
		? (equalValue as OvertimeRiskValue)
		: undefined;

	return {
		organizationId,
		policyId,
		conditionType: condition.conditionType,
		operator: condition.operator,
		valueJson,
		amountMin: condition.amountMin?.toString(),
		amountMax: condition.amountMax?.toString(),
		overtimeRisk: condition.conditionType === "overtime_risk" ? overtimeRisk : undefined,
		teamId: condition.conditionType === "team" ? equalValue : undefined,
		locationId: condition.conditionType === "location" ? equalValue : undefined,
		absenceCategoryId: condition.conditionType === "absence_category" ? equalValue : undefined,
		employeeGroupId: condition.conditionType === "employee_group" ? equalValue : undefined,
	};
}

function databaseApproverType(approverType: PolicyInput["stages"][number]["approverType"]): DatabaseApproverType {
	if (approverType === "team_lead") {
		throw new Error("Unsupported approver type.");
	}

	return approverType;
}

export async function getApprovalPolicies() {
	"use server";

	const currentEmployee = await requirePolicyAdmin();
	return db.query.approvalPolicy.findMany({
		where: (table, { eq: equals }) => equals(table.organizationId, currentEmployee.organizationId),
		with: { conditions: true, stages: true },
		orderBy: (table, { asc }) => [asc(table.priority)],
	});
}

export async function upsertApprovalPolicy(input: PolicyInput & { id?: string }) {
	"use server";

	const currentEmployee = await requirePolicyAdmin();
	const parsed = upsertPolicyInputSchema.safeParse(input);
	if (!parsed.success) {
		return { success: false as const, error: firstZodError(parsed.error) };
	}

	const normalized = normalizeApprovalPolicyInputForTest(parsed.data);
	if (!normalized.success) {
		return normalized;
	}

	if (parsed.data.id) {
		const existingPolicy = await existingPolicyForOrganization(parsed.data.id, currentEmployee.organizationId);
		if (!existingPolicy) {
			return { success: false as const, error: "Approval policy could not be saved." };
		}
	}

	const referenceError = await validatePolicyReferences(currentEmployee.organizationId, normalized.data);
	if (referenceError) {
		return { success: false as const, error: referenceError };
	}

	try {
		await db.transaction(async (tx) => {
			const [savedPolicy] = await tx
				.insert(approvalPolicy)
				.values({
					id: parsed.data.id,
					organizationId: currentEmployee.organizationId,
					name: normalized.data.name,
					description: normalized.data.description || null,
					isActive: normalized.data.isActive,
					priority: normalized.data.priority,
					createdBy: currentEmployee.userId,
					updatedBy: currentEmployee.userId,
				})
				.onConflictDoUpdate({
					target: approvalPolicy.id,
					set: {
						name: normalized.data.name,
						description: normalized.data.description || null,
						isActive: normalized.data.isActive,
						priority: normalized.data.priority,
						updatedBy: currentEmployee.userId,
					},
					where: eq(approvalPolicy.organizationId, currentEmployee.organizationId),
				})
				.returning();

			await tx.delete(approvalPolicyCondition).where(
				and(
					eq(approvalPolicyCondition.policyId, savedPolicy.id),
					eq(approvalPolicyCondition.organizationId, currentEmployee.organizationId),
				),
			);
			await tx.delete(approvalPolicyStage).where(
				and(
					eq(approvalPolicyStage.policyId, savedPolicy.id),
					eq(approvalPolicyStage.organizationId, currentEmployee.organizationId),
				),
			);

			if (normalized.data.conditions.length > 0) {
				await tx.insert(approvalPolicyCondition).values(
					normalized.data.conditions.map((condition) =>
						conditionInsertValue(currentEmployee.organizationId, savedPolicy.id, condition),
					),
				);
			}

			if (normalized.data.stages.length > 0) {
				await tx.insert(approvalPolicyStage).values(
					normalized.data.stages.map((stage) => ({
						organizationId: currentEmployee.organizationId,
						policyId: savedPolicy.id,
						stepOrder: stage.stepOrder,
						label: stage.label,
						approverType: databaseApproverType(stage.approverType),
						approverEmployeeId: stage.approverEmployeeId,
					})),
				);
			}
		});
	} catch {
		return { success: false as const, error: "Approval policy could not be saved." };
	}

	revalidatePath("/settings/approval-policies");
	return { success: true as const };
}

export async function getEmployeeGroups() {
	"use server";

	const currentEmployee = await requirePolicyAdmin();
	return db.query.employeeGroup.findMany({
		where: (table, { eq: equals }) => equals(table.organizationId, currentEmployee.organizationId),
		with: { members: true },
	});
}

export async function upsertEmployeeGroup(input: z.infer<typeof employeeGroupInputSchema>) {
	"use server";

	const currentEmployee = await requirePolicyAdmin();
	const parsed = employeeGroupInputSchema.safeParse(input);
	if (!parsed.success) {
		return { success: false as const, error: firstZodError(parsed.error) };
	}

	const employeeIds = uniqueValues(parsed.data.employeeIds);
	if (employeeIds.length !== parsed.data.employeeIds.length) {
		return { success: false as const, error: "Employee group members must be unique." };
	}

	if (parsed.data.id) {
		const existingGroup = await existingEmployeeGroupForOrganization(parsed.data.id, currentEmployee.organizationId);
		if (!existingGroup) {
			return { success: false as const, error: "Employee group could not be saved." };
		}
	}

	const missingEmployees = await findMissingActiveOrganizationEmployees(currentEmployee.organizationId, employeeIds);
	if (missingEmployees.length > 0) {
		return { success: false as const, error: "One or more employee group members are invalid." };
	}

	try {
		await db.transaction(async (tx) => {
			const [group] = await tx
				.insert(employeeGroup)
				.values({
					id: parsed.data.id,
					organizationId: currentEmployee.organizationId,
					name: parsed.data.name,
					description: parsed.data.description || null,
					isActive: parsed.data.isActive,
				})
				.onConflictDoUpdate({
					target: employeeGroup.id,
					set: {
						name: parsed.data.name,
						description: parsed.data.description || null,
						isActive: parsed.data.isActive,
					},
					where: eq(employeeGroup.organizationId, currentEmployee.organizationId),
				})
				.returning();

			await tx.delete(employeeGroupMember).where(
				and(
					eq(employeeGroupMember.groupId, group.id),
					eq(employeeGroupMember.organizationId, currentEmployee.organizationId),
				),
			);

			if (employeeIds.length > 0) {
				await tx.insert(employeeGroupMember).values(
					employeeIds.map((employeeId) => ({
						organizationId: currentEmployee.organizationId,
						groupId: group.id,
						employeeId,
						createdBy: currentEmployee.userId,
					})),
				);
			}
		});
	} catch {
		return { success: false as const, error: "Employee group could not be saved." };
	}

	revalidatePath("/settings/approval-policies");
	return { success: true as const };
}
