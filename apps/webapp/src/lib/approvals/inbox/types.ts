import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import type { WorkCategoryReviewValue } from "../server/time-correction-review-metadata";

export const SUPPORTED_APPROVAL_INBOX_TYPES = [
	"absence_entry",
	"time_entry",
	"travel_expense_claim",
	"travel_expense_report",
] as const;

export type ApprovalInboxType = (typeof SUPPORTED_APPROVAL_INBOX_TYPES)[number];

export type ApprovalInboxStatus = "pending" | "approved" | "rejected";
export type ApprovalInboxPriority = "urgent" | "high" | "normal" | "low";
export type ApprovalInboxRiskLevel = "low" | "medium" | "high";
export type ApprovalInboxFastLaneGroup =
	| "low_risk_absence"
	| "small_time_correction"
	| "stale_pending"
	| "payroll_blocker";

export interface ApprovalInboxRequester {
	id: string;
	name: string;
	email: string;
	image: string | null;
	teamId: string | null;
}

export interface ApprovalInboxSummary {
	title: string;
	subtitle: string;
	detail: string;
	badge: { label: string; color: string | null } | null;
	stage?: { name: string; order: number };
}

export interface ApprovalInboxTiming {
	createdAt: string;
	resolvedAt: string | null;
	slaDeadline: string | null;
	ageDays: number;
}

export interface ApprovalInboxTriage {
	priority: ApprovalInboxPriority;
	riskLevel: ApprovalInboxRiskLevel;
	riskReasons: string[];
	fastLaneGroup: ApprovalInboxFastLaneGroup | null;
	isPayrollRelevant: boolean;
	explanation: string;
}

export interface ApprovalInboxCapabilities {
	canApprove: boolean;
	canReject: boolean;
	canBulkApprove: boolean;
	requiresRejectReason: boolean;
	/**
	 * Approval needs acceptances only the detail view collects (#604); list and
	 * sprint approve stay off and send the reviewer to the details.
	 */
	requiresDetailReview?: boolean;
}

export interface ApprovalInboxItem {
	id: string;
	type: ApprovalInboxType;
	entityId: string;
	status: ApprovalInboxStatus;
	/** A report cycle retired as returned or withdrawn; its legacy status is `rejected` (#603). */
	closedAs?: "returned" | "withdrawn";
	requester: ApprovalInboxRequester;
	summary: ApprovalInboxSummary;
	timing: ApprovalInboxTiming;
	triage: ApprovalInboxTriage;
	capabilities: ApprovalInboxCapabilities;
}

/**
 * A `{name}` value of a localized text: plain, itself localized, or a list of
 * localized texts the client joins with "; " after translating each one.
 */
export type ApprovalInboxTextParam =
	| string
	| number
	| ApprovalInboxLocalizedText
	| ApprovalInboxLocalizedText[];

export interface ApprovalInboxLocalizedText {
	key: string;
	fallback: string;
	/** Interpolation values for `{name}` placeholders in the key and fallback. */
	params?: Record<string, ApprovalInboxTextParam>;
}

export type ApprovalInboxDetailChangeValue =
	| { kind: "work_location"; value: WorkLocationType }
	| { kind: "work_category"; value: WorkCategoryReviewValue };

export interface ApprovalInboxDetailChange {
	kind: "change";
	original: ApprovalInboxDetailChangeValue;
	requested: ApprovalInboxDetailChangeValue;
}

export interface ApprovalInboxTimeEndpoint {
	at: string;
	utcOffsetMinutes: number | null;
}

export interface ApprovalInboxTimeRange {
	start: ApprovalInboxTimeEndpoint | null;
	end: ApprovalInboxTimeEndpoint | null;
}

export interface ApprovalInboxTimeComparison {
	type: "time_comparison";
	action: "edit" | "delete";
	original: ApprovalInboxTimeRange;
	requested: ApprovalInboxTimeRange;
}

export type ApprovalInboxDetailSection =
	| ApprovalInboxTimeComparison
	| {
			type: "key_value";
			title: string | ApprovalInboxLocalizedText;
			rows: Array<{
				label: string | ApprovalInboxLocalizedText;
				value: string | ApprovalInboxLocalizedText | ApprovalInboxDetailChange;
				tone?: "default" | "warning" | "danger";
				/** An in-app page the value links to (e.g. the report an adjustment corrects). */
				href?: string;
			}>;
	  }
	| { type: "text"; title: string; body: string }
	| {
			type: "timeline";
			title: string | ApprovalInboxLocalizedText;
			events: Array<{
				id: string;
				label: string | ApprovalInboxLocalizedText;
				at: string;
				actorName: string | null;
			}>;
	  }
	| {
			type: "callout";
			title: string | ApprovalInboxLocalizedText;
			body: string | ApprovalInboxLocalizedText;
			tone: "info" | "warning" | "danger";
	  }
	/** Expense report missing-receipt exceptions an approval must accept (#604). */
	| {
			type: "receipt_exception_acceptance";
			title: string | ApprovalInboxLocalizedText;
			items: Array<{ itemId: string; label: string; reason: string }>;
	  };

export interface ApprovalInboxDetailResult {
	item: ApprovalInboxItem;
	sections: ApprovalInboxDetailSection[];
	actions: ApprovalInboxCapabilities;
}

export interface ApprovalInboxWarning {
	source: string;
	message: string;
}

export interface ApprovalInboxListResult {
	items: ApprovalInboxItem[];
	nextCursor: string | null;
	hasMore: boolean;
	total: number;
	counts: Record<ApprovalInboxType, number>;
	supportedTypes: ApprovalInboxType[];
	warnings: ApprovalInboxWarning[];
}

export interface ApprovalInboxDecisionSuccess {
	id: string;
	type: ApprovalInboxType;
	status: "approved" | "rejected";
}

export interface ApprovalInboxDecisionFailure {
	id: string;
	code:
		| "stale"
		| "forbidden"
		| "not_found"
		| "unsupported"
		| "validation_failed";
	message: string;
}

export interface ApprovalInboxBulkDecisionResult {
	succeeded: ApprovalInboxDecisionSuccess[];
	failed: ApprovalInboxDecisionFailure[];
}
