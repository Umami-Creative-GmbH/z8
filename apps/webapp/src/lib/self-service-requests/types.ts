export type SelfServiceRequestSourceType =
	| "time_correction"
	| "absence"
	| "travel_expense"
	| "travel_expense_report"
	| "compliance_exception";

/**
 * `returned`: an expense report a reviewer sent back for changes, waiting for the employee.
 * `expired`: a compliance exception whose 24-hour validity window passed undecided.
 */
export type SelfServiceRequestStatus =
	| "pending"
	| "returned"
	| "approved"
	| "rejected"
	| "expired"
	| "cancelled";

export type SelfServiceRequestAction = "view" | "fix" | "cancel";

export type ComplianceExceptionKind =
	| "rest_period"
	| "overtime_daily"
	| "overtime_weekly"
	| "overtime_monthly";

/** What a compliance exception asked for; its window is shown in the organization's time zone. */
export interface ComplianceExceptionRequestDetails {
	kind: "compliance_exception";
	exceptionType: ComplianceExceptionKind;
	plannedDurationMinutes: number | null;
	validFrom: Date;
	validUntil: Date;
	timeZone: string;
}

export interface SelfServiceRequestItem {
	id: string;
	sourceType: SelfServiceRequestSourceType;
	sourceId: string;
	organizationId: string;
	employeeId: string;
	status: SelfServiceRequestStatus;
	submittedAt: Date;
	resolvedAt: Date | null;
	title: string;
	subtitle: string;
	decisionReason: string | null;
	availableActions: SelfServiceRequestAction[];
	sourceHref: string;
	details?: ComplianceExceptionRequestDetails;
}

export interface SelfServiceRequestCounts {
	pending: number;
	requiredFixes: number;
	recentDecisions: number;
	total: number;
}

export interface SelfServiceRequestFilters {
	status?: SelfServiceRequestStatus | "all";
	sourceType?: SelfServiceRequestSourceType | "all";
	search?: string;
}

export interface SelfServiceRequestSourceError {
	sourceType: SelfServiceRequestSourceType;
	message: string;
}

export interface SelfServiceRequestResult {
	items: SelfServiceRequestItem[];
	counts: SelfServiceRequestCounts;
	sourceErrors: SelfServiceRequestSourceError[];
}
