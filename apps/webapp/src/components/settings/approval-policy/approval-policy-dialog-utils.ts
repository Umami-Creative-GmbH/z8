export type ApprovalPolicyApproverType =
	| "direct_manager"
	| "manager_manager"
	| "org_admin"
	| "specific_employee";

export const approvalTypeOptions = [
	{ value: "absence" },
	{ value: "time_correction" },
	{ value: "manual_time_submission" },
	{ value: "policy_clock_out" },
	{ value: "travel_expense" },
	{ value: "shift_request" },
	{ value: "compliance_exception" },
	{ value: "period_submission" },
] as const;

export type ApprovalPolicyApprovalType =
	(typeof approvalTypeOptions)[number]["value"];

export const fallbackBehaviorOptions = [
	{ value: "fail" },
	{ value: "default_manager" },
	{ value: "organization_admin" },
] as const;

export type ApprovalPolicyFallbackBehavior =
	(typeof fallbackBehaviorOptions)[number]["value"];

export interface ApprovalPolicyFormValues {
	name: string;
	description: string;
	isActive: boolean;
	priority: string;
	approvalTypes: ApprovalPolicyApprovalType[];
	stages: Array<{
		localId: string;
		label: string;
		approverType: ApprovalPolicyApproverType;
		approverEmployeeId: string;
		fallbackBehavior: ApprovalPolicyFallbackBehavior;
	}>;
}

interface ApprovalPolicyPayloadMessages {
	activePolicyRequiresStage: string;
	specificEmployeeRequiresId: string;
}

/** A policy condition as the save action accepts it. */
export interface ApprovalPolicyConditionInput {
	conditionType:
		| "approval_type"
		| "team"
		| "location"
		| "absence_category"
		| "travel_expense_amount"
		| "overtime_risk"
		| "employee_group";
	operator: "equals" | "in" | "gte" | "lte" | "between";
	value?: string;
	values?: string[];
	amountMin?: number;
	amountMax?: number;
}

/** A stored policy, as the policy list returns it. */
export interface ApprovalPolicyRecord {
	id: string;
	name: string;
	description: string | null;
	isActive: boolean;
	priority: number;
	conditions: Array<{
		conditionType: ApprovalPolicyConditionInput["conditionType"];
		operator: ApprovalPolicyConditionInput["operator"];
		valueJson: unknown;
		amountMin: string | null;
		amountMax: string | null;
		overtimeRisk?: string | null;
		teamId?: string | null;
		locationId?: string | null;
		absenceCategoryId?: string | null;
		employeeGroupId?: string | null;
	}>;
	stages: Array<{
		id: string;
		stepOrder: number;
		label: string;
		approverType: ApprovalPolicyApproverType;
		approverEmployeeId: string | null;
		fallbackBehavior: string;
	}>;
}

/**
 * A stored policy loaded into the editor. The editor changes approval types
 * and stages; every other condition, and approval-type values it has no
 * checkbox for, are carried through the save unchanged.
 */
export interface ApprovalPolicyEditState {
	id: string;
	values: ApprovalPolicyFormValues;
	preservedConditions: ApprovalPolicyConditionInput[];
	legacyApprovalTypes: string[];
}

interface ApprovalPolicyPayloadExtras {
	preservedConditions?: ApprovalPolicyConditionInput[];
	legacyApprovalTypes?: string[];
}

const editableApprovalTypes = new Set<string>(
	approvalTypeOptions.map((option) => option.value),
);

function isEditableApprovalType(
	value: string,
): value is ApprovalPolicyApprovalType {
	return editableApprovalTypes.has(value);
}

function isFallbackBehavior(
	value: string,
): value is ApprovalPolicyFallbackBehavior {
	return fallbackBehaviorOptions.some((option) => option.value === value);
}

function storedConditionValues(
	condition: ApprovalPolicyRecord["conditions"][number],
): Pick<ApprovalPolicyConditionInput, "value" | "values"> {
	const valueJson = condition.valueJson;
	let value: string | undefined;
	let values: string[] | undefined;
	if (typeof valueJson === "string") {
		value = valueJson;
	} else if (valueJson && typeof valueJson === "object") {
		const stored = valueJson as { value?: unknown; values?: unknown };
		if (typeof stored.value === "string") value = stored.value;
		if (Array.isArray(stored.values)) {
			values = stored.values.filter(
				(item): item is string => typeof item === "string",
			);
		}
	}
	// Older rows may carry an equality only in its reference column.
	value ??=
		condition.teamId ??
		condition.locationId ??
		condition.absenceCategoryId ??
		condition.employeeGroupId ??
		condition.overtimeRisk ??
		undefined;

	return {
		...(value !== undefined ? { value } : {}),
		...(values !== undefined ? { values } : {}),
	};
}

function storedConditionInput(
	condition: ApprovalPolicyRecord["conditions"][number],
): ApprovalPolicyConditionInput {
	const amountMin =
		condition.amountMin === null ? undefined : Number(condition.amountMin);
	const amountMax =
		condition.amountMax === null ? undefined : Number(condition.amountMax);
	return {
		conditionType: condition.conditionType,
		operator: condition.operator,
		...storedConditionValues(condition),
		...(amountMin !== undefined ? { amountMin } : {}),
		...(amountMax !== undefined ? { amountMax } : {}),
	};
}

/** Loads a stored policy into the editor without losing what it cannot edit. */
export function approvalPolicyToEditState(
	policy: ApprovalPolicyRecord,
): ApprovalPolicyEditState {
	const conditions = policy.conditions.map(storedConditionInput);
	const editableIndex = conditions.findIndex(
		(condition) =>
			condition.conditionType === "approval_type" &&
			(condition.operator === "in" || condition.operator === "equals"),
	);
	const editable = editableIndex === -1 ? null : conditions[editableIndex];
	const editableValues = editable
		? (editable.values ??
			(editable.value !== undefined ? [editable.value] : []))
		: [];

	return {
		id: policy.id,
		values: {
			name: policy.name,
			description: policy.description ?? "",
			isActive: policy.isActive,
			priority: String(policy.priority),
			approvalTypes: editableValues.filter(isEditableApprovalType),
			stages: policy.stages
				.toSorted((left, right) => left.stepOrder - right.stepOrder)
				.map((stage) => ({
					localId: stage.id,
					label: stage.label,
					approverType: stage.approverType,
					approverEmployeeId: stage.approverEmployeeId ?? "",
					// The save action accepts only these; anything else could not be saved.
					fallbackBehavior: isFallbackBehavior(stage.fallbackBehavior)
						? stage.fallbackBehavior
						: "fail",
				})),
		},
		preservedConditions: conditions.filter(
			(_, index) => index !== editableIndex,
		),
		legacyApprovalTypes: editableValues.filter(
			(value) => !isEditableApprovalType(value),
		),
	};
}

export const defaultApprovalPolicyFormValues: ApprovalPolicyFormValues = {
	name: "",
	description: "",
	isActive: false,
	priority: "10",
	approvalTypes: [],
	stages: [],
};

export function buildApprovalPolicyPayload(
	values: ApprovalPolicyFormValues,
	messages: ApprovalPolicyPayloadMessages = {
		activePolicyRequiresStage:
			"Active policies require at least one approval stage.",
		specificEmployeeRequiresId:
			"Specific employee stages require an approver employee ID.",
	},
	extras: ApprovalPolicyPayloadExtras = {},
) {
	if (values.isActive && values.stages.length === 0) {
		throw new Error(messages.activePolicyRequiresStage);
	}

	if (
		values.stages.some(
			(stage) =>
				stage.approverType === "specific_employee" &&
				!stage.approverEmployeeId.trim(),
		)
	) {
		throw new Error(messages.specificEmployeeRequiresId);
	}

	const approvalTypes = [
		...values.approvalTypes,
		...(extras.legacyApprovalTypes ?? []),
	];
	const conditions: ApprovalPolicyConditionInput[] = [
		...(approvalTypes.length
			? [
					{
						conditionType: "approval_type" as const,
						operator: "in" as const,
						values: approvalTypes,
					},
				]
			: []),
		...(extras.preservedConditions ?? []),
	];

	return {
		name: values.name.trim(),
		description: values.description.trim(),
		isActive: values.isActive,
		priority: Number(values.priority),
		conditions,
		stages: values.stages.map((stage, index) => ({
			id: stage.localId,
			stepOrder: index + 1,
			label: stage.label.trim(),
			approverType: stage.approverType,
			fallbackBehavior: stage.fallbackBehavior,
			...(stage.approverEmployeeId.trim()
				? { approverEmployeeId: stage.approverEmployeeId.trim() }
				: {}),
		})),
	};
}
