import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import {
	dateFromInstant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import {
	onClockOutApproved,
	onClockOutRejected,
	onManualEntryApproved,
	onManualEntryRejected,
} from "@/lib/notifications/triggers";
import { applyPolicyClockOutTerminalBreakInTransaction } from "@/lib/time-tracking/policy-clock-out-terminal-break";
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
} from "../domain-adapters/work-period-contract";
import { captureOrdinaryWorkPeriodLegacyState } from "../domain-adapters/work-period-legacy-state";
import {
	ApprovalAuditLogger,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
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
	const payload = parseOrdinaryWorkPeriodWorkflowPayload({
		timeRequest: root.timeRequest,
	});
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
		kind: payload.timeRequest.kind,
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
	};
}

export async function executeOrdinaryWorkPeriodDecisionInTransaction(input: {
	dbService: ApprovalDbService;
	runtime: ReturnType<typeof createProductionApprovalWorkflowRuntime>;
	organizationId: string;
	approvalRequestId: string;
	workPeriodId: string;
	actor: CurrentApprover;
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
						columns: { id: true, workflowId: true, stageId: true },
					});
			const assignmentStage = assignment
				? await database.query.approvalWorkflowStage.findFirst({
						where: and(
							eq(approvalWorkflowStage.id, assignment.stageId),
							eq(approvalWorkflowStage.organizationId, input.organizationId),
						),
						columns: { id: true, workflowId: true },
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
				? exactDecisionMetadata(requestRow.metadata)
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
						terminalRequestMatches &&
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
				if (
					terminalRequestMatches &&
					period.approvalStatus === expectedTerminalStatus &&
					(authority.mode === "legacy" ||
						(observedWorkflow?.id === period.approvalWorkflowId &&
							observedWorkflow.organizationId === input.organizationId &&
							observedWorkflow.workflowType === metadata.kind &&
							observedWorkflow.sourceType === "time_entry" &&
							observedWorkflow.sourceId === period.id &&
							observedWorkflow.requesterEmployeeId === period.employeeId &&
							observedWorkflow.status === expectedTerminalStatus))
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
											captureCount === 1 || mutationResult === undefined
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
								{ approvalRequestId: input.approvalRequestId },
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
					}),
				};
			}
			if (
				!period.approvalWorkflowId ||
				metadata.workflowId !== period.approvalWorkflowId ||
				metadata.workflowOrganizationId !== input.organizationId
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
						terminalRequestMatches && snapshot.status === expectedTerminalStatus
					))
			) {
				throw new Error(ORDINARY_DECISION_ERROR);
			}
			const targets = snapshot.stages.flatMap((stage) =>
				stage.id === metadata.stageId &&
				(metadata.stageSequence === null ||
					stage.sequence === metadata.stageSequence) &&
				(snapshot.status !== "pending" ||
					stage.sequence === snapshot.currentStageOrder) &&
				stage.status ===
					(snapshot.status === "pending"
						? "pending"
						: expectedTerminalStatus) &&
				(requestRow
					? stage.legacyApprovalRequestId === input.approvalRequestId
					: true)
					? stage.assignments
							.filter(
								(assignment) =>
									assignment.id === metadata.assignmentId &&
									assignment.status ===
										(snapshot.status === "pending"
											? "pending"
											: expectedTerminalStatus) &&
									(requestRow
										? assignment.approverEmployeeId === request.approverId
										: true),
							)
							.map((assignment) => ({ stage, assignment }))
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
): void {
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
	const expectedKeys = [
		"timeRequest",
		...(input.expectedApprovalWorkflowId !== null ? ["workflow"] : []),
		...(hasMarker ? ["ordinarySubmission"] : []),
		...(input.requesterAutoCompleted ? ["autoApproval"] : []),
	];
	const root = exactOwnDataValues(metadata, expectedKeys);
	parseOrdinaryWorkPeriodWorkflowPayload(
		{ timeRequest: root.timeRequest },
		input.kind,
	);
	if (input.expectedApprovalWorkflowId !== null) {
		const workflow = exactOwnDataValues(root.workflow, [
			"id",
			"organizationId",
		]);
		if (
			workflow.id !== input.expectedApprovalWorkflowId ||
			workflow.organizationId !== input.organizationId
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
}

async function finalizeOrdinaryWorkPeriodTerminal(
	input: FinalizeOrdinaryWorkPeriodTerminalInput,
): Promise<WorkPeriodApprovalResult> {
	const fail = ordinaryWorkPeriodFinalizationConflict;
	const evidence = validateTerminalEvidence(input);
	const db = input.dbService.db;
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
	const period = periods[0];
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
		),
		columns: { id: true, userId: true },
	});
	if (
		!actor ||
		actor.id !== input.actorEmployeeId ||
		actor.userId !== input.actorUserId
	) {
		throw fail();
	}

	const terminalStatus =
		input.transition.kind === "approve" ? "approved" : "rejected";
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
			validateOrdinaryRequestMetadata(request.metadata, {
				expectedApprovalWorkflowId: input.expectedApprovalWorkflowId,
				kind: input.kind,
				organizationId: input.organizationId,
				workPeriodId: input.workPeriodId,
				requesterAutoCompleted,
			});
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
		input.transition.kind === "approve"
	) {
		await applyPolicyClockOutTerminalBreakInTransaction({
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
		});
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
	return (
		typeof candidate.execute === "function" &&
		typeof candidate.select === "function" &&
		typeof candidate.update === "function" &&
		typeof candidate.insert === "function" &&
		typeof employeeQuery === "object" &&
		employeeQuery !== null &&
		typeof (employeeQuery as Record<string, unknown>).findFirst === "function"
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
			const execution = await executeOrdinaryWorkPeriodDecisionInTransaction({
				dbService,
				runtime,
				organizationId: currentEmployee.organizationId,
				approvalRequestId: input.approvalRequestId,
				workPeriodId: input.workPeriodId,
				actor: currentEmployee,
				decision: input.decision,
			});
			if (
				execution.postCommit?.disposition === "dispatch" &&
				execution.postCommit.event !== "pending"
			) {
				try {
					await Effect.runPromise(
						notifyWorkPeriodApprovalAfterCommit(
							execution.result,
							currentEmployee,
							dbService,
						),
					);
				} catch (error) {
					logger.error(
						{ error, approvalRequestId: input.approvalRequestId },
						"Ordinary work-period decision after-commit work failed",
					);
				}
			}
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
