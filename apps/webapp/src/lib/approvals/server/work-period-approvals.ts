import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowCommand,
	approvalWorkflowStage,
	employee,
	timeEntry,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import {
	dateFromInstant,
	instantFromDate,
	instantToCanonicalString,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { ConflictError } from "@/lib/effect/errors";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	SurchargeService,
	SurchargeServiceLive,
} from "@/lib/effect/services/surcharge.service";
import { createLogger } from "@/lib/logger";
import {
	onClockOutApproved,
	onClockOutRejected,
	onManualEntryApproved,
	onManualEntryRejected,
} from "@/lib/notifications/triggers";
import {
	type PolicyClockOutBreakSnapshot,
	policyClockOutBreakSnapshotFromPendingChanges,
	policyClockOutBreakSnapshotsEqual,
} from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import {
	type PolicyClockOutSurchargeSnapshot,
	parsePolicyClockOutSurchargeSnapshot,
	policyClockOutSurchargeSnapshotFromPendingChanges,
	policyClockOutSurchargeSnapshotsEqual,
} from "@/lib/time-tracking/policy-clock-out-surcharge-snapshot";
import { applyPolicyClockOutTerminalBreakInTransaction } from "@/lib/time-tracking/policy-clock-out-terminal-break";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { decodeApprovalDatabaseJsonText } from "../approval-database-row";
import type { ApprovalActionOptions } from "../domain/types";
import { createLegacyApprovalWriteCoordinator } from "../domain-adapters/legacy-write-coordinator";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	type FinalizeOrdinaryWorkPeriodTerminalAdapterInput,
	type FinalizeOrdinaryWorkPeriodTerminalInput,
	type OrdinaryWorkPeriodApprovalKind,
	type OrdinaryWorkPeriodFinalizerDatabase,
	type OrdinaryWorkPeriodFinalizerDbService,
	type OrdinaryWorkPeriodTerminalEvidence,
	parseOrdinaryWorkPeriodWorkflowPayload,
	type WorkPeriodApprovalResult,
	type WorkPeriodMaintenanceFacts,
} from "../domain-adapters/work-period-contract";
import {
	captureOrdinaryWorkPeriodLegacyState,
	loadOrdinaryWorkPeriodLegacyDecisionEvidence,
} from "../domain-adapters/work-period-legacy-state";
import {
	ApprovalAuditLogger,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import type { VerifiedLegacyApprovalState } from "../workflow/ports";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { fingerprintApprovalWorkflowCommand } from "../workflow/transition-engine";
import { processApprovalWithCurrentEmployee } from "./shared";
import type {
	ApprovalDbService,
	CurrentApprover,
	PendingApprovalRequest,
} from "./types";
import type { WorkPeriodPostCommitDescriptor } from "./work-period-submission";

export type OrdinaryTimeApprovalKind = OrdinaryWorkPeriodApprovalKind;
export type {
	FinalizeOrdinaryWorkPeriodTerminalInput,
	WorkPeriodApprovalResult,
} from "../domain-adapters/work-period-contract";

const ORDINARY_DECISION_ERROR = "Ordinary work-period decision failed";
const logger = createLogger("WorkPeriodApprovals");

function exactDecisionMetadata(value: unknown): {
	kind: OrdinaryTimeApprovalKind;
	workflowId: string | null;
	workflowOrganizationId: string | null;
	stageId: string | null;
	stageSequence: number | null;
	assignmentId: string | null;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(ORDINARY_DECISION_ERROR);
	}
	const root = value as Record<string, unknown>;
	let kind: OrdinaryTimeApprovalKind;
	try {
		kind = parseOrdinaryWorkPeriodWorkflowPayload({
			timeRequest: root.timeRequest,
			...(Object.hasOwn(root, "breakPolicySnapshot")
				? { breakPolicySnapshot: root.breakPolicySnapshot }
				: {}),
			...(Object.hasOwn(root, "surchargeSnapshot")
				? { surchargeSnapshot: root.surchargeSnapshot }
				: {}),
		}).timeRequest.kind;
	} catch {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const requestDescriptors = Object.getOwnPropertyDescriptors(
			root.timeRequest,
		);
		const requestKind = requestDescriptors.kind;
		if (
			Reflect.ownKeys(descriptors).length !== 1 ||
			Reflect.ownKeys(descriptors)[0] !== "timeRequest" ||
			Reflect.ownKeys(requestDescriptors).length !== 1 ||
			!requestKind?.enumerable ||
			!("value" in requestKind) ||
			(requestKind.value !== "manual_time_submission" &&
				requestKind.value !== "policy_clock_out")
		)
			throw new Error(ORDINARY_DECISION_ERROR);
		kind = requestKind.value;
	}
	const workflow = root.workflow;
	const stage = root.stage;
	if (
		(workflow !== undefined &&
			(!workflow || typeof workflow !== "object" || Array.isArray(workflow))) ||
		(stage !== undefined && workflow === undefined) ||
		(stage !== undefined &&
			(!stage || typeof stage !== "object" || Array.isArray(stage)))
	) {
		throw new Error(ORDINARY_DECISION_ERROR);
	}
	const workflowData = workflow as Record<string, unknown> | undefined;
	const stageData = stage as Record<string, unknown> | undefined;
	if (
		(workflowData !== undefined &&
			(typeof workflowData.id !== "string" ||
				typeof workflowData.organizationId !== "string")) ||
		(stageData !== undefined &&
			(typeof stageData.id !== "string" ||
				typeof stageData.sequence !== "number" ||
				!Number.isSafeInteger(stageData.sequence) ||
				stageData.sequence < 1 ||
				(stageData.assignmentId !== undefined &&
					typeof stageData.assignmentId !== "string")))
	) {
		throw new Error(ORDINARY_DECISION_ERROR);
	}
	return {
		kind,
		workflowId: typeof workflowData?.id === "string" ? workflowData.id : null,
		workflowOrganizationId:
			typeof workflowData?.organizationId === "string"
				? workflowData.organizationId
				: null,
		stageId: typeof stageData?.id === "string" ? stageData.id : null,
		stageSequence:
			typeof stageData?.sequence === "number" ? stageData.sequence : null,
		assignmentId:
			typeof stageData?.assignmentId === "string"
				? stageData.assignmentId
				: null,
	};
}

function ordinaryDecisionResult(input: {
	kind: OrdinaryTimeApprovalKind;
	decision:
		| { kind: "approve"; reason: string | null }
		| { kind: "reject"; reason: string };
	period: {
		id: string;
		organizationId: string;
		employeeId: string;
		canonicalRecordId: string;
		startTime: Date;
		endTime: Date;
	};
}): WorkPeriodApprovalResult {
	return {
		kind: input.kind,
		action: input.decision.kind,
		reason: input.decision.reason,
		period: {
			id: input.period.id,
			organizationId: input.period.organizationId,
			employeeId: input.period.employeeId,
			canonicalRecordId: input.period.canonicalRecordId,
			startTime: new Date(input.period.startTime.getTime()),
			endTime: new Date(input.period.endTime.getTime()),
		},
		maintenance: null,
	};
}

function exactMaintenanceFacts(
	value: unknown,
	expected: {
		organizationId: string;
		employeeId: string;
		decision: "approved" | "rejected";
	},
): WorkPeriodMaintenanceFacts {
	const facts = exactOwnDataValues(value, [
		"organizationId",
		"employeeId",
		"dirtyFromDate",
		"decision",
		"surchargePeriodIds",
		"staleSurchargePeriodIds",
		"surchargeSnapshot",
	]);
	if (
		facts.organizationId !== expected.organizationId ||
		facts.employeeId !== expected.employeeId ||
		facts.decision !== expected.decision ||
		typeof facts.dirtyFromDate !== "string" ||
		(facts.decision !== "approved" && facts.decision !== "rejected") ||
		!Array.isArray(facts.surchargePeriodIds) ||
		!Array.isArray(facts.staleSurchargePeriodIds) ||
		[...facts.surchargePeriodIds, ...facts.staleSurchargePeriodIds].some(
			(id) => typeof id !== "string" || id.length === 0,
		) ||
		new Set(facts.surchargePeriodIds).size !==
			facts.surchargePeriodIds.length ||
		new Set(facts.staleSurchargePeriodIds).size !==
			facts.staleSurchargePeriodIds.length ||
		(expected.decision === "rejected" &&
			(facts.surchargePeriodIds.length !== 0 ||
				facts.staleSurchargePeriodIds.length === 0))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	try {
		parsePlainDate(facts.dirtyFromDate);
		if (facts.surchargeSnapshot !== null) {
			const snapshot = facts.surchargeSnapshot as { evaluatedAt?: unknown };
			if (typeof snapshot.evaluatedAt !== "string") throw new Error();
			parsePolicyClockOutSurchargeSnapshot(
				facts.surchargeSnapshot,
				snapshot.evaluatedAt,
			);
		}
	} catch {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	return {
		organizationId: facts.organizationId,
		employeeId: facts.employeeId,
		dirtyFromDate: facts.dirtyFromDate,
		decision: facts.decision,
		surchargePeriodIds: [...facts.surchargePeriodIds],
		staleSurchargePeriodIds: [...facts.staleSurchargePeriodIds],
		surchargeSnapshot:
			facts.surchargeSnapshot === null
				? null
				: parsePolicyClockOutSurchargeSnapshot(
						facts.surchargeSnapshot,
						(facts.surchargeSnapshot as { evaluatedAt: string }).evaluatedAt,
					),
	};
}

function isVerifiedLegacyIntermediateReplay(input: {
	state: VerifiedLegacyApprovalState | null;
	approvalRequestId: string;
	actorEmployeeId: string;
	decision: "approve" | "reject";
}): boolean {
	const state = input.state;
	const request = state?.approvalRequest;
	const chain = state?.chain;
	if (
		input.decision !== "approve" ||
		!state ||
		!request ||
		!chain ||
		request.id !== input.approvalRequestId ||
		request.status !== "approved" ||
		request.approverId !== input.actorEmployeeId ||
		chain.status !== "pending"
	) {
		return false;
	}
	const decided = state.chainRows.find(
		(row) => row.approvalRequestId === input.approvalRequestId,
	);
	const active = state.chainRows.find(
		(row) => row.stepOrder === chain.currentStageOrder,
	);
	return Boolean(
		decided &&
			active &&
			decided.status === "approved" &&
			decided.resolvedApproverEmployeeId === input.actorEmployeeId &&
			decided.decidedBy === input.actorEmployeeId &&
			decided.stepOrder < active.stepOrder &&
			active.status === "pending" &&
			active.approvalRequestId,
	);
}

export async function executeOrdinaryWorkPeriodDecisionInTransaction(input: {
	dbService: ApprovalDbService;
	runtime: ReturnType<typeof createProductionApprovalWorkflowRuntime>;
	organizationId: string;
	approvalRequestId: string;
	workPeriodId: string;
	actor: CurrentApprover;
	allowAnyApprover?: boolean;
	allowOrganizationWideApprover?: boolean;
	decision:
		| { kind: "approve"; reason: string | null }
		| { kind: "reject"; reason: string };
}): Promise<{
	result: WorkPeriodApprovalResult;
	postCommit: WorkPeriodPostCommitDescriptor | null;
}> {
	try {
		return await input.runtime.repository.withTransaction(async (context) => {
			const database = context.dbService
				.db as unknown as ApprovalDbService["db"];
			const actors = await database.query.employee.findMany({
				where: and(
					eq(employee.id, input.actor.id),
					eq(employee.organizationId, input.organizationId),
					eq(employee.userId, input.actor.userId),
					eq(employee.isActive, true),
				),
				with: { user: true },
				limit: 2,
			});
			const actor = actors[0] as CurrentApprover | undefined;
			if (
				actors.length !== 1 ||
				!actor ||
				actor.id !== input.actor.id ||
				actor.organizationId !== input.organizationId ||
				actor.userId !== input.actor.userId
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const requestRow = await database.query.approvalRequest.findFirst({
				where: and(
					eq(approvalRequest.id, input.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, input.workPeriodId),
				),
			});
			const assignment = requestRow
				? null
				: await database.query.approvalStageAssignment.findFirst({
						where: and(
							eq(approvalStageAssignment.id, input.approvalRequestId),
							eq(approvalStageAssignment.organizationId, input.organizationId),
						),
						columns: {
							id: true,
							workflowId: true,
							stageId: true,
							approverEmployeeId: true,
							status: true,
						},
					});
			const assignmentStage = assignment
				? await database.query.approvalWorkflowStage.findFirst({
						where: and(
							eq(approvalWorkflowStage.id, assignment.stageId),
							eq(approvalWorkflowStage.organizationId, input.organizationId),
						),
						columns: {
							id: true,
							workflowId: true,
							sequence: true,
							status: true,
						},
					})
				: null;
			const canonicalTarget = assignmentStage
				? await database.query.approvalWorkflow.findFirst({
						where: and(
							eq(approvalWorkflow.id, assignmentStage.workflowId),
							eq(approvalWorkflow.organizationId, input.organizationId),
							eq(approvalWorkflow.sourceType, "time_entry"),
						),
					})
				: null;
			if (
				(!requestRow && !assignment) ||
				(requestRow &&
					(requestRow.id !== input.approvalRequestId ||
						requestRow.organizationId !== input.organizationId ||
						requestRow.entityType !== "time_entry" ||
						requestRow.entityId !== input.workPeriodId)) ||
				(assignment &&
					(assignment.id !== input.approvalRequestId ||
						assignment.workflowId !== assignmentStage?.workflowId ||
						assignment.stageId !== assignmentStage?.id ||
						assignment.workflowId !== canonicalTarget?.id ||
						!canonicalTarget ||
						canonicalTarget.organizationId !== input.organizationId ||
						canonicalTarget.sourceType !== "time_entry" ||
						(canonicalTarget.workflowType !== "manual_time_submission" &&
							canonicalTarget.workflowType !== "policy_clock_out") ||
						canonicalTarget.sourceId !== input.workPeriodId ||
						!canonicalTarget.requesterEmployeeId))
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const verifiedLegacyState = requestRow
				? await loadOrdinaryWorkPeriodLegacyDecisionEvidence({
						dbService: {
							db: database,
							query: input.dbService.query,
						},
						organizationId: input.organizationId,
						workPeriodId: input.workPeriodId,
						expectedRequesterEmployeeId: requestRow.requestedBy,
						approvalRequestId: input.approvalRequestId,
						expectedRequestStatus: requestRow.status,
					})
				: null;
			if (
				verifiedLegacyState &&
				(!verifiedLegacyState.approvalRequest ||
					verifiedLegacyState.approvalRequest.id !== requestRow?.id ||
					verifiedLegacyState.approvalRequest.organizationId !==
						input.organizationId ||
					verifiedLegacyState.approvalRequest.entityId !== input.workPeriodId ||
					verifiedLegacyState.approvalRequest.requestedBy !==
						requestRow?.requestedBy ||
					verifiedLegacyState.approvalRequest.approverId !==
						requestRow?.approverId ||
					verifiedLegacyState.approvalRequest.status !== requestRow?.status)
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const request = requestRow ?? {
				id: input.approvalRequestId,
				organizationId: input.organizationId,
				entityType: "time_entry",
				entityId: canonicalTarget?.sourceId ?? "",
				requestedBy: canonicalTarget?.requesterEmployeeId ?? "",
				approverId: null,
				status: canonicalTarget?.status ?? "pending",
				metadata: canonicalTarget?.contextSnapshot ?? null,
			};
			const metadata = requestRow
				? {
						...(requestRow.metadata === null
							? {
									workflowId: null,
									workflowOrganizationId: null,
									stageId: null,
									stageSequence: null,
									assignmentId: null,
								}
							: exactDecisionMetadata(requestRow.metadata)),
						kind: verifiedLegacyState?.source
							.workflowType as OrdinaryTimeApprovalKind,
					}
				: {
						kind: parseOrdinaryWorkPeriodWorkflowPayload(
							canonicalTarget?.contextSnapshot,
						).timeRequest.kind,
						workflowId: canonicalTarget?.id ?? "",
						workflowOrganizationId: canonicalTarget?.organizationId ?? "",
						stageId: assignment?.stageId ?? null,
						stageSequence: null,
						assignmentId: assignment?.id ?? null,
					};
			const expectedTerminalStatus =
				input.decision.kind === "approve" ? "approved" : "rejected";
			const canonicalCommand = assignmentStage
				? input.decision.kind === "approve"
					? {
							type: "approve" as const,
							stageId: assignmentStage.id,
							assignmentId: assignment?.id ?? "",
						}
					: {
							type: "reject" as const,
							stageId: assignmentStage.id,
							assignmentId: assignment?.id ?? "",
							reason: input.decision.reason,
						}
				: null;
			const canonicalIdempotencyKey = canonicalTarget
				? `ordinary-decision:${input.organizationId}:${canonicalTarget.id}:${input.approvalRequestId}:${input.decision.kind}:${input.decision.reason ?? ""}`
				: null;
			const canonicalActorFingerprint = fingerprintApprovalCommandActor({
				kind: "employee",
				employeeId: actor.id,
				userId: actor.userId,
			});
			const canonicalCommandFingerprint = canonicalCommand
				? fingerprintApprovalWorkflowCommand(canonicalCommand)
				: null;
			const canonicalReplayReceipt =
				assignment &&
				assignmentStage &&
				canonicalTarget &&
				canonicalCommand &&
				canonicalIdempotencyKey &&
				canonicalCommandFingerprint &&
				assignment.status === expectedTerminalStatus &&
				assignmentStage.status === expectedTerminalStatus
					? await database.query.approvalWorkflowCommand.findFirst({
							where: and(
								eq(
									approvalWorkflowCommand.organizationId,
									input.organizationId,
								),
								eq(approvalWorkflowCommand.workflowId, canonicalTarget.id),
								eq(
									approvalWorkflowCommand.idempotencyKey,
									canonicalIdempotencyKey,
								),
								eq(
									approvalWorkflowCommand.actorFingerprint,
									canonicalActorFingerprint,
								),
								eq(
									approvalWorkflowCommand.commandFingerprint,
									canonicalCommandFingerprint,
								),
								eq(approvalWorkflowCommand.state, "completed"),
							),
							columns: {
								organizationId: true,
								workflowId: true,
								idempotencyKey: true,
								actorFingerprint: true,
								commandFingerprint: true,
								state: true,
								result: true,
							},
						})
					: null;
			const exactCanonicalReplay = Boolean(
				canonicalReplayReceipt &&
					canonicalReplayReceipt.organizationId === input.organizationId &&
					canonicalReplayReceipt.workflowId === canonicalTarget?.id &&
					canonicalReplayReceipt.idempotencyKey === canonicalIdempotencyKey &&
					canonicalReplayReceipt.actorFingerprint ===
						canonicalActorFingerprint &&
					canonicalReplayReceipt.commandFingerprint ===
						canonicalCommandFingerprint &&
					canonicalReplayReceipt.state === "completed" &&
					canonicalReplayReceipt.result !== null,
			);
			const terminalRequestMatches =
				request.status === expectedTerminalStatus &&
				(input.decision.kind === "approve"
					? requestRow?.approvedAt instanceof Date
					: requestRow?.rejectionReason === input.decision.reason);
			const period = await database.query.workPeriod.findFirst({
				where: and(
					eq(workPeriod.id, input.workPeriodId),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, request.requestedBy),
				),
			});
			if (
				!period ||
				period.id !== input.workPeriodId ||
				period.organizationId !== input.organizationId ||
				period.employeeId !== request.requestedBy ||
				!period.canonicalRecordId ||
				!period.endTime ||
				period.durationMinutes === null ||
				period.isActive !== false ||
				period.deletedAt !== null ||
				(period.approvalStatus !== "pending" &&
					!(
						(terminalRequestMatches || exactCanonicalReplay) &&
						period.approvalStatus === expectedTerminalStatus
					))
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const decisionPeriod = {
				id: period.id,
				organizationId: period.organizationId,
				employeeId: period.employeeId,
				canonicalRecordId: period.canonicalRecordId,
				startTime: period.startTime,
				endTime: period.endTime,
			};

			const authority = await context.writeGate.acquire({
				organizationId: input.organizationId,
				workflowType: metadata.kind,
			});
			const fixedGate = {
				acquire: async (scope: {
					organizationId: string;
					workflowType: OrdinaryTimeApprovalKind;
				}) => {
					if (
						scope.organizationId !== input.organizationId ||
						scope.workflowType !== metadata.kind
					) {
						throw new Error(ORDINARY_DECISION_ERROR);
					}
					return authority;
				},
			};
			const decisionContext = {
				...context,
				writeGate: fixedGate,
				compatibilityWriter:
					context.compatibilityWriter.withWriteGate(fixedGate),
			} as ApprovalWorkflowTransactionContext;
			if (
				authority.mode === "legacy" ||
				authority.mode === "shadow" ||
				authority.mode === "ready"
			) {
				const observedWorkflow =
					authority.mode === "legacy" || !period.approvalWorkflowId
						? null
						: await context.repository.loadSnapshot({
								organizationId: input.organizationId,
								workflowId: period.approvalWorkflowId,
							});
				const observedIdentityMatches =
					observedWorkflow?.id === period.approvalWorkflowId &&
					observedWorkflow.organizationId === input.organizationId &&
					observedWorkflow.workflowType === metadata.kind &&
					observedWorkflow.sourceType === "time_entry" &&
					observedWorkflow.sourceId === period.id &&
					observedWorkflow.requesterEmployeeId === period.employeeId;
				const observedIntermediateReplay =
					input.decision.kind === "approve" &&
					terminalRequestMatches &&
					period.approvalStatus === "pending" &&
					observedIdentityMatches &&
					observedWorkflow?.status === "pending" &&
					observedWorkflow.stages.some(
						(stage) =>
							stage.legacyApprovalRequestId === input.approvalRequestId &&
							stage.status === "approved" &&
							stage.assignments.some(
								(assignment) =>
									assignment.approverEmployeeId === request.approverId &&
									assignment.status === "approved",
							),
					);
				const verifiedLegacyIntermediateReplay =
					authority.mode === "legacy" &&
					terminalRequestMatches &&
					period.approvalStatus === "pending" &&
					isVerifiedLegacyIntermediateReplay({
						state: verifiedLegacyState,
						approvalRequestId: input.approvalRequestId,
						actorEmployeeId: actor.id,
						decision: input.decision.kind,
					});
				if (
					verifiedLegacyIntermediateReplay ||
					observedIntermediateReplay ||
					(terminalRequestMatches &&
						period.approvalStatus === expectedTerminalStatus &&
						(authority.mode === "legacy" ||
							(observedIdentityMatches &&
								observedWorkflow?.status === expectedTerminalStatus)))
				) {
					return {
						result: ordinaryDecisionResult({
							kind: metadata.kind,
							decision: input.decision,
							period: decisionPeriod,
						}),
						postCommit: null,
					};
				}
				if (!requestRow || request.status !== "pending") {
					throw new Error(ORDINARY_DECISION_ERROR);
				}
				const coordinator = createLegacyApprovalWriteCoordinator({
					writeGate: fixedGate,
					compatibilityWriter: decisionContext.compatibilityWriter,
				});
				if (
					authority.mode !== "legacy" &&
					(!observedWorkflow ||
						!Number.isSafeInteger(observedWorkflow.version) ||
						observedWorkflow.version < 1)
				) {
					throw new Error(ORDINARY_DECISION_ERROR);
				}
				let mutationResult: WorkPeriodApprovalResult | undefined;
				let captureCount = 0;
				const domainResult = await coordinator.execute({
					organizationId: input.organizationId,
					workflowType: metadata.kind,
					sourceIdentity: {
						organizationId: input.organizationId,
						workflowType: metadata.kind,
						sourceType: "time_entry",
						sourceId: period.id,
					},
					actor: {
						kind: "employee",
						employeeId: actor.id,
						userId: actor.userId,
					},
					idempotencyKey: `ordinary-decision:${input.organizationId}:${period.id}:${input.approvalRequestId}:${input.decision.kind}:${input.decision.reason ?? ""}`,
					expectedVersion: observedWorkflow?.version ?? null,
					captureState:
						authority.mode === "legacy"
							? undefined
							: async () => {
									captureCount += 1;
									if (captureCount === 1 && verifiedLegacyState) {
										return verifiedLegacyState;
									}
									return await captureOrdinaryWorkPeriodLegacyState({
										dbService: {
											db: database,
											query: input.dbService.query,
										},
										organizationId: input.organizationId,
										workPeriodId: period.id,
										expectedKind: metadata.kind,
										expectedRequesterEmployeeId: period.employeeId,
										approvalRequestId: input.approvalRequestId,
										expectedRequestStatus:
											input.decision.kind === "approve"
												? "approved"
												: "rejected",
										expectedSourceStatus:
											mutationResult === undefined
												? "pending"
												: input.decision.kind === "approve"
													? "approved"
													: "rejected",
									});
								},
					mutate: async () => {
						mutationResult = await Effect.runPromise(
							decideWorkPeriodWithCurrentApproverInTransaction(
								{
									db: database,
									query: input.dbService.query,
								},
								actor,
								period.id,
								metadata.kind,
								input.decision.kind,
								input.decision.reason ?? undefined,
								{
									approvalRequestId: input.approvalRequestId,
									allowAnyApprover: input.allowAnyApprover,
									allowOrganizationWideApprover:
										input.allowOrganizationWideApprover,
								},
							).pipe(
								Effect.provideService(
									ApprovalAuditLogger,
									createApprovalAuditLogger({
										db: database,
										query: input.dbService.query,
									}),
								),
							) as Effect.Effect<
								WorkPeriodApprovalResult | undefined,
								unknown,
								never
							>,
						);
						return mutationResult;
					},
				});
				const result =
					(domainResult as WorkPeriodApprovalResult | undefined) ??
					ordinaryDecisionResult({
						kind: metadata.kind,
						decision: input.decision,
						period: decisionPeriod,
					});
				return {
					result,
					postCommit: Object.freeze({
						disposition: "dispatch" as const,
						dedupeKey: `ordinary-decision:${period.id}:${input.approvalRequestId}:${input.decision.kind}`,
						event: domainResult
							? input.decision.kind === "approve"
								? ("approved" as const)
								: ("rejected" as const)
							: ("pending" as const),
						organizationId: input.organizationId,
						workPeriodId: period.id,
						requesterEmployeeId: period.employeeId,
						approverEmployeeId: actor.id,
						kind: metadata.kind,
						startTime: instantToCanonicalString(
							instantFromDate(period.startTime),
						),
						endTime: instantToCanonicalString(instantFromDate(period.endTime)),
						durationMinutes: period.durationMinutes,
						reason: input.decision.reason,
						maintenance: domainResult?.maintenance ?? null,
					}),
				};
			}
			if (
				!period.approvalWorkflowId ||
				(metadata.workflowId !== null &&
					metadata.workflowId !== period.approvalWorkflowId) ||
				(metadata.workflowOrganizationId !== null &&
					metadata.workflowOrganizationId !== input.organizationId)
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const snapshot = await context.repository.loadSnapshot({
				organizationId: input.organizationId,
				workflowId: period.approvalWorkflowId,
			});
			if (
				snapshot.id !== period.approvalWorkflowId ||
				snapshot.organizationId !== input.organizationId ||
				snapshot.workflowType !== metadata.kind ||
				snapshot.sourceType !== "time_entry" ||
				snapshot.sourceId !== period.id ||
				snapshot.requesterEmployeeId !== period.employeeId ||
				(snapshot.status !== "pending" &&
					!(
						(terminalRequestMatches || exactCanonicalReplay) &&
						snapshot.status === expectedTerminalStatus
					))
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			if (exactCanonicalReplay && canonicalCommand && canonicalIdempotencyKey) {
				const replay =
					await input.runtime.transitionEngine.executeInTransactionWithDisposition(
						decisionContext,
						{
							organizationId: input.organizationId,
							workflowId: snapshot.id,
							expectedVersion: snapshot.version,
							idempotencyKey: canonicalIdempotencyKey,
							principal: { kind: "employee", userId: actor.userId },
							command: canonicalCommand,
						},
					);
				if (replay.disposition !== "replayed") {
					throw new Error(ORDINARY_DECISION_ERROR);
				}
				return {
					result: ordinaryDecisionResult({
						kind: metadata.kind,
						decision: input.decision,
						period: decisionPeriod,
					}),
					postCommit: null,
				};
			}
			const targets = snapshot.stages.flatMap((stage) =>
				(metadata.stageId === null || stage.id === metadata.stageId) &&
				(metadata.stageSequence === null ||
					stage.sequence === metadata.stageSequence) &&
				(terminalRequestMatches ||
					snapshot.status !== "pending" ||
					stage.sequence === snapshot.currentStageOrder) &&
				stage.status ===
					(terminalRequestMatches
						? expectedTerminalStatus
						: snapshot.status === "pending"
							? "pending"
							: expectedTerminalStatus) &&
				(requestRow
					? stage.legacyApprovalRequestId === input.approvalRequestId
					: true)
					? stage.assignments.flatMap((assignment) =>
							(metadata.assignmentId === null ||
								assignment.id === metadata.assignmentId) &&
							assignment.status ===
								(terminalRequestMatches
									? expectedTerminalStatus
									: snapshot.status === "pending"
										? "pending"
										: expectedTerminalStatus) &&
							(requestRow
								? assignment.approverEmployeeId === request.approverId
								: true)
								? [{ stage, assignment }]
								: [],
						)
					: [],
			);
			const target = targets[0];
			if (targets.length !== 1 || !target) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const execution =
				await input.runtime.transitionEngine.executeInTransactionWithDisposition(
					decisionContext,
					{
						organizationId: input.organizationId,
						workflowId: snapshot.id,
						expectedVersion: snapshot.version,
						idempotencyKey: `ordinary-decision:${input.organizationId}:${snapshot.id}:${input.approvalRequestId}:${input.decision.kind}:${input.decision.reason ?? ""}`,
						principal: { kind: "employee", userId: actor.userId },
						command:
							input.decision.kind === "approve"
								? {
										type: "approve",
										stageId: target.stage.id,
										assignmentId: target.assignment.id,
									}
								: {
										type: "reject",
										stageId: target.stage.id,
										assignmentId: target.assignment.id,
										reason: input.decision.reason,
									},
					},
				);
			const result = ordinaryDecisionResult({
				kind: metadata.kind,
				decision: input.decision,
				period: decisionPeriod,
			});
			if (execution.disposition === "replayed") {
				return { result, postCommit: null };
			}
			const event =
				execution.result.snapshot.status === "approved"
					? "approved"
					: execution.result.snapshot.status === "rejected"
						? "rejected"
						: "pending";
			const maintenance =
				event === "pending"
					? null
					: exactMaintenanceFacts(execution.finalization?.maintenance, {
							organizationId: input.organizationId,
							employeeId: period.employeeId,
							decision: event,
						});
			return {
				result,
				postCommit: Object.freeze({
					disposition: "observe" as const,
					dedupeKey: `ordinary-decision:${snapshot.id}:${input.approvalRequestId}:${snapshot.version}`,
					event,
					organizationId: input.organizationId,
					workPeriodId: period.id,
					requesterEmployeeId: period.employeeId,
					approverEmployeeId: actor.id,
					kind: metadata.kind,
					startTime: instantToCanonicalString(
						instantFromDate(period.startTime),
					),
					endTime: instantToCanonicalString(instantFromDate(period.endTime)),
					durationMinutes: period.durationMinutes,
					reason: input.decision.reason,
					maintenance,
				}),
			};
		});
	} catch {
		throw new Error(ORDINARY_DECISION_ERROR);
	}
}

function decideWorkPeriodWithCurrentApproverInTransaction(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	workPeriodId: string,
	kind: OrdinaryTimeApprovalKind,
	action: "approve" | "reject",
	reason: string | undefined,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"time_entry",
		workPeriodId,
		action,
		reason,
		(decisionDbService, entityId, approver, approval) =>
			finalizeCurrentWorkPeriodDecision(
				decisionDbService,
				entityId,
				approver,
				approval,
				kind,
				action,
				reason ?? null,
				"manager",
			),
		undefined,
		{ ...options, transactional: true },
		undefined,
		"existing",
	);
}

type ApprovalWithRequester = PendingApprovalRequest & { requestedBy: string };

function conflict(message: string) {
	return new ConflictError({ message, conflictType: "approval_status" });
}

function ordinaryWorkPeriodFinalizationConflict(): Error {
	return new Error("Ordinary work-period finalization conflict");
}

function sameDate(left: Date, right: Date): boolean {
	return left.getTime() === right.getTime();
}

function exactOwnDataValues(
	value: unknown,
	expectedKeys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (
		keys.length !== expectedKeys.length ||
		keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const result: Record<string, unknown> = {};
	for (const key of expectedKeys) {
		const descriptor = descriptors[key];
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		result[key] = descriptor.value;
	}
	return result;
}

function exactOwnDataValue(value: unknown, key: string): unknown {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !("value" in descriptor)) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	return descriptor.value;
}

function validateTerminalEvidence(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): OrdinaryWorkPeriodTerminalEvidence {
	const evidenceValue = exactOwnDataValue(input, "evidence");
	const mode = exactOwnDataValue(evidenceValue, "mode");
	if (mode === "canonical") {
		const evidence = exactOwnDataValues(evidenceValue, [
			"mode",
			"workflowId",
			"payload",
		]);
		if (
			typeof evidence.workflowId !== "string" ||
			evidence.workflowId !== input.expectedApprovalWorkflowId
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		const payload = parseOrdinaryWorkPeriodWorkflowPayload(
			evidence.payload,
			input.kind,
		);
		return { mode, workflowId: evidence.workflowId, payload };
	}
	if (mode === "legacy") {
		const evidence = exactOwnDataValues(evidenceValue, [
			"mode",
			"approvalRequestId",
			"requestMode",
			"expectedStatus",
		]);
		if (
			typeof evidence.approvalRequestId !== "string" ||
			(evidence.requestMode !== "manager" &&
				evidence.requestMode !== "requester_auto_completed") ||
			(evidence.expectedStatus !== "approved" &&
				evidence.expectedStatus !== "rejected") ||
			(evidence.requestMode === "requester_auto_completed" &&
				evidence.expectedStatus !== "approved")
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		return {
			mode,
			approvalRequestId: evidence.approvalRequestId,
			requestMode: evidence.requestMode,
			expectedStatus: evidence.expectedStatus,
		};
	}
	throw ordinaryWorkPeriodFinalizationConflict();
}

function validateOrdinaryRequestMetadata(
	metadata: unknown,
	input: Pick<
		FinalizeOrdinaryWorkPeriodTerminalInput,
		"expectedApprovalWorkflowId" | "kind" | "organizationId" | "workPeriodId"
	> & { requesterAutoCompleted: boolean },
): Readonly<
	import("../domain-adapters/work-period-contract").OrdinaryWorkPeriodWorkflowPayload
> {
	const markerDescriptor =
		typeof metadata === "object" &&
		metadata !== null &&
		!Array.isArray(metadata)
			? Object.getOwnPropertyDescriptor(metadata, "ordinarySubmission")
			: undefined;
	if (
		markerDescriptor &&
		(!markerDescriptor.enumerable || !("value" in markerDescriptor))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const hasMarker = markerDescriptor !== undefined;
	const snapshotDescriptor =
		typeof metadata === "object" &&
		metadata !== null &&
		!Array.isArray(metadata)
			? Object.getOwnPropertyDescriptor(metadata, "breakPolicySnapshot")
			: undefined;
	if (
		snapshotDescriptor &&
		(!snapshotDescriptor.enumerable || !("value" in snapshotDescriptor))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const hasSnapshot = snapshotDescriptor !== undefined;
	const surchargeSnapshotDescriptor =
		typeof metadata === "object" &&
		metadata !== null &&
		!Array.isArray(metadata)
			? Object.getOwnPropertyDescriptor(metadata, "surchargeSnapshot")
			: undefined;
	if (
		surchargeSnapshotDescriptor &&
		(!surchargeSnapshotDescriptor.enumerable ||
			!("value" in surchargeSnapshotDescriptor))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const hasSurchargeSnapshot = surchargeSnapshotDescriptor !== undefined;
	const stageDescriptor =
		typeof metadata === "object" &&
		metadata !== null &&
		!Array.isArray(metadata)
			? Object.getOwnPropertyDescriptor(metadata, "stage")
			: undefined;
	const workflowDescriptor =
		typeof metadata === "object" &&
		metadata !== null &&
		!Array.isArray(metadata)
			? Object.getOwnPropertyDescriptor(metadata, "workflow")
			: undefined;
	if (
		(workflowDescriptor === undefined) !== (stageDescriptor === undefined) ||
		(workflowDescriptor &&
			(!workflowDescriptor.enumerable || !("value" in workflowDescriptor))) ||
		(stageDescriptor &&
			(!stageDescriptor.enumerable || !("value" in stageDescriptor)))
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	if (
		input.kind === "policy_clock_out" &&
		hasMarker &&
		(!hasSnapshot || !hasSurchargeSnapshot)
	) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	const expectedKeys = [
		"timeRequest",
		...(hasSnapshot ? ["breakPolicySnapshot"] : []),
		...(hasSurchargeSnapshot ? ["surchargeSnapshot"] : []),
		...(workflowDescriptor ? ["workflow"] : []),
		...(stageDescriptor ? ["stage"] : []),
		...(hasMarker ? ["ordinarySubmission"] : []),
		...(input.requesterAutoCompleted ? ["autoApproval"] : []),
	];
	const root = exactOwnDataValues(metadata, expectedKeys);
	const payload = parseOrdinaryWorkPeriodWorkflowPayload(
		{
			timeRequest: root.timeRequest,
			...(hasSnapshot ? { breakPolicySnapshot: root.breakPolicySnapshot } : {}),
			...(hasSurchargeSnapshot
				? { surchargeSnapshot: root.surchargeSnapshot }
				: {}),
		},
		input.kind,
	);
	if (workflowDescriptor && stageDescriptor) {
		const workflow = exactOwnDataValues(root.workflow, [
			"id",
			"organizationId",
		]);
		if (
			typeof workflow.id !== "string" ||
			workflow.id.length === 0 ||
			(input.expectedApprovalWorkflowId !== null &&
				workflow.id !== input.expectedApprovalWorkflowId) ||
			workflow.organizationId !== input.organizationId
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		const stage = exactOwnDataValues(root.stage, ["id", "sequence"]);
		if (
			typeof stage.id !== "string" ||
			stage.id.length === 0 ||
			typeof stage.sequence !== "number" ||
			!Number.isInteger(stage.sequence) ||
			stage.sequence < 1
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
	}
	if (input.requesterAutoCompleted) {
		const autoApproval = exactOwnDataValues(root.autoApproval, ["reason"]);
		if (autoApproval.reason !== "requester_is_approver") {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
	}
	if (hasMarker) {
		const marker = exactOwnDataValues(root.ordinarySubmission, [
			"key",
			"submissionId",
		]);
		if (
			typeof marker.submissionId !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
				marker.submissionId,
			)
		) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
		const expectedKey = deriveApprovalWorkflowId({
			organizationId: input.organizationId,
			workflowType: input.kind,
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
			allocationKey: marker.submissionId,
		});
		if (marker.key !== expectedKey) {
			throw ordinaryWorkPeriodFinalizationConflict();
		}
	}
	return payload;
}

async function finalizeOrdinaryWorkPeriodTerminal(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): Promise<WorkPeriodApprovalResult> {
	const fail = ordinaryWorkPeriodFinalizationConflict;
	const evidence = validateTerminalEvidence(input);
	const db: ApprovalDbService["db"] = input.dbService.db;
	const periods = await db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			canonicalRecordId: workPeriod.canonicalRecordId,
			approvalWorkflowId: workPeriod.approvalWorkflowId,
			approvalStatus: workPeriod.approvalStatus,
			pendingChanges: workPeriod.pendingChanges,
			projectId: workPeriod.projectId,
			workCategoryId: workPeriod.workCategoryId,
			workLocationType: workPeriod.workLocationType,
			isActive: workPeriod.isActive,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.requesterEmployeeId),
			),
		)
		.for("update");
	if (periods.length !== 1) throw fail();
	const selectedPeriod = periods[0];
	const period = selectedPeriod
		? {
				...selectedPeriod,
				pendingChanges: decodeApprovalDatabaseJsonText(
					selectedPeriod.pendingChanges,
				),
			}
		: null;
	if (
		!period ||
		period.id !== input.workPeriodId ||
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.requesterEmployeeId ||
		period.approvalStatus !== "pending" ||
		period.isActive !== false ||
		period.deletedAt !== null ||
		!period.clockInId ||
		!period.clockOutId ||
		!period.canonicalRecordId ||
		!period.endTime ||
		period.durationMinutes === null ||
		period.approvalWorkflowId !== input.expectedApprovalWorkflowId ||
		(evidence.mode === "canonical" &&
			period.approvalWorkflowId !== evidence.workflowId)
	) {
		throw fail();
	}
	const evaluatedAt = instantToCanonicalString(instantFromDate(period.endTime));
	let sourceBreakPolicySnapshot: PolicyClockOutBreakSnapshot | null = null;
	let sourceSurchargeSnapshot: PolicyClockOutSurchargeSnapshot | null = null;
	if (evidence.mode === "canonical") {
		try {
			if (input.kind === "policy_clock_out") {
				sourceBreakPolicySnapshot =
					policyClockOutBreakSnapshotFromPendingChanges(
						period.pendingChanges,
						evaluatedAt,
					);
			}
			sourceSurchargeSnapshot =
				policyClockOutSurchargeSnapshotFromPendingChanges(
					period.pendingChanges,
					evaluatedAt,
				);
		} catch {
			throw fail();
		}
	}
	if (
		evidence.mode === "canonical" &&
		(!evidence.payload.surchargeSnapshot ||
			!policyClockOutSurchargeSnapshotsEqual(
				sourceSurchargeSnapshot,
				evidence.payload.surchargeSnapshot,
				evaluatedAt,
			) ||
			(input.kind === "policy_clock_out" &&
				(!evidence.payload.breakPolicySnapshot ||
					!policyClockOutBreakSnapshotsEqual(
						sourceBreakPolicySnapshot,
						evidence.payload.breakPolicySnapshot,
						evaluatedAt,
					))))
	) {
		throw fail();
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
			origin: timeRecord.origin,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.employeeId, input.requesterEmployeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.for("update");
	if (records.length !== 1) throw fail();
	const record = records[0];
	if (
		!record ||
		record.id !== period.canonicalRecordId ||
		record.organizationId !== input.organizationId ||
		record.employeeId !== period.employeeId ||
		record.recordKind !== "work" ||
		record.approvalState !== "pending" ||
		!record.endAt ||
		record.durationMinutes === null ||
		!sameDate(record.startAt, period.startTime) ||
		!sameDate(record.endAt, period.endTime) ||
		record.durationMinutes !== period.durationMinutes
	) {
		throw fail();
	}

	const actor = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, input.actorEmployeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.userId, input.actorUserId),
			eq(employee.isActive, true),
		),
		columns: { id: true, userId: true, isActive: true },
	});
	if (
		!actor ||
		actor.id !== input.actorEmployeeId ||
		actor.userId !== input.actorUserId ||
		actor.isActive !== true
	) {
		throw fail();
	}
	const sourceClockIn = await db.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.id, period.clockInId),
			eq(timeEntry.organizationId, input.organizationId),
			eq(timeEntry.employeeId, input.requesterEmployeeId),
		),
		columns: { id: true, utcOffsetMinutes: true },
	});
	if (
		!sourceClockIn ||
		sourceClockIn.id !== period.clockInId ||
		!Number.isInteger(sourceClockIn.utcOffsetMinutes)
	) {
		throw fail();
	}
	let maintenance: WorkPeriodMaintenanceFacts | null = {
		organizationId: input.organizationId,
		employeeId: input.requesterEmployeeId,
		dirtyFromDate: instantFromDate(period.startTime)
			.toZonedDateTimeISO(
				offsetMinutesToTimeZoneId(sourceClockIn.utcOffsetMinutes),
			)
			.toPlainDate()
			.toString(),
		decision: input.transition.kind === "approve" ? "approved" : "rejected",
		surchargePeriodIds: input.transition.kind === "approve" ? [period.id] : [],
		staleSurchargePeriodIds:
			input.transition.kind === "reject" ? [period.id] : [],
		surchargeSnapshot: sourceSurchargeSnapshot,
	};

	const terminalStatus =
		input.transition.kind === "approve" ? "approved" : "rejected";
	let historicalPolicyClockOut = false;
	let historicalManualSubmission = false;
	if (evidence.mode === "legacy") {
		if (evidence.expectedStatus !== terminalStatus) throw fail();
		const requests = await db
			.select({
				id: approvalRequest.id,
				organizationId: approvalRequest.organizationId,
				entityType: approvalRequest.entityType,
				entityId: approvalRequest.entityId,
				requestedBy: approvalRequest.requestedBy,
				approverId: approvalRequest.approverId,
				status: approvalRequest.status,
				approvedAt: approvalRequest.approvedAt,
				canonicalRecordId: approvalRequest.canonicalRecordId,
				rejectionReason: approvalRequest.rejectionReason,
				metadata: approvalRequest.metadata,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.id, evidence.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, input.workPeriodId),
					eq(approvalRequest.requestedBy, input.requesterEmployeeId),
					eq(approvalRequest.status, terminalStatus),
				),
			)
			.limit(2);
		if (requests.length !== 1) throw fail();
		const request = requests[0];
		if (
			!request ||
			request.id !== evidence.approvalRequestId ||
			request.organizationId !== input.organizationId ||
			request.entityType !== "time_entry" ||
			request.entityId !== input.workPeriodId ||
			request.requestedBy !== input.requesterEmployeeId ||
			request.status !== terminalStatus ||
			(request.canonicalRecordId !== null &&
				request.canonicalRecordId !== period.canonicalRecordId) ||
			(input.transition.kind === "reject" &&
				request.rejectionReason !== input.transition.reason)
		) {
			throw fail();
		}
		const persistedRequesterAutoCompleted =
			request.status === "approved" &&
			request.requestedBy === input.requesterEmployeeId &&
			request.approverId === input.requesterEmployeeId &&
			request.approvedAt instanceof Date &&
			!Number.isNaN(request.approvedAt.getTime());
		const requesterAutoCompleted =
			evidence.requestMode === "requester_auto_completed";
		if (requesterAutoCompleted !== persistedRequesterAutoCompleted)
			throw fail();
		try {
			const terminalMetadata =
				request.metadata === null && input.expectedApprovalWorkflowId === null
					? { timeRequest: { kind: input.kind } }
					: request.metadata;
			const historicalUnmarkedOrdinary =
				input.expectedApprovalWorkflowId === null &&
				!requesterAutoCompleted &&
				request.approverId === input.actorEmployeeId &&
				(typeof terminalMetadata !== "object" ||
					terminalMetadata === null ||
					Object.getOwnPropertyDescriptor(
						terminalMetadata,
						"ordinarySubmission",
					) === undefined) &&
				(() => {
					const metadata = exactOwnDataValues(terminalMetadata, [
						"timeRequest",
					]);
					const timeRequest = exactOwnDataValues(metadata.timeRequest, [
						"kind",
					]);
					return timeRequest.kind === input.kind;
				})();
			historicalPolicyClockOut =
				input.kind === "policy_clock_out" && historicalUnmarkedOrdinary;
			historicalManualSubmission =
				input.kind === "manual_time_submission" && historicalUnmarkedOrdinary;
			if (historicalPolicyClockOut) {
				maintenance = null;
			} else if (historicalManualSubmission) {
				if (maintenance && input.transition.kind === "approve") {
					maintenance = {
						...maintenance,
						surchargePeriodIds: [],
						surchargeSnapshot: null,
					};
				}
			} else {
				const requestPayload = validateOrdinaryRequestMetadata(
					terminalMetadata,
					{
						expectedApprovalWorkflowId: input.expectedApprovalWorkflowId,
						kind: input.kind,
						organizationId: input.organizationId,
						workPeriodId: input.workPeriodId,
						requesterAutoCompleted,
					},
				);
				if (
					input.kind === "policy_clock_out" ||
					input.kind === "manual_time_submission"
				) {
					try {
						if (input.kind === "policy_clock_out") {
							sourceBreakPolicySnapshot =
								policyClockOutBreakSnapshotFromPendingChanges(
									period.pendingChanges,
									evaluatedAt,
								);
						}
						sourceSurchargeSnapshot =
							policyClockOutSurchargeSnapshotFromPendingChanges(
								period.pendingChanges,
								evaluatedAt,
							);
					} catch {
						throw fail();
					}
					if (
						!requestPayload.surchargeSnapshot ||
						!policyClockOutSurchargeSnapshotsEqual(
							sourceSurchargeSnapshot,
							requestPayload.surchargeSnapshot,
							evaluatedAt,
						) ||
						(input.kind === "policy_clock_out" &&
							(!requestPayload.breakPolicySnapshot ||
								!policyClockOutBreakSnapshotsEqual(
									sourceBreakPolicySnapshot,
									requestPayload.breakPolicySnapshot,
									evaluatedAt,
								)))
					) {
						throw fail();
					}
					if (maintenance) {
						maintenance = {
							...maintenance,
							surchargeSnapshot: sourceSurchargeSnapshot,
						};
					}
				}
			}
		} catch {
			throw fail();
		}
	}

	const finalizedAt = dateFromInstant(input.finalizedAt);
	const updatedPeriods = await db
		.update(workPeriod)
		.set({
			approvalStatus: terminalStatus,
			pendingChanges: null,
			updatedAt: finalizedAt,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, period.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				eq(workPeriod.clockInId, period.clockInId),
				eq(workPeriod.clockOutId, period.clockOutId),
				eq(workPeriod.canonicalRecordId, period.canonicalRecordId),
				input.expectedApprovalWorkflowId === null
					? isNull(workPeriod.approvalWorkflowId)
					: eq(workPeriod.approvalWorkflowId, input.expectedApprovalWorkflowId),
				eq(workPeriod.startTime, period.startTime),
				eq(workPeriod.endTime, period.endTime),
				eq(workPeriod.durationMinutes, period.durationMinutes),
				eq(workPeriod.approvalStatus, "pending"),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (updatedPeriods.length !== 1 || updatedPeriods[0]?.id !== period.id) {
		throw fail();
	}

	const updatedRecords = await db
		.update(timeRecord)
		.set({
			approvalState: terminalStatus,
			updatedAt: finalizedAt,
			updatedBy: input.actorUserId,
		})
		.where(
			and(
				eq(timeRecord.id, record.id),
				eq(timeRecord.organizationId, record.organizationId),
				eq(timeRecord.employeeId, record.employeeId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.startAt, record.startAt),
				eq(timeRecord.endAt, record.endAt),
				eq(timeRecord.durationMinutes, record.durationMinutes),
				eq(timeRecord.approvalState, "pending"),
			),
		)
		.returning({ id: timeRecord.id });
	if (updatedRecords.length !== 1 || updatedRecords[0]?.id !== record.id) {
		throw fail();
	}
	if (
		input.kind === "policy_clock_out" &&
		input.transition.kind === "approve" &&
		!historicalPolicyClockOut
	) {
		if (!sourceBreakPolicySnapshot || !sourceSurchargeSnapshot) throw fail();
		const breakResult = await applyPolicyClockOutTerminalBreakInTransaction({
			dbService: input.dbService,
			organizationId: input.organizationId,
			employeeId: input.requesterEmployeeId,
			actorUserId: input.actorUserId,
			period: {
				id: period.id,
				organizationId: period.organizationId,
				employeeId: period.employeeId,
				clockInId: period.clockInId,
				clockOutId: period.clockOutId,
				canonicalRecordId: period.canonicalRecordId,
				approvalWorkflowId: period.approvalWorkflowId,
				startTime: period.startTime,
				endTime: period.endTime,
				durationMinutes: period.durationMinutes,
				projectId: period.projectId,
				workCategoryId: period.workCategoryId,
				workLocationType: period.workLocationType,
			},
			adjustedAt: input.finalizedAt,
			breakPolicySnapshot: sourceBreakPolicySnapshot,
			surchargeSnapshot: sourceSurchargeSnapshot,
		});
		maintenance = breakResult.maintenance;
	}

	const decisions = await db
		.insert(timeRecordApprovalDecision)
		.values({
			organizationId: input.organizationId,
			recordId: record.id,
			actorEmployeeId: input.actorEmployeeId,
			action: terminalStatus,
			reason: input.transition.reason,
			createdAt: finalizedAt,
		})
		.returning({ id: timeRecordApprovalDecision.id });
	if (decisions.length !== 1) throw fail();

	return {
		kind: input.kind,
		action: input.transition.kind,
		reason: input.transition.reason,
		period: {
			id: period.id,
			organizationId: period.organizationId,
			employeeId: period.employeeId,
			canonicalRecordId: period.canonicalRecordId,
			startTime: new Date(period.startTime.getTime()),
			endTime: new Date(period.endTime.getTime()),
		},
		maintenance,
	};
}

export async function finalizeOrdinaryWorkPeriodTerminalInTransaction(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): Promise<WorkPeriodApprovalResult> {
	try {
		return await finalizeOrdinaryWorkPeriodTerminal(input);
	} catch {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
}

function isOrdinaryWorkPeriodFinalizerDatabase(
	value: unknown,
): value is OrdinaryWorkPeriodFinalizerDatabase {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	const query = candidate.query;
	if (typeof query !== "object" || query === null) return false;
	const employeeQuery = (query as Record<string, unknown>).employee;
	const timeEntryQuery = (query as Record<string, unknown>).timeEntry;
	return (
		typeof candidate.execute === "function" &&
		typeof candidate.select === "function" &&
		typeof candidate.update === "function" &&
		typeof candidate.insert === "function" &&
		typeof employeeQuery === "object" &&
		employeeQuery !== null &&
		typeof (employeeQuery as Record<string, unknown>).findFirst ===
			"function" &&
		typeof timeEntryQuery === "object" &&
		timeEntryQuery !== null &&
		typeof (timeEntryQuery as Record<string, unknown>).findFirst === "function"
	);
}

export function requireOrdinaryWorkPeriodFinalizerDbService(
	dbService: FinalizeOrdinaryWorkPeriodTerminalAdapterInput["dbService"],
): OrdinaryWorkPeriodFinalizerDbService {
	if (!isOrdinaryWorkPeriodFinalizerDatabase(dbService.db)) {
		throw ordinaryWorkPeriodFinalizationConflict();
	}
	return { db: dbService.db };
}

export async function finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction(
	input: FinalizeOrdinaryWorkPeriodTerminalAdapterInput,
): Promise<WorkPeriodApprovalResult> {
	return finalizeOrdinaryWorkPeriodTerminalInTransaction({
		...input,
		dbService: requireOrdinaryWorkPeriodFinalizerDbService(input.dbService),
	});
}

function finalizeCurrentWorkPeriodDecision(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	approval: PendingApprovalRequest,
	kind: OrdinaryTimeApprovalKind,
	action: "approve" | "reject",
	reason: string | null,
	requestMode: "manager" | "requester_auto_completed",
) {
	return Effect.gen(function* (_) {
		const requestedBy = (approval as ApprovalWithRequester).requestedBy;
		const source = yield* _(
			dbService.query("getOrdinaryApprovalWorkflowLink", async () => {
				return await dbService.db.query.workPeriod.findFirst({
					where: and(
						eq(workPeriod.id, entityId),
						eq(workPeriod.organizationId, approval.organizationId),
						eq(workPeriod.employeeId, requestedBy),
					),
					columns: { approvalWorkflowId: true },
				});
			}),
		);
		if (!source) {
			return yield* _(
				Effect.fail(conflict("Ordinary work-period finalization conflict")),
			);
		}

		return yield* _(
			Effect.tryPromise({
				try: () =>
					finalizeOrdinaryWorkPeriodTerminalInTransaction({
						dbService,
						organizationId: approval.organizationId,
						workPeriodId: entityId,
						expectedApprovalWorkflowId: source.approvalWorkflowId,
						requesterEmployeeId: requestedBy,
						actorEmployeeId: currentEmployee.id,
						actorUserId: currentEmployee.userId,
						kind,
						evidence: {
							mode: "legacy",
							approvalRequestId: approval.id,
							requestMode,
							expectedStatus: action === "approve" ? "approved" : "rejected",
						},
						transition:
							action === "approve"
								? { kind: "approve", reason }
								: { kind: "reject", reason: reason ?? "" },
						finalizedAt: systemClock.nowInstant(),
					}),
				catch: () => conflict("Ordinary work-period finalization conflict"),
			}),
		);
	});
}

export function notifyWorkPeriodApprovalAfterCommit(
	result: WorkPeriodApprovalResult,
	currentEmployee: CurrentApprover,
	dbService: ApprovalDbService,
) {
	return Effect.promise(async () => {
		const requester = await dbService.db.query.employee.findFirst({
			where: and(
				eq(employee.id, result.period.employeeId),
				eq(employee.organizationId, result.period.organizationId),
			),
			columns: { userId: true },
		});
		if (!requester) return;
		const params = {
			workPeriodId: result.period.id,
			employeeUserId: requester.userId,
			organizationId: result.period.organizationId,
			approverName: currentEmployee.user.name,
			startTime: result.period.startTime,
			endTime: result.period.endTime,
			...(result.reason ? { rejectionReason: result.reason } : {}),
		};

		if (result.kind === "manual_time_submission") {
			await (result.action === "approve"
				? onManualEntryApproved(params)
				: onManualEntryRejected(params));
			return;
		}

		await (result.action === "approve"
			? onClockOutApproved(params)
			: onClockOutRejected(params));
	});
}

export async function completeOrdinaryWorkPeriodDecisionAfterCommit<
	Execution extends {
		postCommit: {
			disposition: "dispatch" | "observe";
			event: string;
			maintenance: WorkPeriodMaintenanceFacts | null;
		} | null;
	},
>(input: {
	execute: () => Promise<Execution>;
	dispatch: (execution: Execution) => Promise<void>;
	maintain: (maintenance: WorkPeriodMaintenanceFacts) => Promise<void>;
	dispatchPending?: boolean;
	onDispatchError: (error: unknown) => void;
	onMaintenanceError: (error: unknown) => void;
}): Promise<Execution> {
	const execution = await input.execute();
	const tasks: Array<{
		kind: "dispatch" | "maintenance";
		promise: Promise<void>;
	}> = [];
	const maintenance = execution.postCommit?.maintenance;
	if (maintenance) {
		tasks.push({
			kind: "maintenance",
			promise: Promise.resolve().then(() => input.maintain(maintenance)),
		});
	}
	if (
		execution.postCommit?.disposition === "dispatch" &&
		(execution.postCommit.event !== "pending" || input.dispatchPending === true)
	) {
		tasks.push({
			kind: "dispatch",
			promise: Promise.resolve().then(() => input.dispatch(execution)),
		});
	}
	const settled = await Promise.allSettled(tasks.map((task) => task.promise));
	for (const [index, result] of settled.entries()) {
		if (result.status === "fulfilled") continue;
		if (tasks[index]?.kind === "maintenance") {
			input.onMaintenanceError(result.reason);
		} else {
			input.onDispatchError(result.reason);
		}
	}
	return execution;
}

export async function reconcileOrdinaryWorkPeriodMaintenanceAfterCommit(
	maintenance: WorkPeriodMaintenanceFacts,
	dependencies: {
		reconcileSurcharges: (
			maintenance: WorkPeriodMaintenanceFacts,
		) => Promise<void>;
		markWorkBalanceDirty: typeof markEmployeeWorkBalanceDirty;
	} = {
		reconcileSurcharges: (facts) =>
			Effect.runPromise(
				Effect.gen(function* (_) {
					const service = yield* _(SurchargeService);
					yield* _(
						service.reconcileWorkPeriods({
							organizationId: facts.organizationId,
							employeeId: facts.employeeId,
							surchargePeriodIds: facts.surchargePeriodIds,
							staleSurchargePeriodIds: facts.staleSurchargePeriodIds,
							surchargeSnapshot: facts.surchargeSnapshot,
						}),
					);
				}).pipe(
					Effect.provide(SurchargeServiceLive),
					Effect.provide(DatabaseServiceLive),
				),
			),
		markWorkBalanceDirty: markEmployeeWorkBalanceDirty,
	},
): Promise<void> {
	const surcharge = Promise.resolve().then(() =>
		dependencies.reconcileSurcharges(maintenance),
	);
	const balance = Promise.resolve().then(() =>
		dependencies.markWorkBalanceDirty({
			organizationId: maintenance.organizationId,
			employeeId: maintenance.employeeId,
			dirtyFromDate: maintenance.dirtyFromDate,
		}),
	);
	const settled = await Promise.allSettled([surcharge, balance]);
	const failures = settled.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	if (failures.length > 0) {
		throw new AggregateError(
			failures,
			"Ordinary work-period maintenance failed",
		);
	}
}

export function decideOrdinaryWorkPeriodWithStableTargetEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	input: {
		approvalRequestId: string;
		workPeriodId: string;
		decision:
			| { kind: "approve"; reason: string | null }
			| { kind: "reject"; reason: string };
	},
	options?: ApprovalActionOptions,
) {
	return Effect.tryPromise({
		try: async () => {
			if (
				currentEmployee.organizationId.length === 0 ||
				input.approvalRequestId.length === 0 ||
				input.workPeriodId.length === 0 ||
				(options?.approvalRequestId !== undefined &&
					options.approvalRequestId !== input.approvalRequestId)
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const runtime = createProductionApprovalWorkflowRuntime({
				db: dbService.db,
				adapters: {
					absence: {
						clock: systemClock,
						finalizeAbsenceTerminal: async () => {
							throw new Error("Absence finalization is outside this boundary");
						},
						deleteCancelledAbsence: async () => {
							throw new Error("Absence cancellation is outside this boundary");
						},
					},
					timeCorrection: {
						clock: systemClock,
						finalizeTimeCorrectionTerminal: async () => {
							throw new Error(
								"Time correction finalization is outside this boundary",
							);
						},
						deleteCancelledCorrections: async () => {
							throw new Error(
								"Time correction cancellation is outside this boundary",
							);
						},
					},
					ordinaryWorkPeriod: {
						finalizeTerminal:
							finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
					},
				},
				canManageApproval: async (authorization) => {
					if (
						authorization.organizationId !== currentEmployee.organizationId ||
						authorization.actorEmployeeId !== currentEmployee.id
					) {
						return false;
					}
					const ability = await getAbility();
					if (
						options?.allowOrganizationWideApprover === true &&
						ability?.cannot("manage", "Approval") === false
					) {
						return true;
					}
					const command = authorization.command;
					if (command.type !== "approve" && command.type !== "reject") {
						return false;
					}
					const stage = authorization.workflow.stages.find(
						(candidate) =>
							candidate.id === command.stageId &&
							candidate.sequence === authorization.workflow.currentStageOrder &&
							candidate.status === "pending",
					);
					if (!stage?.legacyApprovalRequestId) return false;
					return await isEligibleManagerForApprovalRequest({
						db: authorization.dbService.db as never,
						approvalRequestId: stage.legacyApprovalRequestId,
						managerEmployeeId: currentEmployee.id,
						organizationId: authorization.organizationId,
					});
				},
				clock: systemClock,
			});
			await completeOrdinaryWorkPeriodDecisionAfterCommit({
				execute: () =>
					executeOrdinaryWorkPeriodDecisionInTransaction({
						dbService,
						runtime,
						organizationId: currentEmployee.organizationId,
						approvalRequestId: input.approvalRequestId,
						workPeriodId: input.workPeriodId,
						actor: currentEmployee,
						allowAnyApprover: options?.allowAnyApprover,
						allowOrganizationWideApprover:
							options?.allowOrganizationWideApprover,
						decision: input.decision,
					}),
				dispatch: async (execution) => {
					await Effect.runPromise(
						notifyWorkPeriodApprovalAfterCommit(
							execution.result,
							currentEmployee,
							dbService,
						),
					);
				},
				maintain: reconcileOrdinaryWorkPeriodMaintenanceAfterCommit,
				onDispatchError: (error) => {
					logger.error(
						{ error, approvalRequestId: input.approvalRequestId },
						"Ordinary work-period decision after-commit work failed",
					);
				},
				onMaintenanceError: (error) => {
					logger.error(
						{
							error,
							organizationId: currentEmployee.organizationId,
							workflowTargetId: input.approvalRequestId,
							workPeriodId: input.workPeriodId,
						},
						"Ordinary work-period maintenance after commit failed",
					);
				},
			});
		},
		catch: () =>
			new ConflictError({
				message: ORDINARY_DECISION_ERROR,
				conflictType: "approval_decision",
			}),
	});
}

export function finalizeAutoCompletedWorkPeriodApprovalEffect(
	dbService: ApprovalDbService,
	input: {
		approvalRequestId: string;
		organizationId: string;
		requesterEmployeeId: string;
		requesterUserId: string;
		requesterName: string;
		kind: OrdinaryTimeApprovalKind;
	},
) {
	return Effect.gen(function* (_) {
		const approvals = yield* _(
			dbService.query("getAutoCompletedWorkPeriodApproval", async () => {
				return await dbService.db
					.select()
					.from(approvalRequest)
					.where(
						and(
							eq(approvalRequest.id, input.approvalRequestId),
							eq(approvalRequest.organizationId, input.organizationId),
							eq(approvalRequest.entityType, "time_entry"),
							eq(approvalRequest.requestedBy, input.requesterEmployeeId),
							eq(approvalRequest.status, "approved"),
						),
					);
			}),
		);
		const approval = approvals[0];
		if (!approval) {
			return yield* _(
				Effect.fail(conflict("Ordinary work-period finalization conflict")),
			);
		}

		return yield* _(
			finalizeCurrentWorkPeriodDecision(
				dbService,
				approval.entityId,
				{
					id: input.requesterEmployeeId,
					userId: input.requesterUserId,
					organizationId: input.organizationId,
					user: {
						id: input.requesterUserId,
						name: input.requesterName,
						email: "",
						image: null,
					},
				},
				approval as PendingApprovalRequest,
				input.kind,
				"approve",
				"requester_is_approver",
				"requester_auto_completed",
			),
		);
	});
}
