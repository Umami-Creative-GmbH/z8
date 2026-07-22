import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { approvalRequest } from "@/db/schema";
import {
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { createLegacyApprovalWriteCoordinator } from "../domain-adapters/legacy-write-coordinator";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	type OrdinaryWorkPeriodApprovalKind,
	parseOrdinaryWorkPeriodWorkflowPayload,
} from "../domain-adapters/work-period-contract";
import {
	captureOrdinaryWorkPeriodLegacyPreSubmissionState,
	captureOrdinaryWorkPeriodLegacyState,
} from "../domain-adapters/work-period-legacy-state";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import type { ApprovalPolicyOvertimeRisk } from "../policies/types";
import { classifyTimeApprovalRequest } from "../time-request-kind";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import type {
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
}

interface PendingLegacyRequest {
	id: string;
	requestedBy?: string;
	approverId?: string;
	reason?: string | null;
	metadata?: unknown;
	kind?: unknown;
	chainInstanceId?: string | null;
}

function fail(): never {
	throw new Error("Ordinary work-period submission failed");
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
					'requestedBy', request.requested_by,
					'approverId', request.approver_id,
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
			), '[]'::json) as "pendingCanonicalWorkflows"
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
	const source = object(resultRows[0]) as unknown as LockedOrdinarySource;
	if (
		source.id !== input.workPeriodId ||
		source.organizationId !== input.organizationId ||
		source.employeeId !== input.requesterEmployeeId ||
		source.requesterUserId !== input.requesterUserId ||
		!source.clockInId ||
		!source.clockOutId ||
		!source.canonicalRecordId ||
		source.approvalStatus !== "pending" ||
		source.isActive !== false ||
		source.deletedAt !== null ||
		!(source.startTime instanceof Date) ||
		!(source.endTime instanceof Date) ||
		!Number.isSafeInteger(source.durationMinutes) ||
		source.durationMinutes < 0 ||
		source.canonicalId !== source.canonicalRecordId ||
		source.canonicalOrganizationId !== input.organizationId ||
		source.canonicalEmployeeId !== input.requesterEmployeeId ||
		source.canonicalRecordKind !== "work" ||
		source.canonicalApprovalState !== "pending" ||
		!(source.canonicalStartAt instanceof Date) ||
		!(source.canonicalEndAt instanceof Date) ||
		!sameDate(source.canonicalStartAt, source.startTime) ||
		!sameDate(source.canonicalEndAt, source.endTime) ||
		source.canonicalDurationMinutes !== source.durationMinutes ||
		!Array.isArray(source.pendingLegacyRequests) ||
		!Array.isArray(source.pendingCanonicalWorkflows) ||
		classifyTimeApprovalRequest({
			metadata: { timeRequest: { kind: input.kind } },
			reason: input.reason,
			pendingChanges: source.pendingChanges,
			hasRelationalCorrectionEvidence: false,
		}) !== input.kind
	) {
		return fail();
	}
	return source;
}

function requestKind(
	request: PendingLegacyRequest,
): OrdinaryWorkPeriodApprovalKind {
	if (
		request.kind === "manual_time_submission" ||
		request.kind === "policy_clock_out"
	) {
		return request.kind;
	}
	return parseOrdinaryWorkPeriodWorkflowPayload(request.metadata).timeRequest
		.kind;
}

function validatePendingOccupants(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
	source: LockedOrdinarySource,
): ResolvePolicyAndCreateApprovalResult | null {
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
			canonical.id !== source.approvalWorkflowId
		) {
			return fail();
		}
		parseOrdinaryWorkPeriodWorkflowPayload(
			canonical.contextSnapshot,
			input.kind,
		);
	}
	if (legacy) {
		let kind: OrdinaryWorkPeriodApprovalKind;
		try {
			kind = requestKind(legacy);
		} catch {
			return fail();
		}
		if (
			kind !== input.kind ||
			(typeof legacy.requestedBy === "string" &&
				legacy.requestedBy !== input.requesterEmployeeId) ||
			typeof legacy.id !== "string"
		) {
			return fail();
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

function descriptor(input: {
	submission: ExecuteOrdinaryWorkPeriodSubmissionInput;
	source: LockedOrdinarySource;
	result: ResolvePolicyAndCreateApprovalResult;
	authority: ApprovalWriteGateResult;
	approverEmployeeId: string | null;
	submissionKey: string;
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
	});
}

export async function executeOrdinaryWorkPeriodSubmissionInTransaction(
	input: ExecuteOrdinaryWorkPeriodSubmissionInput,
): Promise<{
	result: ResolvePolicyAndCreateApprovalResult;
	postCommit: WorkPeriodPostCommitDescriptor | null;
}> {
	if (input.context.dbService.db !== input.dbService.db) fail();
	const payload = parseOrdinaryWorkPeriodWorkflowPayload(
		{ timeRequest: { kind: input.kind } },
		input.kind,
	);
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
	const source = await loadOrdinarySource(input);
	const replay = validatePendingOccupants(input, source);
	const submissionKey = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: input.kind,
		sourceType: "time_entry",
		sourceId: input.workPeriodId,
		allocationKey: "ordinary-submission",
	});
	if (replay) {
		const approverEmployeeId = await legacyApprover(
			input,
			replay.approvalRequestId,
		);
		return {
			result: replay,
			postCommit: descriptor({
				submission: input,
				source,
				result: replay,
				authority,
				approverEmployeeId,
				submissionKey,
			}),
		};
	}

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
				created = await Effect.runPromise(
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
						defaultApproverId: input.defaultApproverId,
						transactionBehavior: "existing",
						reason: input.reason,
						metadata: payload,
					}),
				);
				if (created.kind === "auto_completed") {
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
			postCommit: descriptor({
				submission: input,
				source,
				result,
				authority,
				approverEmployeeId,
				submissionKey,
			}),
		};
	}

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
		defaultApproverEmployeeId: input.defaultApproverId,
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
		contextSnapshot: payload,
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
	if (started.terminal) {
		if (started.status !== "approved") return fail();
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
	const result: ResolvePolicyAndCreateApprovalResult = started.terminal
		? {
				kind: "auto_completed",
				chainInstanceId:
					started.snapshot.stages.length > 1 ? started.snapshot.id : null,
				approvalRequestId: started.snapshot.id,
				reason: "requester_is_approver",
			}
		: started.snapshot.stages.length > 1
			? {
					kind: "chain_created",
					chainInstanceId: started.snapshot.id,
					approvalRequestId: activeAssignment?.id ?? started.snapshot.id,
				}
			: {
					kind: "default_created",
					approvalRequestId: activeAssignment?.id ?? started.snapshot.id,
				};
	return {
		result,
		postCommit: descriptor({
			submission: input,
			source,
			result,
			authority,
			approverEmployeeId:
				result.kind === "auto_completed"
					? input.requesterEmployeeId
					: (activeAssignment?.approverEmployeeId ?? null),
			submissionKey,
		}),
	};
}
