import type { SQL } from "drizzle-orm";
import type { ApprovalWorkflowType } from "../workflow/types";
import type {
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
	ApprovalInboxType,
} from "./types";

/**
 * The contract of one canonical kind's inbox read (#1058): the pending
 * canonical assignments of its workflows, read from canonical rows alone, with
 * no legacy request behind them. The read service lists, counts and opens
 * every registered read (`canonical-inbox-reads.ts`) next to the legacy
 * sources.
 */

export interface CanonicalInboxEligibleScope {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
}

export interface CanonicalInboxListFilters {
	teamId?: string;
	priority?: ApprovalInboxPriority;
	minAgeDays?: number;
	dateRange?: { from: Date; to: Date };
	/** Already trimmed and lower-cased (`en-US`). */
	search?: string;
}

export interface CanonicalInboxReadDatabase {
	execute(statement: SQL): Promise<unknown>;
}

export interface CanonicalInboxCountInput {
	organizationId: string;
	approverId: string;
	/** Every approver's assignments (managers of approvals). */
	includeAllApprovers?: boolean;
	/** Assignments of other eligible approvers of the same requester. */
	eligibleApprovalScopes?: CanonicalInboxEligibleScope[];
	/** Absent approvers the viewer covers for (#1016). */
	coveredApproverIds?: string[];
	filters?: CanonicalInboxListFilters;
	now?: Date;
	database?: CanonicalInboxReadDatabase;
}

export interface CanonicalInboxLoadInput extends CanonicalInboxCountInput {
	/** One assignment, for the detail view and decision discovery. */
	assignmentId?: string;
	assignmentIds?: string[];
	/** The most rows to return; the read service asks for one more than a page. */
	limit?: number;
	/** Rows after this position in the inbox order (risk, priority, age, id). */
	cursor?: {
		riskLevel: ApprovalInboxRiskLevel;
		priority: ApprovalInboxPriority;
		createdAt: string;
		id: string;
	};
}

/** What deciding a listed canonical assignment needs. */
export interface CanonicalInboxDecisionTarget {
	/** The assignment id, which is also the inbox item id. */
	id: string;
	targetType: "canonical_assignment";
	entityType: ApprovalInboxType;
	/** The workflow's source id. */
	entityId: string;
	organizationId: string;
	approverId: string;
	requesterEmployeeId: string;
	status: ApprovalInboxStatus;
	workflowKind: ApprovalWorkflowType;
}

export interface CanonicalInboxApproval {
	item: ApprovalInboxItem;
	detail: ApprovalInboxDetailResult;
	decisionTarget: CanonicalInboxDecisionTarget;
}

/** A page of approvals; `totalCount` is every match before the limit, when known. */
export type CanonicalInboxApprovalBatch = CanonicalInboxApproval[] & { totalCount?: number };

/** One inbox decision on a listed assignment, after the inbox's own checks. */
export interface CanonicalInboxDecisionInput {
	target: CanonicalInboxDecisionTarget;
	actorEmployeeId: string;
	action: "approve" | "reject";
	/** Trimmed and never empty for a rejection; absent for an approval. */
	reason?: string;
	/** The actor decides as a manager of approvals, not as an assigned approver. */
	allowOrganizationWideApprover: boolean;
}

export interface CanonicalInboxRead {
	/** The inbox type the read's items are listed, filtered and counted under. */
	readonly type: ApprovalInboxType;
	/** The workflow kinds whose assignments the read lists. */
	readonly workflowTypes: readonly ApprovalWorkflowType[];
	load(input: CanonicalInboxLoadInput): Promise<CanonicalInboxApprovalBatch>;
	count(input: CanonicalInboxCountInput): Promise<number>;
	/**
	 * Decides one of the read's assignments in its own transaction, re-checking
	 * the actor's right there. The inbox has already refused self-decisions,
	 * stale targets and a rejection without a reason. Without it, the inbox
	 * type's legacy handler decides (the ordinary work-period kinds).
	 */
	decide?(input: CanonicalInboxDecisionInput): Promise<void>;
}
