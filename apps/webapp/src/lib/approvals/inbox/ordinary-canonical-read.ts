import { type SQL, sql } from "drizzle-orm";
import { db } from "@/db";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatCapturedOffsetInstant } from "@/lib/datetime/temporal-format";
import type { OrdinaryWorkPeriodApprovalKind } from "../domain-adapters/work-period-contract";
import { parseOrdinaryWorkPeriodWorkflowPayload } from "../domain-adapters/work-period-contract";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import { getAgeDays } from "./serialization";
import { buildInboxTriage } from "./triage";
import type {
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
} from "./types";

type EligibleApprovalScope = {
	requesterEmployeeId: string;
	eligibleApproverIds: string[];
};

interface CanonicalEndpoint {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	utcOffsetMinutes: number;
	isSuperseded: boolean;
	supersededById: string | null;
	replacesEntryId: string | null;
}

export interface OrdinaryCanonicalReadRow {
	projection: {
		id: string;
		organizationId: string;
		workflowId: string;
		activeStageId: string;
		sourceType: string;
		sourceId: string;
		status: string;
		displayPayload: unknown;
		searchText: string;
		createdAt: Date;
	};
	workflow: {
		id: string;
		organizationId: string;
		workflowType: string;
		sourceType: string;
		sourceId: string;
		requesterEmployeeId: string | null;
		status: string;
		currentStageOrder: number | null;
		contextSnapshot: unknown;
		submittedAt: Date;
	};
	stage: {
		id: string;
		organizationId: string;
		workflowId: string;
		sequence: number;
		label: string;
		status: string;
		legacyApprovalRequestId: string | null;
	};
	assignment: {
		id: string;
		organizationId: string;
		workflowId: string;
		stageId: string;
		approverEmployeeId: string;
		status: string;
		assignedAt: Date;
	};
	requester: {
		id: string;
		organizationId: string;
		userId: string;
		teamId: string | null;
		user: { id: string; name: string; email: string; image: string | null };
	};
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		canonicalRecordId: string | null;
		approvalWorkflowId: string | null;
		approvalStatus: string;
		isActive: boolean;
		deletedAt: Date | null;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		pendingChanges: unknown;
		employee: {
			id: string;
			organizationId: string;
			userId: string;
			user: { id: string; name: string; email: string; image: string | null };
		};
		clockIn: CanonicalEndpoint | null;
		clockOut: CanonicalEndpoint | null;
	};
	canonicalRecord: {
		id: string;
		organizationId: string;
		employeeId: string;
		recordKind: string;
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		approvalState: string;
	} | null;
	compatibilityRequest: {
		id: string;
		organizationId: string;
		entityType: string;
		entityId: string;
		requestedBy: string;
		approverId: string | null;
		status: string;
		metadata: unknown;
	} | null;
}

export interface OrdinaryCanonicalApproval {
	item: ApprovalInboxItem;
	detail: ApprovalInboxDetailResult;
	decisionTarget: {
		id: string;
		targetType: "canonical_assignment";
		entityType: "time_entry";
		entityId: string;
		organizationId: string;
		approverId: string;
		requesterEmployeeId: string;
		status: ApprovalInboxStatus;
		workflowKind: OrdinaryWorkPeriodApprovalKind;
	};
}

interface SelectOrdinaryCanonicalApprovalsInput {
	rows: OrdinaryCanonicalReadRow[];
	organizationId: string;
	approverId: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: EligibleApprovalScope[];
	search?: string;
	teamId?: string;
	now?: Date;
}

export type OrdinaryCanonicalApprovalBatch = OrdinaryCanonicalApproval[] & {
	totalCount: number;
};

function exactObject(value: unknown, keys: readonly string[]) {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return null;
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Reflect.ownKeys(descriptors).some(
			(key) =>
				typeof key !== "string" ||
				!keys.includes(key) ||
				!descriptors[key]?.enumerable ||
				!("value" in descriptors[key]),
		)
	) {
		return null;
	}
	return value as Record<string, unknown>;
}

function ordinaryKind(value: string): OrdinaryWorkPeriodApprovalKind | null {
	return value === "manual_time_submission" || value === "policy_clock_out"
		? value
		: null;
}

function sameDate(left: Date | null, right: Date | null): boolean {
	return left instanceof Date && right instanceof Date
		? left.getTime() === right.getTime()
		: left === right;
}

function validEndpoint(
	endpoint: CanonicalEndpoint | null,
	row: OrdinaryCanonicalReadRow,
	type: "clock_in" | "clock_out",
): endpoint is CanonicalEndpoint {
	return Boolean(
		endpoint &&
			endpoint.organizationId === row.period.organizationId &&
			endpoint.employeeId === row.period.employeeId &&
			endpoint.type === type &&
			endpoint.timestamp instanceof Date &&
			Number.isInteger(endpoint.utcOffsetMinutes) &&
			endpoint.isSuperseded === false &&
			endpoint.supersededById === null &&
			endpoint.replacesEntryId === null,
	);
}

function parseDisplay(
	row: OrdinaryCanonicalReadRow,
	kind: OrdinaryWorkPeriodApprovalKind,
) {
	const expectedTitle =
		kind === "manual_time_submission"
			? "Manual time submission"
			: "Policy clock-out";
	const display = exactObject(row.projection.displayPayload, [
		"kind",
		"title",
		"startTime",
		"endTime",
		"durationMinutes",
		"approvalStatus",
		"stage",
	]);
	const stage = exactObject(display?.stage, ["name", "order"]);
	const expectedSearch =
		display &&
		typeof display.startTime === "string" &&
		typeof display.endTime === "string" &&
		stage &&
		typeof stage.name === "string"
			? `${expectedTitle} ${display.startTime} ${display.endTime} ${stage.name}`.toLocaleLowerCase(
					"en-US",
				)
			: null;
	if (
		!display ||
		display.kind !== kind ||
		display.title !== expectedTitle ||
		typeof display.startTime !== "string" ||
		typeof display.endTime !== "string" ||
		display.durationMinutes !== row.period.durationMinutes ||
		display.approvalStatus !== "pending" ||
		!stage ||
		stage.name !== row.stage.label ||
		stage.order !== row.stage.sequence ||
		row.projection.searchText !== expectedSearch
	) {
		return null;
	}
	try {
		if (
			parseInstant(display.startTime).epochMilliseconds !==
				row.period.startTime.getTime() ||
			parseInstant(display.endTime).epochMilliseconds !==
				row.period.endTime?.getTime()
		) {
			return null;
		}
	} catch {
		return null;
	}
	return stage as { name: string; order: number };
}

function hasExactCompatibility(
	row: OrdinaryCanonicalReadRow,
	kind: OrdinaryWorkPeriodApprovalKind,
): boolean {
	const request = row.compatibilityRequest;
	if (!row.stage.legacyApprovalRequestId || !request) return false;
	const metadata = exactObject(request.metadata, [
		"workflow",
		"stage",
		"timeRequest",
	]);
	const workflow = exactObject(metadata?.workflow, ["id", "organizationId"]);
	const stage = exactObject(metadata?.stage, ["id", "sequence"]);
	const timeRequest = exactObject(metadata?.timeRequest, ["kind"]);
	return Boolean(
		request.id === row.stage.legacyApprovalRequestId &&
			request.organizationId === row.projection.organizationId &&
			request.entityType === "time_entry" &&
			request.entityId === row.period.id &&
			request.requestedBy === row.requester.id &&
			request.approverId === row.assignment.approverEmployeeId &&
			request.status === "pending" &&
			workflow?.id === row.workflow.id &&
			workflow.organizationId === row.workflow.organizationId &&
			stage?.id === row.stage.id &&
			stage.sequence === row.stage.sequence &&
			timeRequest?.kind === kind,
	);
}

function visible(
	input: SelectOrdinaryCanonicalApprovalsInput,
	row: OrdinaryCanonicalReadRow,
) {
	if (input.includeAllApprovers) return true;
	if (row.assignment.approverEmployeeId === input.approverId) return true;
	return (
		input.eligibleApprovalScopes?.some(
			(scope) =>
				scope.requesterEmployeeId === row.requester.id &&
				scope.eligibleApproverIds.includes(input.approverId) &&
				scope.eligibleApproverIds.includes(row.assignment.approverEmployeeId),
		) ?? false
	);
}

function validateRow(
	row: OrdinaryCanonicalReadRow,
	organizationId: string,
): {
	kind: OrdinaryWorkPeriodApprovalKind;
	stage: { name: string; order: number };
} | null {
	const {
		projection,
		workflow,
		stage,
		assignment,
		requester,
		period,
		canonicalRecord,
	} = row;
	const kind = ordinaryKind(workflow.workflowType);
	if (!kind) return null;
	try {
		parseOrdinaryWorkPeriodWorkflowPayload(workflow.contextSnapshot, kind);
	} catch {
		return null;
	}
	if (
		projection.organizationId !== organizationId ||
		workflow.organizationId !== organizationId ||
		stage.organizationId !== organizationId ||
		assignment.organizationId !== organizationId ||
		requester.organizationId !== organizationId ||
		period.organizationId !== organizationId ||
		canonicalRecord?.organizationId !== organizationId ||
		projection.status !== "pending" ||
		workflow.status !== "pending" ||
		stage.status !== "pending" ||
		assignment.status !== "pending" ||
		projection.workflowId !== workflow.id ||
		projection.activeStageId !== stage.id ||
		projection.sourceType !== "time_entry" ||
		projection.sourceId !== period.id ||
		workflow.sourceType !== "time_entry" ||
		workflow.sourceId !== period.id ||
		workflow.requesterEmployeeId !== requester.id ||
		workflow.currentStageOrder !== stage.sequence ||
		stage.workflowId !== workflow.id ||
		assignment.workflowId !== workflow.id ||
		assignment.stageId !== stage.id ||
		requester.user.id !== requester.userId ||
		period.employeeId !== requester.id ||
		period.employee.id !== requester.id ||
		period.employee.organizationId !== organizationId ||
		period.employee.userId !== requester.userId ||
		period.employee.user.id !== requester.user.id ||
		period.approvalWorkflowId !== workflow.id ||
		period.approvalStatus !== "pending" ||
		period.isActive !== false ||
		period.deletedAt !== null ||
		!(period.startTime instanceof Date) ||
		!(period.endTime instanceof Date) ||
		!Number.isInteger(period.durationMinutes) ||
		(period.durationMinutes ?? -1) < 0 ||
		!validEndpoint(period.clockIn, row, "clock_in") ||
		!validEndpoint(period.clockOut, row, "clock_out") ||
		!sameDate(period.clockIn.timestamp, period.startTime) ||
		!sameDate(period.clockOut.timestamp, period.endTime) ||
		!canonicalRecord ||
		canonicalRecord.id !== period.canonicalRecordId ||
		canonicalRecord.employeeId !== requester.id ||
		canonicalRecord.recordKind !== "work" ||
		canonicalRecord.approvalState !== "pending" ||
		canonicalRecord.durationMinutes !== period.durationMinutes ||
		!sameDate(canonicalRecord.startAt, period.startTime) ||
		!sameDate(canonicalRecord.endAt, period.endTime) ||
		classifyTimeApprovalRequest({
			metadata: workflow.contextSnapshot,
			pendingChanges: period.pendingChanges,
		}) !== kind
	) {
		return null;
	}
	const publicStage = parseDisplay(row, kind);
	return publicStage ? { kind, stage: publicStage } : null;
}

function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const remainder = minutes % 60;
	return `${hours ? `${hours}h` : ""}${hours && remainder ? " " : ""}${remainder ? `${remainder}m` : ""}`;
}

function publicTitle(kind: OrdinaryWorkPeriodApprovalKind): string {
	return kind === "manual_time_submission"
		? "Manual Time Submission"
		: "Clock-out Approval";
}

function toApproval(
	row: OrdinaryCanonicalReadRow,
	validated: NonNullable<ReturnType<typeof validateRow>>,
	now?: Date,
): OrdinaryCanonicalApproval {
	const { period, requester, assignment, workflow } = row;
	const { clockIn, clockOut } = period;
	if (!clockIn || !clockOut) {
		throw new Error("Validated ordinary approval endpoints are unavailable");
	}
	const title = publicTitle(validated.kind);
	const date = formatCapturedOffsetInstant(instantFromDate(clockIn.timestamp), {
		locale: "en-US",
		timeFormat: "24h",
		offsetMinutes: clockIn.utcOffsetMinutes,
		preset: "dateMedium",
	});
	const start = formatCapturedOffsetInstant(
		instantFromDate(clockIn.timestamp),
		{
			locale: "en-US",
			timeFormat: "24h",
			offsetMinutes: clockIn.utcOffsetMinutes,
			preset: "time",
		},
	);
	const end = formatCapturedOffsetInstant(instantFromDate(clockOut.timestamp), {
		locale: "en-US",
		timeFormat: "24h",
		offsetMinutes: clockOut.utcOffsetMinutes,
		preset: "time",
	});
	const duration = formatDuration(period.durationMinutes ?? 0);
	const priority = ordinaryPriority(workflow.submittedAt, now);
	const triage = buildInboxTriage({
		type: "time_entry",
		priority,
		status: "pending",
		createdAt: workflow.submittedAt,
		now,
	});
	const capabilities = {
		canApprove: true,
		canReject: true,
		canBulkApprove: true,
		requiresRejectReason: true,
	};
	const item: ApprovalInboxItem = {
		id: assignment.id,
		type: "time_entry",
		entityId: assignment.id,
		status: "pending",
		requester: {
			id: requester.id,
			name: requester.user.name,
			email: requester.user.email,
			image: requester.user.image,
			teamId: requester.teamId,
		},
		summary: {
			title,
			subtitle: `${date} - ${start} to ${end}`,
			detail: `${duration} on ${date}`,
			badge: {
				label:
					validated.kind === "manual_time_submission" ? "Manual" : "Clock-out",
				color: null,
			},
			stage: validated.stage,
		},
		timing: {
			createdAt: workflow.submittedAt.toISOString(),
			resolvedAt: null,
			slaDeadline: null,
			ageDays: getAgeDays({ createdAt: workflow.submittedAt, now }),
		},
		triage,
		capabilities,
	};
	const detail: ApprovalInboxDetailResult = {
		item,
		actions: capabilities,
		sections: [
			{
				type: "key_value",
				title: "Request",
				rows: [
					{ label: "Type", value: title },
					{ label: "Range", value: item.summary.subtitle },
					{ label: "Duration", value: duration },
					{ label: "Status", value: "pending" },
					{
						label: "Stage",
						value: `${validated.stage.name} (${validated.stage.order})`,
					},
				],
			},
			{
				type: "timeline",
				title: "Timeline",
				events: [
					{
						id: "timeline-created-1",
						label: `${requester.user.name} requested ${title.toLowerCase()}`,
						at: workflow.submittedAt.toISOString(),
						actorName: requester.user.name,
					},
				],
			},
		],
	};
	return {
		item,
		detail,
		decisionTarget: {
			id: assignment.id,
			targetType: "canonical_assignment",
			entityType: "time_entry",
			entityId: period.id,
			organizationId: workflow.organizationId,
			approverId: assignment.approverEmployeeId,
			requesterEmployeeId: requester.id,
			status: "pending",
			workflowKind: validated.kind,
		},
	};
}

function ordinaryPriority(
	createdAt: Date,
	now = new Date(),
): ApprovalInboxPriority {
	const ageHours = instantFromDate(createdAt)
		.until(instantFromDate(now))
		.total("hours");
	if (ageHours > 72) return "urgent";
	if (ageHours > 48) return "high";
	if (ageHours > 24) return "normal";
	return "low";
}

export function selectOrdinaryCanonicalApprovals(
	input: SelectOrdinaryCanonicalApprovalsInput,
): OrdinaryCanonicalApproval[] {
	const search = input.search?.trim().toLocaleLowerCase("en-US");
	return input.rows.flatMap((row) => {
		const validated = validateRow(row, input.organizationId);
		if (
			!validated ||
			!visible(input, row) ||
			(input.teamId && row.requester.teamId !== input.teamId) ||
			hasExactCompatibility(row, validated.kind)
		) {
			return [];
		}
		const approval = toApproval(row, validated, input.now);
		if (search) {
			const searchable = [
				approval.item.requester.name,
				approval.item.requester.email,
				approval.item.summary.title,
				approval.item.summary.subtitle,
				approval.item.summary.detail,
				approval.item.summary.stage?.name,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase("en-US");
			if (!searchable.includes(search)) return [];
		}
		return [approval];
	});
}

interface OrdinaryCanonicalReadDatabase {
	execute(statement: SQL): Promise<unknown>;
}

interface OrdinaryCanonicalLoadInput
	extends Omit<SelectOrdinaryCanonicalApprovalsInput, "rows"> {
	database?: OrdinaryCanonicalReadDatabase;
	assignmentId?: string;
	assignmentIds?: string[];
	limit?: number;
	cursor?: {
		riskLevel: ApprovalInboxRiskLevel;
		priority: ApprovalInboxPriority;
		createdAt: string;
		id: string;
	};
}

function resultRows(result: unknown): Record<string, unknown>[] {
	return typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
		? (result.rows as Record<string, unknown>[])
		: [];
}

function candidateVisibility(input: OrdinaryCanonicalLoadInput): SQL {
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
	return eligible.length > 0
		? sql`(assignment.approver_employee_id = ${input.approverId}::uuid or ${sql.join(eligible, sql` or `)})`
		: sql`assignment.approver_employee_id = ${input.approverId}::uuid`;
}

function targetCondition(input: OrdinaryCanonicalLoadInput): SQL {
	if (input.assignmentId) {
		return sql`and assignment.id = ${input.assignmentId}::uuid`;
	}
	if (input.assignmentIds?.length) {
		return sql`and assignment.id in (${sql.join(
			input.assignmentIds.map((id) => sql`${id}::uuid`),
			sql`, `,
		)})`;
	}
	return sql``;
}

function cursorCondition(input: OrdinaryCanonicalLoadInput): SQL {
	if (!input.cursor) return sql``;
	const cursorRiskRank = { high: 0, medium: 1, low: 2 }[input.cursor.riskLevel];
	const cursorPriorityRank = { urgent: 0, high: 1, normal: 2, low: 3 }[
		input.cursor.priority
	];
	return sql`and (${riskRankSql(input)} > ${cursorRiskRank}
		or (${riskRankSql(input)} = ${cursorRiskRank} and ${priorityRankSql(input)} > ${cursorPriorityRank})
		or (${riskRankSql(input)} = ${cursorRiskRank} and ${priorityRankSql(input)} = ${cursorPriorityRank}
			and workflow.submitted_at > ${new Date(input.cursor.createdAt)})
		or (${riskRankSql(input)} = ${cursorRiskRank} and ${priorityRankSql(input)} = ${cursorPriorityRank}
			and workflow.submitted_at = ${new Date(input.cursor.createdAt)} and assignment.id > ${input.cursor.id}::uuid))`;
}

function riskRankSql(input: OrdinaryCanonicalLoadInput): SQL {
	return sql`case when workflow.submitted_at <= ${input.now ?? new Date()} - interval '3 days' then 0 else 1 end`;
}

function priorityRankSql(input: OrdinaryCanonicalLoadInput): SQL {
	const now = input.now ?? new Date();
	return sql`case
		when workflow.submitted_at < ${now} - interval '72 hours' then 0
		when workflow.submitted_at < ${now} - interval '48 hours' then 1
		when workflow.submitted_at < ${now} - interval '24 hours' then 2
		else 3 end`;
}

function boundedLimit(input: OrdinaryCanonicalLoadInput): number {
	if (input.assignmentId) return 1;
	const requested = Math.floor(input.limit ?? 51);
	return Math.min(Math.max(requested, 1), 101);
}

function candidateQuery(input: OrdinaryCanonicalLoadInput, countOnly = false) {
	const selection = countOnly
		? sql`count(*)::integer as "totalCount"`
		: sql`
			projection.id as "projectionId", projection.organization_id as "projectionOrganizationId",
			projection.workflow_id as "projectionWorkflowId", projection.active_stage_id as "activeStageId",
			projection.source_type as "sourceType", projection.source_id as "sourceId",
			projection.status as "projectionStatus", projection.display_payload as "displayPayload",
			projection.search_text as "searchText", projection.created_at as "projectionCreatedAt",
			workflow.id as "workflowId", workflow.organization_id as "workflowOrganizationId",
			workflow.workflow_type as "workflowType", workflow.source_type as "workflowSourceType",
			workflow.source_id as "workflowSourceId", workflow.requester_employee_id as "requesterEmployeeId",
			workflow.status as "workflowStatus", workflow.current_stage_order as "currentStageOrder",
			workflow.context_snapshot as "contextSnapshot", workflow.submitted_at as "submittedAt",
			stage.id as "stageId", stage.organization_id as "stageOrganizationId",
			stage.workflow_id as "stageWorkflowId", stage.stage_order as "stageSequence",
			stage.label as "stageLabel", stage.status as "stageStatus",
			stage.legacy_approval_request_id as "legacyApprovalRequestId",
			assignment.id as "assignmentId", assignment.organization_id as "assignmentOrganizationId",
			assignment.workflow_id as "assignmentWorkflowId", assignment.stage_id as "assignmentStageId",
			assignment.approver_employee_id as "approverEmployeeId", assignment.status as "assignmentStatus",
			assignment.assigned_at as "assignedAt", requester.id as "requesterId",
			requester.organization_id as "requesterOrganizationId", requester.user_id as "requesterUserId",
			requester.team_id as "requesterTeamId", requester_user.id as "userId",
			requester_user.name as "userName", requester_user.email as "userEmail",
			requester_user.image as "userImage", count(*) over()::integer as "totalCount"`;
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
		join work_period source_period
			on source_period.id = projection.source_id
			and source_period.organization_id = projection.organization_id
			and source_period.employee_id = workflow.requester_employee_id
		join time_record source_record
			on source_record.id = source_period.canonical_record_id
			and source_record.organization_id = source_period.organization_id
			and source_record.employee_id = source_period.employee_id
		join time_entry source_clock_in
			on source_clock_in.id = source_period.clock_in_id
			and source_clock_in.organization_id = source_period.organization_id
			and source_clock_in.employee_id = source_period.employee_id
		join time_entry source_clock_out
			on source_clock_out.id = source_period.clock_out_id
			and source_clock_out.organization_id = source_period.organization_id
			and source_clock_out.employee_id = source_period.employee_id
		left join approval_request compatibility
			on compatibility.id = stage.legacy_approval_request_id
			and compatibility.organization_id = projection.organization_id
		where projection.organization_id = ${input.organizationId}
			and projection.source_type = 'time_entry'
			and workflow.source_type = 'time_entry'
			and workflow.workflow_type in ('manual_time_submission', 'policy_clock_out')
			and projection.status = 'pending'
			and workflow.status = 'pending'
			and stage.status = 'pending'
			and assignment.status = 'pending'
			and workflow.current_stage_order = stage.stage_order
			and source_period.approval_workflow_id = workflow.id
			and source_period.approval_status = 'pending'
			and source_period.is_active = false
			and source_period.deleted_at is null
			and source_period.end_time is not null
			and source_period.duration_minutes is not null
			and source_record.record_kind = 'work'
			and source_record.approval_state = 'pending'
			and source_record.start_at = source_period.start_time
			and source_record.end_at = source_period.end_time
			and source_record.duration_minutes = source_period.duration_minutes
			and source_clock_in.type = 'clock_in'
			and source_clock_in.timestamp = source_period.start_time
			and source_clock_in.utc_offset_minutes is not null
			and source_clock_in.is_superseded = false
			and source_clock_in.superseded_by_id is null
			and source_clock_in.replaces_entry_id is null
			and source_clock_out.type = 'clock_out'
			and source_clock_out.timestamp = source_period.end_time
			and source_clock_out.utc_offset_minutes is not null
			and source_clock_out.is_superseded = false
			and source_clock_out.superseded_by_id is null
			and source_clock_out.replaces_entry_id is null
			and jsonb_typeof(workflow.context_snapshot) = 'object'
			and (select count(*) from jsonb_object_keys(case
				when jsonb_typeof(workflow.context_snapshot) = 'object' then workflow.context_snapshot
				else '{}'::jsonb end)) = 1
			and jsonb_typeof(workflow.context_snapshot -> 'timeRequest') = 'object'
			and (select count(*) from jsonb_object_keys(case
				when jsonb_typeof(workflow.context_snapshot -> 'timeRequest') = 'object'
					then workflow.context_snapshot -> 'timeRequest'
				else '{}'::jsonb end)) = 1
			and workflow.context_snapshot -> 'timeRequest' ->> 'kind' = workflow.workflow_type::text
			and jsonb_typeof(projection.display_payload) = 'object'
			and (select count(*) from jsonb_object_keys(case
				when jsonb_typeof(projection.display_payload) = 'object' then projection.display_payload
				else '{}'::jsonb end)) = 7
			and jsonb_typeof(projection.display_payload -> 'stage') = 'object'
			and (select count(*) from jsonb_object_keys(case
				when jsonb_typeof(projection.display_payload -> 'stage') = 'object'
					then projection.display_payload -> 'stage'
				else '{}'::jsonb end)) = 2
			and projection.display_payload ->> 'kind' = workflow.workflow_type::text
			and projection.display_payload ->> 'title' = case
				when workflow.workflow_type = 'manual_time_submission' then 'Manual time submission'
				else 'Policy clock-out'
			end
			and case
				when projection.display_payload ->> 'startTime' ~ '^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$'
					and pg_input_is_valid(projection.display_payload ->> 'startTime', 'timestamp with time zone')
				then (projection.display_payload ->> 'startTime')::timestamptz
				else null
			end = source_period.start_time at time zone 'UTC'
			and case
				when projection.display_payload ->> 'endTime' ~ '^\\d{4}-\\d{2}-\\d{2}T.*(Z|[+-]\\d{2}:\\d{2})$'
					and pg_input_is_valid(projection.display_payload ->> 'endTime', 'timestamp with time zone')
				then (projection.display_payload ->> 'endTime')::timestamptz
				else null
			end = source_period.end_time at time zone 'UTC'
			and case
				when projection.display_payload ->> 'durationMinutes' ~ '^[0-9]+$'
					and pg_input_is_valid(projection.display_payload ->> 'durationMinutes', 'integer')
				then (projection.display_payload ->> 'durationMinutes')::integer
				else null
			end = source_period.duration_minutes
			and projection.display_payload ->> 'approvalStatus' = 'pending'
			and projection.display_payload -> 'stage' ->> 'name' = stage.label
			and projection.display_payload -> 'stage' ->> 'order' = stage.stage_order::text
			and projection.search_text = lower(
				(projection.display_payload ->> 'title') || ' ' ||
				(projection.display_payload ->> 'startTime') || ' ' ||
				(projection.display_payload ->> 'endTime') || ' ' || stage.label
			)
			and case
				when source_period.pending_changes is null then true
				when pg_input_is_valid(source_period.pending_changes, 'jsonb') then
					jsonb_typeof(source_period.pending_changes::jsonb) = 'object'
					and (not (source_period.pending_changes::jsonb ? 'isManualEntry')
						or jsonb_typeof(source_period.pending_changes::jsonb -> 'isManualEntry') = 'boolean')
					and (not (source_period.pending_changes::jsonb ? 'isNewClockOut')
						or jsonb_typeof(source_period.pending_changes::jsonb -> 'isNewClockOut') = 'boolean')
					and coalesce(
						source_period.pending_changes::jsonb -> case
							when workflow.workflow_type = 'manual_time_submission' then 'isNewClockOut'
							else 'isManualEntry'
						end,
						'false'::jsonb
					) <> 'true'::jsonb
				else false
			end
			and not coalesce((
				compatibility.id is not null
				and compatibility.entity_type = 'time_entry'
				and compatibility.entity_id = projection.source_id
				and compatibility.requested_by = workflow.requester_employee_id
				and compatibility.approver_id = assignment.approver_employee_id
				and compatibility.status = 'pending'
				and jsonb_typeof(compatibility.metadata) = 'object'
				and (select count(*) from jsonb_object_keys(case
					when jsonb_typeof(compatibility.metadata) = 'object' then compatibility.metadata
					else '{}'::jsonb end)) = 3
				and jsonb_typeof(compatibility.metadata -> 'workflow') = 'object'
				and (select count(*) from jsonb_object_keys(case
					when jsonb_typeof(compatibility.metadata -> 'workflow') = 'object'
						then compatibility.metadata -> 'workflow'
					else '{}'::jsonb end)) = 2
				and jsonb_typeof(compatibility.metadata -> 'stage') = 'object'
				and (select count(*) from jsonb_object_keys(case
					when jsonb_typeof(compatibility.metadata -> 'stage') = 'object'
						then compatibility.metadata -> 'stage'
					else '{}'::jsonb end)) = 2
				and jsonb_typeof(compatibility.metadata -> 'timeRequest') = 'object'
				and (select count(*) from jsonb_object_keys(case
					when jsonb_typeof(compatibility.metadata -> 'timeRequest') = 'object'
						then compatibility.metadata -> 'timeRequest'
					else '{}'::jsonb end)) = 1
				and compatibility.metadata -> 'workflow' ->> 'id' = workflow.id::text
				and compatibility.metadata -> 'workflow' ->> 'organizationId' = projection.organization_id
				and compatibility.metadata -> 'stage' ->> 'id' = stage.id::text
				and compatibility.metadata -> 'stage' ->> 'sequence' = stage.stage_order::text
				and compatibility.metadata -> 'timeRequest' ->> 'kind' = workflow.workflow_type::text
			), false)
			and ${candidateVisibility(input)}
			${targetCondition(input)}
			${cursorCondition(input)}
		${countOnly ? sql`` : sql`order by ${riskRankSql(input)}, ${priorityRankSql(input)}, workflow.submitted_at, assignment.id limit ${boundedLimit(input)}`}
	`;
}

function toCandidate(value: Record<string, unknown>) {
	return {
		projection: {
			id: value.projectionId,
			organizationId: value.projectionOrganizationId,
			workflowId: value.projectionWorkflowId,
			activeStageId: value.activeStageId,
			sourceType: value.sourceType,
			sourceId: value.sourceId,
			status: value.projectionStatus,
			displayPayload: value.displayPayload,
			searchText: value.searchText,
			createdAt: value.projectionCreatedAt,
		},
		workflow: {
			id: value.workflowId,
			organizationId: value.workflowOrganizationId,
			workflowType: value.workflowType,
			sourceType: value.workflowSourceType,
			sourceId: value.workflowSourceId,
			requesterEmployeeId: value.requesterEmployeeId,
			status: value.workflowStatus,
			currentStageOrder: value.currentStageOrder,
			contextSnapshot: value.contextSnapshot,
			submittedAt: value.submittedAt,
		},
		stage: {
			id: value.stageId,
			organizationId: value.stageOrganizationId,
			workflowId: value.stageWorkflowId,
			sequence: value.stageSequence,
			label: value.stageLabel,
			status: value.stageStatus,
			legacyApprovalRequestId: value.legacyApprovalRequestId,
		},
		assignment: {
			id: value.assignmentId,
			organizationId: value.assignmentOrganizationId,
			workflowId: value.assignmentWorkflowId,
			stageId: value.assignmentStageId,
			approverEmployeeId: value.approverEmployeeId,
			status: value.assignmentStatus,
			assignedAt: value.assignedAt,
		},
		requester: {
			id: value.requesterId,
			organizationId: value.requesterOrganizationId,
			userId: value.requesterUserId,
			teamId: value.requesterTeamId,
			user: {
				id: value.userId,
				name: value.userName,
				email: value.userEmail,
				image: value.userImage,
			},
		},
		totalCount: value.totalCount,
	} as unknown as Omit<
		OrdinaryCanonicalReadRow,
		"period" | "canonicalRecord" | "compatibilityRequest"
	> & {
		totalCount: number;
	};
}

function evidenceQuery(organizationId: string, sourceIds: string[]) {
	return sql`
		select period.id as "periodId", period.organization_id as "periodOrganizationId",
			period.employee_id as "periodEmployeeId", period.canonical_record_id as "periodCanonicalRecordId",
			period.approval_workflow_id as "periodApprovalWorkflowId", period.approval_status as "periodApprovalStatus",
			period.is_active as "periodIsActive", period.deleted_at as "periodDeletedAt",
			period.start_time as "periodStartTime", period.end_time as "periodEndTime",
			period.duration_minutes as "periodDurationMinutes", period.pending_changes as "periodPendingChanges",
			clock_in.id as "clockInId", clock_in.organization_id as "clockInOrganizationId",
			clock_in.employee_id as "clockInEmployeeId", clock_in.type as "clockInType",
			clock_in.timestamp as "clockInTimestamp", clock_in.utc_offset_minutes as "clockInUtcOffsetMinutes",
			clock_in.is_superseded as "clockInIsSuperseded", clock_in.superseded_by_id as "clockInSupersededById",
			clock_in.replaces_entry_id as "clockInReplacesEntryId", clock_out.id as "clockOutId",
			clock_out.organization_id as "clockOutOrganizationId", clock_out.employee_id as "clockOutEmployeeId",
			clock_out.type as "clockOutType", clock_out.timestamp as "clockOutTimestamp",
			clock_out.utc_offset_minutes as "clockOutUtcOffsetMinutes", clock_out.is_superseded as "clockOutIsSuperseded",
			clock_out.superseded_by_id as "clockOutSupersededById", clock_out.replaces_entry_id as "clockOutReplacesEntryId",
			canonical.id as "canonicalId", canonical.organization_id as "canonicalOrganizationId",
			canonical.employee_id as "canonicalEmployeeId", canonical.record_kind as "canonicalRecordKind",
			canonical.start_at as "canonicalStartAt", canonical.end_at as "canonicalEndAt",
			canonical.duration_minutes as "canonicalDurationMinutes", canonical.approval_state as "canonicalApprovalState"
		from work_period period
		join time_record canonical on canonical.id = period.canonical_record_id and canonical.organization_id = period.organization_id
		join time_entry clock_in on clock_in.id = period.clock_in_id and clock_in.organization_id = period.organization_id
		join time_entry clock_out on clock_out.id = period.clock_out_id and clock_out.organization_id = period.organization_id
		where period.organization_id = ${organizationId}
			and period.id in (${sql.join(
				sourceIds.map((id) => sql`${id}::uuid`),
				sql`, `,
			)})
	`;
}

function compatibilityQuery(organizationId: string, requestIds: string[]) {
	return sql`select id, organization_id as "organizationId", entity_type as "entityType",
		entity_id as "entityId", requested_by as "requestedBy", approver_id as "approverId",
		status, metadata from approval_request where organization_id = ${organizationId}
		and id in (${sql.join(
			requestIds.map((id) => sql`${id}::uuid`),
			sql`, `,
		)})`;
}

function endpoint(
	value: Record<string, unknown>,
	prefix: "clockIn" | "clockOut",
) {
	const id = value[`${prefix}Id`];
	if (typeof id !== "string") return null;
	return {
		id,
		organizationId: value[`${prefix}OrganizationId`],
		employeeId: value[`${prefix}EmployeeId`],
		type: value[`${prefix}Type`],
		timestamp: value[`${prefix}Timestamp`],
		utcOffsetMinutes: value[`${prefix}UtcOffsetMinutes`],
		isSuperseded: value[`${prefix}IsSuperseded`],
		supersededById: value[`${prefix}SupersededById`],
		replacesEntryId: value[`${prefix}ReplacesEntryId`],
	} as CanonicalEndpoint;
}

function toEvidence(
	value: Record<string, unknown>,
	requester: OrdinaryCanonicalReadRow["requester"],
) {
	return {
		period: {
			id: value.periodId,
			organizationId: value.periodOrganizationId,
			employeeId: value.periodEmployeeId,
			canonicalRecordId: value.periodCanonicalRecordId,
			approvalWorkflowId: value.periodApprovalWorkflowId,
			approvalStatus: value.periodApprovalStatus,
			isActive: value.periodIsActive,
			deletedAt: value.periodDeletedAt,
			startTime: value.periodStartTime,
			endTime: value.periodEndTime,
			durationMinutes: value.periodDurationMinutes,
			pendingChanges: value.periodPendingChanges,
			employee: requester,
			clockIn: endpoint(value, "clockIn"),
			clockOut: endpoint(value, "clockOut"),
		},
		canonicalRecord: {
			id: value.canonicalId,
			organizationId: value.canonicalOrganizationId,
			employeeId: value.canonicalEmployeeId,
			recordKind: value.canonicalRecordKind,
			startAt: value.canonicalStartAt,
			endAt: value.canonicalEndAt,
			durationMinutes: value.canonicalDurationMinutes,
			approvalState: value.canonicalApprovalState,
		},
	} as Pick<OrdinaryCanonicalReadRow, "period" | "canonicalRecord">;
}

export async function loadOrdinaryCanonicalApprovals(
	input: OrdinaryCanonicalLoadInput,
): Promise<OrdinaryCanonicalApprovalBatch> {
	input = { ...input, now: input.now ?? new Date() };
	const database =
		input.database ?? (db as unknown as OrdinaryCanonicalReadDatabase);
	const candidates = resultRows(
		await database.execute(candidateQuery(input)),
	).map(toCandidate);
	if (candidates.length === 0) return Object.assign([], { totalCount: 0 });
	const sourceIds = [
		...new Set(candidates.map(({ projection }) => projection.sourceId)),
	];
	const evidenceRows = resultRows(
		await database.execute(evidenceQuery(input.organizationId, sourceIds)),
	);
	const evidenceBySource = new Map(
		evidenceRows.map((value) => [value.periodId, value]),
	);
	const compatibilityIds = [
		...new Set(
			candidates.flatMap(({ stage }) =>
				stage.legacyApprovalRequestId ? [stage.legacyApprovalRequestId] : [],
			),
		),
	];
	const compatibilityRows = compatibilityIds.length
		? resultRows(
				await database.execute(
					compatibilityQuery(input.organizationId, compatibilityIds),
				),
			)
		: [];
	const compatibilityById = new Map(
		compatibilityRows.map((value) => [value.id, value]),
	);
	const rows = candidates.flatMap((candidate) => {
		const evidence = evidenceBySource.get(candidate.projection.sourceId);
		if (!evidence) return [];
		return [
			{
				...candidate,
				...toEvidence(evidence, candidate.requester),
				compatibilityRequest: candidate.stage.legacyApprovalRequestId
					? (compatibilityById.get(candidate.stage.legacyApprovalRequestId) ??
						null)
					: null,
			} as OrdinaryCanonicalReadRow,
		];
	});
	const approvals = selectOrdinaryCanonicalApprovals({ ...input, rows });
	const rawTotal = candidates[0]?.totalCount ?? candidates.length;
	const excluded = candidates.length - approvals.length;
	return Object.assign(approvals, {
		totalCount: Math.max(0, rawTotal - excluded),
	});
}

export async function countOrdinaryCanonicalApprovals(
	input: Omit<
		OrdinaryCanonicalLoadInput,
		"limit" | "cursor" | "assignmentId" | "assignmentIds"
	>,
): Promise<number> {
	const database =
		input.database ?? (db as unknown as OrdinaryCanonicalReadDatabase);
	const rows = resultRows(await database.execute(candidateQuery(input, true)));
	return typeof rows[0]?.totalCount === "number" ? rows[0].totalCount : 0;
}
