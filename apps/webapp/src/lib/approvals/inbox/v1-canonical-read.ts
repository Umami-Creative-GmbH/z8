import { sql } from "drizzle-orm";
import { db } from "@/db";
import { decodeApprovalDatabaseTimestamptz } from "../approval-database-row";
import { approvalAuthoritySql } from "../authority";
import {
	canonicalInboxFilters,
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

function absenceCandidates(
	input: CanonicalInboxLoadInput,
	now: Date,
	countOnly = false,
) {
	const selection = countOnly
		? sql`count(*)::integer as "totalCount"`
		: sql`assignment.id as "assignmentId", assignment.approver_employee_id as "approverId", workflow.id as "workflowId", workflow.organization_id as "organizationId", workflow.source_id as "sourceId", workflow.workflow_type as "workflowType", workflow.requester_employee_id as "requesterId", workflow.submitted_at as "submittedAt", stage.label as "stageLabel", stage.stage_order as "stageOrder", requester.team_id as "teamId", requester_user.name as "userName", requester_user.email as "userEmail", requester_user.image as "userImage", to_jsonb(source) as source, category.name as "categoryName", submitted.facts as "submittedFacts", count(*) over()::integer as "totalCount"`;
	return sql`select ${selection}
		from approval_inbox_projection projection
		join approval_workflow workflow on workflow.id = projection.workflow_id and workflow.organization_id = projection.organization_id and workflow.source_id = projection.source_id
		join approval_workflow_rollout rollout on rollout.organization_id = workflow.organization_id and rollout.workflow_type = workflow.workflow_type
		join approval_workflow_stage stage on stage.id = projection.active_stage_id and stage.workflow_id = workflow.id and stage.organization_id = workflow.organization_id and stage.stage_order = workflow.current_stage_order
		join approval_stage_assignment assignment on assignment.stage_id = stage.id and assignment.workflow_id = workflow.id and assignment.organization_id = workflow.organization_id
		join employee requester on requester.id = workflow.requester_employee_id and requester.organization_id = workflow.organization_id
		join "user" requester_user on requester_user.id = requester.user_id
		join absence_entry source on source.id = workflow.source_id and source.organization_id = workflow.organization_id and source.approval_workflow_id = workflow.id
		join employee subject on subject.id = source.employee_id and subject.organization_id = workflow.organization_id
		join absence_category category on category.id = source.category_id and category.organization_id = workflow.organization_id
		left join lateral (select revision.facts from approval_submitted_revision revision where revision.organization_id = workflow.organization_id and revision.workflow_id = workflow.id and revision.source_id = source.id and revision.workflow_type = 'absence' and revision.authority = 'canonical' order by revision.revision desc limit 1) submitted on true
		where projection.organization_id = ${input.organizationId} and projection.source_type = 'absence_entry' and workflow.source_type = 'absence_entry' and workflow.workflow_type = 'absence'
		and projection.status = 'pending' and workflow.status = 'pending' and stage.status = 'pending' and assignment.status = 'pending' and source.status = 'pending'
		and ${approvalAuthoritySql(sql`rollout.lifecycle_mode`, "canonical")} and ${canonicalInboxVisibility(input)} ${canonicalInboxTarget(input)} ${canonicalInboxFilters(input.filters, now)}
		${countOnly ? sql`` : sql`order by workflow.submitted_at, assignment.id`}`;
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function absenceApproval(
	row: Record<string, unknown>,
	input: CanonicalInboxLoadInput,
	now: Date,
): CanonicalInboxApproval | null {
	const source = record(row.source);
	if (
		!source ||
		row.organizationId !== input.organizationId ||
		row.workflowType !== "absence" ||
		source.organization_id !== input.organizationId ||
		source.id !== row.sourceId ||
		source.approval_workflow_id !== row.workflowId
	)
		return null;
	const submittedAt = decodeApprovalDatabaseTimestamptz(row.submittedAt);
	const title: ApprovalInboxLocalizedText = {
		key: "approvals:approvals.requestTypeAbsence",
		fallback: "Absence request",
	};
	const range = {
		kind: "plain_date_range" as const,
		start: String(source.start_date),
		end: String(source.end_date),
	};
	const priority = canonicalInboxPriority(submittedAt, now);
	const capabilities = {
		canApprove: true,
		canReject: true,
		canBulkApprove: true,
		requiresRejectReason: true,
	};
	const item = {
		id: String(row.assignmentId),
		type: "absence_entry" as const,
		entityId: String(row.sourceId),
		status: "pending" as const,
		requester: {
			id: String(row.requesterId),
			name: String(row.userName),
			email: String(row.userEmail),
			image: typeof row.userImage === "string" ? row.userImage : null,
			teamId: typeof row.teamId === "string" ? row.teamId : null,
		},
		summary: {
			title: title.fallback,
			subtitle: `${range.start} – ${range.end}`,
			detail: String(row.categoryName),
			badge: null,
			stage: { name: String(row.stageLabel), order: Number(row.stageOrder) },
			localized: {
				title,
				subtitle: {
					key: "approvals:approvals.canonicalAbsenceRange",
					fallback: "{range}",
					params: { range },
				},
				detail: {
					key: "approvals:approvals.canonicalAbsenceCategory",
					fallback: "{category}",
					params: { category: String(row.categoryName) },
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
			type: "absence_entry",
			requestKind: "absence",
			priority,
			status: "pending",
			createdAt: submittedAt,
			now,
		}),
		capabilities,
	};
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title,
			rows: [
				{
					label: {
						key: "approvals:approvals.absenceChange.category",
						fallback: "Absence category",
					},
					value: String(row.categoryName),
				},
				{
					label: {
						key: "approvals:approvals.absenceChange.original",
						fallback: "Recorded dates",
					},
					value: range,
				},
				{
					label: {
						key: "approvals:approvals.absenceChange.originalStartCoverage",
						fallback: "Recorded start day",
					},
					value: submittedCoverage(row, source, "start"),
				},
				{
					label: {
						key: "approvals:approvals.absenceChange.originalEndCoverage",
						fallback: "Recorded end day",
					},
					value: submittedCoverage(row, source, "end"),
				},
			],
		},
	];
	return {
		item,
		detail: { item, sections, actions: capabilities },
		decisionTarget: {
			id: item.id,
			targetType: "canonical_assignment",
			entityType: "absence_entry",
			entityId: item.entityId,
			organizationId: input.organizationId,
			approverId: String(row.approverId),
			requesterEmployeeId: item.requester.id,
			status: "pending",
			workflowKind: "absence",
		},
	};
}

function submittedCoverage(
	row: Record<string, unknown>,
	source: Record<string, unknown>,
	endpoint: "start" | "end",
): ApprovalInboxLocalizedText {
	const facts = record(row.submittedFacts);
	const coverage =
		facts?.kind === "absence" &&
		facts.organizationId === row.organizationId &&
		facts.absenceId === source.id
			? record(facts.coverage)
			: null;
	if (
		coverage?.kind === "explicit_partial" &&
		typeof coverage.startTime === "string" &&
		typeof coverage.endTime === "string"
	)
		return {
			key: "approvals:approvals.canonicalAbsencePartialHours",
			fallback: "{startTime}–{endTime} (wall-clock zone not recorded)",
			params: { startTime: coverage.startTime, endTime: coverage.endTime },
		};
	if (coverage?.kind === "full_day") return coverageText("full_day");
	if (coverage?.kind === "half_day_periods")
		return coverageText(
			endpoint === "start" ? coverage.startPeriod : coverage.endPeriod,
		);
	return {
		key: "approvals:approvals.canonicalAbsenceCoverageUnknown",
		fallback: "Submitted day coverage is unavailable",
	};
}

function coverageText(value: unknown): ApprovalInboxLocalizedText {
	if (value === "am")
		return {
			key: "approvals:approvals.absenceChange.morning",
			fallback: "Morning",
		};
	if (value === "pm")
		return {
			key: "approvals:approvals.absenceChange.afternoon",
			fallback: "Afternoon",
		};
	return {
		key: "approvals:approvals.absenceChange.fullDay",
		fallback: "Full day",
	};
}

async function loadAbsenceCanonicalApprovals(input: CanonicalInboxLoadInput) {
	const now = input.now ?? new Date();
	const rows = resultRows(
		await (input.database ?? db).execute(absenceCandidates(input, now)),
	);
	const approvals = rows.flatMap((row) => {
		const approval = absenceApproval(row, input, now);
		return approval ? [approval] : [];
	});
	return Object.assign(approvals, { totalCount: approvals.length });
}

async function countAbsenceCanonicalApprovals(input: CanonicalInboxCountInput) {
	const rows = resultRows(
		await (input.database ?? db).execute(
			absenceCandidates(input, input.now ?? new Date(), true),
		),
	);
	return Number(rows[0]?.totalCount ?? 0);
}

/** The existing authenticated absence owner revalidates canonical assignment decisions. */
export const absenceInboxRead: CanonicalInboxRead = {
	type: "absence_entry",
	workflowTypes: ["absence"],
	load: loadAbsenceCanonicalApprovals,
	count: countAbsenceCanonicalApprovals,
};

import { parseInstant } from "@/lib/datetime/temporal-core";
import { decodeApprovalDatabaseTimestampWithoutTimeZone } from "../approval-database-row";
import {
	parseTimeCorrectionReviewMetadata,
	timeCorrectionMetadataChanges,
} from "../server/time-correction-review-metadata";
import type {
	ApprovalInboxTimeComparison,
	ApprovalInboxTimeEndpoint,
} from "./types";

function correctionCandidates(
	input: CanonicalInboxLoadInput,
	now: Date,
	countOnly = false,
) {
	const selection = countOnly
		? sql`count(*)::integer as "totalCount"`
		: sql`assignment.id as "assignmentId", assignment.approver_employee_id as "approverId", workflow.id as "workflowId", workflow.organization_id as "organizationId", workflow.source_id as "sourceId", workflow.workflow_type as "workflowType", workflow.requester_employee_id as "requesterId", workflow.submitted_at as "submittedAt", stage.label as "stageLabel", stage.stage_order as "stageOrder", requester.team_id as "teamId", requester_user.name as "userName", requester_user.email as "userEmail", requester_user.image as "userImage", to_jsonb(source) as source, workflow.context_snapshot as "contextSnapshot", workflow.context_snapshot -> 'timeCorrection' as correction, original_start.timestamp as "originalStart", original_start.utc_offset_minutes as "startOffset", original_end.timestamp as "originalEnd", original_end.utc_offset_minutes as "endOffset", proposed_start.timestamp as "proposedStart", proposed_start.utc_offset_minutes as "proposedStartOffset", proposed_end.timestamp as "proposedEnd", proposed_end.utc_offset_minutes as "proposedEndOffset", submitted.facts as "submittedFacts"`;
	return sql`select ${selection}
 from approval_inbox_projection projection
 join approval_workflow workflow on workflow.id = projection.workflow_id and workflow.organization_id = projection.organization_id and workflow.source_id = projection.source_id
 join approval_workflow_rollout rollout on rollout.organization_id = workflow.organization_id and rollout.workflow_type = workflow.workflow_type
 join approval_workflow_stage stage on stage.id = projection.active_stage_id and stage.workflow_id = workflow.id and stage.organization_id = workflow.organization_id and stage.stage_order = workflow.current_stage_order
 join approval_stage_assignment assignment on assignment.stage_id = stage.id and assignment.workflow_id = workflow.id and assignment.organization_id = workflow.organization_id
 join employee requester on requester.id = workflow.requester_employee_id and requester.organization_id = workflow.organization_id
 join "user" requester_user on requester_user.id = requester.user_id
 join work_period source on source.id = workflow.source_id and source.organization_id = workflow.organization_id and source.approval_workflow_id = workflow.id
 join employee subject on subject.id = source.employee_id and subject.organization_id = workflow.organization_id
 left join time_entry original_start on original_start.id = source.clock_in_id and original_start.organization_id = workflow.organization_id and original_start.employee_id = source.employee_id
 left join time_entry original_end on original_end.id = source.clock_out_id and original_end.organization_id = workflow.organization_id and original_end.employee_id = source.employee_id
 left join time_entry proposed_start on proposed_start.id::text = workflow.context_snapshot -> 'timeCorrection' ->> 'clockInCorrectionId' and proposed_start.organization_id = workflow.organization_id and proposed_start.employee_id = source.employee_id and proposed_start.replaces_entry_id = source.clock_in_id and proposed_start.type = 'correction'
 left join time_entry proposed_end on proposed_end.id::text = workflow.context_snapshot -> 'timeCorrection' ->> 'clockOutCorrectionId' and proposed_end.organization_id = workflow.organization_id and proposed_end.employee_id = source.employee_id and proposed_end.replaces_entry_id = source.clock_out_id and proposed_end.type = 'correction'
 left join lateral (select revision.facts from approval_submitted_revision revision where revision.organization_id = workflow.organization_id and revision.workflow_id = workflow.id and revision.source_id = source.id and revision.workflow_type = 'time_correction' and revision.authority = 'canonical' order by revision.revision desc limit 1) submitted on true
 where projection.organization_id = ${input.organizationId} and projection.source_type = 'time_entry' and workflow.source_type = 'time_entry' and workflow.workflow_type = 'time_correction'
 and projection.status = 'pending' and workflow.status = 'pending' and stage.status = 'pending' and assignment.status = 'pending' and source.deleted_at is null
 and ${approvalAuthoritySql(sql`rollout.lifecycle_mode`, "canonical")} and ${canonicalInboxVisibility(input)} ${canonicalInboxTarget(input)} ${canonicalInboxFilters(input.filters, now)}
 ${countOnly ? sql`` : sql`order by workflow.submitted_at, assignment.id`}`;
}

function timeEndpoint(
	at: unknown,
	offset: unknown,
): ApprovalInboxTimeEndpoint | null {
	if (at == null) return null;
	try {
		const instant =
			typeof at === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(at)
				? parseInstant(at).toString()
				: decodeApprovalDatabaseTimestampWithoutTimeZone(at).toISOString();
		return {
			at: instant,
			utcOffsetMinutes:
				typeof offset === "number" && Number.isInteger(offset) ? offset : null,
		};
	} catch {
		return null;
	}
}

function correctionComparison(
	row: Record<string, unknown>,
	correction: Record<string, unknown>,
): ApprovalInboxTimeComparison {
	const facts = record(row.submittedFacts);
	const captured =
		facts !== null &&
		facts.organizationId === row.organizationId &&
		facts.workPeriodId === row.sourceId &&
		facts.kind === "time_correction";
	const baseline = captured && facts ? record(facts.baseline) : null;
	const requested = captured && facts ? record(facts.requested) : null;
	const start = record(baseline?.clockIn);
	const end = record(baseline?.clockOut);
	const requestedStart = record(requested?.clockIn);
	const requestedEnd = record(requested?.clockOut);
	const original = {
		start: start
			? timeEndpoint(start.at, start.utcOffsetMinutes)
			: timeEndpoint(row.originalStart, row.startOffset),
		end: end
			? timeEndpoint(end.at, end.utcOffsetMinutes)
			: timeEndpoint(row.originalEnd, row.endOffset),
	};
	return {
		type: "time_comparison",
		action: correction.action === "delete" ? "delete" : "edit",
		original,
		requested:
			correction.action === "delete"
				? { start: null, end: null }
				: {
						start: requestedStart
							? timeEndpoint(requestedStart.at, requestedStart.utcOffsetMinutes)
							: correction.clockInCorrectionId
								? timeEndpoint(row.proposedStart, row.proposedStartOffset)
								: original.start,
						end: requestedEnd
							? timeEndpoint(requestedEnd.at, requestedEnd.utcOffsetMinutes)
							: correction.clockOutCorrectionId
								? timeEndpoint(row.proposedEnd, row.proposedEndOffset)
								: original.end,
					},
	};
}
function correctionApproval(
	row: Record<string, unknown>,
	input: CanonicalInboxLoadInput,
	now: Date,
): CanonicalInboxApproval | null {
	const source = record(row.source);
	const correction = record(row.correction);
	if (
		!source ||
		!correction ||
		row.organizationId !== input.organizationId ||
		row.workflowType !== "time_correction" ||
		source.organization_id !== input.organizationId ||
		source.id !== row.sourceId ||
		source.approval_workflow_id !== row.workflowId
	)
		return null;
	const submittedAt = decodeApprovalDatabaseTimestamptz(row.submittedAt);
	const title: ApprovalInboxLocalizedText =
		correction.action === "delete"
			? {
					key: "approvals:approvals.canonicalTimeDeletion",
					fallback: "Time deletion request",
				}
			: {
					key: "approvals:approvals.canonicalTimeCorrection",
					fallback: "Time correction request",
				};
	const capabilities = {
		canApprove: true,
		canReject: true,
		canBulkApprove: true,
		requiresRejectReason: true,
	};
	const item = {
		id: String(row.assignmentId),
		type: "time_entry" as const,
		entityId: String(row.sourceId),
		status: "pending" as const,
		requester: {
			id: String(row.requesterId),
			name: String(row.userName),
			email: String(row.userEmail),
			image: typeof row.userImage === "string" ? row.userImage : null,
			teamId: typeof row.teamId === "string" ? row.teamId : null,
		},
		summary: {
			title: title.fallback,
			subtitle: String(row.userName),
			detail: title.fallback,
			badge: null,
			stage: { name: String(row.stageLabel), order: Number(row.stageOrder) },
			localized: {
				title,
				subtitle: {
					key: "approvals:approvals.canonicalRequester",
					fallback: "{name}",
					params: { name: String(row.userName) },
				},
				detail: title,
			},
		},
		timing: {
			createdAt: submittedAt.toISOString(),
			resolvedAt: null,
			slaDeadline: null,
			ageDays: getAgeDays({ createdAt: submittedAt, now }),
		},
		triage: buildInboxTriage({
			type: "time_entry",
			requestKind: "time_correction",
			priority: canonicalInboxPriority(submittedAt, now),
			status: "pending",
			createdAt: submittedAt,
			now,
		}),
		capabilities,
	};
	const sections: ApprovalInboxDetailSection[] = [
		correctionComparison(row, correction),
	];
	const changes = timeCorrectionMetadataChanges(
		parseTimeCorrectionReviewMetadata(row.contextSnapshot),
		new Map(),
	);
	const rows: Extract<
		ApprovalInboxDetailSection,
		{ type: "key_value" }
	>["rows"] = [];
	if (changes?.workLocation)
		rows.push({
			label: {
				key: "approvals:approvals.workLocation",
				fallback: "Work location",
			},
			value: {
				kind: "change",
				original: {
					kind: "work_location",
					value: changes.workLocation.original,
				},
				requested: {
					kind: "work_location",
					value: changes.workLocation.requested,
				},
			},
		});
	if (changes?.workCategory)
		rows.push({
			label: {
				key: "approvals:approvals.workCategory",
				fallback: "Work category",
			},
			value: {
				kind: "change",
				original: {
					kind: "work_category",
					value: changes.workCategory.original,
				},
				requested: {
					kind: "work_category",
					value: changes.workCategory.requested,
				},
			},
		});
	if (changes?.vehicleUse)
		rows.push({
			label: { key: "approvals:approvals.vehicleUse", fallback: "Vehicle use" },
			value: {
				kind: "change",
				original: { kind: "vehicle_use", value: changes.vehicleUse.original },
				requested: { kind: "vehicle_use", value: changes.vehicleUse.requested },
			},
		});
	if (rows.length)
		sections.push({
			type: "key_value",
			title: {
				key: "approvals:approvals.requestedCorrection",
				fallback: "Requested correction",
			},
			rows,
		});
	return {
		item,
		detail: { item, sections, actions: capabilities },
		decisionTarget: {
			id: item.id,
			targetType: "canonical_assignment",
			entityType: "time_entry",
			entityId: item.entityId,
			organizationId: input.organizationId,
			approverId: String(row.approverId),
			requesterEmployeeId: item.requester.id,
			status: "pending",
			workflowKind: "time_correction",
		},
	};
}

async function loadTimeCorrectionCanonicalApprovals(
	input: CanonicalInboxLoadInput,
) {
	const now = input.now ?? new Date();
	const rows = resultRows(
		await (input.database ?? db).execute(correctionCandidates(input, now)),
	);
	const approvals = rows.flatMap((row) => {
		const approval = correctionApproval(row, input, now);
		return approval ? [approval] : [];
	});
	return Object.assign(approvals, { totalCount: approvals.length });
}

async function countTimeCorrectionCanonicalApprovals(
	input: CanonicalInboxCountInput,
) {
	const rows = resultRows(
		await (input.database ?? db).execute(
			correctionCandidates(input, input.now ?? new Date(), true),
		),
	);
	return Number(rows[0]?.totalCount ?? 0);
}

/** Canonical corrections are decided by the existing authenticated correction owner. */
export const timeCorrectionInboxRead: CanonicalInboxRead = {
	type: "time_entry",
	workflowTypes: ["time_correction"],
	load: loadTimeCorrectionCanonicalApprovals,
	count: countTimeCorrectionCanonicalApprovals,
};
