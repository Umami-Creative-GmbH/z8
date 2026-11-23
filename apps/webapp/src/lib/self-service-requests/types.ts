import type {
	TravelExpenseReportItemType,
	TravelExpenseReportKind,
} from "@/db/schema/travel-expense";

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

/** What a compliance exception asked for; its window is shown in the viewer's time zone. */
export interface ComplianceExceptionRequestDetails {
	kind: "compliance_exception";
	exceptionType: ComplianceExceptionKind;
	plannedDurationMinutes: number | null;
	validFrom: Date;
	validUntil: Date;
	timeZone: string;
}

/**
 * What names an expense report, as `reportName` and `reportKindLabel` do: the item's title is the
 * trip purpose or the standalone expense's description or route ("" if none).
 */
export interface ExpenseReportRequestDetails {
	kind: "expense_report";
	reportKind: TravelExpenseReportKind;
	/** A standalone report's (only) expense type; null for a trip or before an expense exists. */
	itemType: TravelExpenseReportItemType | null;
	/**
	 * Only on an adjustment report, which copies its original's purpose and dates: the report it
	 * adjusts, named as that report is (null when it has no name or cannot be read).
	 */
	adjustmentOf?: { reportId: string; title: string | null };
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
	details?:
		| ComplianceExceptionRequestDetails
		| ExpenseReportRequestDetails
		| EarlierClaimRequestDetails;
}

/** What names an earlier claim, as the finance list does ("Earlier {type} claim"). */
export interface EarlierClaimRequestDetails {
	kind: "earlier_claim";
	/** The claim's type as stored (receipt, mileage, per_diem). */
	claimType: string;
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
	/** The viewer's own time zone: request instants are read in it, as validity windows are. */
	timeZone: string;
}
