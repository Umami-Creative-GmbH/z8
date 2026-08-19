import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import type { WorkCategoryReviewValue } from "../server/time-correction-review-metadata";

export const SUPPORTED_APPROVAL_INBOX_TYPES = [
	"absence_entry",
	"time_entry",
	"travel_expense_claim",
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
}

export interface ApprovalInboxItem {
	id: string;
	type: ApprovalInboxType;
	entityId: string;
	status: ApprovalInboxStatus;
	requester: ApprovalInboxRequester;
	summary: ApprovalInboxSummary;
	timing: ApprovalInboxTiming;
	triage: ApprovalInboxTriage;
	capabilities: ApprovalInboxCapabilities;
}

export interface ApprovalInboxLocalizedText {
	key: string;
	fallback: string;
}

export type ApprovalInboxDetailChangeValue =
	| { kind: "work_location"; value: WorkLocationType }
	| { kind: "work_category"; value: WorkCategoryReviewValue };

export interface ApprovalInboxDetailChange {
	kind: "change";
	original: ApprovalInboxDetailChangeValue;
	requested: ApprovalInboxDetailChangeValue;
}

export type ApprovalInboxDetailSection =
	| {
			type: "key_value";
			title: string | ApprovalInboxLocalizedText;
			rows: Array<{
				label: string | ApprovalInboxLocalizedText;
				value: string | ApprovalInboxLocalizedText | ApprovalInboxDetailChange;
				tone?: "default" | "warning" | "danger";
			}>;
	  }
	| { type: "text"; title: string; body: string }
	| {
			type: "timeline";
			title: string;
			events: Array<{
				id: string;
				label: string;
				at: string;
				actorName: string | null;
			}>;
	  }
	| {
			type: "callout";
			title: string;
			body: string;
			tone: "info" | "warning" | "danger";
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
