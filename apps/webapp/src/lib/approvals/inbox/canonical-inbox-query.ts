import { type SQL, sql } from "drizzle-orm";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { ApprovalInboxPriority, ApprovalInboxRiskLevel } from "./types";

/**
 * The SQL pieces every canonical inbox read shares (#1058): visibility, filters, the
 * risk/priority order and its cursor, a target assignment, and the page bound. Each read's query
 * names its tables `workflow`, `assignment`, `requester`, `requester_user` and `projection`.
 */

export interface CanonicalInboxVisibilityInput {
	approverId: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: Array<{
		requesterEmployeeId: string;
		eligibleApproverIds: string[];
	}>;
	/** Absent approvers the viewer covers for (#1016). */
	coveredApproverIds?: string[];
}

export interface CanonicalInboxFilters {
	teamId?: string;
	priority?: ApprovalInboxPriority;
	minAgeDays?: number;
	dateRange?: { from: Date; to: Date };
	search?: string;
}

export interface CanonicalInboxCursor {
	riskLevel: ApprovalInboxRiskLevel;
	priority: ApprovalInboxPriority;
	createdAt: string;
	id: string;
}

const PRIORITY_RANK: Record<ApprovalInboxPriority, number> = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3,
};
const RISK_RANK: Record<ApprovalInboxRiskLevel, number> = {
	high: 0,
	medium: 1,
	low: 2,
};

/** The rows of a raw `execute` result. */
export function resultRows(result: unknown): Record<string, unknown>[] {
	return typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
		? (result.rows as Record<string, unknown>[])
		: [];
}

/**
 * The assignments the viewer may see: their own, every one, those of eligible approvers of a
 * requester they may decide for, and those of absent approvers they cover for.
 */
export function canonicalInboxVisibility(
	input: CanonicalInboxVisibilityInput,
): SQL {
	if (input.includeAllApprovers) return sql`true`;
	const eligible = (input.eligibleApprovalScopes ?? []).flatMap((scope) =>
		scope.eligibleApproverIds.includes(input.approverId) &&
		scope.eligibleApproverIds.length > 0
			? [
					sql`(workflow.requester_employee_id = ${scope.requesterEmployeeId}::uuid and assignment.approver_employee_id in (${sql.join(
						scope.eligibleApproverIds.map((id) => sql`${id}::uuid`),
						sql`, `,
					)}))`,
				]
			: [],
	);
	if (input.coveredApproverIds && input.coveredApproverIds.length > 0) {
		eligible.push(
			sql`assignment.approver_employee_id in (${sql.join(
				input.coveredApproverIds.map((id) => sql`${id}::uuid`),
				sql`, `,
			)})`,
		);
	}
	return eligible.length > 0
		? sql`(assignment.approver_employee_id = ${input.approverId}::uuid or ${sql.join(eligible, sql` or `)})`
		: sql`assignment.approver_employee_id = ${input.approverId}::uuid`;
}

/** 0 for a workflow submitted at least three days ago (high risk), else 1. */
export function canonicalInboxRiskRank(now: Date): SQL {
	return sql`case when workflow.submitted_at <= ${now}::timestamptz - interval '3 days' then 0 else 1 end`;
}

/** The priority rank by age, as `canonicalInboxPriority` names it. */
export function canonicalInboxPriorityRank(now: Date): SQL {
	return sql`case
		when workflow.submitted_at < ${now}::timestamptz - interval '72 hours' then 0
		when workflow.submitted_at < ${now}::timestamptz - interval '48 hours' then 1
		when workflow.submitted_at < ${now}::timestamptz - interval '24 hours' then 2
		else 3 end`;
}

/** The list's filters as `and ...`, or nothing. */
export function canonicalInboxFilters(
	filters: CanonicalInboxFilters | undefined,
	now: Date,
): SQL {
	if (!filters) return sql``;
	const conditions: SQL[] = [];
	if (filters.teamId)
		conditions.push(sql`requester.team_id = ${filters.teamId}::uuid`);
	if (filters.priority) {
		conditions.push(
			sql`${canonicalInboxPriorityRank(now)} = ${PRIORITY_RANK[filters.priority]}`,
		);
	}
	if (filters.minAgeDays) {
		conditions.push(
			sql`workflow.submitted_at <= ${now}::timestamptz - ${filters.minAgeDays} * interval '1 day'`,
		);
	}
	if (filters.dateRange) {
		conditions.push(
			sql`workflow.submitted_at >= ${filters.dateRange.from}`,
			sql`workflow.submitted_at <= ${filters.dateRange.to}`,
		);
	}
	if (filters.search) {
		conditions.push(sql`(
			strpos(lower(requester_user.name), ${filters.search}) > 0
			or strpos(lower(requester_user.email), ${filters.search}) > 0
			or strpos(projection.search_text, ${filters.search}) > 0
		)`);
	}
	return conditions.length > 0
		? sql`and ${sql.join(conditions, sql` and `)}`
		: sql``;
}

/** One assignment or several, as `and ...`, or nothing. */
export function canonicalInboxTarget(input: {
	assignmentId?: string;
	assignmentIds?: string[];
}): SQL {
	if (input.assignmentId)
		return sql`and assignment.id = ${input.assignmentId}::uuid`;
	if (input.assignmentIds?.length) {
		return sql`and assignment.id in (${sql.join(
			input.assignmentIds.map((id) => sql`${id}::uuid`),
			sql`, `,
		)})`;
	}
	return sql``;
}

/** The rows after the cursor in the list's order (risk, priority, submitted, assignment). */
export function canonicalInboxCursor(
	cursor: CanonicalInboxCursor | undefined,
	now: Date,
): SQL {
	if (!cursor) return sql``;
	const risk = RISK_RANK[cursor.riskLevel];
	const priority = PRIORITY_RANK[cursor.priority];
	const createdAt = new Date(cursor.createdAt);
	const riskRank = canonicalInboxRiskRank(now);
	const priorityRank = canonicalInboxPriorityRank(now);
	return sql`and (${riskRank} > ${risk}
		or (${riskRank} = ${risk} and ${priorityRank} > ${priority})
		or (${riskRank} = ${risk} and ${priorityRank} = ${priority} and workflow.submitted_at > ${createdAt})
		or (${riskRank} = ${risk} and ${priorityRank} = ${priority}
			and workflow.submitted_at = ${createdAt} and assignment.id > ${cursor.id}::uuid))`;
}

/** The list's order. */
export function canonicalInboxOrder(now: Date): SQL {
	return sql`${canonicalInboxRiskRank(now)}, ${canonicalInboxPriorityRank(now)}, workflow.submitted_at, assignment.id`;
}

/** One row for a single assignment, else the requested page, between 1 and 101 rows. */
export function canonicalInboxLimit(input: {
	assignmentId?: string;
	limit?: number;
	evaluateBeforePagination?: boolean;
}): number | SQL {
	if (input.assignmentId) return 1;
	if (input.evaluateBeforePagination) return sql`all`;
	return Math.min(Math.max(Math.floor(input.limit ?? 51), 1), 101);
}

/** An approval's priority by its age: as `canonicalInboxPriorityRank` ranks it. */
export function canonicalInboxPriority(
	submittedAt: Date,
	now: Date,
): ApprovalInboxPriority {
	const hours = instantFromDate(submittedAt)
		.until(instantFromDate(now))
		.total("hours");
	if (hours > 72) return "urgent";
	if (hours > 48) return "high";
	if (hours > 24) return "normal";
	return "low";
}
