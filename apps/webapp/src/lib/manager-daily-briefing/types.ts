import type { ApprovalInboxItem, ApprovalInboxSummary } from "@/lib/approvals/inbox/types";

export type BriefingActionSeverity = "critical" | "high" | "warning" | "info";

export type BriefingActionCategory =
	| "approval"
	| "attendance"
	| "absence"
	| "coverage"
	| "overtime"
	| "payroll"
	/** Work lacking its vehicle or an odometer reading (#1127). */
	| "driving";

export interface BriefingActionItem {
	id: string;
	category: BriefingActionCategory;
	severity: BriefingActionSeverity;
	title: string;
	titleKey?: string;
	titleParams?: Record<string, string | number>;
	description: string;
	descriptionKey?: string;
	descriptionParams?: Record<string, string | number>;
	href: string;
}

export interface BriefingApprovalActionItem extends BriefingActionItem {
	category: "approval";
	approvalId: string;
	approvalType: string;
	entityId: string;
	requesterName: string;
	summary: string;
	/** The inbox lets the viewer approve it from the list; else the briefing offers no Approve. */
	canApprove: boolean;
	/** The inbox lets the viewer reject it from the list; else the briefing offers no Reject. */
	canReject: boolean;
	/** The viewer requested it, so someone else decides it (#686, #697). */
	ownRequest?: boolean;
	/**
	 * Approval needs acceptances only the inbox's detail view collects (#604): no one-click
	 * approve, the briefing sends the manager to the inbox instead (#1980).
	 */
	requiresDetailReview?: boolean;
	/**
	 * The inbox's localized forms of the summary (#687), translated for the viewer by the panel
	 * in place of the English `title` (after the requester's name), `description` and `summary`.
	 */
	localized?: ApprovalInboxSummary["localized"];
}

export interface BriefingSummaryCounts {
	criticalIssues: number;
	openApprovals: number;
	attendanceExceptions: number;
	absencesToday: number;
	coverageRisks: number;
	overtimeWarnings: number;
	payrollIssues: number;
}

export interface BriefingSections {
	needsAction: BriefingActionItem[];
	approvals: BriefingActionItem[];
	attendance: BriefingActionItem[];
	absences: BriefingActionItem[];
	coverage: BriefingActionItem[];
	overtime: BriefingActionItem[];
	payroll: BriefingActionItem[];
}

export interface BriefingSection<TItem extends BriefingActionItem = BriefingActionItem> {
	id: string;
	title: string;
	titleKey?: string;
	description: string;
	descriptionKey?: string;
	items: TItem[];
	error?: string;
	emptyState?: string;
	emptyStateKey?: string;
}

export interface ManagerDailyBriefing {
	generatedAt: string;
	date: string;
	/** The standalone operational check failed; never infer all-clear from its empty fallback. */
	needsActionError?: string;
	summary: BriefingSummaryCounts;
	needsAction: BriefingActionItem[];
	sections: {
		approvals: BriefingSection<BriefingApprovalActionItem>;
		attendance: BriefingSection;
		absences: BriefingSection;
		coverage: BriefingSection;
		overtime: BriefingSection;
		payroll: BriefingSection;
	};
}

export interface BriefingShift {
	id: string;
	employeeId: string;
	employeeName: string;
	teamName: string | null;
	date: string;
	startTime: string;
	endTime: string;
	status: "draft" | "published";
	subareaId?: string | null;
	subareaName?: string | null;
}

export interface BriefingTimeRecord {
	id: string;
	employeeId: string;
	startAt: Date;
	endAt: Date | null;
}

export interface BriefingAbsence {
	id: string;
	employeeId: string;
	employeeName: string;
	teamName: string | null;
	categoryName: string;
	startDate: string;
	endDate: string;
	status: "pending" | "approved" | "rejected";
}

export interface BriefingCoverageRule {
	id: string;
	subareaId: string;
	subareaName: string;
	dayOfWeek: string;
	startTime: string;
	endTime: string;
	minimumStaffCount: number;
}

/**
 * A pending approval of the viewer's unified Approval inbox (#1980): every inbox type, with the
 * capabilities the inbox gives it.
 */
export type BriefingApproval = ApprovalInboxItem;

/** A page of approvals; `totalCount` is every match before the page, when known. */
export type BriefingApprovalBatch = BriefingApproval[] & { totalCount?: number };

export function approvalToBriefingItem(approval: BriefingApproval): BriefingApprovalActionItem {
	const { priority } = approval.triage;
	return {
		id: `approval:${approval.id}`,
		category: "approval",
		severity: priority === "urgent" ? "critical" : priority === "high" ? "high" : "warning",
		title: `${approval.requester.name}: ${approval.summary.title}`,
		description: approval.summary.subtitle,
		href: `/approvals/inbox?types=${approval.type}`,
		approvalId: approval.id,
		approvalType: approval.type,
		entityId: approval.entityId,
		requesterName: approval.requester.name,
		summary: approval.summary.detail,
		canApprove: approval.capabilities.canApprove,
		canReject: approval.capabilities.canReject,
		...(approval.capabilities.ownRequest ? { ownRequest: true } : {}),
		...(approval.capabilities.requiresDetailReview ? { requiresDetailReview: true } : {}),
		...(approval.summary.localized ? { localized: approval.summary.localized } : {}),
	};
}
