import { type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	decidePeriodSubmission,
	PeriodSubmissionDecisionError,
} from "@/lib/time-tracking/period-submissions/submission-service";
import { decodeApprovalDatabaseTimestamptz } from "../approval-database-row";
import { isPeriodSubmissionSubmittedFacts } from "../evidence/period-submission-facts";
import { buildPeriodSubmissionReviewSections } from "../presentation/period-submission-review";
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import type {
	CanonicalInboxApproval,
	CanonicalInboxApprovalBatch,
	CanonicalInboxCountInput,
	CanonicalInboxDecisionInput,
	CanonicalInboxLoadInput,
	CanonicalInboxRead,
	CanonicalInboxReadDatabase,
} from "./canonical-inbox-read";
import { getAgeDays } from "./serialization";
import { buildInboxTriage } from "./triage";
import type {
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
	ApprovalInboxLocalizedText,
	ApprovalInboxPriority,
} from "./types";

/**
 * The inbox read of period submissions (#1059): their pending canonical assignments, read from
 * canonical rows and the submission itself. There is no legacy request behind them (Approvals
 * ADR-0002). The card (#1061) is built from the submitted revision's facts.
 */

function resultRows(result: unknown): Record<string, unknown>[] {
	return typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
		? (result.rows as Record<string, unknown>[])
		: [];
}

function visibility(input: CanonicalInboxCountInput): SQL {
	if (input.includeAllApprovers) return sql`true`;
	const eligible = (input.eligibleApprovalScopes ?? []).flatMap((scope) =>
		scope.eligibleApproverIds.includes(input.approverId) && scope.eligibleApproverIds.length > 0
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

function riskRank(now: Date): SQL {
	return sql`case when workflow.submitted_at <= ${now}::timestamptz - interval '3 days' then 0 else 1 end`;
}

function priorityRank(now: Date): SQL {
	return sql`case
		when workflow.submitted_at < ${now}::timestamptz - interval '72 hours' then 0
		when workflow.submitted_at < ${now}::timestamptz - interval '48 hours' then 1
		when workflow.submitted_at < ${now}::timestamptz - interval '24 hours' then 2
		else 3 end`;
}

function filters(input: CanonicalInboxCountInput, now: Date): SQL {
	const filter = input.filters;
	if (!filter) return sql``;
	const conditions: SQL[] = [];
	if (filter.teamId) conditions.push(sql`requester.team_id = ${filter.teamId}::uuid`);
	if (filter.priority) {
		const rank = { urgent: 0, high: 1, normal: 2, low: 3 }[filter.priority];
		conditions.push(sql`${priorityRank(now)} = ${rank}`);
	}
	if (filter.minAgeDays) {
		conditions.push(
			sql`workflow.submitted_at <= ${now}::timestamptz - ${filter.minAgeDays} * interval '1 day'`,
		);
	}
	if (filter.dateRange) {
		conditions.push(
			sql`workflow.submitted_at >= ${filter.dateRange.from}`,
			sql`workflow.submitted_at <= ${filter.dateRange.to}`,
		);
	}
	if (filter.search) {
		conditions.push(sql`(
			strpos(lower(requester_user.name), ${filter.search}) > 0
			or strpos(lower(requester_user.email), ${filter.search}) > 0
			or strpos(projection.search_text, ${filter.search}) > 0
		)`);
	}
	return conditions.length > 0 ? sql`and ${sql.join(conditions, sql` and `)}` : sql``;
}

function target(input: CanonicalInboxLoadInput): SQL {
	if (input.assignmentId) return sql`and assignment.id = ${input.assignmentId}::uuid`;
	if (input.assignmentIds?.length) {
		return sql`and assignment.id in (${sql.join(
			input.assignmentIds.map((id) => sql`${id}::uuid`),
			sql`, `,
		)})`;
	}
	return sql``;
}

function cursor(input: CanonicalInboxLoadInput, now: Date): SQL {
	if (!input.cursor) return sql``;
	const risk = { high: 0, medium: 1, low: 2 }[input.cursor.riskLevel];
	const priority = { urgent: 0, high: 1, normal: 2, low: 3 }[input.cursor.priority];
	const createdAt = new Date(input.cursor.createdAt);
	return sql`and (${riskRank(now)} > ${risk}
		or (${riskRank(now)} = ${risk} and ${priorityRank(now)} > ${priority})
		or (${riskRank(now)} = ${risk} and ${priorityRank(now)} = ${priority} and workflow.submitted_at > ${createdAt})
		or (${riskRank(now)} = ${risk} and ${priorityRank(now)} = ${priority}
			and workflow.submitted_at = ${createdAt} and assignment.id > ${input.cursor.id}::uuid))`;
}

function candidateQuery(input: CanonicalInboxLoadInput, now: Date, countOnly: boolean): SQL {
	const selection = countOnly
		? sql`count(*)::integer as "totalCount"`
		: sql`
			assignment.id as "assignmentId", assignment.approver_employee_id as "approverEmployeeId",
			workflow.id as "workflowId", workflow.organization_id as "organizationId",
			workflow.requester_employee_id as "requesterEmployeeId", workflow.submitted_at as "submittedAt",
			stage.label as "stageLabel", stage.stage_order as "stageOrder",
			submission.id as "submissionId", submission.start_date::text as "startDate",
			submission.end_date::text as "endDate", submission.timezone as "timezone",
			submission.cadence as "cadence",
			coalesce((revision.facts -> 'work' ->> 'totalMinutes')::integer, 0) as "totalMinutes",
			revision.facts as "facts",
			requester.team_id as "teamId", requester_user.name as "userName",
			requester_user.email as "userEmail", requester_user.image as "userImage",
			count(*) over()::integer as "totalCount"`;
	return sql`
		select ${selection}
		from approval_inbox_projection projection
		join approval_workflow workflow
			on workflow.id = projection.workflow_id and workflow.organization_id = projection.organization_id
		join approval_workflow_stage stage
			on stage.id = projection.active_stage_id and stage.workflow_id = workflow.id
			and stage.organization_id = projection.organization_id
		join approval_stage_assignment assignment
			on assignment.stage_id = stage.id and assignment.workflow_id = workflow.id
			and assignment.organization_id = projection.organization_id
		join employee requester
			on requester.id = workflow.requester_employee_id and requester.organization_id = projection.organization_id
		join "user" requester_user on requester_user.id = requester.user_id
		join period_submission submission
			on submission.id = workflow.source_id
			and submission.organization_id = projection.organization_id
			and submission.employee_id = workflow.requester_employee_id
			and submission.approval_workflow_id = workflow.id
		left join approval_submitted_revision revision
			on revision.organization_id = projection.organization_id
			and revision.workflow_id = workflow.id
			and revision.revision = 1
		where projection.organization_id = ${input.organizationId}
			and projection.source_type = 'period_submission'
			and workflow.source_type = 'period_submission'
			and workflow.workflow_type = 'period_submission'
			and projection.status = 'pending'
			and workflow.status = 'pending'
			and stage.status = 'pending'
			and assignment.status = 'pending'
			and workflow.current_stage_order = stage.stage_order
			and submission.status = 'pending'
			and ${visibility(input)}
			${filters(input, now)}
			${target(input)}
			${cursor(input, now)}
		${
			countOnly
				? sql``
				: sql`order by ${riskRank(now)}, ${priorityRank(now)}, workflow.submitted_at, assignment.id
			limit ${input.assignmentId ? 1 : Math.min(Math.max(Math.floor(input.limit ?? 51), 1), 101)}`
		}
	`;
}

function priorityOf(submittedAt: Date, now: Date): ApprovalInboxPriority {
	const hours = (now.getTime() - submittedAt.getTime()) / 3_600_000;
	if (hours > 72) return "urgent";
	if (hours > 48) return "high";
	if (hours > 24) return "normal";
	return "low";
}

function hoursAndMinutes(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}:${String(minutes).padStart(2, "0")}`;
}

const TITLE: ApprovalInboxLocalizedText = {
	key: "approvals:approvals.periodSubmission.title",
	fallback: "Period submission",
};

function toApproval(row: Record<string, unknown>, now: Date): CanonicalInboxApproval {
	const submittedAt = decodeApprovalDatabaseTimestamptz(row.submittedAt);
	const startDate = String(row.startDate);
	const endDate = String(row.endDate);
	const totalMinutes = Number(row.totalMinutes) || 0;
	const total = hoursAndMinutes(totalMinutes);
	const range = { kind: "plain_date_range" as const, start: startDate, end: endDate };
	const priority = priorityOf(submittedAt, now);
	const capabilities = {
		canApprove: true,
		canReject: true,
		// Out of scope for period submissions (spec #805): decided one at a time.
		canBulkApprove: false,
		requiresRejectReason: true,
	};
	const subtitle: ApprovalInboxLocalizedText = {
		key: "approvals:approvals.periodSubmission.subtitle",
		fallback: "{range}",
		params: { range },
	};
	const detailText: ApprovalInboxLocalizedText = {
		key: "approvals:approvals.periodSubmission.summaryTotal",
		fallback: "{total} h worked",
		params: { total },
	};
	const requesterName = String(row.userName);
	const item: ApprovalInboxItem = {
		id: String(row.assignmentId),
		type: "period_submission",
		entityId: String(row.submissionId),
		status: "pending",
		requester: {
			id: String(row.requesterEmployeeId),
			name: requesterName,
			email: String(row.userEmail),
			image: typeof row.userImage === "string" ? row.userImage : null,
			teamId: typeof row.teamId === "string" ? row.teamId : null,
		},
		summary: {
			title: "Period submission",
			subtitle: startDate === endDate ? startDate : `${startDate} – ${endDate}`,
			detail: `${total} h worked`,
			badge: null,
			stage: { name: String(row.stageLabel), order: Number(row.stageOrder) },
			localized: { title: TITLE, subtitle, detail: detailText },
		},
		timing: {
			createdAt: submittedAt.toISOString(),
			resolvedAt: null,
			slaDeadline: null,
			ageDays: getAgeDays({ createdAt: submittedAt, now }),
		},
		triage: buildInboxTriage({
			type: "period_submission",
			priority,
			status: "pending",
			createdAt: submittedAt,
			now,
		}),
		capabilities,
	};
	const facts = isPeriodSubmissionSubmittedFacts(row.facts) ? row.facts : null;
	const detail: ApprovalInboxDetailResult = {
		item,
		actions: capabilities,
		sections: facts
			? buildPeriodSubmissionReviewSections({
					facts,
					employeeName: requesterName,
					submittedAt: submittedAt.toISOString(),
				})
			: [
					{
						type: "key_value",
						title: TITLE,
						rows: [
							{
								label: {
									key: "approvals:approvals.periodSubmission.employee",
									fallback: "Employee",
								},
								value: requesterName,
							},
							{
								label: { key: "approvals:approvals.periodSubmission.period", fallback: "Period" },
								value: range,
							},
							{
								label: { key: "approvals:approvals.periodSubmission.total", fallback: "Total" },
								value: {
									key: "approvals:approvals.periodSubmission.totalHours",
									fallback: "{total} h",
									params: { total },
								},
							},
							{
								label: {
									key: "approvals:approvals.periodSubmission.submittedAt",
									fallback: "Submitted",
								},
								value: { kind: "instant", at: submittedAt.toISOString() },
							},
						],
					},
				],
	};
	return {
		item,
		detail,
		decisionTarget: {
			id: item.id,
			targetType: "canonical_assignment",
			entityType: "period_submission",
			entityId: String(row.submissionId),
			organizationId: String(row.organizationId),
			approverId: String(row.approverEmployeeId),
			requesterEmployeeId: item.requester.id,
			status: "pending",
			workflowKind: "period_submission",
		},
	};
}

function readDatabase(input: CanonicalInboxCountInput): CanonicalInboxReadDatabase {
	return input.database ?? (db as unknown as CanonicalInboxReadDatabase);
}

export async function loadPeriodSubmissionApprovals(
	input: CanonicalInboxLoadInput,
): Promise<CanonicalInboxApprovalBatch> {
	const now = input.now ?? new Date();
	const rows = resultRows(await readDatabase(input).execute(candidateQuery(input, now, false)));
	const approvals = rows.map((row) => toApproval(row, now));
	return Object.assign(approvals, {
		totalCount: typeof rows[0]?.totalCount === "number" ? rows[0].totalCount : 0,
	});
}

export async function countPeriodSubmissionApprovals(
	input: CanonicalInboxCountInput,
): Promise<number> {
	const rows = resultRows(
		await readDatabase(input).execute(candidateQuery(input, input.now ?? new Date(), true)),
	);
	return typeof rows[0]?.totalCount === "number" ? rows[0].totalCount : 0;
}

/** The inbox's typed errors for a period submission decision's refusals. */
function inboxDecisionError(error: unknown): unknown {
	if (error && typeof error === "object" && "_tag" in error) return error;
	if (error instanceof PeriodSubmissionDecisionError) {
		switch (error.code) {
			case "reason_required":
				return new ValidationError({ message: error.message, field: "reason" });
			case "not_pending":
				return new ConflictError({
					message: "Request is already decided",
					conflictType: "approval_decision",
				});
			case "not_found":
				return new NotFoundError({ message: "Approval not found", entityType: "approval_request" });
		}
	}
	if (error instanceof ApprovalTransitionEngineError) {
		if (error.code === "forbidden") {
			return new AuthorizationError({
				message: "You are not authorized to decide this request",
				resource: "period_submission",
			});
		}
		if (error.code === "version_conflict") {
			return new ConflictError({
				message: "Request is already decided",
				conflictType: "approval_decision",
			});
		}
	}
	return error;
}

export async function decidePeriodSubmissionFromInbox(
	input: CanonicalInboxDecisionInput,
): Promise<void> {
	try {
		await decidePeriodSubmission({
			organizationId: input.target.organizationId,
			actorEmployeeId: input.actorEmployeeId,
			assignmentId: input.target.id,
			action: input.action,
			reason: input.reason ?? null,
			allowOrganizationWideApprover: input.allowOrganizationWideApprover,
		});
	} catch (error) {
		throw inboxDecisionError(error);
	}
}

/** Period submissions in the inbox: listed, counted, opened and decided canonically. */
export const periodSubmissionInboxRead: CanonicalInboxRead = {
	type: "period_submission",
	workflowTypes: ["period_submission"],
	load: loadPeriodSubmissionApprovals,
	count: countPeriodSubmissionApprovals,
	decide: decidePeriodSubmissionFromInbox,
};
