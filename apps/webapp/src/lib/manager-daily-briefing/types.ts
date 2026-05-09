export type BriefingActionSeverity = "critical" | "high" | "warning" | "info";

export type BriefingActionCategory =
	| "approval"
	| "attendance"
	| "absence"
	| "coverage"
	| "overtime"
	| "payroll";

export interface BriefingActionItem {
	id: string;
	category: BriefingActionCategory;
	severity: BriefingActionSeverity;
	title: string;
	description: string;
	href: string;
}

export interface BriefingApprovalActionItem extends BriefingActionItem {
	category: "approval";
	approvalId: string;
	approvalType: string;
	entityId: string;
	requesterName: string;
	summary: string;
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
	description: string;
	items: TItem[];
	error?: string;
	emptyState?: string;
}

export interface ManagerDailyBriefing {
	generatedAt: string;
	date: string;
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

export interface BriefingApproval {
	id: string;
	approvalType: string;
	entityId: string;
	typeName: string;
	requester: {
		id: string;
		name: string;
	};
	priority: "urgent" | "high" | "normal" | "low";
	display: {
		summary: string;
	};
}

export function approvalToBriefingItem(approval: BriefingApproval): BriefingApprovalActionItem {
	return {
		id: `approval:${approval.id}`,
		category: "approval",
		severity:
			approval.priority === "urgent"
				? "critical"
				: approval.priority === "high"
					? "high"
					: "warning",
		title: `${approval.requester.name} needs ${approval.typeName} approval`,
		description: approval.display.summary,
		href: "/approvals/inbox",
		approvalId: approval.id,
		approvalType: approval.approvalType,
		entityId: approval.entityId,
		requesterName: approval.requester.name,
		summary: approval.display.summary,
	};
}
