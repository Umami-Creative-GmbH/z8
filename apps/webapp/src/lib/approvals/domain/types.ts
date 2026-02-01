/**
 * Unified Approval Center - Domain Types
 *
 * Core domain types for the approval system. These define the contract
 * for approval type handlers and the unified approval item format.
 */

import type { Effect } from "effect";
import type { ComponentType } from "react";
import type { AnyAppError } from "@/lib/effect/errors";

// ============================================
// APPROVAL ITEM (Unified Format)
// ============================================

/**
 * Unified approval item that normalizes different approval types
 * into a consistent format for the inbox UI.
 */
export interface UnifiedApprovalItem {
	/** Unique ID of the approval request */
	id: string;

	/** Type identifier (e.g., "absence_entry", "time_entry", "shift_request") */
	approvalType: ApprovalType;

	/** ID of the underlying entity being approved */
	entityId: string;

	/** Human-readable type name for display */
	typeName: string;

	/** Requester information */
	requester: {
		id: string;
		userId: string;
		name: string;
		email: string;
		image: string | null;
		teamId: string | null;
	};

	/** Approver employee ID */
	approverId: string;

	/** Organization ID for multi-tenancy */
	organizationId: string;

	/** Current status */
	status: ApprovalStatus;

	/** When the request was created */
	createdAt: Date;

	/** When it was approved/rejected (if applicable) */
	resolvedAt: Date | null;

	/** Priority level (inferred from metadata) */
	priority: ApprovalPriority;

	/** SLA information */
	sla: {
		deadline: Date | null;
		status: SLAStatus;
		hoursRemaining: number | null;
	};

	/** Display metadata for rendering */
	display: ApprovalDisplayMetadata;
}

/**
 * Approval types supported by the system.
 * Extensible via union type.
 */
export type ApprovalType = "absence_entry" | "time_entry" | "shift_request";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalPriority = "urgent" | "high" | "normal" | "low";

export type SLAStatus = "on_time" | "approaching" | "overdue";

/**
 * Display metadata for rendering approval items in the table and detail panel.
 */
export interface ApprovalDisplayMetadata {
	/** Primary title (e.g., "Vacation", "Time Correction") */
	title: string;

	/** Subtitle with key details (e.g., "Jan 15-17, 2026") */
	subtitle: string;

	/** One-line summary for the table */
	summary: string;

	/** Optional badge (category, type indicator) */
	badge?: {
		label: string;
		color: string | null;
	};

	/** Optional icon identifier */
	icon?: string;
}

// ============================================
// APPROVAL TYPE HANDLER (Plugin Interface)
// ============================================

/**
 * Query parameters for fetching approvals.
 */
export interface ApprovalQueryParams {
	/** Employee ID of the approver */
	approverId: string;

	/** Organization ID for multi-tenancy */
	organizationId: string;

	/** Filter by status (default: pending) */
	status?: ApprovalStatus;

	/** Filter by approval type */
	types?: ApprovalType[];

	/** Filter by team ID */
	teamId?: string;

	/** Search by requester name/email */
	search?: string;

	/** Filter by date range (request creation date) */
	dateRange?: {
		from: Date;
		to: Date;
	};

	/** Filter by age in days (minimum age) */
	minAgeDays?: number;

	/** Filter by priority */
	priority?: ApprovalPriority;

	/** Cursor for pagination (createdAt timestamp) */
	cursor?: string;

	/** Items per page */
	limit: number;
}

/**
 * Paginated result for approval queries.
 */
export interface PaginatedApprovalResult {
	items: UnifiedApprovalItem[];
	nextCursor: string | null;
	hasMore: boolean;
	total: number;
}

/**
 * Detail data for the slide-over panel.
 */
export interface ApprovalDetail<TEntity = unknown> {
	/** The unified approval item */
	approval: UnifiedApprovalItem;

	/** Full entity data for type-specific rendering */
	entity: TEntity;

	/** Timeline of events */
	timeline: ApprovalTimelineEvent[];
}

export interface ApprovalTimelineEvent {
	id: string;
	type: "created" | "approved" | "rejected" | "escalated" | "reminder";
	performedBy: {
		name: string;
		image: string | null;
	} | null;
	timestamp: Date;
	message: string;
}

/**
 * Handler interface for each approval type.
 * Implement this to add support for a new approval type.
 */
export interface ApprovalTypeHandler<TEntity = unknown> {
	/** Type identifier (must match ApprovalType union) */
	readonly type: ApprovalType;

	/** Human-readable name */
	readonly displayName: string;

	/** Icon component for the type */
	readonly icon: ComponentType<{ className?: string }>;

	/** Whether bulk approve is supported for this type */
	readonly supportsBulkApprove: boolean;

	/**
	 * Fetch pending approvals of this type.
	 */
	getApprovals: (
		params: ApprovalQueryParams,
	) => Effect.Effect<UnifiedApprovalItem[], AnyAppError>;

	/**
	 * Get count of pending approvals (for badges).
	 */
	getCount: (
		approverId: string,
		organizationId: string,
	) => Effect.Effect<number, AnyAppError>;

	/**
	 * Get full details for the slide-over panel.
	 * @param entityId - The ID of the entity
	 * @param organizationId - Organization ID for authorization (optional for internal calls)
	 */
	getDetail: (
		entityId: string,
		organizationId?: string,
	) => Effect.Effect<ApprovalDetail<TEntity>, AnyAppError>;

	/**
	 * Approve the entity.
	 */
	approve: (entityId: string, approverId: string) => Effect.Effect<void, AnyAppError>;

	/**
	 * Reject the entity with a reason.
	 */
	reject: (
		entityId: string,
		approverId: string,
		reason: string,
	) => Effect.Effect<void, AnyAppError>;

	/**
	 * Calculate priority from entity metadata.
	 */
	calculatePriority: (entity: TEntity, createdAt: Date) => ApprovalPriority;

	/**
	 * Calculate SLA deadline based on type-specific rules.
	 */
	calculateSLADeadline: (entity: TEntity, createdAt: Date) => Date | null;

	/**
	 * Generate display metadata for the unified item.
	 */
	getDisplayMetadata: (entity: TEntity) => ApprovalDisplayMetadata;
}

// ============================================
// SLA CONFIGURATION
// ============================================

/**
 * SLA rule configuration for an approval type.
 */
export interface SLARule {
	approvalType: ApprovalType;
	priority: ApprovalPriority;
	deadlineHours: number;
	escalationEnabled: boolean;
	escalationThresholdHours?: number;
}

/**
 * Escalation configuration for an organization.
 */
export interface EscalationConfig {
	channels: ("teams" | "email" | "push" | "in_app" | "webhook")[];
	recipientType: "backup_manager" | "admin" | "custom";
	customRecipients?: string[];
}

// ============================================
// BULK OPERATIONS
// ============================================

/**
 * Result of a bulk approve operation.
 */
export interface BulkApproveResult {
	succeeded: string[];
	failed: Array<{
		id: string;
		error: string;
	}>;
}
