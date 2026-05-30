import type { ApprovalType } from "@/lib/approvals/domain/types";

export type ApprovalPolicyConditionType =
	| "approval_type"
	| "team"
	| "location"
	| "absence_category"
	| "travel_expense_amount"
	| "overtime_risk"
	| "employee_group";

export type ApprovalPolicyConditionOperator = "equals" | "in" | "gte" | "lte" | "between";
export type ApprovalPolicyApproverType =
	| "direct_manager"
	| "manager_manager"
	| "org_admin"
	| "specific_employee"
	| "team_lead";
export type ApprovalPolicyOvertimeRisk = "none" | "warning" | "violation";

export interface ApprovalPolicyEvaluationContext {
	organizationId: string;
	approvalType: ApprovalType;
	requesterEmployeeId: string;
	teamId: string | null;
	locationId: string | null;
	absenceCategoryId: string | null;
	travelExpenseAmount: number | null;
	overtimeRisk: ApprovalPolicyOvertimeRisk | null;
	employeeGroupIds: string[];
	entityType: string;
	entityId: string;
}

export interface ApprovalPolicyConditionDraft {
	conditionType: ApprovalPolicyConditionType;
	operator: ApprovalPolicyConditionOperator;
	value?: string;
	values?: string[];
	amountMin?: number;
	amountMax?: number;
}

export interface ApprovalPolicyStageDraft {
	id: string;
	stepOrder: number;
	label: string;
	approverType: ApprovalPolicyApproverType;
	approverEmployeeId?: string;
}

export interface ApprovalPolicyDraft {
	id: string;
	organizationId: string;
	name: string;
	isActive: boolean;
	priority: number;
	conditions: ApprovalPolicyConditionDraft[];
	stages: ApprovalPolicyStageDraft[];
}
