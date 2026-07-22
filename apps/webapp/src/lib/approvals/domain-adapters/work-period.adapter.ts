import { and, eq } from "drizzle-orm";
import { timeRecord, workPeriod } from "@/db/schema";
import { compareInstants, instantFromDate } from "@/lib/datetime/temporal-core";
import type { ApprovalDbService as ServerApprovalDbService } from "../server/types";
import type {
	FinalizeOrdinaryWorkPeriodTerminalInput,
	WorkPeriodApprovalResult,
} from "../server/work-period-approvals";
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
	type OrdinaryWorkPeriodApprovalKind,
	type OrdinaryWorkPeriodApprovalSource,
	parseOrdinaryWorkPeriodWorkflowPayload,
} from "./work-period-contract";

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface OrdinaryWorkPeriodApprovalAdapterDependencies {
	finalizeTerminal(
		input: FinalizeOrdinaryWorkPeriodTerminalInput,
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

function payloadFromWorkflow(
	workflow: ApprovalWorkflowSnapshot,
	kind: OrdinaryWorkPeriodApprovalKind,
) {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(
			workflow.contextSnapshot,
			"timeRequest",
		);
		if (!descriptor?.enumerable || !("value" in descriptor)) fail();
		return parseOrdinaryWorkPeriodWorkflowPayload(
			{ timeRequest: descriptor.value },
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
		sourcePayload.timeRequest.kind !== workflowPayload.timeRequest.kind ||
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

function terminalApprovalRequestId(
	input: ApprovalTerminalAdapterInput<OrdinaryWorkPeriodApprovalSource>,
): string {
	const completedAt = input.workflow.completedAt;
	if (!completedAt) {
		return fail("Ordinary work-period compatibility evidence is invalid");
	}
	const terminalStages = input.workflow.stages.filter(
		(stage) =>
			stage.status === input.transition.to &&
			stage.decidedAt !== null &&
			compareInstants(stage.decidedAt, completedAt) === 0,
	);
	const legacyApprovalRequestId = terminalStages[0]?.legacyApprovalRequestId;
	if (
		terminalStages.length !== 1 ||
		typeof legacyApprovalRequestId !== "string" ||
		!CANONICAL_UUID.test(legacyApprovalRequestId)
	) {
		return fail("Ordinary work-period compatibility evidence is invalid");
	}
	return legacyApprovalRequestId;
}

function terminalResult(
	kind: OrdinaryWorkPeriodApprovalKind,
	input: ApprovalTerminalAdapterInput<OrdinaryWorkPeriodApprovalSource>,
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
			const db = (input.dbService as unknown as ServerApprovalDbService).db;
			const periods = await db
				.select({
					id: workPeriod.id,
					organizationId: workPeriod.organizationId,
					employeeId: workPeriod.employeeId,
					clockInId: workPeriod.clockInId,
					clockOutId: workPeriod.clockOutId,
					canonicalRecordId: workPeriod.canonicalRecordId,
					approvalWorkflowId: workPeriod.approvalWorkflowId,
					startTime: workPeriod.startTime,
					endTime: workPeriod.endTime,
					durationMinutes: workPeriod.durationMinutes,
					isActive: workPeriod.isActive,
					approvalStatus: workPeriod.approvalStatus,
					deletedAt: workPeriod.deletedAt,
				})
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.id, input.sourceIdentity.sourceId),
						eq(workPeriod.organizationId, input.organizationId),
						eq(workPeriod.employeeId, requesterEmployeeId),
					),
				)
				.for("update");
			const period = periods[0];
			if (
				periods.length !== 1 ||
				!period ||
				period.id !== input.sourceIdentity.sourceId ||
				period.organizationId !== input.organizationId ||
				period.employeeId !== requesterEmployeeId ||
				period.approvalWorkflowId !== input.workflow.id ||
				!period.canonicalRecordId ||
				!period.clockInId ||
				!period.clockOutId ||
				period.isActive ||
				period.deletedAt !== null ||
				!period.endTime ||
				period.durationMinutes === null
			) {
				return fail();
			}
			const records = await db
				.select({
					id: timeRecord.id,
					organizationId: timeRecord.organizationId,
					employeeId: timeRecord.employeeId,
					recordKind: timeRecord.recordKind,
					startAt: timeRecord.startAt,
					endAt: timeRecord.endAt,
					durationMinutes: timeRecord.durationMinutes,
					approvalState: timeRecord.approvalState,
				})
				.from(timeRecord)
				.where(
					and(
						eq(timeRecord.id, period.canonicalRecordId),
						eq(timeRecord.organizationId, input.organizationId),
						eq(timeRecord.employeeId, requesterEmployeeId),
						eq(timeRecord.recordKind, "work"),
					),
				)
				.for("update");
			const canonical = records[0];
			if (
				records.length !== 1 ||
				!canonical ||
				canonical.id !== period.canonicalRecordId ||
				canonical.organizationId !== input.organizationId ||
				canonical.employeeId !== requesterEmployeeId ||
				canonical.recordKind !== "work" ||
				canonical.approvalState !== period.approvalStatus ||
				!canonical.endAt ||
				canonical.durationMinutes !== period.durationMinutes ||
				!sameDate(canonical.startAt, period.startTime) ||
				!sameDate(canonical.endAt, period.endTime)
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
			const approvalRequestId = terminalApprovalRequestId(input);
			const transition =
				input.transition.kind === "approve"
					? { kind: "approve" as const, reason: input.transition.reason }
					: input.transition.kind === "reject"
						? { kind: "reject" as const, reason: input.transition.reason }
						: fail();
			await dependencies.finalizeTerminal({
				dbService: input.dbService as unknown as ServerApprovalDbService,
				organizationId: input.organizationId,
				workPeriodId: input.source.id,
				approvalRequestId,
				expectedApprovalWorkflowId: input.workflow.id,
				requesterEmployeeId: input.source.employeeId,
				actorEmployeeId: input.actor.employeeId,
				actorUserId: input.actor.userId,
				kind,
				transition,
				finalizedAt: input.finalizedAt,
				allowUnlinkedLegacySource: false,
			});
			return terminalResult(kind, input);
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
					title,
					startTime: input.source.startTime,
					endTime: input.source.endTime,
					durationMinutes: input.source.durationMinutes,
					approvalStatus: input.source.approvalStatus,
				},
				searchText:
					`${title} ${input.source.startTime} ${input.source.endTime}`.toLocaleLowerCase(
						"en-US",
					),
			}) as { displayPayload: JsonObject; searchText: string };
		},
	};
}
