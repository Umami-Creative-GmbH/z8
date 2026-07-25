import { sql } from "drizzle-orm";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { decodeApprovalDatabaseTimestamp } from "../approval-database-row";
import type {
	ApprovalSourceIdentity,
	ApprovalWorkflowSnapshot,
	JsonObject,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import type {
	ApprovalDomainAdapter,
	ApprovalDomainAdapterContext,
	ApprovalTerminalAdapterInput,
	ApprovalTerminalFinalizationResult,
} from "./types";
import {
	type FinalizeOrdinaryWorkPeriodTerminalAdapterInput,
	type OrdinaryWorkPeriodApprovalKind,
	type OrdinaryWorkPeriodApprovalSource,
	parseOrdinaryWorkPeriodWorkflowPayload,
	type WorkPeriodApprovalResult,
} from "./work-period-contract";

export interface OrdinaryWorkPeriodApprovalAdapterDependencies {
	finalizeTerminal(
		input: FinalizeOrdinaryWorkPeriodTerminalAdapterInput,
	): Promise<WorkPeriodApprovalResult>;
}

export class OrdinaryWorkPeriodApprovalAdapterError extends Error {
	constructor(
		message = "Ordinary work-period approval adapter input is invalid",
	) {
		super(message);
		this.name = "OrdinaryWorkPeriodApprovalAdapterError";
	}
}

function fail(message?: string): never {
	throw new OrdinaryWorkPeriodApprovalAdapterError(message);
}

function resultRows(result: unknown): unknown[] {
	return typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
		? result.rows
		: [];
}

interface OrdinaryWorkPeriodEvidenceRow {
	id: string;
	organizationId: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string;
	canonicalRecordId: string;
	approvalWorkflowId: string;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	isActive: boolean;
	approvalStatus: "pending" | "approved" | "rejected";
	deletedAt: Date | null;
	canonicalId: string;
	canonicalOrganizationId: string;
	canonicalEmployeeId: string;
	canonicalRecordKind: string;
	canonicalStartAt: Date;
	canonicalEndAt: Date;
	canonicalDurationMinutes: number;
	canonicalApprovalState: string;
}

function evidenceRow(value: unknown): OrdinaryWorkPeriodEvidenceRow {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail();
	}
	return value as OrdinaryWorkPeriodEvidenceRow;
}

function payloadFromWorkflow(
	workflow: ApprovalWorkflowSnapshot,
	kind: OrdinaryWorkPeriodApprovalKind,
) {
	try {
		const timeRequest = Object.getOwnPropertyDescriptor(
			workflow.contextSnapshot,
			"timeRequest",
		);
		const breakPolicySnapshot = Object.getOwnPropertyDescriptor(
			workflow.contextSnapshot,
			"breakPolicySnapshot",
		);
		const surchargeSnapshot = Object.getOwnPropertyDescriptor(
			workflow.contextSnapshot,
			"surchargeSnapshot",
		);
		if (!timeRequest?.enumerable || !("value" in timeRequest)) fail();
		if (
			breakPolicySnapshot &&
			(!breakPolicySnapshot.enumerable || !("value" in breakPolicySnapshot))
		) {
			fail();
		}
		if (
			surchargeSnapshot &&
			(!surchargeSnapshot.enumerable || !("value" in surchargeSnapshot))
		) {
			fail();
		}
		return parseOrdinaryWorkPeriodWorkflowPayload(
			{
				timeRequest: timeRequest.value,
				...(breakPolicySnapshot && "value" in breakPolicySnapshot
					? { breakPolicySnapshot: breakPolicySnapshot.value }
					: {}),
				...(surchargeSnapshot && "value" in surchargeSnapshot
					? { surchargeSnapshot: surchargeSnapshot.value }
					: {}),
			},
			kind,
		);
	} catch {
		return fail();
	}
}

function validateIdentity(
	kind: OrdinaryWorkPeriodApprovalKind,
	organizationId: string,
	workflow: ApprovalWorkflowSnapshot,
	sourceIdentity: ApprovalSourceIdentity,
): void {
	payloadFromWorkflow(workflow, kind);
	if (
		workflow.organizationId !== organizationId ||
		sourceIdentity.organizationId !== organizationId ||
		workflow.workflowType !== kind ||
		sourceIdentity.workflowType !== kind ||
		workflow.sourceType !== "time_entry" ||
		sourceIdentity.sourceType !== "time_entry" ||
		workflow.sourceId !== sourceIdentity.sourceId ||
		!workflow.requesterEmployeeId
	) {
		fail();
	}
}

function validateContext(
	kind: OrdinaryWorkPeriodApprovalKind,
	input: ApprovalDomainAdapterContext<OrdinaryWorkPeriodApprovalSource>,
): void {
	validateIdentity(
		kind,
		input.organizationId,
		input.workflow,
		input.sourceIdentity,
	);
	let sourcePayload: OrdinaryWorkPeriodApprovalSource["payload"];
	try {
		const descriptor = Object.getOwnPropertyDescriptor(input.source, "payload");
		if (!descriptor?.enumerable || !("value" in descriptor)) fail();
		sourcePayload = parseOrdinaryWorkPeriodWorkflowPayload(
			descriptor.value,
			kind,
		);
	} catch {
		fail();
	}
	const workflowPayload = payloadFromWorkflow(input.workflow, kind);
	if (
		input.source.id !== input.sourceIdentity.sourceId ||
		input.source.organizationId !== input.organizationId ||
		input.source.employeeId !== input.workflow.requesterEmployeeId ||
		input.source.approvalWorkflowId !== input.workflow.id ||
		JSON.stringify(sourcePayload) !== JSON.stringify(workflowPayload) ||
		input.workflow.stages.some(
			(stage) =>
				stage.organizationId !== input.organizationId ||
				stage.workflowId !== input.workflow.id,
		)
	) {
		fail();
	}
}

function sameDate(left: Date, right: Date): boolean {
	return left.getTime() === right.getTime();
}

function terminalResult(
	kind: OrdinaryWorkPeriodApprovalKind,
	input: ApprovalTerminalAdapterInput<OrdinaryWorkPeriodApprovalSource>,
	maintenance: WorkPeriodApprovalResult["maintenance"],
): ApprovalTerminalFinalizationResult {
	const status = input.transition.to;
	return normalizeStableData({
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
		sourceIdentity: {
			organizationId: input.organizationId,
			workflowType: kind,
			sourceType: "time_entry",
			sourceId: input.source.id,
		},
		transitionKind: input.transition.kind,
		terminalStatus: status,
		sourceSnapshot: {
			kind,
			startTime: input.source.startTime,
			endTime: input.source.endTime,
			durationMinutes: input.source.durationMinutes,
			approvalStatus: status,
		},
		eventPayload: {
			kind,
			status,
			durationMinutes: input.source.durationMinutes,
		},
		compatibilityPayload: {
			entityType: "time_entry",
			kind,
			status,
		},
		finalizedAt: input.finalizedAt,
		...(maintenance ? { maintenance } : {}),
	}) as ApprovalTerminalFinalizationResult;
}

export function createOrdinaryWorkPeriodApprovalAdapter(
	kind: OrdinaryWorkPeriodApprovalKind,
	dependencies: OrdinaryWorkPeriodApprovalAdapterDependencies,
): ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource> {
	return {
		workflowType: kind,
		sourceType: "time_entry",
		async loadSource(input) {
			validateIdentity(
				kind,
				input.organizationId,
				input.workflow,
				input.sourceIdentity,
			);
			const requesterEmployeeId = input.workflow.requesterEmployeeId ?? fail();
			const payload = payloadFromWorkflow(input.workflow, kind);
			const rows = resultRows(
				await input.dbService.db.execute(sql`
					select
						period.id,
						period.organization_id as "organizationId",
						period.employee_id as "employeeId",
						period.clock_in_id as "clockInId",
						period.clock_out_id as "clockOutId",
						period.canonical_record_id as "canonicalRecordId",
						period.approval_workflow_id as "approvalWorkflowId",
						period.start_time as "startTime",
						period.end_time as "endTime",
						period.duration_minutes as "durationMinutes",
						period.is_active as "isActive",
						period.approval_status as "approvalStatus",
						period.deleted_at as "deletedAt",
						canonical.id as "canonicalId",
						canonical.organization_id as "canonicalOrganizationId",
						canonical.employee_id as "canonicalEmployeeId",
						canonical.record_kind as "canonicalRecordKind",
						canonical.start_at as "canonicalStartAt",
						canonical.end_at as "canonicalEndAt",
						canonical.duration_minutes as "canonicalDurationMinutes",
						canonical.approval_state as "canonicalApprovalState"
					from work_period period
					join time_record canonical
						on canonical.id = period.canonical_record_id
						and canonical.organization_id = period.organization_id
						and canonical.employee_id = period.employee_id
						and canonical.record_kind = 'work'
					where period.id = ${input.sourceIdentity.sourceId}::uuid
						and period.organization_id = ${input.organizationId}
						and period.employee_id = ${requesterEmployeeId}::uuid
					for update of period, canonical
				`),
			);
			const rawPeriod = evidenceRow(rows[0]);
			const period = {
				...rawPeriod,
				startTime: decodeApprovalDatabaseTimestamp(rawPeriod.startTime),
				endTime: decodeApprovalDatabaseTimestamp(rawPeriod.endTime),
				deletedAt:
					rawPeriod.deletedAt === null
						? null
						: decodeApprovalDatabaseTimestamp(rawPeriod.deletedAt),
				canonicalStartAt: decodeApprovalDatabaseTimestamp(
					rawPeriod.canonicalStartAt,
				),
				canonicalEndAt: decodeApprovalDatabaseTimestamp(
					rawPeriod.canonicalEndAt,
				),
			};
			if (
				rows.length !== 1 ||
				period.id !== input.sourceIdentity.sourceId ||
				period.organizationId !== input.organizationId ||
				period.employeeId !== requesterEmployeeId ||
				period.approvalWorkflowId !== input.workflow.id ||
				!period.canonicalRecordId ||
				!period.clockInId ||
				!period.clockOutId ||
				period.isActive !== false ||
				period.deletedAt !== null ||
				!(period.startTime instanceof Date) ||
				!(period.endTime instanceof Date) ||
				!Number.isInteger(period.durationMinutes) ||
				period.durationMinutes < 0 ||
				!(["pending", "approved", "rejected"] as readonly unknown[]).includes(
					period.approvalStatus,
				)
			) {
				return fail();
			}
			if (
				period.canonicalId !== period.canonicalRecordId ||
				period.canonicalOrganizationId !== input.organizationId ||
				period.canonicalEmployeeId !== requesterEmployeeId ||
				period.canonicalRecordKind !== "work" ||
				period.canonicalApprovalState !== period.approvalStatus ||
				!(period.canonicalStartAt instanceof Date) ||
				!(period.canonicalEndAt instanceof Date) ||
				period.canonicalDurationMinutes !== period.durationMinutes ||
				!sameDate(period.canonicalStartAt, period.startTime) ||
				!sameDate(period.canonicalEndAt, period.endTime)
			) {
				return fail();
			}
			return normalizeStableData({
				id: period.id,
				organizationId: period.organizationId,
				employeeId: period.employeeId,
				canonicalRecordId: period.canonicalRecordId,
				approvalWorkflowId: period.approvalWorkflowId,
				approvalStatus: period.approvalStatus,
				startTime: instantFromDate(period.startTime).toString(),
				endTime: instantFromDate(period.endTime).toString(),
				durationMinutes: period.durationMinutes,
				payload,
			}) as OrdinaryWorkPeriodApprovalSource;
		},
		async getTrustedCapabilities(input) {
			validateContext(kind, input);
			return { canCancelAfterApproval: false };
		},
		async produceRoutingContext(input) {
			validateContext(kind, input);
			return normalizeStableData({
				organizationId: input.organizationId,
				workflowType: kind,
				source: { type: "time_entry", id: input.source.id },
				requesterEmployeeId: input.source.employeeId,
				teamIds: [],
				locationId: null,
				absenceCategoryId: null,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
				workPeriod: { durationMinutes: input.source.durationMinutes },
			}) as JsonObject;
		},
		async preflightCommand(input) {
			validateContext(kind, input);
			const expected = {
				submit: "pending",
				approve: "approved",
				reject: "rejected",
				cancel: "cancelled",
			}[input.command.kind];
			if (
				input.command.kind === "cancel" ||
				input.workflow.status !== "pending" ||
				input.source.approvalStatus !== "pending" ||
				input.proposedStatus !== expected
			) {
				return fail(
					"Ordinary work-period command is incompatible with source state",
				);
			}
		},
		async preflightTerminal(input) {
			validateContext(kind, input);
			if (
				(input.transition.kind !== "approve" &&
					input.transition.kind !== "reject") ||
				input.transition.from !== "pending" ||
				input.workflow.status !== input.transition.to ||
				input.source.approvalStatus !== "pending"
			) {
				return fail(
					"Ordinary work-period terminal transition is incompatible with source state",
				);
			}
			if (input.actor.kind !== "employee" || !input.actor.userId) {
				return fail("Ordinary work-period terminal actor is invalid");
			}
		},
		async finalizeTerminal(input) {
			await this.preflightTerminal(input);
			if (input.actor.kind !== "employee" || !input.actor.userId) return fail();
			const payload = payloadFromWorkflow(input.workflow, kind);
			const transition =
				input.transition.kind === "approve"
					? { kind: "approve" as const, reason: input.transition.reason }
					: input.transition.kind === "reject"
						? { kind: "reject" as const, reason: input.transition.reason }
						: fail();
			const finalized = await dependencies.finalizeTerminal({
				dbService: input.dbService,
				organizationId: input.organizationId,
				workPeriodId: input.source.id,
				expectedApprovalWorkflowId: input.workflow.id,
				requesterEmployeeId: input.source.employeeId,
				actorEmployeeId: input.actor.employeeId,
				actorUserId: input.actor.userId,
				kind,
				evidence: {
					mode: "canonical",
					workflowId: input.workflow.id,
					payload,
				},
				transition,
				finalizedAt: input.finalizedAt,
			});
			return terminalResult(kind, input, finalized.maintenance);
		},
		async projectDisplay(input) {
			validateContext(kind, input);
			const title =
				kind === "manual_time_submission"
					? "Manual time submission"
					: "Policy clock-out";
			return normalizeStableData({
				displayPayload: {
					kind,
					startTime: input.source.startTime,
					endTime: input.source.endTime,
					durationMinutes: input.source.durationMinutes,
				},
				searchText: title.toLocaleLowerCase("en-US"),
			}) as { displayPayload: JsonObject; searchText: string };
		},
	};
}
