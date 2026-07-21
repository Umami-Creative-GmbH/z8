import {
	ApprovalRoutingPolicyValidationError,
	findMatchingRoutingPolicy,
	validateRoutingPolicy,
} from "../routing/policy-matcher";
import type { ApprovalRoutingContext } from "../routing/types";
import type {
	ApprovalPolicyConditionDraft,
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "./types";

function toRoutingContext(
	context: ApprovalPolicyEvaluationContext,
): ApprovalRoutingContext | null {
	let workflowType: ApprovalRoutingContext["workflowType"];

	switch (context.approvalType) {
		case "absence_entry":
			workflowType = "absence";
			break;
		case "time_entry":
			workflowType = "time_correction";
			break;
		case "shift_request":
			workflowType = "shift_request";
			break;
		case "travel_expense_claim":
			workflowType = "travel_expense";
			break;
		default:
			return null;
	}

	return {
		organizationId: context.organizationId,
		workflowType,
		source: { type: context.entityType, id: context.entityId },
		requesterEmployeeId: context.requesterEmployeeId,
		teamIds: context.teamId === null ? [] : [context.teamId],
		locationId: context.locationId,
		absenceCategoryId: context.absenceCategoryId,
		travelExpenseAmount: context.travelExpenseAmount,
		overtimeRisk: context.overtimeRisk,
		employeeGroupIds: context.employeeGroupIds,
	};
}

function routingValidationMessage(
	condition: ApprovalPolicyConditionDraft,
	index: number,
	error: ApprovalRoutingPolicyValidationError,
) {
	const label = `Condition ${index + 1} (${condition.conditionType})`;

	if (error.field.endsWith(".operator")) {
		return condition.conditionType === "travel_expense_amount"
			? `${label} only supports gte, lte, or between operators.`
			: `${label} only supports equals or in operators.`;
	}

	if (error.field.endsWith(".value")) {
		return `${label} requires a value for equals.`;
	}

	if (error.field.endsWith(".values")) {
		return `${label} requires at least one value for in.`;
	}

	if (error.field.endsWith(".amountMin")) {
		if (error.message.includes("less than or equal to amountMax")) {
			return `${label} requires amountMin to be less than or equal to amountMax.`;
		}
		if (condition.operator === "gte") {
			return `${label} requires amountMin for gte.`;
		}
		if (condition.operator === "between") {
			return `${label} requires amountMin and amountMax for between.`;
		}
		return `${label} requires amountMin to be less than or equal to amountMax.`;
	}

	if (error.field.endsWith(".amountMax")) {
		return condition.operator === "lte"
			? `${label} requires amountMax for lte.`
			: `${label} requires amountMin and amountMax for between.`;
	}

	return error.message;
}

function validateCondition(
	policy: ApprovalPolicyDraft,
	condition: ApprovalPolicyConditionDraft,
	index: number,
): string[] {
	try {
		validateRoutingPolicy({ ...policy, conditions: [condition], stages: [] });
		return [];
	} catch (error) {
		return error instanceof ApprovalRoutingPolicyValidationError
			? [routingValidationMessage(condition, index, error)]
			: [String(error)];
	}
}

function validateStage(
	policy: ApprovalPolicyDraft,
	stage: ApprovalPolicyDraft["stages"][number],
	index: number,
): string[] {
	try {
		validateRoutingPolicy({ ...policy, conditions: [], stages: [stage] });
		return [];
	} catch (error) {
		return error instanceof ApprovalRoutingPolicyValidationError
			? [error.message.replace("stages[0]", `stages[${index}]`)]
			: [String(error)];
	}
}

export function findMatchingPolicy(
	context: ApprovalPolicyEvaluationContext,
	policies: ApprovalPolicyDraft[],
) {
	const routingContext = toRoutingContext(context);
	if (!routingContext) {
		return null;
	}

	return findMatchingRoutingPolicy(routingContext, policies);
}

export function validatePolicyDraft(policy: ApprovalPolicyDraft): string[] {
	const errors: string[] = [];

	if (policy.isActive && policy.stages.length === 0) {
		errors.push("Active policies require at least one approval stage.");
	}

	for (const [index, condition] of policy.conditions.entries()) {
		errors.push(...validateCondition(policy, condition, index));
	}

	for (const [index, stage] of policy.stages.entries()) {
		errors.push(...validateStage(policy, stage, index));

		if (stage.approverType === "team_lead") {
			errors.push(
				"Team lead approver stages are not available until team lead relationships exist.",
			);
		}

		if (
			stage.approverType === "specific_employee" &&
			!stage.approverEmployeeId
		) {
			errors.push(
				`Stage ${stage.stepOrder} requires a specific employee approver.`,
			);
		}
	}

	return errors;
}
