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

function matchesStringList(values: string[], condition: ApprovalPolicyConditionDraft) {
	if (condition.operator === "equals") {
		return !!condition.value && values.includes(condition.value);
	}

	if (condition.operator === "in") {
		return stringList(condition).some((value) => values.includes(value));
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
			return matchesStringList(context.employeeGroupIds, condition);
		case "overtime_risk":
			return matchesString(context.overtimeRisk, condition);
		case "travel_expense_amount":
			return matchesAmount(context.travelExpenseAmount, condition);
	}
}

function validateCondition(condition: ApprovalPolicyConditionDraft, index: number): string[] {
	const errors: string[] = [];
	const label = `Condition ${index + 1} (${condition.conditionType})`;

	if (condition.conditionType === "travel_expense_amount") {
		if (!["gte", "lte", "between"].includes(condition.operator)) {
			errors.push(`${label} only supports gte, lte, or between operators.`);
		}

		if (condition.operator === "gte" && typeof condition.amountMin !== "number") {
			errors.push(`${label} requires amountMin for gte.`);
		}

		if (condition.operator === "lte" && typeof condition.amountMax !== "number") {
			errors.push(`${label} requires amountMax for lte.`);
		}

		if (condition.operator === "between") {
			if (typeof condition.amountMin !== "number" || typeof condition.amountMax !== "number") {
				errors.push(`${label} requires amountMin and amountMax for between.`);
			} else if (condition.amountMin > condition.amountMax) {
				errors.push(`${label} requires amountMin to be less than or equal to amountMax.`);
			}
		}

		return errors;
	}

	if (!["equals", "in"].includes(condition.operator)) {
		errors.push(`${label} only supports equals or in operators.`);
	}

	if (condition.operator === "equals" && !condition.value) {
		errors.push(`${label} requires a value for equals.`);
	}

	if (condition.operator === "in" && (!condition.values || condition.values.length === 0)) {
		errors.push(`${label} requires at least one value for in.`);
	}

	return errors;
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

	for (const [index, condition] of policy.conditions.entries()) {
		errors.push(...validateCondition(condition, index));
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
