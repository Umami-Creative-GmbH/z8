export type ApprovalPolicyApproverType =
	| "direct_manager"
	| "manager_manager"
	| "org_admin"
	| "specific_employee";

export interface ApprovalPolicyFormValues {
	name: string;
	description: string;
	isActive: boolean;
	priority: string;
	approvalTypes: string[];
	stages: Array<{
		localId: string;
		label: string;
		approverType: ApprovalPolicyApproverType;
		approverEmployeeId: string;
	}>;
}

interface ApprovalPolicyPayloadMessages {
	activePolicyRequiresStage: string;
	specificEmployeeRequiresId: string;
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
		activePolicyRequiresStage: "Active policies require at least one approval stage.",
		specificEmployeeRequiresId: "Specific employee stages require an approver employee ID.",
	},
) {
	if (values.isActive && values.stages.length === 0) {
		throw new Error(messages.activePolicyRequiresStage);
	}

	if (
		values.stages.some(
			(stage) => stage.approverType === "specific_employee" && !stage.approverEmployeeId.trim(),
		)
	) {
		throw new Error(messages.specificEmployeeRequiresId);
	}

	return {
		name: values.name.trim(),
		description: values.description.trim(),
		isActive: values.isActive,
		priority: Number(values.priority),
		conditions: values.approvalTypes.length
			? [
					{
						conditionType: "approval_type" as const,
						operator: "in" as const,
						values: values.approvalTypes,
					},
				]
			: [],
		stages: values.stages.map((stage, index) => ({
			id: stage.localId,
			stepOrder: index + 1,
			label: stage.label.trim(),
			approverType: stage.approverType,
			...(stage.approverEmployeeId.trim()
				? { approverEmployeeId: stage.approverEmployeeId.trim() }
				: {}),
		})),
	};
}

export const approvalTypeOptions = [
	{ value: "absence_entry" },
	{ value: "time_entry" },
	{ value: "travel_expense_claim" },
] as const;
