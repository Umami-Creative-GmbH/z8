import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import { approvalRequest, workPeriod } from "@/db/schema";
import {
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { policyClockOutBreakSnapshotFromPendingChanges } from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import { policyClockOutSurchargeSnapshotFromPendingChanges } from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import {
	decodeApprovalDatabaseJsonText,
	decodeApprovalDatabaseTimestamp,
} from "../approval-database-row";
import { createLegacyApprovalWriteCoordinator } from "../domain-adapters/legacy-write-coordinator";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	type OrdinaryWorkPeriodApprovalKind,
	parseOrdinaryWorkPeriodWorkflowPayload,
	type WorkPeriodMaintenanceFacts,
} from "../domain-adapters/work-period-contract";
import {
	captureOrdinaryWorkPeriodLegacyPreSubmissionState,
	captureOrdinaryWorkPeriodLegacyState,
} from "../domain-adapters/work-period-legacy-state";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import { getPrimaryEligibleManagerIdForRequester } from "../policies/manager-eligibility-db";
import type { ApprovalPolicyOvertimeRisk } from "../policies/types";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import type {
	ApprovalWorkflowSnapshot,
	ApprovalWriteGate,
	ApprovalWriteGateResult,
} from "../workflow/ports";
import { startApprovalWorkflow } from "../workflow/start-workflow";
import type { ApprovalDbService } from "./types";
import {
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	finalizeOrdinaryWorkPeriodTerminalInTransaction,
} from "./work-period-approvals";

export interface ExecuteOrdinaryWorkPeriodSubmissionInput {
	dbService: ApprovalDbService;
	context: ApprovalWorkflowTransactionContext;
	organizationId: string;
	workPeriodId: string;
	submissionId: string;
	requesterEmployeeId: string;
	requesterUserId: string;
	teamId: string | null;
	defaultApproverId: string | null;
	reason: string;
	overtimeRisk: ApprovalPolicyOvertimeRisk;
	kind: OrdinaryWorkPeriodApprovalKind;
	metadata: Record<string, unknown>;
}

export interface WorkPeriodPostCommitDescriptor {
	disposition: "dispatch" | "observe";
	dedupeKey: string;
	event: "pending" | "approved" | "rejected";
	organizationId: string;
	workPeriodId: string;
	requesterEmployeeId: string;
	approverEmployeeId: string | null;
	kind: OrdinaryWorkPeriodApprovalKind;
	startTime: string;
	endTime: string;
	durationMinutes: number;
	reason: string | null;
	maintenance: WorkPeriodMaintenanceFacts | null;
}

export async function insertOrdinaryWorkPeriodSourceInTransaction(input: {
	dbService: ApprovalDbService;
	id: string;
	employeeId: string;
	organizationId: string;
	clockInId: string;
	clockOutId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	projectId: string | null;
	workCategoryId: string | null;
	canonicalRecordId: string;
	approvalStatus: "pending" | "approved";
	pendingChanges: unknown;
}) {
	const [period] = await input.dbService.db
		.insert(workPeriod)
		.values({
			id: input.id,
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			clockInId: input.clockInId,
			clockOutId: input.clockOutId,
			startTime: input.startTime,
			endTime: input.endTime,
			durationMinutes: input.durationMinutes,
			projectId: input.projectId,
			workCategoryId: input.workCategoryId,
			canonicalRecordId: input.canonicalRecordId,
			isActive: false,
			approvalStatus: input.approvalStatus,
			pendingChanges: input.pendingChanges as never,
		})
		.returning();
	if (!period) fail();
	return period;
}

interface LockedOrdinarySource {
	id: string;
	organizationId: string;
	employeeId: string;
	requesterUserId: string;
	clockInId: string;
	clockOutId: string;
	canonicalRecordId: string;
	approvalWorkflowId: string | null;
	approvalStatus: "pending" | "approved" | "rejected";
	pendingChanges: unknown;
	isActive: boolean;
	startTime: Date;
	endTime: Date;
	wasAutoAdjusted: boolean;
	originalEndTime: Date | null;
	durationMinutes: number;
	deletedAt: Date | null;
	canonicalId: string;
	canonicalOrganizationId: string;
	canonicalEmployeeId: string;
	canonicalRecordKind: string;
	canonicalStartAt: Date;
	canonicalEndAt: Date;
	canonicalDurationMinutes: number;
	canonicalApprovalState: string;
	pendingLegacyRequests: unknown[];
	pendingCanonicalWorkflows: unknown[];
	terminalCanonicalWorkflows: unknown[];
	terminalCanonicalReceipts: unknown[];
	terminalLegacyMarkedRequests: unknown[];
	historicalLegacyAutoRequests: unknown[];
	hasMalformedLegacyMarker: boolean;
}

interface PendingLegacyRequest {
	id: string;
	organizationId?: string;
	entityType?: string;
	entityId?: string;
	requestedBy?: string;
	approverId?: string;
	status?: string;
	reason?: string | null;
	metadata?: unknown;
	chainInstanceId?: string | null;
}

export class OrdinaryWorkPeriodSubmissionError extends Error {
	constructor() {
		super("Ordinary work-period submission failed");
		this.name = "OrdinaryWorkPeriodSubmissionError";
	}
}

class ResolverManagerValidationError extends ValidationError {
	constructor() {
		super({
			field: "managerId",
			message: "No manager assigned to approve time changes",
		});
		this.name = "ResolverManagerValidationError";
	}
}

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(): never {
	throw new OrdinaryWorkPeriodSubmissionError();
}

function canonicalSubmissionId(value: unknown): string {
	return typeof value === "string" && CANONICAL_UUID.test(value)
		? value
		: fail();
}

function rows(result: unknown): unknown[] {
	return result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray(result.rows)
		? result.rows
		: fail();
}

function sameDate(left: Date, right: Date): boolean {
	return left.getTime() === right.getTime();
}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail();
	}
	return value as Record<string, unknown>;
}

function decodeLockedOrdinarySource(value: unknown): LockedOrdinarySource {
	const row = object(value);
	return {
		...row,
		pendingChanges: decodeApprovalDatabaseJsonText(row.pendingChanges),
		startTime: decodeApprovalDatabaseTimestamp(row.startTime),
		endTime: decodeApprovalDatabaseTimestamp(row.endTime),
		originalEndTime:
			row.originalEndTime === null
				? null
				: decodeApprovalDatabaseTimestamp(row.originalEndTime),
		deletedAt:
			row.deletedAt === null
				? null
				: decodeApprovalDatabaseTimestamp(row.deletedAt),
		canonicalStartAt: decodeApprovalDatabaseTimestamp(row.canonicalStartAt),
		canonicalEndAt: decodeApprovalDatabaseTimestamp(row.canonicalEndAt),
	} as LockedOrdinarySource;
}

function exactDataObject(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return fail();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Reflect.ownKeys(descriptors).length !== expectedKeys.length ||
		Reflect.ownKeys(descriptors).some(
			(key) => typeof key !== "string" || !expectedKeys.includes(key),
		)
	) {
		return fail();
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		result[key] = descriptor.value;
	}
	return result;
}

function fixedWriteGate(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
	authority: ApprovalWriteGateResult,
): ApprovalWriteGate {
	return {
		async acquire(scope) {
			if (
				scope.organizationId !== input.organizationId ||
				scope.workflowType !== input.kind
			) {
				return fail();
			}
			return authority;
		},
	};
}

function sourceLockKey(input: {
	organizationId: string;
	workflowType: OrdinaryWorkPeriodApprovalKind;
	sourceId: string;
}): string {
	return JSON.stringify([
		input.organizationId,
		input.workflowType,
		"time_entry",
		input.sourceId,
	]);
}

async function lockOrdinarySource(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
) {
	for (const workflowType of [
		"manual_time_submission",
		"policy_clock_out",
	] as const) {
		const result = await input.dbService.db.execute(sql`
			select pg_advisory_xact_lock(
				hashtextextended(${sourceLockKey({
					organizationId: input.organizationId,
					workflowType,
					sourceId: input.workPeriodId,
				})}, 0)
			) as locked
		`);
		if (rows(result).length !== 1) fail();
	}
}

async function loadOrdinarySource(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
	submissionKey: string,
): Promise<LockedOrdinarySource> {
	const result = await input.dbService.db.execute(sql`
		select
			period.id,
			period.organization_id as "organizationId",
			period.employee_id as "employeeId",
			requester.user_id as "requesterUserId",
			period.clock_in_id as "clockInId",
			period.clock_out_id as "clockOutId",
			period.canonical_record_id as "canonicalRecordId",
			period.approval_workflow_id as "approvalWorkflowId",
			period.approval_status as "approvalStatus",
			period.pending_changes as "pendingChanges",
			period.is_active as "isActive",
			period.start_time as "startTime",
			period.end_time as "endTime",
			period.was_auto_adjusted as "wasAutoAdjusted",
			period.original_end_time as "originalEndTime",
			period.duration_minutes as "durationMinutes",
			period.deleted_at as "deletedAt",
			canonical.id as "canonicalId",
			canonical.organization_id as "canonicalOrganizationId",
			canonical.employee_id as "canonicalEmployeeId",
			canonical.record_kind as "canonicalRecordKind",
			canonical.start_at as "canonicalStartAt",
			canonical.end_at as "canonicalEndAt",
			canonical.duration_minutes as "canonicalDurationMinutes",
			canonical.approval_state as "canonicalApprovalState",
			coalesce((
				select json_agg(json_build_object(
					'id', request.id,
					'organizationId', request.organization_id,
					'entityType', request.entity_type,
					'entityId', request.entity_id,
					'requestedBy', request.requested_by,
					'approverId', request.approver_id,
					'status', request.status,
					'reason', request.reason,
					'metadata', request.metadata,
					'chainInstanceId', stage.chain_instance_id
				) order by request.id)
				from approval_request request
				left join approval_chain_stage_instance stage
					on stage.approval_request_id = request.id
					and stage.organization_id = request.organization_id
				where request.organization_id = period.organization_id
					and request.entity_type = 'time_entry'
					and request.entity_id = period.id
					and request.status = 'pending'
			), '[]'::json) as "pendingLegacyRequests",
			coalesce((
				select json_agg(json_build_object(
					'id', workflow.id,
					'workflowType', workflow.workflow_type,
					'requesterEmployeeId', workflow.requester_employee_id,
					'contextSnapshot', workflow.context_snapshot
				) order by workflow.id)
				from approval_workflow workflow
				where workflow.organization_id = period.organization_id
					and workflow.source_type = 'time_entry'
					and workflow.source_id = period.id
					and workflow.workflow_type in ('manual_time_submission', 'policy_clock_out')
					and workflow.status = 'pending'
			), '[]'::json) as "pendingCanonicalWorkflows",
			coalesce((
				select json_agg(workflow_row.value order by workflow_row.id)
				from (
					select workflow.id, json_build_object(
						'id', workflow.id,
						'organizationId', workflow.organization_id,
						'workflowType', workflow.workflow_type,
						'sourceType', workflow.source_type,
						'sourceId', workflow.source_id,
						'requesterEmployeeId', workflow.requester_employee_id,
						'status', workflow.status,
						'contextSnapshot', workflow.context_snapshot
					) as value
					from approval_workflow workflow
					where workflow.organization_id = period.organization_id
						and workflow.source_type = 'time_entry'
						and workflow.source_id = period.id
						and workflow.workflow_type in ('manual_time_submission', 'policy_clock_out')
						and workflow.status in ('approved', 'rejected')
					order by workflow.id
					limit 2
				) workflow_row
			), '[]'::json) as "terminalCanonicalWorkflows",
			coalesce((
				select json_agg(receipt_row.value order by receipt_row.id)
				from (
					select event.id, json_build_object(
						'organizationId', event.organization_id,
						'workflowId', event.workflow_id,
						'idempotencyKey', event.idempotency_key,
						'version', event.version,
						'eventIndex', event.event_index
					) as value
					from approval_workflow_event event
					join approval_workflow workflow
						on workflow.id = event.workflow_id
						and workflow.organization_id = event.organization_id
					where workflow.organization_id = period.organization_id
						and workflow.source_type = 'time_entry'
						and workflow.source_id = period.id
						and workflow.workflow_type in ('manual_time_submission', 'policy_clock_out')
						and workflow.status in ('approved', 'rejected')
						and event.version = 1
						and event.event_index = 0
					order by event.id
					limit 2
				) receipt_row
			), '[]'::json) as "terminalCanonicalReceipts",
			coalesce((
				select json_agg(request_row.value order by request_row.id)
				from (
					select request.id, json_build_object(
						'id', request.id,
						'organizationId', request.organization_id,
						'entityType', request.entity_type,
						'entityId', request.entity_id,
						'requestedBy', request.requested_by,
						'approverId', request.approver_id,
						'status', request.status,
						'approvedAt', request.approved_at,
						'metadata', request.metadata,
						'chainInstanceId', stage.chain_instance_id,
						'stageId', stage.id,
						'stepOrder', stage.step_order,
						'stageStatus', stage.status,
						'stageApprovalRequestId', stage.approval_request_id,
						'stageDecidedBy', stage.decided_by,
						'stageDecidedAt', stage.decided_at,
						'chainOrganizationId', chain.organization_id,
						'chainEntityType', chain.entity_type,
						'chainEntityId', chain.entity_id,
						'chainRequesterEmployeeId', chain.requester_employee_id,
						'chainStatus', chain.status,
						'chainCurrentStageOrder', chain.current_stage_order,
						'chainCompletedAt', chain.completed_at,
						'chainStageCount', case when chain.id is null then null else (
							select count(*)::integer
							from approval_chain_stage_instance cycle_stage
							where cycle_stage.organization_id = chain.organization_id
								and cycle_stage.chain_instance_id = chain.id
						) end
					) as value
					from approval_request request
					left join approval_chain_stage_instance stage
						on stage.approval_request_id = request.id
						and stage.organization_id = request.organization_id
					left join approval_chain_instance chain
						on chain.id = stage.chain_instance_id
						and chain.organization_id = stage.organization_id
					where request.organization_id = period.organization_id
						and request.entity_type = 'time_entry'
						and request.entity_id = period.id
						and request.requested_by = ${input.requesterEmployeeId}::uuid
						and request.status in ('approved', 'rejected')
						and request.metadata ? 'ordinarySubmission'
						and request.metadata -> 'ordinarySubmission' ->> 'key' = ${submissionKey}
					order by request.id
					limit 101
				) request_row
			), '[]'::json) as "terminalLegacyMarkedRequests",
			coalesce((
				select json_agg(request_row.value order by request_row.id)
				from (
					select request.id, json_build_object(
						'id', request.id,
						'organizationId', request.organization_id,
						'entityType', request.entity_type,
						'entityId', request.entity_id,
						'requestedBy', request.requested_by,
						'approverId', request.approver_id,
						'status', request.status,
						'approvedAt', request.approved_at,
						'metadata', request.metadata,
						'chainInstanceId', stage.chain_instance_id
					) as value
					from approval_request request
					left join approval_chain_stage_instance stage
						on stage.approval_request_id = request.id
						and stage.organization_id = request.organization_id
					where request.organization_id = period.organization_id
						and request.entity_type = 'time_entry'
						and request.entity_id = period.id
						and request.requested_by = ${input.requesterEmployeeId}::uuid
						and request.approver_id = ${input.requesterEmployeeId}::uuid
						and request.status = 'approved'
						and not (request.metadata ? 'ordinarySubmission')
						and request.metadata -> 'timeRequest' ->> 'kind' = ${input.kind}
						and request.metadata -> 'autoApproval' ->> 'reason' = 'requester_is_approver'
					order by request.id
					limit 2
				) request_row
			), '[]'::json) as "historicalLegacyAutoRequests",
			exists (
				select 1
				from approval_request request
				where request.organization_id = period.organization_id
					and request.entity_type = 'time_entry'
					and request.entity_id = period.id
					and request.requested_by = ${input.requesterEmployeeId}::uuid
					and request.status in ('approved', 'rejected')
					and request.metadata ? 'ordinarySubmission'
					and case
						when jsonb_typeof(request.metadata -> 'ordinarySubmission') <> 'object' then true
						else jsonb_typeof(request.metadata -> 'ordinarySubmission' -> 'key') <> 'string'
							or jsonb_typeof(request.metadata -> 'ordinarySubmission' -> 'submissionId') <> 'string'
							or request.metadata -> 'ordinarySubmission' ->> 'submissionId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
							or (select count(*) from jsonb_object_keys(request.metadata -> 'ordinarySubmission')) <> 2
							or request.metadata -> 'ordinarySubmission' ->> 'key' is distinct from ${submissionKey}
							or request.metadata -> 'ordinarySubmission' ->> 'submissionId' is distinct from ${input.submissionId}
					end
				limit 1
			) as "hasMalformedLegacyMarker"
		from work_period period
		join employee requester
			on requester.id = period.employee_id
			and requester.organization_id = period.organization_id
			and requester.is_active = true
		join time_record canonical
			on canonical.id = period.canonical_record_id
			and canonical.organization_id = period.organization_id
			and canonical.employee_id = period.employee_id
			and canonical.record_kind = 'work'
		where period.id = ${input.workPeriodId}::uuid
			and period.organization_id = ${input.organizationId}
			and period.employee_id = ${input.requesterEmployeeId}::uuid
		limit 2
		for update of period, requester, canonical
	`);
	const resultRows = rows(result);
	if (resultRows.length !== 1) return fail();
	const source = decodeLockedOrdinarySource(resultRows[0]);
	if (
		source.id !== input.workPeriodId ||
		source.organizationId !== input.organizationId ||
		source.employeeId !== input.requesterEmployeeId ||
		source.requesterUserId !== input.requesterUserId ||
		!source.clockInId ||
		!source.clockOutId ||
		!source.canonicalRecordId ||
		(source.approvalStatus !== "pending" &&
			source.approvalStatus !== "approved" &&
			source.approvalStatus !== "rejected") ||
		source.isActive !== false ||
		source.deletedAt !== null ||
		!(source.startTime instanceof Date) ||
		!(source.endTime instanceof Date) ||
		typeof source.wasAutoAdjusted !== "boolean" ||
		(source.originalEndTime !== null &&
			!(source.originalEndTime instanceof Date)) ||
		source.endTime.getTime() < source.startTime.getTime() ||
		!Number.isSafeInteger(source.durationMinutes) ||
		source.durationMinutes < 0 ||
		source.canonicalId !== source.canonicalRecordId ||
		source.canonicalOrganizationId !== input.organizationId ||
		source.canonicalEmployeeId !== input.requesterEmployeeId ||
		source.canonicalRecordKind !== "work" ||
		source.canonicalApprovalState !== source.approvalStatus ||
		!(source.canonicalStartAt instanceof Date) ||
		!(source.canonicalEndAt instanceof Date) ||
		!sameDate(source.canonicalStartAt, source.startTime) ||
		!sameDate(source.canonicalEndAt, source.endTime) ||
		source.canonicalDurationMinutes !== source.durationMinutes ||
		!Array.isArray(source.pendingLegacyRequests) ||
		!Array.isArray(source.pendingCanonicalWorkflows) ||
		!Array.isArray(source.terminalCanonicalWorkflows) ||
		!Array.isArray(source.terminalCanonicalReceipts) ||
		!Array.isArray(source.terminalLegacyMarkedRequests) ||
		!Array.isArray(source.historicalLegacyAutoRequests) ||
		typeof source.hasMalformedLegacyMarker !== "boolean"
	) {
		return fail();
	}
	return source;
}

function requestKind(
	request: PendingLegacyRequest,
	input: Pick<
		ExecuteOrdinaryWorkPeriodSubmissionInput,
		"kind" | "organizationId" | "submissionId" | "workPeriodId"
	>,
): Readonly<
	import("../domain-adapters/work-period-contract").OrdinaryWorkPeriodWorkflowPayload
> {
	try {
		return parseOrdinaryWorkPeriodWorkflowPayload(request.metadata, input.kind);
	} catch {
		// Generated legacy requests carry a private replay marker beside the payload.
	}
	try {
		const metadata = exactDataObject(request.metadata, ["timeRequest"]);
		const timeRequest = exactDataObject(metadata.timeRequest, ["kind"]);
		if (timeRequest.kind !== input.kind) return fail();
		return Object.freeze({
			timeRequest: Object.freeze({ kind: input.kind }),
		});
	} catch {
		// New submissions and canonical compatibility rows carry more evidence.
	}
	try {
		const metadata = exactDataObject(request.metadata, [
			"timeRequest",
			...(input.kind === "policy_clock_out"
				? ["breakPolicySnapshot", "surchargeSnapshot"]
				: ["surchargeSnapshot"]),
			"ordinarySubmission",
		]);
		const marker = exactDataObject(metadata.ordinarySubmission, [
			"key",
			"submissionId",
		]);
		const kind = parseOrdinaryWorkPeriodWorkflowPayload(
			{
				timeRequest: metadata.timeRequest,
				...(input.kind === "policy_clock_out"
					? { breakPolicySnapshot: metadata.breakPolicySnapshot }
					: {}),
				surchargeSnapshot: metadata.surchargeSnapshot,
			},
			input.kind,
		).timeRequest.kind;
		const expectedKey = deriveApprovalWorkflowId({
			organizationId: input.organizationId,
			workflowType: input.kind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
			allocationKey: input.submissionId,
		});
		if (
			canonicalSubmissionId(marker.submissionId) !== input.submissionId ||
			marker.key !== expectedKey
		) {
			return fail();
		}
		return parseOrdinaryWorkPeriodWorkflowPayload(
			{
				timeRequest: metadata.timeRequest,
				...(input.kind === "policy_clock_out"
					? { breakPolicySnapshot: metadata.breakPolicySnapshot }
					: {}),
				surchargeSnapshot: metadata.surchargeSnapshot,
			},
			kind,
		);
	} catch {
		// Canonical compatibility rows use workflow and stage envelopes.
	}
	try {
		const metadata = exactDataObject(request.metadata, [
			"workflow",
			"stage",
			"timeRequest",
			...(input.kind === "policy_clock_out"
				? ["breakPolicySnapshot", "surchargeSnapshot"]
				: ["surchargeSnapshot"]),
		]);
		return parseOrdinaryWorkPeriodWorkflowPayload(
			{
				timeRequest: metadata.timeRequest,
				...(input.kind === "policy_clock_out"
					? { breakPolicySnapshot: metadata.breakPolicySnapshot }
					: {}),
				surchargeSnapshot: metadata.surchargeSnapshot,
			},
			input.kind,
		);
	} catch {
		return fail();
	}
}

function validateCompatibilityMetadata(input: {
	metadata: unknown;
	organizationId: string;
	workflowId: string;
	kind: OrdinaryWorkPeriodApprovalKind;
	expectedStage?: { id: string; sequence: number };
}): { stageId: string; sequence: number } {
	const metadata = exactDataObject(input.metadata, [
		"workflow",
		"stage",
		"timeRequest",
		...(input.kind === "policy_clock_out"
			? ["breakPolicySnapshot", "surchargeSnapshot"]
			: ["surchargeSnapshot"]),
	]);
	const workflow = exactDataObject(metadata.workflow, ["id", "organizationId"]);
	const stage = exactDataObject(metadata.stage, ["id", "sequence"]);
	parseOrdinaryWorkPeriodWorkflowPayload(
		{
			timeRequest: metadata.timeRequest,
			...(input.kind === "policy_clock_out"
				? { breakPolicySnapshot: metadata.breakPolicySnapshot }
				: {}),
			surchargeSnapshot: metadata.surchargeSnapshot,
		},
		input.kind,
	);
	if (
		workflow.id !== input.workflowId ||
		workflow.organizationId !== input.organizationId ||
		typeof stage.id !== "string" ||
		!Number.isSafeInteger(stage.sequence) ||
		(stage.sequence as number) < 1 ||
		(input.expectedStage !== undefined &&
			(stage.id !== input.expectedStage.id ||
				stage.sequence !== input.expectedStage.sequence))
	) {
		return fail();
	}
	return { stageId: stage.id, sequence: stage.sequence as number };
}

function validatePendingOccupants(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
	source: LockedOrdinarySource,
	authority: ApprovalWriteGateResult,
	expectedWorkflowId: string,
	expectedPayload: Readonly<
		import("../domain-adapters/work-period-contract").OrdinaryWorkPeriodWorkflowPayload
	>,
): ResolvePolicyAndCreateApprovalResult | null {
	if (
		source.approvalStatus !== "pending" ||
		source.canonicalApprovalState !== "pending" ||
		classifyTimeApprovalRequest({
			metadata: { timeRequest: { kind: input.kind } },
			reason: input.reason,
			pendingChanges: source.pendingChanges,
		}) !== input.kind
	) {
		return fail();
	}
	if (
		source.pendingLegacyRequests.length > 1 ||
		source.pendingCanonicalWorkflows.length > 1
	) {
		return fail();
	}
	const legacy = source.pendingLegacyRequests[0]
		? (object(
				source.pendingLegacyRequests[0],
			) as unknown as PendingLegacyRequest)
		: null;
	const canonical = source.pendingCanonicalWorkflows[0]
		? object(source.pendingCanonicalWorkflows[0])
		: null;
	if (canonical) {
		if (
			canonical.workflowType !== input.kind ||
			canonical.requesterEmployeeId !== input.requesterEmployeeId ||
			canonical.id !== source.approvalWorkflowId ||
			((authority.mode === "canonical" || authority.mode === "complete") &&
				canonical.id !== expectedWorkflowId)
		) {
			return fail();
		}
		const canonicalPayload = parseOrdinaryWorkPeriodWorkflowPayload(
			canonical.contextSnapshot,
			input.kind,
		);
		if (JSON.stringify(canonicalPayload) !== JSON.stringify(expectedPayload)) {
			return fail();
		}
	}
	if (legacy) {
		let legacyPayload: Readonly<
			import("../domain-adapters/work-period-contract").OrdinaryWorkPeriodWorkflowPayload
		>;
		try {
			legacyPayload = requestKind(legacy, input);
		} catch {
			return fail();
		}
		if (
			legacyPayload.timeRequest.kind !== input.kind ||
			JSON.stringify(legacyPayload) !== JSON.stringify(expectedPayload) ||
			legacy.organizationId !== input.organizationId ||
			legacy.entityType !== "time_entry" ||
			legacy.entityId !== input.workPeriodId ||
			legacy.status !== "pending" ||
			legacy.requestedBy !== input.requesterEmployeeId ||
			typeof legacy.id !== "string"
		) {
			return fail();
		}
		if (authority.mode === "canonical" || authority.mode === "complete") {
			if (!canonical) return fail();
			validateCompatibilityMetadata({
				metadata: legacy.metadata,
				organizationId: input.organizationId,
				workflowId: expectedWorkflowId,
				kind: input.kind,
			});
			return null;
		}
		if (canonical && source.approvalWorkflowId !== canonical.id) return fail();
		return legacy.chainInstanceId
			? {
					kind: "chain_created",
					chainInstanceId: legacy.chainInstanceId,
					approvalRequestId: legacy.id,
				}
			: { kind: "default_created", approvalRequestId: legacy.id };
	}
	return null;
}

function sourceBindingEvidence(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
) {
	return {
		organizationId: input.organizationId,
		sourceType: "time_entry",
		sourceId: input.workPeriodId,
	};
}

async function bindSourceWorkflow(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	source: LockedOrdinarySource;
	workflowId: string;
	expectedApprovalStatus: "pending" | "approved";
}) {
	const result = await input.submission.dbService.db.execute(sql`
		update work_period set
			approval_workflow_id = ${input.workflowId},
			updated_at = now()
		where id = ${input.submission.workPeriodId}::uuid
			and organization_id = ${input.submission.organizationId}
			and employee_id = ${input.submission.requesterEmployeeId}::uuid
			and clock_in_id = ${input.source.clockInId}::uuid
			and clock_out_id = ${input.source.clockOutId}::uuid
			and canonical_record_id = ${input.source.canonicalRecordId}::uuid
			and approval_workflow_id is null
			and approval_status = ${input.expectedApprovalStatus}
			and start_time = ${input.source.startTime}
			and end_time = ${input.source.endTime}
			and duration_minutes = ${input.source.durationMinutes}
			and is_active = false
			and deleted_at is null
			and exists (
				select 1 from time_record canonical
				where canonical.id = work_period.canonical_record_id
					and canonical.organization_id = work_period.organization_id
					and canonical.employee_id = work_period.employee_id
					and canonical.record_kind = 'work'
					and canonical.approval_state = ${input.expectedApprovalStatus}
					and canonical.start_at = work_period.start_time
					and canonical.end_at = work_period.end_time
					and canonical.duration_minutes = work_period.duration_minutes
			)
		returning id, organization_id as "organizationId"
	`);
	const bound = rows(result);
	if (
		bound.length !== 1 ||
		object(bound[0]).id !== input.submission.workPeriodId ||
		object(bound[0]).organizationId !== input.submission.organizationId
	) {
		return fail();
	}
	return {
		...sourceBindingEvidence(input.submission),
		workflowId: input.workflowId,
		affectedRows: 1,
	};
}

async function verifySourceWorkflow(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	workflowId: string;
}) {
	const result = await input.submission.dbService.db.execute(sql`
		select id, organization_id as "organizationId"
		from work_period
		where id = ${input.submission.workPeriodId}::uuid
			and organization_id = ${input.submission.organizationId}
			and employee_id = ${input.submission.requesterEmployeeId}::uuid
			and approval_workflow_id = ${input.workflowId}::uuid
		limit 2
	`);
	const verified = rows(result);
	if (
		verified.length !== 1 ||
		object(verified[0]).id !== input.submission.workPeriodId ||
		object(verified[0]).organizationId !== input.submission.organizationId
	) {
		return fail();
	}
	return {
		...sourceBindingEvidence(input.submission),
		workflowId: input.workflowId,
		affectedRows: 1,
	};
}

async function legacyApprover(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
	approvalRequestId: string,
): Promise<string> {
	const request = await input.dbService.db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, approvalRequestId),
			eq(approvalRequest.organizationId, input.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.entityId, input.workPeriodId),
			eq(approvalRequest.requestedBy, input.requesterEmployeeId),
		),
		columns: { id: true, approverId: true },
	});
	if (!request || request.id !== approvalRequestId || !request.approverId) {
		return fail();
	}
	return request.approverId;
}

function representativeStage(snapshot: ApprovalWorkflowSnapshot) {
	const stage =
		snapshot.stages.find(
			(candidate) => candidate.sequence === snapshot.currentStageOrder,
		) ?? snapshot.stages.at(-1);
	if (!stage) return fail();
	return stage;
}

async function resolveCanonicalCompatibilityRequest(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	snapshot: ApprovalWorkflowSnapshot;
	expectedStatus: "pending" | "approved" | "rejected";
	stage?: { id: string; sequence: number };
}): Promise<{ id: string; approverId: string }> {
	const stage = input.stage ?? representativeStage(input.snapshot);
	const requests =
		await input.submission.dbService.db.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.submission.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.submission.workPeriodId),
				eq(approvalRequest.requestedBy, input.submission.requesterEmployeeId),
				eq(approvalRequest.status, input.expectedStatus),
				sql`${approvalRequest.metadata} -> 'workflow' ->> 'id' = ${input.snapshot.id}`,
				sql`${approvalRequest.metadata} -> 'workflow' ->> 'organizationId' = ${input.submission.organizationId}`,
				sql`${approvalRequest.metadata} -> 'stage' ->> 'id' = ${stage.id}`,
				sql`${approvalRequest.metadata} -> 'stage' ->> 'sequence' = ${String(stage.sequence)}`,
				sql`${approvalRequest.metadata} -> 'timeRequest' ->> 'kind' = ${input.submission.kind}`,
			),
			columns: {
				id: true,
				organizationId: true,
				entityType: true,
				entityId: true,
				requestedBy: true,
				approverId: true,
				status: true,
				metadata: true,
			},
			limit: 2,
		});
	if (requests.length !== 1) return fail();
	const request = requests[0];
	if (
		!request ||
		request.organizationId !== input.submission.organizationId ||
		request.entityType !== "time_entry" ||
		request.entityId !== input.submission.workPeriodId ||
		request.requestedBy !== input.submission.requesterEmployeeId ||
		request.status !== input.expectedStatus ||
		!request.approverId
	) {
		return fail();
	}
	validateCompatibilityMetadata({
		metadata: request.metadata,
		organizationId: input.submission.organizationId,
		workflowId: input.snapshot.id,
		kind: input.submission.kind,
		expectedStage: { id: stage.id, sequence: stage.sequence },
	});
	return { id: request.id, approverId: request.approverId };
}

function completeModeApprovalId(snapshot: ApprovalWorkflowSnapshot): string {
	const stage = representativeStage(snapshot);
	// Complete mode intentionally has no legacy row; start snapshots guarantee
	// deterministic stage and assignment identities for the public result.
	if (snapshot.status === "approved") return stage.id;
	return (
		stage.assignments.find((assignment) => assignment.status === "pending")
			?.id ?? fail()
	);
}

function hasValidApprovedAt(value: unknown): boolean {
	if (value instanceof Date) return !Number.isNaN(value.getTime());
	if (typeof value !== "string") return false;
	try {
		parseInstant(value);
		return true;
	} catch {
		return false;
	}
}

function validateLegacyAutoReplay(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	request: unknown;
}): { approvalRequestId: string; chainInstanceId: string | null } {
	const request = object(input.request);
	if (
		typeof request.id !== "string" ||
		request.organizationId !== input.submission.organizationId ||
		request.entityType !== "time_entry" ||
		request.entityId !== input.submission.workPeriodId ||
		request.requestedBy !== input.submission.requesterEmployeeId ||
		request.approverId !== input.submission.requesterEmployeeId ||
		request.status !== "approved" ||
		!hasValidApprovedAt(request.approvedAt) ||
		(request.chainInstanceId !== null &&
			request.chainInstanceId !== undefined &&
			typeof request.chainInstanceId !== "string")
	) {
		return fail();
	}
	let metadata: Record<string, unknown>;
	try {
		metadata = exactDataObject(request.metadata, [
			"timeRequest",
			...(input.submission.kind === "policy_clock_out"
				? ["breakPolicySnapshot", "surchargeSnapshot"]
				: ["surchargeSnapshot"]),
			"autoApproval",
		]);
		parseOrdinaryWorkPeriodWorkflowPayload(
			{
				timeRequest: metadata.timeRequest,
				...(input.submission.kind === "policy_clock_out"
					? { breakPolicySnapshot: metadata.breakPolicySnapshot }
					: {}),
				surchargeSnapshot: metadata.surchargeSnapshot,
			},
			input.submission.kind,
		);
	} catch {
		metadata = exactDataObject(request.metadata, [
			"timeRequest",
			"autoApproval",
		]);
		const timeRequest = exactDataObject(metadata.timeRequest, ["kind"]);
		if (timeRequest.kind !== input.submission.kind) return fail();
	}
	const autoApproval = exactDataObject(metadata.autoApproval, ["reason"]);
	if (autoApproval.reason !== "requester_is_approver") return fail();
	return {
		approvalRequestId: request.id,
		chainInstanceId:
			typeof request.chainInstanceId === "string"
				? request.chainInstanceId
				: null,
	};
}

function validateMarkedAutoRequest(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	request: unknown;
}): {
	request: Record<string, unknown>;
	key: string;
	kind: OrdinaryWorkPeriodApprovalKind;
} {
	const request = object(input.request);
	if (
		typeof request.id !== "string" ||
		request.organizationId !== input.submission.organizationId ||
		request.entityType !== "time_entry" ||
		request.entityId !== input.submission.workPeriodId ||
		request.requestedBy !== input.submission.requesterEmployeeId ||
		request.approverId !== input.submission.requesterEmployeeId ||
		request.status !== "approved" ||
		!hasValidApprovedAt(request.approvedAt)
	) {
		return fail();
	}
	const metadata = exactDataObject(request.metadata, [
		"timeRequest",
		...(input.submission.kind === "policy_clock_out"
			? ["breakPolicySnapshot", "surchargeSnapshot"]
			: ["surchargeSnapshot"]),
		"ordinarySubmission",
		"autoApproval",
	]);
	const payload = parseOrdinaryWorkPeriodWorkflowPayload({
		timeRequest: metadata.timeRequest,
		...(input.submission.kind === "policy_clock_out"
			? { breakPolicySnapshot: metadata.breakPolicySnapshot }
			: {}),
		surchargeSnapshot: metadata.surchargeSnapshot,
	});
	const marker = exactDataObject(metadata.ordinarySubmission, [
		"key",
		"submissionId",
	]);
	const autoApproval = exactDataObject(metadata.autoApproval, ["reason"]);
	if (
		typeof marker.key !== "string" ||
		canonicalSubmissionId(marker.submissionId) !==
			input.submission.submissionId ||
		autoApproval.reason !== "requester_is_approver"
	) {
		return fail();
	}
	return { request, key: marker.key, kind: payload.timeRequest.kind };
}

function resolveMarkedLegacyCycle(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	requests: unknown[];
	submissionKey: string;
}): { approvalRequestId: string; chainInstanceId: string | null } | null {
	if (input.requests.length > 100) return fail();
	const matching = input.requests.flatMap((request) => {
		const validated = validateMarkedAutoRequest({
			submission: input.submission,
			request,
		});
		if (validated.key !== input.submissionKey) return [];
		if (validated.kind !== input.submission.kind) return fail();
		return [validated.request];
	});
	if (matching.length === 0) return null;
	const chainIds = new Set(
		matching.flatMap((request) =>
			typeof request.chainInstanceId === "string"
				? [request.chainInstanceId]
				: [],
		),
	);
	if (chainIds.size === 0) {
		if (matching.length !== 1 || matching[0]?.chainInstanceId !== null) {
			return fail();
		}
		return {
			approvalRequestId: matching[0].id as string,
			chainInstanceId: null,
		};
	}
	if (
		chainIds.size !== 1 ||
		matching.some((request) => typeof request.chainInstanceId !== "string")
	) {
		return fail();
	}
	const chainInstanceId = [...chainIds][0] ?? fail();
	const stageIds = new Set<string>();
	const stepOrders = new Set<number>();
	for (const request of matching) {
		if (
			request.chainInstanceId !== chainInstanceId ||
			request.chainOrganizationId !== input.submission.organizationId ||
			request.chainEntityType !== "time_entry" ||
			request.chainEntityId !== input.submission.workPeriodId ||
			request.chainRequesterEmployeeId !==
				input.submission.requesterEmployeeId ||
			request.chainStatus !== "approved" ||
			!hasValidApprovedAt(request.chainCompletedAt) ||
			request.stageStatus !== "approved" ||
			request.stageApprovalRequestId !== request.id ||
			request.stageDecidedBy !== input.submission.requesterEmployeeId ||
			!hasValidApprovedAt(request.stageDecidedAt) ||
			typeof request.stageId !== "string" ||
			!Number.isSafeInteger(request.stepOrder) ||
			(request.stepOrder as number) < 1 ||
			request.chainStageCount !== matching.length
		) {
			return fail();
		}
		stageIds.add(request.stageId);
		stepOrders.add(request.stepOrder as number);
	}
	if (
		stageIds.size !== matching.length ||
		stepOrders.size !== matching.length
	) {
		return fail();
	}
	const final = matching.toSorted(
		(left, right) => (right.stepOrder as number) - (left.stepOrder as number),
	)[0];
	if (
		!final ||
		final.stepOrder !== final.chainCurrentStageOrder ||
		matching.filter((request) => request.stepOrder === final.stepOrder)
			.length !== 1
	) {
		return fail();
	}
	return {
		approvalRequestId: final.id as string,
		chainInstanceId,
	};
}

async function resolveTerminalReplay(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	source: LockedOrdinarySource;
	authority: ApprovalWriteGateResult;
	expectedWorkflowId: string;
}): Promise<{
	result: ResolvePolicyAndCreateApprovalResult;
	approverEmployeeId: string;
} | null> {
	if (input.source.approvalStatus === "pending") return null;
	const canonicalAuthority =
		input.authority.mode === "canonical" || input.authority.mode === "complete";
	if (
		(input.source.approvalStatus !== "approved" &&
			input.source.approvalStatus !== "rejected") ||
		input.source.canonicalApprovalState !== input.source.approvalStatus ||
		(canonicalAuthority && input.source.terminalCanonicalWorkflows.length > 1)
	) {
		return fail();
	}
	const canonical = input.source.terminalCanonicalWorkflows[0];
	if (canonical) {
		if (input.source.terminalCanonicalReceipts.length !== 1) return fail();
		const workflow = object(canonical);
		const receipt = object(input.source.terminalCanonicalReceipts[0]);
		const submissionKey = deriveApprovalWorkflowId({
			organizationId: input.submission.organizationId,
			workflowType: input.submission.kind,
			sourceType: "time_entry",
			sourceId: input.submission.workPeriodId,
			allocationKey: input.submission.submissionId,
		});
		if (
			receipt.organizationId !== input.submission.organizationId ||
			receipt.workflowId !== workflow.id ||
			receipt.idempotencyKey !== submissionKey ||
			receipt.version !== 1 ||
			receipt.eventIndex !== 0
		) {
			return fail();
		}
	} else if (input.source.terminalCanonicalReceipts.length !== 0) {
		return fail();
	}
	if (canonical && canonicalAuthority) {
		const workflow = object(canonical);
		if (
			workflow.id !== input.expectedWorkflowId ||
			workflow.id !== input.source.approvalWorkflowId ||
			workflow.organizationId !== input.submission.organizationId ||
			workflow.workflowType !== input.submission.kind ||
			workflow.sourceType !== "time_entry" ||
			workflow.sourceId !== input.submission.workPeriodId ||
			workflow.requesterEmployeeId !== input.submission.requesterEmployeeId ||
			workflow.status !== input.source.approvalStatus
		) {
			return fail();
		}
		const workflowPayload = parseOrdinaryWorkPeriodWorkflowPayload(
			workflow.contextSnapshot,
			input.submission.kind,
		);
		const snapshot = await input.submission.context.repository.loadSnapshot({
			organizationId: input.submission.organizationId,
			workflowId: input.expectedWorkflowId,
		});
		if (
			snapshot.id !== input.expectedWorkflowId ||
			snapshot.organizationId !== input.submission.organizationId ||
			snapshot.workflowType !== input.submission.kind ||
			snapshot.sourceType !== "time_entry" ||
			snapshot.sourceId !== input.submission.workPeriodId ||
			snapshot.requesterEmployeeId !== input.submission.requesterEmployeeId ||
			snapshot.status !== input.source.approvalStatus ||
			snapshot.completedAt === null ||
			snapshot.stages.length === 0
		) {
			return fail();
		}
		const snapshotPayload = parseOrdinaryWorkPeriodWorkflowPayload(
			snapshot.contextSnapshot,
			input.submission.kind,
		);
		if (
			JSON.stringify(snapshotPayload) !== JSON.stringify(workflowPayload) ||
			snapshotPayload.surchargeSnapshot?.evaluatedAt !==
				instantToCanonicalString(
					instantFromDate(
						input.source.wasAutoAdjusted
							? (input.source.originalEndTime ?? fail())
							: input.source.endTime,
					),
				) ||
			(input.submission.kind === "policy_clock_out" &&
				snapshotPayload.breakPolicySnapshot?.evaluatedAt !==
					instantToCanonicalString(
						instantFromDate(
							input.source.wasAutoAdjusted
								? (input.source.originalEndTime ?? fail())
								: input.source.endTime,
						),
					))
		) {
			return fail();
		}
		const requesterAutoCompleted =
			input.source.approvalStatus === "approved" &&
			snapshot.stages.every(
				(stage) =>
					stage.activationMode === "requester_auto_approve" &&
					stage.status === "approved" &&
					stage.assignments.length === 0,
			);
		if (!requesterAutoCompleted) {
			const firstStage = snapshot.stages.find((stage) => stage.sequence === 1);
			const firstAssignment = firstStage?.assignments[0];
			if (
				firstStage?.activationMode !== "human" ||
				(firstStage.status !== "approved" &&
					firstStage.status !== "rejected") ||
				!firstAssignment ||
				typeof firstAssignment.approverEmployeeId !== "string"
			) {
				return fail();
			}
			const approvalRequestId =
				input.authority.mode === "canonical"
					? (
							await resolveCanonicalCompatibilityRequest({
								submission: input.submission,
								snapshot,
								expectedStatus: firstStage.status,
								stage: { id: firstStage.id, sequence: firstStage.sequence },
							})
						).id
					: firstAssignment.id;
			return {
				result:
					snapshot.stages.length > 1
						? {
								kind: "chain_created",
								chainInstanceId: snapshot.id,
								approvalRequestId,
							}
						: { kind: "default_created", approvalRequestId },
				approverEmployeeId: firstAssignment.approverEmployeeId,
			};
		}
		const approvalRequestId = completeModeApprovalId(snapshot);
		return {
			result: {
				kind: "auto_completed",
				chainInstanceId: snapshot.stages.length > 1 ? snapshot.id : null,
				approvalRequestId,
				reason: "requester_is_approver",
			},
			approverEmployeeId: input.submission.requesterEmployeeId,
		};
	}
	if (canonicalAuthority) {
		return fail();
	}
	if (input.source.hasMalformedLegacyMarker) return fail();
	const manualRequests = input.source.terminalLegacyMarkedRequests.flatMap(
		(value) => {
			const request = object(value);
			return Object.hasOwn(object(request.metadata), "autoApproval")
				? []
				: [request];
		},
	);
	if (manualRequests.length > 0) {
		if (
			manualRequests.length !==
				input.source.terminalLegacyMarkedRequests.length ||
			manualRequests.length > 100
		) {
			return fail();
		}
		const payloads = manualRequests.map((request) =>
			requestKind(request as unknown as PendingLegacyRequest, input.submission),
		);
		const payload = payloads[0] ?? fail();
		const evaluatedAt = instantToCanonicalString(
			instantFromDate(
				input.source.wasAutoAdjusted
					? (input.source.originalEndTime ?? fail())
					: input.source.endTime,
			),
		);
		if (
			input.source.pendingChanges !== null ||
			(!input.source.wasAutoAdjusted &&
				input.source.originalEndTime !== null) ||
			payloads.some(
				(candidate) => JSON.stringify(candidate) !== JSON.stringify(payload),
			) ||
			manualRequests.some(
				(request) =>
					request.organizationId !== input.submission.organizationId ||
					request.entityType !== "time_entry" ||
					request.entityId !== input.submission.workPeriodId ||
					request.requestedBy !== input.submission.requesterEmployeeId ||
					(request.status !== "approved" && request.status !== "rejected") ||
					typeof request.approverId !== "string" ||
					typeof request.id !== "string",
			) ||
			payload.timeRequest.kind !== input.submission.kind ||
			payload.surchargeSnapshot?.evaluatedAt !== evaluatedAt ||
			(input.submission.kind === "policy_clock_out" &&
				payload.breakPolicySnapshot?.evaluatedAt !== evaluatedAt)
		) {
			return fail();
		}
		const observed = input.source.terminalCanonicalWorkflows[0];
		if (observed) {
			const workflow = object(observed);
			const workflowPayload = parseOrdinaryWorkPeriodWorkflowPayload(
				workflow.contextSnapshot,
				input.submission.kind,
			);
			if (
				workflow.id !== input.source.approvalWorkflowId ||
				workflow.organizationId !== input.submission.organizationId ||
				workflow.workflowType !== input.submission.kind ||
				workflow.sourceType !== "time_entry" ||
				workflow.sourceId !== input.submission.workPeriodId ||
				workflow.requesterEmployeeId !== input.submission.requesterEmployeeId ||
				workflow.status !== input.source.approvalStatus ||
				JSON.stringify(workflowPayload) !== JSON.stringify(payload)
			) {
				return fail();
			}
		}
		if (manualRequests.length === 1) {
			const request = manualRequests[0] ?? fail();
			if (
				request.status !== input.source.approvalStatus ||
				request.chainInstanceId !== null
			) {
				return fail();
			}
			return {
				result: {
					kind: "default_created",
					approvalRequestId: request.id as string,
				},
				approverEmployeeId: request.approverId as string,
			};
		}
		const chainInstanceId = manualRequests[0]?.chainInstanceId;
		const stageIds = new Set<string>();
		const sequences = new Set<number>();
		for (const request of manualRequests) {
			if (
				typeof chainInstanceId !== "string" ||
				request.chainInstanceId !== chainInstanceId ||
				request.chainOrganizationId !== input.submission.organizationId ||
				request.chainEntityType !== "time_entry" ||
				request.chainEntityId !== input.submission.workPeriodId ||
				request.chainRequesterEmployeeId !==
					input.submission.requesterEmployeeId ||
				request.chainStatus !== input.source.approvalStatus ||
				!hasValidApprovedAt(request.chainCompletedAt) ||
				request.chainStageCount !== manualRequests.length ||
				request.stageStatus !== request.status ||
				request.stageApprovalRequestId !== request.id ||
				request.stageDecidedBy !== request.approverId ||
				!hasValidApprovedAt(request.stageDecidedAt) ||
				typeof request.stageId !== "string" ||
				!Number.isSafeInteger(request.stepOrder)
			) {
				return fail();
			}
			stageIds.add(request.stageId);
			sequences.add(request.stepOrder as number);
		}
		const ordered = manualRequests.toSorted(
			(left, right) => (left.stepOrder as number) - (right.stepOrder as number),
		);
		const first = ordered[0] ?? fail();
		const final = ordered.at(-1) ?? fail();
		if (
			stageIds.size !== manualRequests.length ||
			sequences.size !== manualRequests.length ||
			first.stepOrder !== 1 ||
			final.stepOrder !== final.chainCurrentStageOrder ||
			final.status !== input.source.approvalStatus
		) {
			return fail();
		}
		return {
			result: {
				kind: "chain_created",
				chainInstanceId: chainInstanceId as string,
				approvalRequestId: first.id as string,
			},
			approverEmployeeId: first.approverId as string,
		};
	}
	const marked = resolveMarkedLegacyCycle({
		submission: input.submission,
		requests: input.source.terminalLegacyMarkedRequests,
		submissionKey: deriveApprovalWorkflowId({
			organizationId: input.submission.organizationId,
			workflowType: input.submission.kind,
			sourceType: "time_entry",
			sourceId: input.submission.workPeriodId,
			allocationKey: input.submission.submissionId,
		}),
	});
	if (marked) {
		return {
			result: {
				kind: "auto_completed",
				chainInstanceId: marked.chainInstanceId,
				approvalRequestId: marked.approvalRequestId,
				reason: "requester_is_approver",
			},
			approverEmployeeId: input.submission.requesterEmployeeId,
		};
	}
	if (input.source.historicalLegacyAutoRequests.length > 1) return fail();
	const legacy = input.source.historicalLegacyAutoRequests[0];
	if (!legacy || input.source.historicalLegacyAutoRequests.length !== 1) {
		return fail();
	}
	const evidence = validateLegacyAutoReplay({
		submission: input.submission,
		request: legacy,
	});
	if (evidence.chainInstanceId !== null) return fail();
	return {
		result: {
			kind: "auto_completed",
			chainInstanceId: evidence.chainInstanceId,
			approvalRequestId: evidence.approvalRequestId,
			reason: "requester_is_approver",
		},
		approverEmployeeId: input.submission.requesterEmployeeId,
	};
}

function descriptor(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	source: LockedOrdinarySource;
	result: ResolvePolicyAndCreateApprovalResult;
	authority: ApprovalWriteGateResult;
	approverEmployeeId: string | null;
	submissionKey: string;
	maintenance: WorkPeriodMaintenanceFacts | null;
}): WorkPeriodPostCommitDescriptor {
	return Object.freeze({
		disposition:
			input.authority.mode === "canonical" ||
			input.authority.mode === "complete"
				? "observe"
				: "dispatch",
		dedupeKey: `${input.submissionKey}:${input.result.kind}`,
		event: input.result.kind === "auto_completed" ? "approved" : "pending",
		organizationId: input.submission.organizationId,
		workPeriodId: input.submission.workPeriodId,
		requesterEmployeeId: input.submission.requesterEmployeeId,
		approverEmployeeId: input.approverEmployeeId,
		kind: input.submission.kind,
		startTime: instantToCanonicalString(
			instantFromDate(input.source.startTime),
		),
		endTime: instantToCanonicalString(instantFromDate(input.source.endTime)),
		durationMinutes: input.source.durationMinutes,
		reason: input.submission.reason || null,
		maintenance: input.maintenance,
	});
}

async function executeOrdinaryWorkPeriodSubmission(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
): Promise<{
	result: ResolvePolicyAndCreateApprovalResult;
	disposition: "executed" | "replayed";
	postCommit: WorkPeriodPostCommitDescriptor | null;
}> {
	const submissionId = canonicalSubmissionId(input.submissionId);
	if (input.context.dbService.db !== input.dbService.db) fail();
	const authority = await input.context.writeGate.acquire({
		organizationId: input.organizationId,
		workflowType: input.kind,
	});
	const fixedGate = fixedWriteGate(input, authority);
	const context = {
		...input.context,
		writeGate: fixedGate,
		compatibilityWriter:
			input.context.compatibilityWriter.withWriteGate(fixedGate),
	} as ApprovalWorkflowTransactionContext;
	await lockOrdinarySource(input);
	const submissionKey = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: input.kind,
		sourceType: "time_entry",
		sourceId: input.workPeriodId,
		allocationKey: submissionId,
	});
	const expectedWorkflowId = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: input.kind,
		sourceType: "time_entry",
		sourceId: input.workPeriodId,
		allocationKey: submissionKey,
	});
	const source = await loadOrdinarySource(input, submissionKey);
	const terminalReplay = await resolveTerminalReplay({
		submission: input,
		source,
		authority,
		expectedWorkflowId,
	});
	if (terminalReplay) {
		return {
			result: terminalReplay.result,
			disposition: "replayed",
			postCommit: null,
		};
	}
	const markerDescriptor =
		typeof source.pendingChanges === "object" &&
		source.pendingChanges !== null &&
		!Array.isArray(source.pendingChanges)
			? Object.getOwnPropertyDescriptor(
					source.pendingChanges,
					"ordinarySubmission",
				)
			: undefined;
	if (
		markerDescriptor &&
		(!markerDescriptor.enumerable || !("value" in markerDescriptor))
	)
		fail();
	const historicalManualSubmission =
		input.kind === "manual_time_submission" && markerDescriptor === undefined;
	if (
		historicalManualSubmission &&
		(authority.mode === "canonical" || authority.mode === "complete")
	)
		fail();
	const breakPolicySnapshot =
		input.kind === "policy_clock_out"
			? policyClockOutBreakSnapshotFromPendingChanges(
					source.pendingChanges,
					instantToCanonicalString(instantFromDate(source.endTime)),
				)
			: undefined;
	const surchargeSnapshot = historicalManualSubmission
		? undefined
		: policyClockOutSurchargeSnapshotFromPendingChanges(
				source.pendingChanges,
				instantToCanonicalString(instantFromDate(source.endTime)),
			);
	const payload = historicalManualSubmission
		? Object.freeze({
				timeRequest: Object.freeze({ kind: "manual_time_submission" as const }),
			})
		: parseOrdinaryWorkPeriodWorkflowPayload(
				{
					timeRequest: { kind: input.kind },
					...(breakPolicySnapshot ? { breakPolicySnapshot } : {}),
					...(surchargeSnapshot ? { surchargeSnapshot } : {}),
				},
				input.kind,
			);
	const legacyMetadata = {
		...payload,
		ordinarySubmission: { key: submissionKey, submissionId },
	};
	const replay = validatePendingOccupants(
		input,
		source,
		authority,
		expectedWorkflowId,
		payload,
	);
	if (replay) {
		return {
			result: replay,
			disposition: "replayed",
			postCommit: null,
		};
	}
	if (historicalManualSubmission) fail();
	let terminalMaintenance: WorkPeriodMaintenanceFacts | null = null;

	if (
		authority.mode === "legacy" ||
		authority.mode === "shadow" ||
		authority.mode === "ready"
	) {
		let created: ResolvePolicyAndCreateApprovalResult | null = null;
		let captureCount = 0;
		const coordinator = createLegacyApprovalWriteCoordinator({
			writeGate: fixedGate,
			compatibilityWriter: context.compatibilityWriter,
		});
		const result = await coordinator.execute({
			organizationId: input.organizationId,
			workflowType: input.kind,
			sourceIdentity: {
				organizationId: input.organizationId,
				workflowType: input.kind,
				sourceType: "time_entry",
				sourceId: input.workPeriodId,
			},
			actor: {
				kind: "employee",
				employeeId: input.requesterEmployeeId,
				userId: null,
			},
			idempotencyKey: submissionKey,
			expectedVersion: null,
			captureState: async () => {
				captureCount += 1;
				if (captureCount === 1) {
					return await captureOrdinaryWorkPeriodLegacyPreSubmissionState({
						dbService: input.dbService,
						organizationId: input.organizationId,
						workPeriodId: input.workPeriodId,
						expectedKind: input.kind,
						expectedRequesterEmployeeId: input.requesterEmployeeId,
					});
				}
				if (!created) return fail();
				return await captureOrdinaryWorkPeriodLegacyState({
					dbService: input.dbService,
					organizationId: input.organizationId,
					workPeriodId: input.workPeriodId,
					expectedKind: input.kind,
					expectedRequesterEmployeeId: input.requesterEmployeeId,
					approvalRequestId: created.approvalRequestId,
					expectedRequestStatus:
						created.kind === "auto_completed" ? "approved" : "pending",
				});
			},
			mutate: async () => {
				const currentDefaultApproverId =
					await getPrimaryEligibleManagerIdForRequester({
						db: input.dbService.db,
						requesterEmployeeId: input.requesterEmployeeId,
						organizationId: input.organizationId,
					});
				const resolved = await Effect.runPromiseExit(
					resolvePolicyAndCreateApproval(input.dbService, {
						context: {
							organizationId: input.organizationId,
							approvalType: "time_entry",
							requesterEmployeeId: input.requesterEmployeeId,
							teamId: input.teamId,
							locationId: null,
							absenceCategoryId: null,
							travelExpenseAmount: null,
							overtimeRisk: input.overtimeRisk,
							employeeGroupIds: [],
							entityType: "time_entry",
							entityId: input.workPeriodId,
						},
						defaultApproverId: currentDefaultApproverId,
						transactionBehavior: "existing",
						reason: input.reason,
						metadata: legacyMetadata,
					}),
				);
				if (Exit.isFailure(resolved)) {
					const failure = Option.getOrNull(Cause.failureOption(resolved.cause));
					if (
						failure instanceof ValidationError &&
						failure._tag === "ValidationError" &&
						failure.field === "managerId" &&
						failure.message === "No manager assigned to approve time changes"
					) {
						throw new ResolverManagerValidationError();
					}
					if (failure) throw failure;
					return fail();
				}
				created = resolved.value;
				if (created.kind === "auto_completed") {
					const finalized =
						await finalizeOrdinaryWorkPeriodTerminalInTransaction({
							dbService: input.dbService,
							organizationId: input.organizationId,
							workPeriodId: input.workPeriodId,
							expectedApprovalWorkflowId: null,
							requesterEmployeeId: input.requesterEmployeeId,
							actorEmployeeId: input.requesterEmployeeId,
							actorUserId: input.requesterUserId,
							kind: input.kind,
							evidence: {
								mode: "legacy",
								approvalRequestId: created.approvalRequestId,
								requestMode: "requester_auto_completed",
								expectedStatus: "approved",
							},
							transition: {
								kind: "approve",
								reason: "requester_is_approver",
							},
							finalizedAt: systemClock.nowInstant(),
						});
					terminalMaintenance = finalized.maintenance;
				}
				return created;
			},
			afterMirror: async (observed) => {
				if (!created) return fail();
				await bindSourceWorkflow({
					submission: input,
					source,
					workflowId: observed.snapshot.id,
					expectedApprovalStatus:
						created.kind === "auto_completed" ? "approved" : "pending",
				});
			},
		});
		const approverEmployeeId =
			result.kind === "auto_completed"
				? input.requesterEmployeeId
				: await legacyApprover(input, result.approvalRequestId);
		return {
			result,
			disposition: "executed",
			postCommit: descriptor({
				submission: input,
				source,
				result,
				authority,
				approverEmployeeId,
				submissionKey,
				maintenance: terminalMaintenance,
			}),
		};
	}

	const currentDefaultApproverId =
		await getPrimaryEligibleManagerIdForRequester({
			db: input.dbService.db,
			requesterEmployeeId: input.requesterEmployeeId,
			organizationId: input.organizationId,
		});
	const started = await startApprovalWorkflow({
		context,
		organizationId: input.organizationId,
		workflowType: input.kind,
		sourceIdentity: {
			organizationId: input.organizationId,
			workflowType: input.kind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
		},
		requesterEmployeeId: input.requesterEmployeeId,
		actor: {
			kind: "employee",
			employeeId: input.requesterEmployeeId,
			userId: input.requesterUserId,
		},
		submissionKey,
		defaultApproverEmployeeId: currentDefaultApproverId,
		routingContext: {
			organizationId: input.organizationId,
			workflowType: input.kind,
			source: { type: "time_entry", id: input.workPeriodId },
			requesterEmployeeId: input.requesterEmployeeId,
			teamIds: input.teamId ? [input.teamId] : [],
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: input.overtimeRisk,
			employeeGroupIds: [],
		},
		contextSnapshot:
			payload as unknown as import("../workflow/ports").JsonObject,
		displayProjection: {
			displayPayload: {
				kind: input.kind,
				startTime: instantToCanonicalString(instantFromDate(source.startTime)),
				endTime: instantToCanonicalString(instantFromDate(source.endTime)),
				durationMinutes: source.durationMinutes,
			},
			searchText:
				input.kind === "manual_time_submission"
					? "manual time submission"
					: "policy clock-out",
		},
		bindSourceWorkflow: (workflowId) =>
			bindSourceWorkflow({
				submission: input,
				source,
				workflowId,
				expectedApprovalStatus: "pending",
			}),
		verifySourceWorkflow: (workflowId) =>
			verifySourceWorkflow({ submission: input, workflowId }),
	});
	if (started.snapshot.id !== expectedWorkflowId) return fail();
	if (started.terminal) {
		if (started.status !== "approved") return fail();
		const finalized =
			await finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction({
				dbService: input.dbService,
				organizationId: input.organizationId,
				workPeriodId: input.workPeriodId,
				expectedApprovalWorkflowId: started.snapshot.id,
				requesterEmployeeId: input.requesterEmployeeId,
				actorEmployeeId: input.requesterEmployeeId,
				actorUserId: input.requesterUserId,
				kind: input.kind,
				evidence: {
					mode: "canonical",
					workflowId: started.snapshot.id,
					payload,
				},
				transition: { kind: "approve", reason: "requester_is_approver" },
				finalizedAt: started.snapshot.completedAt ?? systemClock.nowInstant(),
			});
		terminalMaintenance = finalized.maintenance;
	}
	if (started.kind === "created" && authority.mode === "canonical") {
		await context.compatibilityWriter.mirrorCanonicalToLegacy({
			result: {
				snapshot: started.snapshot,
				events: started.events,
				projection: started.projection,
				outbox: started.outbox,
			},
		});
	}
	const activeAssignment = started.snapshot.stages
		.flatMap((stage) => stage.assignments)
		.find((assignment) => assignment.status === "pending");
	const canonicalCompatibility =
		authority.mode === "canonical" && !started.terminal
			? await resolveCanonicalCompatibilityRequest({
					submission: input,
					snapshot: started.snapshot,
					expectedStatus: "pending",
				})
			: null;
	const approvalRequestId =
		canonicalCompatibility?.id ?? completeModeApprovalId(started.snapshot);
	const result: ResolvePolicyAndCreateApprovalResult = started.terminal
		? {
				kind: "auto_completed",
				chainInstanceId:
					started.snapshot.stages.length > 1 ? started.snapshot.id : null,
				approvalRequestId,
				reason: "requester_is_approver",
			}
		: started.snapshot.stages.length > 1
			? {
					kind: "chain_created",
					chainInstanceId: started.snapshot.id,
					approvalRequestId,
				}
			: {
					kind: "default_created",
					approvalRequestId,
				};
	return {
		result,
		disposition: started.kind === "existing" ? "replayed" : "executed",
		postCommit:
			started.kind === "existing"
				? null
				: descriptor({
						submission: input,
						source,
						result,
						authority,
						approverEmployeeId:
							result.kind === "auto_completed"
								? input.requesterEmployeeId
								: (canonicalCompatibility?.approverId ??
									activeAssignment?.approverEmployeeId ??
									null),
						submissionKey,
						maintenance: terminalMaintenance,
					}),
	};
}

export async function executeOrdinaryWorkPeriodSubmissionInTransaction(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
): Promise<{
	result: ResolvePolicyAndCreateApprovalResult;
	disposition: "executed" | "replayed";
	postCommit: WorkPeriodPostCommitDescriptor | null;
}> {
	try {
		return await executeOrdinaryWorkPeriodSubmission(input);
	} catch (error) {
		if (
			error instanceof ResolverManagerValidationError &&
			error.field === "managerId" &&
			error.message === "No manager assigned to approve time changes"
		) {
			throw error;
		}
		throw new OrdinaryWorkPeriodSubmissionError();
	}
}
