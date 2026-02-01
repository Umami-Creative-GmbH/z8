/**
 * Unified Approval Center - SLA Calculator
 *
 * Calculates SLA deadlines and status based on approval type,
 * priority, and organization configuration.
 */

import { DateTime } from "luxon";
import type { ApprovalPriority, ApprovalType, SLARule, SLAStatus } from "./types";

// ============================================
// DEFAULT SLA RULES
// ============================================

/**
 * Default SLA rules when no organization-specific rules are configured.
 * These represent reasonable defaults based on approval urgency.
 */
const DEFAULT_SLA_RULES: SLARule[] = [
	// Absence requests
	{ approvalType: "absence_entry", priority: "urgent", deadlineHours: 4, escalationEnabled: true },
	{ approvalType: "absence_entry", priority: "high", deadlineHours: 24, escalationEnabled: true },
	{
		approvalType: "absence_entry",
		priority: "normal",
		deadlineHours: 48,
		escalationEnabled: true,
	},
	{ approvalType: "absence_entry", priority: "low", deadlineHours: 72, escalationEnabled: false },

	// Time corrections
	{
		approvalType: "time_entry",
		priority: "urgent",
		deadlineHours: 8,
		escalationEnabled: true,
	},
	{
		approvalType: "time_entry",
		priority: "high",
		deadlineHours: 24,
		escalationEnabled: true,
	},
	{
		approvalType: "time_entry",
		priority: "normal",
		deadlineHours: 48,
		escalationEnabled: true,
	},
	{
		approvalType: "time_entry",
		priority: "low",
		deadlineHours: 72,
		escalationEnabled: false,
	},

	// Shift requests
	{
		approvalType: "shift_request",
		priority: "urgent",
		deadlineHours: 2,
		escalationEnabled: true,
	},
	{
		approvalType: "shift_request",
		priority: "high",
		deadlineHours: 12,
		escalationEnabled: true,
	},
	{
		approvalType: "shift_request",
		priority: "normal",
		deadlineHours: 24,
		escalationEnabled: true,
	},
	{
		approvalType: "shift_request",
		priority: "low",
		deadlineHours: 48,
		escalationEnabled: false,
	},
];

// ============================================
// SLA CALCULATOR
// ============================================

/**
 * Get the SLA rule for a given approval type and priority.
 */
export function getSLARule(
	approvalType: ApprovalType,
	priority: ApprovalPriority,
	orgRules?: SLARule[],
): SLARule | null {
	// Check org-specific rules first
	if (orgRules) {
		const orgRule = orgRules.find(
			(r) => r.approvalType === approvalType && r.priority === priority,
		);
		if (orgRule) return orgRule;
	}

	// Fall back to defaults
	return (
		DEFAULT_SLA_RULES.find((r) => r.approvalType === approvalType && r.priority === priority) ||
		null
	);
}

/**
 * Calculate the SLA deadline for an approval.
 */
export function calculateSLADeadline(
	approvalType: ApprovalType,
	priority: ApprovalPriority,
	createdAt: Date,
	orgRules?: SLARule[],
): Date | null {
	const rule = getSLARule(approvalType, priority, orgRules);
	if (!rule) return null;

	const deadline = DateTime.fromJSDate(createdAt).plus({ hours: rule.deadlineHours });
	return deadline.toJSDate();
}

/**
 * Calculate the SLA status and remaining time.
 */
export function calculateSLAStatus(
	deadline: Date | null,
	now: Date = new Date(),
): { status: SLAStatus; hoursRemaining: number | null } {
	if (!deadline) {
		return { status: "on_time", hoursRemaining: null };
	}

	const deadlineDt = DateTime.fromJSDate(deadline);
	const nowDt = DateTime.fromJSDate(now);
	const hoursRemaining = deadlineDt.diff(nowDt, "hours").hours;

	if (hoursRemaining < 0) {
		return { status: "overdue", hoursRemaining: Math.floor(hoursRemaining) };
	}

	if (hoursRemaining <= 4) {
		return { status: "approaching", hoursRemaining: Math.floor(hoursRemaining) };
	}

	return { status: "on_time", hoursRemaining: Math.floor(hoursRemaining) };
}

/**
 * Get a human-readable SLA status message.
 */
export function getSLAStatusMessage(
	status: SLAStatus,
	hoursRemaining: number | null,
): string {
	switch (status) {
		case "overdue":
			if (hoursRemaining !== null) {
				const hoursOverdue = Math.abs(hoursRemaining);
				if (hoursOverdue >= 24) {
					const days = Math.floor(hoursOverdue / 24);
					return `${days} day${days > 1 ? "s" : ""} overdue`;
				}
				return `${hoursOverdue}h overdue`;
			}
			return "Overdue";

		case "approaching":
			if (hoursRemaining !== null) {
				return `${hoursRemaining}h remaining`;
			}
			return "Due soon";

		case "on_time":
			if (hoursRemaining !== null && hoursRemaining < 24) {
				return `${hoursRemaining}h remaining`;
			}
			if (hoursRemaining !== null) {
				const days = Math.floor(hoursRemaining / 24);
				return `${days} day${days > 1 ? "s" : ""} remaining`;
			}
			return "On track";
	}
}

// ============================================
// PRIORITY HELPERS
// ============================================

/**
 * Priority weights for sorting (lower = higher priority).
 */
export const PRIORITY_WEIGHTS: Record<ApprovalPriority, number> = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3,
};

/**
 * Compare two priorities for sorting.
 * Returns negative if a has higher priority, positive if b has higher priority.
 */
export function comparePriority(a: ApprovalPriority, b: ApprovalPriority): number {
	return PRIORITY_WEIGHTS[a] - PRIORITY_WEIGHTS[b];
}
