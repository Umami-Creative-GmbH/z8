import {
	instantToCanonicalString,
	isInstant,
} from "@/lib/datetime/temporal-core";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
} from "./identity";
import type {
	ApprovalAssignmentActorIdentity,
	ApprovalAssignmentSnapshot,
	ApprovalEngineClock,
	ApprovalStageSnapshot,
	ApprovalWorkflowEventReferences,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowEventType,
	ApprovalWorkflowSnapshot,
	JsonObject,
	ObservedLegacyTransition,
	ObservedLegacyTransitionPlan,
} from "./ports";
import type { ApprovalLegacyObservationPlanner } from "./repository";
import { normalizeStableData } from "./stable-data";
import { assertValidApprovalWorkflowSnapshot } from "./state-machine";
import { APPROVAL_WORKFLOW_TYPES } from "./types";

export type LegacyApprovalObservationPlannerErrorCode =
	| "ambiguous_transition"
	| "invalid_evidence"
	| "invalid_lifecycle";

export class LegacyApprovalObservationPlannerError extends Error {
	readonly code: LegacyApprovalObservationPlannerErrorCode;

	constructor(code: LegacyApprovalObservationPlannerErrorCode) {
		super("Legacy approval observation planning failed");
		this.name = "LegacyApprovalObservationPlannerError";
		this.code = code;
	}
}

function fail(code: LegacyApprovalObservationPlannerErrorCode): never {
	throw new LegacyApprovalObservationPlannerError(code);
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function canonicalUuid(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			value,
		)
	);
}

function canonicalEvidence(value: unknown): string {
	if (isInstant(value)) {
		try {
			return JSON.stringify(instantToCanonicalString(value));
		} catch {
			return fail("invalid_evidence");
		}
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalEvidence).join(",")}]`;
	}
	if (record(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalEvidence(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function observedDisplaySnapshot(input: ObservedLegacyTransition): JsonObject {
	const currentDisplay =
		input.after.displaySnapshot ?? input.after.sourceSnapshot;
	if (
		input.expectedVersion === null &&
		input.source.workflowType === "time_correction" &&
		Object.hasOwn(currentDisplay, "workMetadata")
	) {
		const workMetadata = currentDisplay.workMetadata;
		const workPeriod = input.before.sourceSnapshot.workPeriod;
		if (
			!record(workMetadata) ||
			!record(workPeriod) ||
			!Object.hasOwn(workPeriod, "workLocationType") ||
			!Object.hasOwn(workPeriod, "workCategoryId")
		) {
			return fail("invalid_evidence");
		}
		return normalizeStableData({
			...currentDisplay,
			workMetadata: {
				...workMetadata,
				original: {
					workLocationType: workPeriod.workLocationType,
					workCategoryId: workPeriod.workCategoryId,
				},
			},
		}) as JsonObject;
	}
	if (
		input.expectedVersion !== null &&
		input.before.displaySnapshot &&
		Object.hasOwn(input.before.displaySnapshot, "workMetadata")
	) {
		return normalizeStableData({
			...currentDisplay,
			workMetadata: input.before.displaySnapshot.workMetadata,
		}) as JsonObject;
	}
	return normalizeStableData(currentDisplay) as JsonObject;
}

function assignmentActorFromEventActor(
	actor: ObservedLegacyTransition["actor"],
): ApprovalAssignmentActorIdentity | null {
	if (actor.kind === "employee") {
		return { kind: "employee", employeeId: actor.employeeId, userId: null };
	}
	if (actor.kind === "system") {
		return { kind: "system", employeeId: null, userId: null };
	}
	return null;
}

function validateScope(input: ObservedLegacyTransition): void {
	if (
		!record(input) ||
		!nonEmpty(input.organizationId) ||
		!record(input.source) ||
		input.source.organizationId !== input.organizationId ||
		!APPROVAL_WORKFLOW_TYPES.includes(input.source.workflowType) ||
		!nonEmpty(input.source.sourceType) ||
		!canonicalUuid(input.source.sourceId) ||
		!nonEmpty(input.idempotencyKey) ||
		(input.expectedVersion !== null &&
			(!Number.isInteger(input.expectedVersion) ||
				input.expectedVersion < 1)) ||
		!record(input.actor) ||
		!record(input.before) ||
		!record(input.after)
	) {
		fail("invalid_evidence");
	}
	if (
		(input.actor.kind === "employee" &&
			(!canonicalUuid(input.actor.employeeId) ||
				(input.actor.userId !== null && !nonEmpty(input.actor.userId)))) ||
		((input.actor.kind === "system" || input.actor.kind === "legacy_unknown") &&
			(input.actor.employeeId !== null || input.actor.userId !== null)) ||
		!(["employee", "system", "legacy_unknown"] as const).includes(
			input.actor.kind,
		)
	) {
		fail("invalid_evidence");
	}
	for (const state of [input.before, input.after]) {
		if (
			state.organizationId !== input.organizationId ||
			state.source.organizationId !== input.organizationId ||
			state.source.workflowType !== input.source.workflowType ||
			state.source.sourceType !== input.source.sourceType ||
			state.source.sourceId !== input.source.sourceId ||
			!isInstant(state.capturedAt) ||
			!record(state.sourceSnapshot) ||
			(state.displaySnapshot !== undefined && !record(state.displaySnapshot)) ||
			!Array.isArray(state.chainRows)
		) {
			fail("invalid_evidence");
		}
	}
}

function validateDirectRequest(input: ObservedLegacyTransition): void {
	for (const state of [input.before, input.after]) {
		const request = state.approvalRequest;
		if (request === null) continue;
		if (
			!canonicalUuid(request.id) ||
			request.organizationId !== input.organizationId ||
			request.entityType !== input.source.sourceType ||
			request.entityId !== input.source.sourceId ||
			!canonicalUuid(request.requestedBy) ||
			!canonicalUuid(request.approverId) ||
			!isInstant(request.updatedAt) ||
			!(["pending", "approved", "rejected"] as const).includes(
				request.status,
			) ||
			(request.status === "approved" && !isInstant(request.approvedAt)) ||
			(request.status !== "approved" && request.approvedAt !== null) ||
			(request.status === "rejected" && !nonEmpty(request.rejectionReason)) ||
			(request.status !== "rejected" && request.rejectionReason !== null) ||
			(request.metadata !== null && !record(request.metadata))
		) {
			fail("invalid_evidence");
		}
	}
}

interface LegacyEventDraft {
	eventType: ApprovalWorkflowEventType;
	previousState: JsonObject | null;
	resultingState: JsonObject;
	reason: string | null;
	metadata: JsonObject | null;
	references?: ApprovalWorkflowEventReferences;
	occurredAt: ApprovalWorkflowEventSnapshot["occurredAt"];
}

function assignmentEventDraft(input: {
	eventType:
		| "assignment.created"
		| "assignment.approved"
		| "assignment.rejected"
		| "assignment.cancelled";
	assignment: ApprovalAssignmentSnapshot;
	stageId: string;
	previousStatus: "pending" | null;
	reason: string | null;
	occurredAt: ApprovalWorkflowEventSnapshot["occurredAt"];
}): LegacyEventDraft {
	return {
		eventType: input.eventType,
		previousState:
			input.previousStatus === null ? null : { status: input.previousStatus },
		resultingState:
			input.eventType === "assignment.created"
				? {
						approverEmployeeId: input.assignment.approverEmployeeId,
						sequence: input.assignment.sequence,
						status: "pending",
					}
				: { status: input.assignment.status },
		reason: input.reason,
		metadata: { stageId: input.stageId },
		references: { assignmentId: input.assignment.id },
		occurredAt: input.occurredAt,
	};
}

function stageEventDraft(input: {
	eventType:
		| "stage.activated"
		| "stage.auto_approved"
		| "stage.approved"
		| "stage.rejected"
		| "stage.cancelled";
	stage: ApprovalStageSnapshot;
	previousStatus: "waiting" | "pending";
	reason: string | null;
	occurredAt: ApprovalWorkflowEventSnapshot["occurredAt"];
	requesterEmployeeId?: string;
}): LegacyEventDraft {
	return {
		eventType: input.eventType,
		previousState: { status: input.previousStatus },
		resultingState: { status: input.stage.status },
		reason: input.reason,
		metadata: {
			stageId: input.stage.id,
			stageOrder: input.stage.sequence,
			...(input.requesterEmployeeId
				? { requesterEmployeeId: input.requesterEmployeeId }
				: {}),
		},
		occurredAt: input.occurredAt,
	};
}

function sameChainRowIdentity(
	left: ObservedLegacyTransition["before"]["chainRows"][number],
	right: ObservedLegacyTransition["after"]["chainRows"][number],
): boolean {
	return (
		left.id === right.id &&
		left.stepOrder === right.stepOrder &&
		left.policyStageId === right.policyStageId &&
		left.labelSnapshot === right.labelSnapshot &&
		left.approverTypeSnapshot === right.approverTypeSnapshot &&
		left.resolvedApproverEmployeeId === right.resolvedApproverEmployeeId
	);
}

function validChainRowRequestTransition(input: {
	beforeRow: ObservedLegacyTransition["before"]["chainRows"][number];
	afterRow: ObservedLegacyTransition["after"]["chainRows"][number];
	beforeChain: NonNullable<ObservedLegacyTransition["before"]["chain"]>;
	afterChain: NonNullable<ObservedLegacyTransition["after"]["chain"]>;
}): boolean {
	if (input.beforeRow.approvalRequestId === input.afterRow.approvalRequestId) {
		return true;
	}
	if (
		input.beforeRow.approvalRequestId === null &&
		input.afterRow.approvalRequestId !== null
	) {
		return (
			input.beforeChain.status === "pending" &&
			(input.afterChain.status === "pending" ||
				input.afterChain.status === "approved") &&
			input.afterChain.currentStageOrder >
				input.beforeChain.currentStageOrder &&
			input.afterRow.stepOrder > input.beforeChain.currentStageOrder &&
			input.afterRow.stepOrder <= input.afterChain.currentStageOrder &&
			input.beforeRow.status === "cancelled" &&
			(input.afterRow.stepOrder === input.afterChain.currentStageOrder
				? input.afterChain.status === "pending"
					? input.afterRow.status === "pending"
					: input.afterRow.status === "approved" &&
						input.afterRow.resolvedApproverEmployeeId ===
							input.afterChain.requesterEmployeeId
				: input.afterRow.status === "approved" &&
					input.afterRow.resolvedApproverEmployeeId ===
						input.afterChain.requesterEmployeeId)
		);
	}
	return (
		input.beforeRow.approvalRequestId !== null &&
		input.afterRow.approvalRequestId === null &&
		input.beforeChain.status === "pending" &&
		input.afterChain.status === "cancelled" &&
		input.afterRow.stepOrder >= input.afterChain.currentStageOrder &&
		input.beforeRow.status === "pending" &&
		input.afterRow.status === "cancelled"
	);
}

function validateChainState(
	input: ObservedLegacyTransition,
	state: ObservedLegacyTransition["after"],
): void {
	const chain = state.chain;
	if (
		chain === null ||
		!canonicalUuid(chain.id) ||
		chain.organizationId !== input.organizationId ||
		chain.entityType !== input.source.sourceType ||
		chain.entityId !== input.source.sourceId ||
		!canonicalUuid(chain.policyId) ||
		!canonicalUuid(chain.requesterEmployeeId) ||
		!Number.isInteger(chain.currentStageOrder) ||
		chain.currentStageOrder < 1 ||
		!isInstant(chain.createdAt) ||
		!isInstant(chain.updatedAt) ||
		(chain.status === "pending" && chain.completedAt !== null) ||
		(chain.status !== "pending" && !isInstant(chain.completedAt)) ||
		state.chainRows.length === 0
	) {
		fail("invalid_evidence");
	}
	const orders = new Set<number>();
	const requestIds = new Set<string>();
	for (const row of state.chainRows) {
		if (
			!canonicalUuid(row.id) ||
			row.organizationId !== input.organizationId ||
			row.chainInstanceId !== chain.id ||
			!canonicalUuid(row.policyStageId) ||
			!Number.isInteger(row.stepOrder) ||
			row.stepOrder < 1 ||
			orders.has(row.stepOrder) ||
			!nonEmpty(row.labelSnapshot) ||
			!nonEmpty(row.approverTypeSnapshot) ||
			!canonicalUuid(row.resolvedApproverEmployeeId) ||
			!isInstant(row.createdAt) ||
			!isInstant(row.updatedAt) ||
			!(["pending", "approved", "rejected", "cancelled"] as const).includes(
				row.status,
			) ||
			(row.approvalRequestId !== null &&
				(!canonicalUuid(row.approvalRequestId) ||
					requestIds.has(row.approvalRequestId))) ||
			((row.status === "approved" || row.status === "rejected") &&
				(row.approvalRequestId === null ||
					!canonicalUuid(row.decidedBy) ||
					!isInstant(row.decidedAt))) ||
			((row.status === "pending" || row.status === "cancelled") &&
				(row.decidedBy !== null || row.decidedAt !== null))
		) {
			fail("invalid_evidence");
		}
		orders.add(row.stepOrder);
		if (row.approvalRequestId) requestIds.add(row.approvalRequestId);
	}
	const request = state.approvalRequest;
	if (request) {
		const linked = state.chainRows.find(
			(row) => row.approvalRequestId === request.id,
		);
		if (
			!linked ||
			(linked.stepOrder !== chain.currentStageOrder &&
				!(
					input.expectedVersion !== null &&
					chain.status === "pending" &&
					request.status === "approved" &&
					linked.stepOrder < chain.currentStageOrder
				)) ||
			linked.resolvedApproverEmployeeId !== request.approverId ||
			linked.status !== request.status ||
			request.requestedBy !== chain.requesterEmployeeId
		) {
			fail("invalid_evidence");
		}
	}
}

function buildChainPlan(
	input: ObservedLegacyTransition,
): ObservedLegacyTransitionPlan {
	validateChainState(input, input.after);
	const chain = input.after.chain;
	if (!chain) return fail("invalid_evidence");
	const initialApproved =
		input.expectedVersion === null &&
		input.before.approvalRequest === null &&
		input.before.chain === null &&
		input.before.chainRows.length === 0 &&
		chain.status === "approved" &&
		chain.completedAt !== null &&
		input.after.chainRows.every(
			(row) =>
				row.status === "approved" &&
				row.resolvedApproverEmployeeId === chain.requesterEmployeeId &&
				row.approvalRequestId !== null &&
				row.decidedAt !== null,
		);
	const initialPending =
		input.expectedVersion === null &&
		input.before.approvalRequest === null &&
		input.before.chain === null &&
		input.before.chainRows.length === 0 &&
		chain.status === "pending" &&
		chain.completedAt === null &&
		input.after.chainRows.every((row) =>
			row.stepOrder < chain.currentStageOrder
				? row.status === "approved" && row.decidedAt !== null
				: row.stepOrder === chain.currentStageOrder
					? row.status === "pending" && row.approvalRequestId !== null
					: row.status === "cancelled" && row.approvalRequestId === null,
		);
	let advancedRowOrder: number | null = null;
	let activatedRowOrder: number | null = null;
	let beforeChain = input.before.chain;
	if (!initialApproved && !initialPending) {
		validateChainState(input, input.before);
		beforeChain = input.before.chain;
	}
	const terminalApproved =
		!initialApproved &&
		!initialPending &&
		input.expectedVersion !== null &&
		beforeChain !== null &&
		beforeChain.id === chain.id &&
		beforeChain.policyId === chain.policyId &&
		beforeChain.requesterEmployeeId === chain.requesterEmployeeId &&
		beforeChain.status === "pending" &&
		chain.status === "approved" &&
		chain.completedAt !== null &&
		chain.currentStageOrder >= beforeChain.currentStageOrder &&
		input.before.chainRows.length === input.after.chainRows.length &&
		input.after.chainRows.every((afterRow) => {
			const beforeRow = input.before.chainRows.find(
				(row) => row.id === afterRow.id && row.stepOrder === afterRow.stepOrder,
			);
			if (
				!beforeRow ||
				!sameChainRowIdentity(beforeRow, afterRow) ||
				!validChainRowRequestTransition({
					beforeRow,
					afterRow,
					beforeChain,
					afterChain: chain,
				}) ||
				afterRow.status !== "approved"
			) {
				return false;
			}
			if (afterRow.stepOrder < beforeChain.currentStageOrder) {
				return beforeRow.status === "approved";
			}
			if (afterRow.stepOrder === beforeChain.currentStageOrder) {
				return beforeRow.status === "pending";
			}
			return (
				beforeRow.status === "cancelled" &&
				afterRow.resolvedApproverEmployeeId === chain.requesterEmployeeId
			);
		});
	const terminalRejected =
		!initialApproved &&
		!initialPending &&
		input.expectedVersion !== null &&
		beforeChain !== null &&
		beforeChain.id === chain.id &&
		beforeChain.policyId === chain.policyId &&
		beforeChain.requesterEmployeeId === chain.requesterEmployeeId &&
		beforeChain.status === "pending" &&
		chain.status === "rejected" &&
		chain.completedAt !== null &&
		chain.currentStageOrder === beforeChain.currentStageOrder &&
		input.before.chainRows.length === input.after.chainRows.length &&
		input.after.chainRows.every((afterRow) => {
			const beforeRow = input.before.chainRows.find(
				(row) => row.id === afterRow.id && row.stepOrder === afterRow.stepOrder,
			);
			if (
				!beforeRow ||
				!sameChainRowIdentity(beforeRow, afterRow) ||
				!validChainRowRequestTransition({
					beforeRow,
					afterRow,
					beforeChain,
					afterChain: chain,
				})
			)
				return false;
			if (afterRow.stepOrder < chain.currentStageOrder) {
				return (
					beforeRow.status === "approved" && afterRow.status === "approved"
				);
			}
			if (afterRow.stepOrder === chain.currentStageOrder) {
				return beforeRow.status === "pending" && afterRow.status === "rejected";
			}
			return (
				beforeRow.status === "cancelled" && afterRow.status === "cancelled"
			);
		});
	const terminalCancelled =
		!initialApproved &&
		!initialPending &&
		input.expectedVersion !== null &&
		beforeChain !== null &&
		beforeChain.id === chain.id &&
		beforeChain.policyId === chain.policyId &&
		beforeChain.requesterEmployeeId === chain.requesterEmployeeId &&
		beforeChain.status === "pending" &&
		chain.status === "cancelled" &&
		chain.completedAt !== null &&
		chain.currentStageOrder === beforeChain.currentStageOrder &&
		input.after.approvalRequest === null &&
		input.before.chainRows.length === input.after.chainRows.length &&
		input.after.chainRows.every((afterRow) => {
			const beforeRow = input.before.chainRows.find(
				(row) => row.id === afterRow.id && row.stepOrder === afterRow.stepOrder,
			);
			if (
				!beforeRow ||
				!sameChainRowIdentity(beforeRow, afterRow) ||
				!validChainRowRequestTransition({
					beforeRow,
					afterRow,
					beforeChain,
					afterChain: chain,
				})
			) {
				return false;
			}
			if (afterRow.stepOrder < chain.currentStageOrder) {
				return (
					beforeRow.status === "approved" && afterRow.status === "approved"
				);
			}
			if (afterRow.stepOrder === chain.currentStageOrder) {
				return (
					beforeRow.status === "pending" &&
					afterRow.status === "cancelled" &&
					afterRow.approvalRequestId === null
				);
			}
			return (
				beforeRow.status === "cancelled" && afterRow.status === "cancelled"
			);
		});
	const terminalApprovedCancelled =
		!initialApproved &&
		!initialPending &&
		input.expectedVersion !== null &&
		beforeChain !== null &&
		beforeChain.id === chain.id &&
		beforeChain.policyId === chain.policyId &&
		beforeChain.requesterEmployeeId === chain.requesterEmployeeId &&
		beforeChain.currentStageOrder === chain.currentStageOrder &&
		beforeChain.status === "approved" &&
		chain.status === "cancelled" &&
		chain.completedAt !== null &&
		input.before.sourceSnapshot.status === "approved" &&
		input.after.sourceSnapshot.status === "approved" &&
		input.before.approvalRequest?.status === "approved" &&
		input.after.approvalRequest?.status === "approved" &&
		input.before.approvalRequest.id === input.after.approvalRequest.id &&
		input.before.chainRows.length === input.after.chainRows.length &&
		input.after.chainRows.every((afterRow) => {
			const beforeRow = input.before.chainRows.find(
				(row) => row.id === afterRow.id && row.stepOrder === afterRow.stepOrder,
			);
			return (
				beforeRow !== undefined &&
				sameChainRowIdentity(beforeRow, afterRow) &&
				beforeRow.status === "approved" &&
				afterRow.status === "approved" &&
				beforeRow.approvalRequestId === afterRow.approvalRequestId &&
				beforeRow.decidedBy === afterRow.decidedBy &&
				canonicalEvidence(beforeRow.decidedAt) ===
					canonicalEvidence(afterRow.decidedAt)
			);
		});
	if (terminalApproved || terminalRejected || terminalCancelled) {
		advancedRowOrder = beforeChain?.currentStageOrder ?? null;
	}
	if (
		!initialApproved &&
		!initialPending &&
		!terminalApproved &&
		!terminalRejected &&
		!terminalCancelled &&
		!terminalApprovedCancelled
	) {
		if (
			input.expectedVersion === null ||
			!beforeChain ||
			beforeChain.id !== chain.id ||
			beforeChain.policyId !== chain.policyId ||
			beforeChain.requesterEmployeeId !== chain.requesterEmployeeId ||
			beforeChain.status !== "pending" ||
			chain.status !== "pending" ||
			chain.completedAt !== null ||
			chain.currentStageOrder <= beforeChain.currentStageOrder ||
			input.before.chainRows.length !== input.after.chainRows.length
		) {
			fail("invalid_lifecycle");
		}
		for (const afterRow of input.after.chainRows) {
			const beforeRow = input.before.chainRows.find(
				(row) => row.id === afterRow.id && row.stepOrder === afterRow.stepOrder,
			);
			if (
				!beforeRow ||
				!sameChainRowIdentity(beforeRow, afterRow) ||
				!validChainRowRequestTransition({
					beforeRow,
					afterRow,
					beforeChain,
					afterChain: chain,
				})
			) {
				fail("invalid_lifecycle");
			}
			if (afterRow.stepOrder === beforeChain.currentStageOrder) {
				if (beforeRow.status !== "pending" || afterRow.status !== "approved") {
					fail("invalid_lifecycle");
				}
				advancedRowOrder = afterRow.stepOrder;
			} else if (
				afterRow.stepOrder > beforeChain.currentStageOrder &&
				afterRow.stepOrder < chain.currentStageOrder
			) {
				if (
					beforeRow.status !== "cancelled" ||
					afterRow.status !== "approved" ||
					afterRow.resolvedApproverEmployeeId !== chain.requesterEmployeeId ||
					afterRow.approvalRequestId === null
				) {
					fail("invalid_lifecycle");
				}
			} else if (afterRow.stepOrder === chain.currentStageOrder) {
				if (
					beforeRow.status !== "cancelled" ||
					afterRow.status !== "pending" ||
					afterRow.approvalRequestId === null
				) {
					fail("invalid_lifecycle");
				}
				activatedRowOrder = afterRow.stepOrder;
			} else if (beforeRow.status !== afterRow.status) {
				fail("invalid_lifecycle");
			}
		}
		if (advancedRowOrder === null || activatedRowOrder === null) {
			fail("invalid_lifecycle");
		}
	}
	if (
		!initialApproved &&
		!initialPending &&
		!terminalApproved &&
		!terminalRejected &&
		!terminalCancelled &&
		!terminalApprovedCancelled &&
		chain.status !== "pending"
	) {
		fail("invalid_lifecycle");
	}
	const workflowId = deriveApprovalWorkflowId({
		...input.source,
		allocationKey: chain.id,
	});
	const stages: ApprovalStageSnapshot[] = [...input.after.chainRows]
		.sort((left, right) => left.stepOrder - right.stepOrder)
		.map((row): ApprovalStageSnapshot => {
			const beforeRow = input.before.chainRows.find(
				(candidate) => candidate.id === row.id,
			);
			const legacyApprovalRequestId =
				row.approvalRequestId ??
				(terminalCancelled && row.stepOrder === chain.currentStageOrder
					? (beforeRow?.approvalRequestId ?? null)
					: null);
			const activationMode =
				row.resolvedApproverEmployeeId === chain.requesterEmployeeId
					? "requester_auto_approve"
					: "human";
			const status =
				chain.status === "pending" && row.stepOrder > chain.currentStageOrder
					? ("waiting" as const)
					: row.status;
			const stageId = deriveApprovalStageId({
				organizationId: input.organizationId,
				workflowId,
				allocationKey: row.id,
			});
			const activationAt =
				input.before.approvalRequest?.id === legacyApprovalRequestId
					? input.before.approvalRequest.updatedAt
					: input.after.approvalRequest?.id === legacyApprovalRequestId
						? input.after.approvalRequest.updatedAt
						: (row.decidedAt ??
							(input.before.approvalRequest?.id === legacyApprovalRequestId
								? input.before.approvalRequest.updatedAt
								: legacyApprovalRequestId === null
									? null
									: row.updatedAt));
			const assignments: ApprovalAssignmentSnapshot[] =
				activationMode === "human" &&
				status !== "waiting" &&
				legacyApprovalRequestId !== null
					? [
							{
								id: deriveApprovalAssignmentId({
									organizationId: input.organizationId,
									workflowId,
									allocationKey: legacyApprovalRequestId,
								}),
								organizationId: input.organizationId,
								workflowId,
								stageId,
								sequence: 1,
								approverEmployeeId: row.resolvedApproverEmployeeId,
								status:
									status === "approved" ||
									status === "rejected" ||
									status === "cancelled"
										? status
										: "pending",
								assignedAt: activationAt ?? fail("invalid_evidence"),
								resolvedAt:
									status === "approved" ||
									status === "rejected" ||
									status === "cancelled"
										? (row.decidedAt ?? chain.completedAt)
										: null,
								resolvedBy:
									status === "approved" ||
									status === "rejected" ||
									status === "cancelled"
										? terminalApprovedCancelled && row.decidedBy
											? {
													kind: "employee" as const,
													employeeId: row.decidedBy,
													userId: null,
												}
											: assignmentActorFromEventActor(input.actor)
										: null,
								reassignedByEmployeeId: null,
								reassignedFromAssignmentId: null,
								reassignmentMetadata: null,
							},
						]
					: [];
			return {
				id: stageId,
				organizationId: input.organizationId,
				workflowId,
				sequence: row.stepOrder,
				label: row.labelSnapshot,
				resolverSnapshot: {
					kind: "legacy_chain",
					chainRowId: row.id,
					policyStageId: row.policyStageId,
					approverType: row.approverTypeSnapshot,
				},
				activationMode,
				status,
				activatedAt:
					status === "waiting" ||
					(status === "cancelled" && legacyApprovalRequestId === null)
						? null
						: (activationAt ?? fail("invalid_evidence")),
				decidedAt:
					status === "waiting" || status === "pending"
						? null
						: (row.decidedAt ?? chain.completedAt),
				decisionReason:
					status === "rejected"
						? (input.after.approvalRequest?.rejectionReason ??
							"Legacy request rejected")
						: status === "cancelled"
							? terminalCancelled
								? "Legacy chain cancelled"
								: "Cleared after legacy rejection"
							: null,
				legacyApprovalRequestId,
				assignments,
			};
		});
	const contextSnapshot = normalizeStableData(
		input.after.sourceSnapshot,
	) as JsonObject;
	const displaySnapshot = observedDisplaySnapshot(input);
	const displayPayload = normalizeStableData(displaySnapshot) as JsonObject;
	const snapshot: ApprovalWorkflowSnapshot = {
		id: workflowId,
		organizationId: input.organizationId,
		workflowType: input.source.workflowType,
		sourceType: input.source.sourceType,
		sourceId: input.source.sourceId,
		requesterEmployeeId: chain.requesterEmployeeId,
		status: chain.status,
		currentStageOrder:
			chain.status === "pending" ? chain.currentStageOrder : null,
		version: input.expectedVersion === null ? 1 : input.expectedVersion + 1,
		policySnapshot: {
			kind: "legacy_chain",
			chainId: chain.id,
			policyId: chain.policyId,
			policyName: chain.policyNameSnapshot,
		},
		contextSnapshot,
		displaySnapshot,
		submittedAt: chain.createdAt,
		completedAt: chain.status === "pending" ? null : chain.completedAt,
		cancelledAt: chain.status === "cancelled" ? chain.completedAt : null,
		decisionReason:
			chain.status === "cancelled"
				? "Legacy chain cancelled"
				: chain.status === "rejected"
					? (input.after.approvalRequest?.rejectionReason ??
						"Legacy request rejected")
					: null,
		stages,
	};
	try {
		assertValidApprovalWorkflowSnapshot(snapshot);
	} catch {
		return fail("invalid_evidence");
	}
	const evidenceKey = canonicalEvidence(input);
	const drafts: LegacyEventDraft[] = [];
	const workflowDraft = (
		eventType:
			| "workflow.activation_requested"
			| "workflow.approved"
			| "workflow.rejected"
			| "workflow.cancelled",
		previousState: JsonObject | null,
		resultingState: JsonObject,
		reason: string | null,
		metadata: JsonObject | null = null,
	): LegacyEventDraft => ({
		eventType,
		previousState,
		resultingState,
		reason,
		metadata,
		occurredAt: chain.updatedAt,
	});
	const pushActivation = (stage: ApprovalStageSnapshot) => {
		const assignment = stage.assignments[0] ?? fail("invalid_evidence");
		drafts.push(
			assignmentEventDraft({
				eventType: "assignment.created",
				assignment,
				stageId: stage.id,
				previousStatus: null,
				reason: null,
				occurredAt: stage.activatedAt ?? fail("invalid_evidence"),
			}),
			stageEventDraft({
				eventType: "stage.activated",
				stage,
				previousStatus: "waiting",
				reason: null,
				occurredAt: stage.activatedAt ?? fail("invalid_evidence"),
			}),
		);
	};
	const pushAutoApproval = (stage: ApprovalStageSnapshot) =>
		drafts.push(
			stageEventDraft({
				eventType: "stage.auto_approved",
				stage,
				previousStatus: "waiting",
				reason: "requester_auto_approved",
				occurredAt: stage.decidedAt ?? fail("invalid_evidence"),
				requesterEmployeeId: chain.requesterEmployeeId,
			}),
		);
	const pushStageClosure = (
		stage: ApprovalStageSnapshot,
		status: "approved" | "rejected" | "cancelled",
		previousStatus: "waiting" | "pending",
	) => {
		const assignment = stage.assignments[0];
		if (assignment && previousStatus === "pending") {
			drafts.push(
				assignmentEventDraft({
					eventType: `assignment.${status}`,
					assignment,
					stageId: stage.id,
					previousStatus: "pending",
					reason: stage.decisionReason,
					occurredAt: stage.decidedAt ?? fail("invalid_evidence"),
				}),
			);
		}
		drafts.push(
			stageEventDraft({
				eventType: `stage.${status}`,
				stage,
				previousStatus,
				reason: stage.decisionReason,
				occurredAt: stage.decidedAt ?? fail("invalid_evidence"),
			}),
		);
	};

	if (initialApproved || initialPending) {
		for (const stage of stages.filter((item) => item.status === "approved")) {
			if (stage.activationMode === "requester_auto_approve") {
				pushAutoApproval(stage);
			} else {
				pushStageClosure(stage, "approved", "pending");
			}
		}
		if (initialPending) {
			const active = stages.find(
				(stage) => stage.sequence === snapshot.currentStageOrder,
			);
			if (!active) fail("invalid_evidence");
			pushActivation(active);
			drafts.push(
				workflowDraft(
					"workflow.activation_requested",
					null,
					{ status: "pending", currentStageOrder: active.sequence },
					null,
					{ stageId: active.id, stageOrder: active.sequence },
				),
			);
		} else {
			drafts.push(
				workflowDraft("workflow.approved", null, { status: "approved" }, null),
			);
		}
	} else if (terminalApprovedCancelled) {
		drafts.push(
			workflowDraft(
				"workflow.cancelled",
				{ status: "approved" },
				{ status: "cancelled" },
				snapshot.decisionReason,
			),
		);
	} else if (terminalApproved || terminalRejected || terminalCancelled) {
		const currentOrder =
			input.before.chain?.currentStageOrder ?? fail("invalid_evidence");
		const current = stages.find((stage) => stage.sequence === currentOrder);
		if (!current) fail("invalid_evidence");
		const status = terminalApproved
			? "approved"
			: terminalRejected
				? "rejected"
				: "cancelled";
		pushStageClosure(current, status, "pending");
		for (const future of stages.filter(
			(stage) => stage.sequence > currentOrder,
		)) {
			if (terminalApproved) {
				pushAutoApproval(future);
			} else {
				pushStageClosure(future, "cancelled", "waiting");
			}
		}
		drafts.push(
			workflowDraft(
				`workflow.${status}`,
				{ status: "pending" },
				{ status },
				snapshot.decisionReason,
			),
		);
	} else {
		const approved = stages.find(
			(stage) => stage.sequence === advancedRowOrder,
		);
		const active = stages.find((stage) => stage.sequence === activatedRowOrder);
		if (!approved || !active) fail("invalid_evidence");
		pushStageClosure(approved, "approved", "pending");
		for (const autoApproved of stages.filter(
			(stage) =>
				stage.sequence > approved.sequence &&
				stage.sequence < active.sequence &&
				stage.activationMode === "requester_auto_approve" &&
				stage.status === "approved",
		)) {
			pushAutoApproval(autoApproved);
		}
		pushActivation(active);
		drafts.push(
			workflowDraft(
				"workflow.activation_requested",
				{ status: "pending", currentStageOrder: approved.sequence },
				{ status: "pending", currentStageOrder: active.sequence },
				null,
				{ stageId: active.id, stageOrder: active.sequence },
			),
		);
	}
	const events: ApprovalWorkflowEventSnapshot[] = drafts.map(
		(draft, eventIndex) => ({
			id: deriveApprovalEventId({
				organizationId: input.organizationId,
				workflowId,
				allocationKey: `${input.idempotencyKey}:${evidenceKey}:${eventIndex}:${draft.eventType}`,
			}),
			organizationId: input.organizationId,
			workflowId,
			version: snapshot.version,
			eventIndex,
			eventType: draft.eventType,
			actor: { ...input.actor },
			previousState: draft.previousState,
			resultingState: draft.resultingState,
			reason: draft.reason,
			metadata: draft.metadata,
			...(draft.references ? { references: draft.references } : {}),
			idempotencyKey: input.idempotencyKey,
			occurredAt: draft.occurredAt,
		}),
	);
	return {
		snapshot,
		events,
		projection: {
			organizationId: input.organizationId,
			workflowId,
			workflowType: input.source.workflowType,
			sourceType: input.source.sourceType,
			sourceId: input.source.sourceId,
			status: snapshot.status,
			currentStageOrder: snapshot.currentStageOrder,
			requesterEmployeeId: chain.requesterEmployeeId,
			displayPayload,
			searchText: "",
			activeInboxStage:
				snapshot.status === "pending"
					? {
							stageId:
								stages.find(
									(stage) => stage.sequence === snapshot.currentStageOrder,
								)?.id ?? fail("invalid_evidence"),
							stageOrder:
								snapshot.currentStageOrder ?? fail("invalid_evidence"),
						}
					: null,
			updatedAt: chain.updatedAt,
		},
		outbox: events.map((event) => ({
			organizationId: input.organizationId,
			workflowId,
			eventId: event.id,
			eventType: event.eventType,
			dedupeKey: `observe:${event.id}`,
			payload: {
				legacyObservation: true,
				organizationId: input.organizationId,
				workflowId,
				sourceType: input.source.sourceType,
				sourceId: input.source.sourceId,
				eventId: event.id,
				eventType: event.eventType,
			},
			disposition: "observe",
			createdAt: event.occurredAt,
		})),
	};
}

function buildPlan(
	input: ObservedLegacyTransition,
): ObservedLegacyTransitionPlan {
	validateScope(input);
	validateDirectRequest(input);
	if (input.after.chain !== null) {
		return buildChainPlan(input);
	}
	if (
		input.before.chain !== null ||
		input.before.chainRows.length !== 0 ||
		input.after.chain !== null ||
		input.after.chainRows.length !== 0
	) {
		fail("ambiguous_transition");
	}
	const beforeRequest = input.before.approvalRequest;
	const afterRequest = input.after.approvalRequest;
	const initial = beforeRequest === null && afterRequest?.status === "pending";
	const initialAutoApproved =
		beforeRequest === null &&
		afterRequest?.status === "approved" &&
		afterRequest.approverId === afterRequest.requestedBy;
	const terminal =
		beforeRequest?.status === "pending" &&
		(afterRequest === null ||
			afterRequest.status === "approved" ||
			afterRequest.status === "rejected");
	const approvedOwnerCancellation =
		beforeRequest?.status === "approved" &&
		afterRequest === null &&
		input.expectedVersion !== null &&
		input.before.sourceSnapshot.status === "approved" &&
		input.after.sourceSnapshot.status === "approved" &&
		canonicalEvidence(input.before.sourceSnapshot) ===
			canonicalEvidence(input.after.sourceSnapshot) &&
		input.actor.kind === "employee" &&
		input.actor.employeeId === beforeRequest.requestedBy;
	if (
		(!initial &&
			!initialAutoApproved &&
			!terminal &&
			!approvedOwnerCancellation) ||
		((initial || initialAutoApproved) && input.expectedVersion !== null) ||
		(terminal && input.expectedVersion === null) ||
		(beforeRequest !== null &&
			afterRequest !== null &&
			(beforeRequest.id !== afterRequest.id ||
				beforeRequest.requestedBy !== afterRequest.requestedBy ||
				beforeRequest.approverId !== afterRequest.approverId ||
				beforeRequest.entityType !== afterRequest.entityType ||
				beforeRequest.entityId !== afterRequest.entityId))
	) {
		fail("invalid_lifecycle");
	}
	const request = afterRequest ?? beforeRequest;
	if (!request) return fail("ambiguous_transition");
	const status = initial
		? ("pending" as const)
		: afterRequest === null
			? ("cancelled" as const)
			: afterRequest.status;
	if (!status) return fail("invalid_lifecycle");
	const transitionAt = afterRequest?.updatedAt ?? input.after.capturedAt;
	const cancellationReason = approvedOwnerCancellation
		? "Legacy approved request cancelled by owner"
		: "Legacy pending request disappeared";
	const version =
		input.expectedVersion === null ? 1 : input.expectedVersion + 1;
	const workflowId = deriveApprovalWorkflowId({
		...input.source,
		allocationKey: request.id,
	});
	const stageId = deriveApprovalStageId({
		organizationId: input.organizationId,
		workflowId,
		allocationKey: request.id,
	});
	const assignmentId = deriveApprovalAssignmentId({
		organizationId: input.organizationId,
		workflowId,
		allocationKey: request.id,
	});
	const assignment: ApprovalAssignmentSnapshot = {
		id: assignmentId,
		organizationId: input.organizationId,
		workflowId,
		stageId,
		sequence: 1,
		approverEmployeeId: request.approverId,
		status: approvedOwnerCancellation ? "approved" : status,
		assignedAt: beforeRequest?.updatedAt ?? request.updatedAt,
		resolvedAt:
			status === "pending"
				? null
				: approvedOwnerCancellation
					? request.approvedAt
					: transitionAt,
		resolvedBy:
			status === "pending"
				? null
				: approvedOwnerCancellation
					? { kind: "employee", employeeId: request.approverId, userId: null }
					: assignmentActorFromEventActor(input.actor),
		reassignedByEmployeeId: null,
		reassignedFromAssignmentId: null,
		reassignmentMetadata: null,
	};
	const stage: ApprovalStageSnapshot = {
		id: stageId,
		organizationId: input.organizationId,
		workflowId,
		sequence: 1,
		label: "Legacy approval",
		resolverSnapshot: {
			kind: "legacy_direct",
			approvalRequestId: request.id,
		},
		activationMode: initialAutoApproved ? "requester_auto_approve" : "human",
		status: approvedOwnerCancellation ? "approved" : status,
		activatedAt: beforeRequest?.updatedAt ?? request.updatedAt,
		decidedAt:
			status === "pending"
				? null
				: approvedOwnerCancellation
					? request.approvedAt
					: transitionAt,
		decisionReason:
			status === "cancelled" && !approvedOwnerCancellation
				? cancellationReason
				: status === "rejected"
					? (afterRequest?.rejectionReason ?? "Legacy request rejected")
					: null,
		legacyApprovalRequestId: request.id,
		assignments: initialAutoApproved ? [] : [assignment],
	};
	const contextSnapshot = normalizeStableData(
		input.after.sourceSnapshot,
	) as JsonObject;
	const displaySnapshot = observedDisplaySnapshot(input);
	const displayPayload = normalizeStableData(displaySnapshot) as JsonObject;
	const snapshot: ApprovalWorkflowSnapshot = {
		id: workflowId,
		organizationId: input.organizationId,
		workflowType: input.source.workflowType,
		sourceType: input.source.sourceType,
		sourceId: input.source.sourceId,
		requesterEmployeeId: request.requestedBy,
		status,
		currentStageOrder: status === "pending" ? 1 : null,
		version,
		policySnapshot: {
			kind: "legacy_direct",
			approvalRequestId: request.id,
		},
		contextSnapshot,
		displaySnapshot,
		submittedAt: beforeRequest?.updatedAt ?? request.updatedAt,
		completedAt: status === "pending" ? null : transitionAt,
		cancelledAt: status === "cancelled" ? transitionAt : null,
		decisionReason:
			status === "cancelled"
				? cancellationReason
				: status === "rejected"
					? (afterRequest?.rejectionReason ?? "Legacy request rejected")
					: null,
		stages: [stage],
	};
	try {
		assertValidApprovalWorkflowSnapshot(snapshot);
	} catch {
		return fail("invalid_evidence");
	}
	const evidenceKey = canonicalEvidence(input);
	const drafts: LegacyEventDraft[] = [];
	if (initial) {
		drafts.push(
			assignmentEventDraft({
				eventType: "assignment.created",
				assignment,
				stageId,
				previousStatus: null,
				reason: null,
				occurredAt: transitionAt,
			}),
			stageEventDraft({
				eventType: "stage.activated",
				stage,
				previousStatus: "waiting",
				reason: null,
				occurredAt: transitionAt,
			}),
			{
				eventType: "workflow.activation_requested",
				previousState: null,
				resultingState: { status: "pending", currentStageOrder: 1 },
				reason: null,
				metadata: { stageId, stageOrder: 1 },
				occurredAt: transitionAt,
			},
		);
	} else if (initialAutoApproved) {
		drafts.push(
			stageEventDraft({
				eventType: "stage.auto_approved",
				stage,
				previousStatus: "waiting",
				reason: "requester_auto_approved",
				occurredAt: transitionAt,
				requesterEmployeeId: request.requestedBy,
			}),
			{
				eventType: "workflow.approved",
				previousState: null,
				resultingState: { status: "approved" },
				reason: "requester_auto_approved",
				metadata: null,
				occurredAt: transitionAt,
			},
		);
	} else if (approvedOwnerCancellation) {
		drafts.push({
			eventType: "workflow.cancelled",
			previousState: { status: "approved" },
			resultingState: { status: "cancelled" },
			reason: cancellationReason,
			metadata: null,
			occurredAt: transitionAt,
		});
	} else {
		const terminalStatus = status as "approved" | "rejected" | "cancelled";
		drafts.push(
			assignmentEventDraft({
				eventType: `assignment.${terminalStatus}`,
				assignment,
				stageId,
				previousStatus: "pending",
				reason: stage.decisionReason ?? request.reason,
				occurredAt: transitionAt,
			}),
			stageEventDraft({
				eventType: `stage.${terminalStatus}`,
				stage,
				previousStatus: "pending",
				reason: stage.decisionReason ?? request.reason,
				occurredAt: transitionAt,
			}),
			{
				eventType: `workflow.${terminalStatus}`,
				previousState: { status: "pending" },
				resultingState: { status: terminalStatus },
				reason: snapshot.decisionReason ?? request.reason,
				metadata: null,
				occurredAt: transitionAt,
			},
		);
	}
	const events: ApprovalWorkflowEventSnapshot[] = drafts.map(
		(draft, eventIndex) => ({
			id: deriveApprovalEventId({
				organizationId: input.organizationId,
				workflowId,
				allocationKey: `${input.idempotencyKey}:${evidenceKey}:${eventIndex}:${draft.eventType}`,
			}),
			organizationId: input.organizationId,
			workflowId,
			version,
			eventIndex,
			eventType: draft.eventType,
			actor: { ...input.actor },
			previousState: draft.previousState,
			resultingState: draft.resultingState,
			reason: draft.reason,
			metadata: draft.metadata,
			...(draft.references ? { references: draft.references } : {}),
			idempotencyKey: input.idempotencyKey,
			occurredAt: draft.occurredAt,
		}),
	);
	return {
		snapshot,
		events,
		projection: {
			organizationId: input.organizationId,
			workflowId,
			workflowType: input.source.workflowType,
			sourceType: input.source.sourceType,
			sourceId: input.source.sourceId,
			status: snapshot.status,
			currentStageOrder: snapshot.currentStageOrder,
			requesterEmployeeId: snapshot.requesterEmployeeId,
			displayPayload,
			searchText: "",
			activeInboxStage:
				status === "pending" ? { stageId, stageOrder: 1 } : null,
			updatedAt: transitionAt,
		},
		outbox: events.map((event) => ({
			organizationId: input.organizationId,
			workflowId,
			eventId: event.id,
			eventType: event.eventType,
			dedupeKey: `observe:${event.id}`,
			payload: {
				legacyObservation: true,
				organizationId: input.organizationId,
				workflowId,
				sourceType: input.source.sourceType,
				sourceId: input.source.sourceId,
				eventId: event.id,
				eventType: event.eventType,
			},
			disposition: "observe",
			createdAt: event.occurredAt,
		})),
	};
}

export function createLegacyApprovalObservationPlanner(_input: {
	clock: ApprovalEngineClock;
}): ApprovalLegacyObservationPlanner {
	return {
		async plan(input) {
			let normalized: ObservedLegacyTransition;
			try {
				normalized = normalizeStableData(input) as ObservedLegacyTransition;
			} catch {
				return fail("invalid_evidence");
			}
			return buildPlan(normalized);
		},
	};
}
