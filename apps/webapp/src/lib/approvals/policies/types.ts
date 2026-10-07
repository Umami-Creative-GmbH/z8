import type { ApprovalType } from "@/lib/approvals/domain/types";
import type { RoutingStageFallback } from "../routing/types";

export type ApprovalPolicyConditionType =
	| "approval_type"
	| "team"
	| "location"
	| "absence_category"
	| "travel_expense_amount"
	| "overtime_risk"
	| "employee_group";

export type ApprovalPolicyConditionOperator =
	| "equals"
	| "in"
	| "gte"
	| "lte"
	| "between";
export type ApprovalPolicyApproverType =
	| "direct_manager"
	| "manager_manager"
	| "org_admin"
	| "specific_employee"
	| "team_lead";
export type ApprovalPolicyOvertimeRisk = "none" | "warning" | "violation";

/**
 * Currency of `travel_expense_amount` thresholds. A report is routed by an
 * amount only in this currency; any other amount is refused rather than
 * compared as an unlabeled number (#602).
 */
export const APPROVAL_AMOUNT_THRESHOLD_CURRENCY = "EUR";

export interface ApprovalPolicyEvaluationContext {
	organizationId: string;
	approvalType: ApprovalType;
	requesterEmployeeId: string;
	teamId: string | null;
	locationId: string | null;
	absenceCategoryId: string | null;
	/** In {@link APPROVAL_AMOUNT_THRESHOLD_CURRENCY} for travel expense reports. */
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
	fallbackBehavior: RoutingStageFallback;
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
