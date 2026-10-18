import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { hasExactAbsenceHours } from "@/lib/absences/change-request-coverage";

import type {
	AbsenceChangeOriginal,
	AbsenceChangeProposal,
} from "@/lib/absences/change-request-types";
import { AbsenceChangeError } from "@/lib/absences/change-request-types";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import { decodeApprovalDatabaseTimestamptz } from "../approval-database-row";
import {
	canonicalInboxCursor,
	canonicalInboxFilters,
	canonicalInboxLimit,
	canonicalInboxOrder,
	canonicalInboxPriority,
	canonicalInboxTarget,
	canonicalInboxVisibility,
	resultRows,
} from "./canonical-inbox-query";
import type {
	CanonicalInboxApproval,
	CanonicalInboxCountInput,
	CanonicalInboxLoadInput,
	CanonicalInboxRead,
} from "./canonical-inbox-read";
import { getAgeDays } from "./serialization";
import { buildInboxTriage } from "./triage";
import type {
	ApprovalInboxDetailSection,
	ApprovalInboxLocalizedText,
} from "./types";

function candidateQuery(
	input: CanonicalInboxLoadInput,
	now: Date,
	countOnly: boolean,
) {
	const selection = countOnly
		? sql`count(*)::integer as "totalCount"`
		: sql`assignment.id as "assignmentId", assignment.approver_employee_id as "approverId", workflow.id as "workflowId", workflow.organization_id as "organizationId", workflow.requester_employee_id as "requesterId", workflow.submitted_at as "submittedAt", stage.label as "stageLabel", stage.stage_order as "stageOrder", change.id as "changeId", category.name as "categoryName", change.kind, change.original, change.proposed, change.reason, requester.team_id as "teamId", requester_user.name as "userName", requester_user.email as "userEmail", requester_user.image as "userImage", count(*) over()::integer as "totalCount"`;
	return sql`select ${selection}
		from approval_inbox_projection projection
		join approval_workflow workflow on workflow.id = projection.workflow_id and workflow.organization_id = projection.organization_id
		join approval_workflow_stage stage on stage.id = projection.active_stage_id and stage.workflow_id = workflow.id and stage.organization_id = projection.organization_id
		join approval_stage_assignment assignment on assignment.stage_id = stage.id and assignment.workflow_id = workflow.id and assignment.organization_id = projection.organization_id
		join employee requester on requester.id = workflow.requester_employee_id and requester.organization_id = projection.organization_id
		join "user" requester_user on requester_user.id = requester.user_id
		join absence_change_request change on change.id = workflow.source_id and change.organization_id = projection.organization_id and change.employee_id = workflow.requester_employee_id and change.approval_workflow_id = workflow.id
		left join absence_category category on category.id::text = change.original ->> 'categoryId' and category.organization_id = projection.organization_id
		where projection.organization_id = ${input.organizationId} and projection.source_type = 'absence_change_request' and workflow.source_type = 'absence_change_request' and workflow.workflow_type = 'absence_change' and projection.status = 'pending' and workflow.status = 'pending' and stage.status = 'pending' and assignment.status = 'pending' and change.status = 'pending' and workflow.current_stage_order = stage.stage_order
		and ${canonicalInboxVisibility(input)} ${canonicalInboxFilters(input.filters, now)} ${canonicalInboxTarget(input)} ${canonicalInboxCursor(input.cursor, now)}
		${countOnly ? sql`` : sql`order by ${canonicalInboxOrder(now)} limit ${canonicalInboxLimit(input)}`}`;
}

const COPY = {
	exactHours: {
		key: "approvals:approvals.absenceChange.exactHours",
		fallback: "Exact recorded hours",
	},
	afternoon: {
		key: "approvals:approvals.absenceChange.afternoon",
		fallback: "Afternoon",
	},
	cancelAll: {
		key: "approvals:approvals.absenceChange.cancelAll",
		fallback: "Cancel the entire absence",
	},
	cancellationTitle: {
		key: "approvals:approvals.absenceChange.cancellationTitle",
		fallback: "Absence cancellation",
	},
	fullDay: {
		key: "approvals:approvals.absenceChange.fullDay",
		fallback: "Full day",
	},
	morning: {
		key: "approvals:approvals.absenceChange.morning",
		fallback: "Morning",
	},
	original: {
		key: "approvals:approvals.absenceChange.original",
		fallback: "Recorded dates",
	},
	originalEndCoverage: {
		key: "approvals:approvals.absenceChange.originalEndCoverage",
		fallback: "Recorded end day",
	},
	originalStartCoverage: {
		key: "approvals:approvals.absenceChange.originalStartCoverage",
		fallback: "Recorded start day",
	},
	proposed: {
		key: "approvals:approvals.absenceChange.proposed",
		fallback: "Proposed change",
	},
	proposedEndCoverage: {
		key: "approvals:approvals.absenceChange.proposedEndCoverage",
		fallback: "Proposed end day",
	},
	proposedStartCoverage: {
		key: "approvals:approvals.absenceChange.proposedStartCoverage",
		fallback: "Proposed start day",
	},
	range: {
		key: "approvals:approvals.absenceChange.range",
		fallback: "{range}",
	},
	reason: {
		key: "approvals:approvals.absenceChange.reason",
		fallback: "Reason",
	},
	title: {
		key: "approvals:approvals.absenceChange.title",
		fallback: "Absence change",
	},
} satisfies Record<string, ApprovalInboxLocalizedText>;
const period = (value: string): ApprovalInboxLocalizedText =>
	value === "am"
		? COPY.morning
		: value === "pm"
			? COPY.afternoon
			: COPY.fullDay;

function toApproval(
	row: Record<string, unknown>,
	now: Date,
): CanonicalInboxApproval {
	const original = row.original as AbsenceChangeOriginal;
	const proposed = row.proposed as AbsenceChangeProposal | null;
	const submittedAt = decodeApprovalDatabaseTimestamptz(row.submittedAt);
	const title = proposed ? "Absence change" : "Absence cancellation";
	const titleText = proposed ? COPY.title : COPY.cancellationTitle;
	const capabilities = {
		canApprove: true,
		canReject: true,
		canBulkApprove: false,
		requiresRejectReason: true,
	};
	const item = {
		id: String(row.assignmentId),
		type: "absence_change_request" as const,
		entityId: String(row.changeId),
		status: "pending" as const,
		requester: {
			id: String(row.requesterId),
			name: String(row.userName),
			email: String(row.userEmail),
			image: typeof row.userImage === "string" ? row.userImage : null,
			teamId: typeof row.teamId === "string" ? row.teamId : null,
		},
		summary: {
			title,
			subtitle: `${original.startDate} – ${original.endDate}`,
			detail: String(row.reason),
			badge: null,
			stage: { name: String(row.stageLabel), order: Number(row.stageOrder) },
			localized: {
				title: titleText,
				subtitle: {
					...COPY.range,
					params: {
						range: {
							kind: "plain_date_range" as const,
							start: original.startDate,
							end: original.endDate,
						},
					},
				},
				detail: {
					key: "approvals:approvals.absenceChange.reasonValue",
					fallback: "{reason}",
					params: { reason: String(row.reason) },
				},
			},
		},
		timing: {
			createdAt: submittedAt.toISOString(),
			resolvedAt: null,
			slaDeadline: null,
			ageDays: getAgeDays({ createdAt: submittedAt, now }),
		},
		triage: buildInboxTriage({
			type: "absence_change_request",
			priority: canonicalInboxPriority(submittedAt, now),
			status: "pending",
			createdAt: submittedAt,
			now,
		}),
		capabilities,
	};
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: titleText,
			rows: [
				{
					label: {
						key: "approvals:approvals.absenceChange.category",
						fallback: "Absence category",
					},
					value: typeof row.categoryName === "string" ? row.categoryName : "—",
				},
				{
					label: COPY.original,
					value: {
						kind: "plain_date_range",
						start: original.startDate,
						end: original.endDate,
					},
				},
				{
					label: COPY.originalStartCoverage,
					value: hasExactAbsenceHours(original)
						? COPY.exactHours
						: period(original.startPeriod),
				},
				{
					label: COPY.originalEndCoverage,
					value: hasExactAbsenceHours(original)
						? COPY.exactHours
						: period(original.endPeriod),
				},
				...(original.canonical
					? [
							{
								label: {
									key: "approvals:approvals.absenceChange.originalInterval",
									fallback: "Recorded hours",
								},
								value: interval(original.canonical),
							},
						]
					: []),
				...(proposed
					? [
							{
								label: COPY.proposed,
								value: {
									kind: "plain_date_range" as const,
									start: proposed.startDate,
									end: proposed.endDate,
								},
							},
							{
								label: COPY.proposedStartCoverage,
								value: hasExactAbsenceHours(proposed)
									? COPY.exactHours
									: period(proposed.startPeriod),
							},
							{
								label: COPY.proposedEndCoverage,
								value: hasExactAbsenceHours(proposed)
									? COPY.exactHours
									: period(proposed.endPeriod),
							},
							{
								label: {
									key: "approvals:approvals.absenceChange.proposedInterval",
									fallback: "Proposed hours",
								},
								value: interval(proposed.canonical),
							},
							...proposed.displacedVacations.map((vacation) => ({
								label: {
									key: "approvals:approvals.absenceChange.displacedVacation",
									fallback: "Vacation dates replaced on approval",
								},
								value: {
									kind: "plain_date_range" as const,
									start:
										vacation.startDate > proposed.startDate
											? vacation.startDate
											: proposed.startDate,
									end:
										vacation.endDate < proposed.endDate
											? vacation.endDate
											: proposed.endDate,
								},
							})),
						]
					: [{ label: COPY.proposed, value: COPY.cancelAll }]),
				...(proposed?.historicalReconciliationReview
					? [
							{
								label: {
									key: "approvals:approvals.absenceChange.reconciliationReason",
									fallback: "Historical vacation reconciliation source",
								},
								value: proposed.historicalReconciliationReview.reason,
							},
							...proposed.historicalReconciliationReview.totals.map(
								(total) => ({
									label: {
										key: "approvals:approvals.absenceChange.historicalRemaining",
										fallback: "Previously taken vacation remaining",
									},
									value: `${total.year}: ${total.currentDays} → ${total.remainingDays} (${total.datedDays} newly dated days)`,
								}),
							),
							...proposed.historicalReconciliationReview.balances.map(
								(balance) => ({
									label: {
										key: "approvals:approvals.absenceChange.reconciledBalance",
										fallback: "Available vacation after reconciliation",
									},
									value: `${balance.year}: ${balance.before} → ${balance.after}`,
								}),
							),
						]
					: []),
				{ label: COPY.reason, value: String(row.reason) },
			],
		},
	];
	return {
		item,
		detail: { item, actions: capabilities, sections },
		decisionTarget: {
			id: item.id,
			targetType: "canonical_assignment",
			entityType: "absence_change_request",
			entityId: item.entityId,
			organizationId: String(row.organizationId),
			approverId: String(row.approverId),
			requesterEmployeeId: item.requester.id,
			status: "pending",
			workflowKind: "absence_change",
		},
	};
}

export const absenceChangeInboxRead: CanonicalInboxRead = {
	type: "absence_change_request",
	workflowTypes: ["absence_change"],
	async load(input) {
		const now = input.now ?? dateFromInstant(systemClock.nowInstant());
		const rows = resultRows(
			await (input.database ?? db).execute(candidateQuery(input, now, false)),
		);
		return Object.assign(
			rows.map((row) => toApproval(row, now)),
			{ totalCount: Number(rows[0]?.totalCount) || 0 },
		);
	},
	async count(input: CanonicalInboxCountInput) {
		const now = input.now ?? dateFromInstant(systemClock.nowInstant());
		const rows = resultRows(
			await (input.database ?? db).execute(candidateQuery(input, now, true)),
		);
		return Number(rows[0]?.totalCount) || 0;
	},
	async decide(input) {
		try {
			await (
				await import("@/lib/absences/change-request-service")
			).decideAbsenceChange({
				organizationId: input.target.organizationId,
				actorEmployeeId: input.actorEmployeeId,
				assignmentId: input.target.id,
				shortcutGuard: input.shortcutGuard,
				action: input.action,
				reason: input.reason,
				allowOrganizationWideApprover: input.allowOrganizationWideApprover,
			});
		} catch (error) {
			if (error instanceof AbsenceChangeError)
				throw new ConflictError({
					message: error.message,
					conflictType: "absence_change",
				});
			throw error;
		}
	},
};

// Absence instants encode event-local calendar and clock values in UTC; never shift by viewer zone.
function interval(bounds: { startAt: string; endAt: string }): string {
	const label = (instant: string) =>
		Temporal.Instant.from(instant)
			.toZonedDateTimeISO("UTC")
			.toPlainDateTime()
			.toString({ smallestUnit: "minute" })
			.replace("T", " ");
	return `${label(bounds.startAt)} – ${label(bounds.endAt)}`;
}
