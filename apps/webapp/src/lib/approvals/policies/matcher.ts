import type {
	ApprovalPolicyConditionDraft,
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "./types";

function stringList(condition: ApprovalPolicyConditionDraft): string[] {
	return condition.values ?? (condition.value ? [condition.value] : []);
}

function matchesString(value: string | null, condition: ApprovalPolicyConditionDraft) {
	if (!value) {
		return false;
	}

	if (condition.operator === "equals") {
		return value === condition.value;
	}

	if (condition.operator === "in") {
		return stringList(condition).includes(value);
	}

	return false;
}

function matchesAmount(amount: number | null, condition: ApprovalPolicyConditionDraft) {
	if (amount === null) {
		return false;
	}

	if (condition.operator === "gte") {
		return typeof condition.amountMin === "number" && amount >= condition.amountMin;
	}

	if (condition.operator === "lte") {
		return typeof condition.amountMax === "number" && amount <= condition.amountMax;
	}

	if (condition.operator === "between") {
		return (
			typeof condition.amountMin === "number" &&
			typeof condition.amountMax === "number" &&
			amount >= condition.amountMin &&
			amount <= condition.amountMax
		);
	}

	return false;
}

export function matchesCondition(
	context: ApprovalPolicyEvaluationContext,
	condition: ApprovalPolicyConditionDraft,
) {
	switch (condition.conditionType) {
		case "approval_type":
			return matchesString(context.approvalType, condition);
		case "team":
			return matchesString(context.teamId, condition);
		case "location":
			return matchesString(context.locationId, condition);
		case "absence_category":
			return matchesString(context.absenceCategoryId, condition);
		case "employee_group":
			return stringList(condition).some((groupId) => context.employeeGroupIds.includes(groupId));
		case "overtime_risk":
			return matchesString(context.overtimeRisk, condition);
		case "travel_expense_amount":
			return matchesAmount(context.travelExpenseAmount, condition);
	}
}

export function findMatchingPolicy(
	context: ApprovalPolicyEvaluationContext,
	policies: ApprovalPolicyDraft[],
) {
	return (
		policies
			.filter((policy) => policy.isActive && policy.organizationId === context.organizationId)
			.sort((a, b) => a.priority - b.priority)
			.find((policy) => policy.conditions.every((condition) => matchesCondition(context, condition))) ?? null
	);
}

export function validatePolicyDraft(policy: ApprovalPolicyDraft): string[] {
	const errors: string[] = [];

	if (policy.isActive && policy.stages.length === 0) {
		errors.push("Active policies require at least one approval stage.");
	}

	for (const stage of policy.stages) {
		if (stage.approverType === "team_lead") {
			errors.push("Team lead approver stages are not available until team lead relationships exist.");
		}

		if (stage.approverType === "specific_employee" && !stage.approverEmployeeId) {
			errors.push(`Stage ${stage.stepOrder} requires a specific employee approver.`);
		}
	}

	return errors;
}
