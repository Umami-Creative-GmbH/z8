import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import type { PerDiemDayLocation } from "@/lib/travel-expenses/per-diem";
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
	/** Localized forms the client prefers over the English strings above (#687). */
	localized?: {
		title: ApprovalInboxLocalizedText;
		subtitle: ApprovalInboxLocalizedText;
		detail: ApprovalInboxLocalizedText;
	};
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
	/** The viewer requested this; someone else decides it, so every decision is off (#686). */
	ownRequest?: boolean;
	/**
	 * The viewer covers for this item's approver but already decided an
	 * earlier stage of it (four-eyes, #1016); every decision is off.
	 */
	decidedEarlierStage?: boolean;
}

/** An absent approver the viewer covers for right now (#1016). */
export interface ApprovalInboxCover {
	approverId: string;
	approverName: string;
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
	/** Assigned to an absent approver the viewer covers for: their "Covering for" section (#1016). */
	coveringFor?: ApprovalInboxCover;
}

/**
 * A typed value the viewer formats in their own locale (#687), like the report
 * pages: calendar days exactly as entered (never shifted by a zone), a recorded
 * UTC instant (shown in UTC), a frozen decimal amount with its currency, an
 * ISO 3166 country code.
 */
export type ApprovalInboxValue =
	| { kind: "plain_date"; date: string }
	| { kind: "instant"; at: string }
	| { kind: "plain_date_range"; start: string; end: string }
	| { kind: "money"; amount: string; currency: string; signed?: true }
	| { kind: "country"; code: string };

/**
 * A `{name}` value of a localized text: plain, typed, itself localized, or a
 * list the client joins with "; " after rendering each entry.
 */
export type ApprovalInboxTextParam =
	| string
	| number
	| ApprovalInboxValue
	| ApprovalInboxLocalizedText
	| Array<string | ApprovalInboxValue | ApprovalInboxLocalizedText>
	| ApprovalInboxPerDiemLocationParam;

/** A per diem day's applied location (#681), named in the reader's language when rendered. */
export interface ApprovalInboxPerDiemLocationParam {
	perDiemLocation: Pick<PerDiemDayLocation, "country" | "place" | "label">;
}

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
			/** The title is text a person entered (an expense's description), shown as written. */
			titleAsEntered?: true;
			rows: Array<{
				label: string | ApprovalInboxLocalizedText;
				value: string | ApprovalInboxLocalizedText | ApprovalInboxValue | ApprovalInboxDetailChange;
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
				/** A covering deputy decided for this absent approver (#1016). */
				actingForName?: string | null;
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
			items: Array<{ itemId: string; label: string | ApprovalInboxLocalizedText; reason: string }>;
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
	/**
	 * One "Covering for" section per covered approver (#1016), with its own
	 * rows; `items` holds only the viewer's own approvals.
	 */
	covering?: ApprovalInboxCoveringSection[];
}

/** A "Covering for" section: what waits for one absent approver the viewer covers for. */
export interface ApprovalInboxCoveringSection extends ApprovalInboxCover {
	/** Pending approvals the section lists; `rows.length` unless `hasMore`. */
	count: number;
	rows: ApprovalInboxItem[];
	/** More wait than the section lists at once. */
	hasMore: boolean;
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
