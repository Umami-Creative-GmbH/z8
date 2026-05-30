import { z } from "zod";
import {
	type ApproverDirectoryEmployee,
	type ApproverDirectoryManagerLink,
	resolveApproverFromDirectory,
} from "@/lib/approvals/policies/approver-resolution";
import { findMatchingPolicy, validatePolicyDraft } from "@/lib/approvals/policies/matcher";
import type {
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "@/lib/approvals/policies/types";

const conditionSchema = z.object({
	conditionType: z.enum([
		"approval_type",
		"team",
		"location",
		"absence_category",
		"travel_expense_amount",
		"overtime_risk",
		"employee_group",
	]),
	operator: z.enum(["equals", "in", "gte", "lte", "between"]),
	value: z.string().trim().optional(),
	values: z.array(z.string().trim().min(1)).optional(),
	amountMin: z.number().optional(),
	amountMax: z.number().optional(),
});

export const policyInputSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().optional(),
	isActive: z.boolean(),
	priority: z.number().int().min(1),
	conditions: z.array(conditionSchema),
	stages: z.array(
		z.object({
			id: z.string(),
			stepOrder: z.number().int().min(1),
			label: z.string().trim().min(1),
			approverType: z.enum([
				"direct_manager",
				"manager_manager",
				"org_admin",
				"specific_employee",
				"team_lead",
			]),
			approverEmployeeId: z.string().trim().optional(),
		}),
	),
});

export const upsertPolicyInputSchema = policyInputSchema.extend({
	id: z.string().optional(),
});

export type PolicyInput = z.infer<typeof policyInputSchema>;

const overtimeRiskValues = new Set<string>(["none", "warning", "violation"]);

export function uniqueValues(values: string[]) {
	return [...new Set(values)];
}

export function firstZodError(error: z.ZodError) {
	return error.issues[0]?.message ?? "Invalid policy input.";
}

function validatePolicyConditionValues(input: PolicyInput) {
	for (const [index, condition] of input.conditions.entries()) {
		if (
			condition.conditionType === "overtime_risk" &&
			[condition.value, ...(condition.values ?? [])].some(
				(value) => value && !overtimeRiskValues.has(value),
			)
		) {
			return `Condition ${index + 1} (overtime_risk) must be none, warning, or violation.`;
		}
	}

	return null;
}

export function normalizeApprovalPolicyInputForTest(input: PolicyInput) {
	const parsed = policyInputSchema.safeParse(input);
	if (!parsed.success) {
		return { success: false as const, error: firstZodError(parsed.error) };
	}

	const draft: ApprovalPolicyDraft = {
		id: "draft",
		organizationId: "draft_org",
		...parsed.data,
	};
	const errors = validatePolicyDraft(draft);
	if (errors.length > 0) {
		return { success: false as const, error: errors[0] };
	}

	const conditionValueError = validatePolicyConditionValues(parsed.data);
	if (conditionValueError) {
		return { success: false as const, error: conditionValueError };
	}

	return { success: true as const, data: parsed.data };
}

export function previewApprovalPolicyForTest(input: {
	context: ApprovalPolicyEvaluationContext;
	policies: ApprovalPolicyDraft[];
	employees: ApproverDirectoryEmployee[];
	managerLinks: ApproverDirectoryManagerLink[];
}) {
	const policy = findMatchingPolicy(input.context, input.policies);
	if (!policy) {
		return { matchedPolicyId: null, matchedPolicyName: null, stages: [] };
	}

	return {
		matchedPolicyId: policy.id,
		matchedPolicyName: policy.name,
		stages: policy.stages.map((stage) => {
			const resolved = resolveApproverFromDirectory({
				organizationId: input.context.organizationId,
				requesterEmployeeId: input.context.requesterEmployeeId,
				stage,
				employees: input.employees,
				managerLinks: input.managerLinks,
			});

			return resolved.ok
				? {
						label: stage.label,
						approverEmployeeId: resolved.approverEmployeeId,
						status: "resolved" as const,
					}
				: {
						label: stage.label,
						approverEmployeeId: null,
						status: "unresolved" as const,
						reason: resolved.reason,
					};
		}),
	};
}
