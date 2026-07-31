import type {
	ApprovalPolicyConditionDraft,
	ApprovalPolicyDraft,
} from "../policies/types";
import { APPROVAL_WORKFLOW_TYPES } from "../workflow/types";
import {
	type ApprovalRoutingContext,
	LEGACY_APPROVAL_TYPE_ALIASES,
	ROUTING_STAGE_FALLBACKS,
} from "./types";

const conditionTypes = new Set([
	"approval_type",
	"team",
	"location",
	"absence_category",
	"travel_expense_amount",
	"overtime_risk",
	"employee_group",
]);

const stringConditionTypes = new Set([
	"approval_type",
	"team",
	"location",
	"absence_category",
	"overtime_risk",
	"employee_group",
]);

const knownApprovalTypeValues = new Set<string>([
	...APPROVAL_WORKFLOW_TYPES,
	...Object.values(LEGACY_APPROVAL_TYPE_ALIASES).flat(),
]);

export class ApprovalRoutingPolicyValidationError extends Error {
	constructor(
		readonly field: string,
		reason: string,
	) {
		super(`Invalid ${field}: ${reason}.`);
		this.name = "ApprovalRoutingPolicyValidationError";
	}
}

function invalid(field: string, reason: string): never {
	throw new ApprovalRoutingPolicyValidationError(field, reason);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ConditionRecord = Record<string, unknown> & {
	conditionType: unknown;
	operator: unknown;
};

function isConditionRecord(
	value: Record<string, unknown>,
): value is ConditionRecord {
	return "conditionType" in value && "operator" in value;
}

function requireStringValue(
	value: unknown,
	field: string,
): asserts value is string {
	if (!isNonEmptyString(value)) {
		invalid(field, "a non-empty string is required");
	}
}

function requireStringValues(
	value: unknown,
	field: string,
): asserts value is string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		!value.every(isNonEmptyString)
	) {
		invalid(field, "a non-empty list of strings is required");
	}
}

function requireFiniteNumber(
	value: unknown,
	field: string,
): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		invalid(field, "a finite number is required");
	}
}

function validateApprovalType(value: string, field: string) {
	if (!knownApprovalTypeValues.has(value)) {
		invalid(field, "an approval workflow type or legacy alias is required");
	}
}

function validateCondition(condition: unknown, index: number) {
	const prefix = `conditions[${index}]`;
	if (!isRecord(condition)) {
		invalid(prefix, "an object is required");
	}

	if (!isConditionRecord(condition)) {
		invalid(prefix, "a condition type and operator are required");
	}

	const persistedCondition = condition;

	if (
		typeof persistedCondition.conditionType !== "string" ||
		!conditionTypes.has(persistedCondition.conditionType)
	) {
		invalid(
			`${prefix}.conditionType`,
			"an unsupported condition type was provided",
		);
	}

	if (persistedCondition.conditionType === "travel_expense_amount") {
		if (
			persistedCondition.operator !== "gte" &&
			persistedCondition.operator !== "lte" &&
			persistedCondition.operator !== "between"
		) {
			invalid(`${prefix}.operator`, "an unsupported operator was provided");
		}

		if (persistedCondition.operator === "gte") {
			requireFiniteNumber(persistedCondition.amountMin, `${prefix}.amountMin`);
			return;
		}

		if (persistedCondition.operator === "lte") {
			requireFiniteNumber(persistedCondition.amountMax, `${prefix}.amountMax`);
			return;
		}

		requireFiniteNumber(persistedCondition.amountMin, `${prefix}.amountMin`);
		requireFiniteNumber(persistedCondition.amountMax, `${prefix}.amountMax`);
		if (persistedCondition.amountMin > persistedCondition.amountMax) {
			invalid(`${prefix}.amountMin`, "must be less than or equal to amountMax");
		}
		return;
	}

	if (!stringConditionTypes.has(persistedCondition.conditionType)) {
		invalid(
			`${prefix}.conditionType`,
			"an unsupported condition type was provided",
		);
	}

	if (
		persistedCondition.operator !== "equals" &&
		persistedCondition.operator !== "in"
	) {
		invalid(`${prefix}.operator`, "an unsupported operator was provided");
	}

	if (persistedCondition.operator === "equals") {
		requireStringValue(persistedCondition.value, `${prefix}.value`);
		if (persistedCondition.conditionType === "approval_type") {
			validateApprovalType(persistedCondition.value, `${prefix}.value`);
		}
		return;
	}

	requireStringValues(persistedCondition.values, `${prefix}.values`);
	if (persistedCondition.conditionType === "approval_type") {
		for (const value of persistedCondition.values) {
			validateApprovalType(value, `${prefix}.values`);
		}
	}
}

export function validateRoutingPolicy(policy: ApprovalPolicyDraft): void {
	if (!Array.isArray(policy.conditions)) {
		invalid("conditions", "a list is required");
	}

	for (const [index, condition] of policy.conditions.entries()) {
		validateCondition(condition, index);
	}

	if (!Array.isArray(policy.stages)) {
		invalid("stages", "a list is required");
	}

	for (const [index, stage] of policy.stages.entries()) {
		if (!isRecord(stage)) {
			invalid(`stages[${index}]`, "an object is required");
		}

		if (
			!ROUTING_STAGE_FALLBACKS.some(
				(fallback) => fallback === stage.fallbackBehavior,
			)
		) {
			invalid(
				`stages[${index}].fallbackBehavior`,
				"an unsupported fallback behavior was provided",
			);
		}
	}
}

function matchesString(
	value: string | null,
	condition: ApprovalPolicyConditionDraft,
): boolean {
	if (value === null) {
		return false;
	}

	return condition.operator === "equals"
		? value === condition.value
		: (condition.values?.includes(value) ?? false);
}

function matchesStringList(
	values: string[],
	condition: ApprovalPolicyConditionDraft,
): boolean {
	const valueSet = new Set(values);
	if (condition.operator === "equals") {
		return condition.value !== undefined && valueSet.has(condition.value);
	}

	return condition.values?.some((value) => valueSet.has(value)) ?? false;
}

function matchesAmount(
	amount: number | null,
	condition: ApprovalPolicyConditionDraft,
): boolean {
	if (amount === null) {
		return false;
	}

	switch (condition.operator) {
		case "gte":
			return amount >= (condition.amountMin ?? Number.POSITIVE_INFINITY);
		case "lte":
			return amount <= (condition.amountMax ?? Number.NEGATIVE_INFINITY);
		case "between":
			return (
				amount >= (condition.amountMin ?? Number.POSITIVE_INFINITY) &&
				amount <= (condition.amountMax ?? Number.NEGATIVE_INFINITY)
			);
		default:
			return false;
	}
}

function matchesRoutingCondition(
	context: ApprovalRoutingContext,
	condition: ApprovalPolicyConditionDraft,
): boolean {
	switch (condition.conditionType) {
		case "approval_type":
			return matchesStringList(
				[
					context.workflowType,
					...LEGACY_APPROVAL_TYPE_ALIASES[context.workflowType],
				],
				condition,
			);
		case "team":
			return matchesStringList(context.teamIds, condition);
		case "location":
			return matchesString(context.locationId, condition);
		case "absence_category":
			return matchesString(context.absenceCategoryId, condition);
		case "overtime_risk":
			return matchesString(context.overtimeRisk, condition);
		case "employee_group":
			return matchesStringList(context.employeeGroupIds, condition);
		case "travel_expense_amount":
			return matchesAmount(context.travelExpenseAmount, condition);
	}
}

export function findMatchingRoutingPolicy(
	context: ApprovalRoutingContext,
	policies: ApprovalPolicyDraft[],
): ApprovalPolicyDraft | null {
	const candidates = policies
		.filter(
			(policy) =>
				policy.isActive && policy.organizationId === context.organizationId,
		)
		.sort((left, right) => left.priority - right.priority);

	for (const policy of candidates) {
		validateRoutingPolicy(policy);
	}

	return (
		candidates.find((policy) =>
			policy.conditions.every((condition) =>
				matchesRoutingCondition(context, condition),
			),
		) ?? null
	);
}
