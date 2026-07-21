import type { ApprovalWorkflowType } from "@/lib/approvals/workflow/types";

export const ROUTING_STAGE_FALLBACKS = [
	"fail",
	"default_manager",
	"organization_admin",
] as const;

export type RoutingStageFallback = (typeof ROUTING_STAGE_FALLBACKS)[number];

export interface ApprovalRoutingContext {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	source: { type: string; id: string };
	requesterEmployeeId: string;
	teamIds: string[];
	locationId: string | null;
	absenceCategoryId: string | null;
	travelExpenseAmount: number | null;
	overtimeRisk: "none" | "warning" | "violation" | null;
	employeeGroupIds: string[];
}

export const LEGACY_APPROVAL_TYPE_ALIASES = {
	absence: ["absence_entry"],
	time_correction: ["time_entry"],
	manual_time_submission: ["time_entry"],
	policy_clock_out: ["time_entry"],
	travel_expense: ["travel_expense_claim"],
	shift_request: [],
	compliance_exception: [],
} as const satisfies Record<ApprovalWorkflowType, readonly string[]>;
