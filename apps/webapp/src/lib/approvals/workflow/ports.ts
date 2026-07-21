import type { SQL } from "drizzle-orm";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { ApprovedCancellationAuthorization } from "../domain-adapters/registry";
import type { ApprovalTerminalFinalizationResult } from "../domain-adapters/types";
import type { ApprovalProjectionWriteInput } from "../projection/contracts";
import type { ApprovalWorkflowCommand } from "./state-machine";
import type {
	ApprovalActorKind,
	ApprovalAssignmentStatus,
	ApprovalOutboxDisposition,
	ApprovalStageStatus,
	ApprovalWorkflowEventType,
	ApprovalWorkflowStatus,
	ApprovalWorkflowType,
} from "./types";

export type {
	ApprovalActorKind,
	ApprovalAssignmentStatus,
	ApprovalOutboxDisposition,
	ApprovalStageStatus,
	ApprovalWorkflowEventType,
	ApprovalWorkflowStatus,
	ApprovalWorkflowType,
};

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
	[key: string]: JsonValue;
}

export const APPROVAL_WORKFLOW_LIFECYCLE_MODES = [
	"legacy",
	"shadow",
	"ready",
	"canonical",
	"complete",
] as const;

export type ApprovalWorkflowLifecycleMode =
	(typeof APPROVAL_WORKFLOW_LIFECYCLE_MODES)[number];

export interface ApprovalTransactionClient {
	execute(query: SQL): Promise<unknown>;
}

export interface ApprovalDbService {
	db: ApprovalTransactionClient;
}

export interface ApprovalCutoverBehavior {
	serveFrom: "legacy" | "canonical";
	writeLegacy: boolean;
	writeCanonical: boolean;
	decideCanonical: boolean;
	mirror: "none" | "legacy_to_canonical" | "canonical_to_legacy";
}

export interface ApprovalWriteGateResult {
	mode: ApprovalWorkflowLifecycleMode;
	behavior: ApprovalCutoverBehavior;
}

export interface ApprovalWriteGate {
	/**
	 * Acquires the transaction-scoped rollout lock before reading behavior.
	 * The future engine must call this for every write, including complete mode.
	 */
	acquire(input: {
		organizationId: string;
		workflowType: ApprovalWorkflowType;
	}): Promise<ApprovalWriteGateResult>;
}

export type ApprovalAssignmentActorIdentity =
	| { kind: "employee"; employeeId: string; userId: null }
	| { kind: "system"; employeeId: null; userId: null };

export type ApprovalEventActorIdentity =
	| {
			kind: "employee";
			employeeId: string;
			userId: string | null;
	  }
	| { kind: "system"; employeeId: null; userId: null }
	| { kind: "legacy_unknown"; employeeId: null; userId: null };

export type ApprovalCommandActor =
	| { kind: "employee"; employeeId: string; userId: string }
	| { kind: "system"; employeeId: null; userId: null };

export type ApprovalWorkflowPrincipal =
	| { kind: "employee"; userId: string }
	| {
			kind: "system";
			systemId: "approval-expiry" | "approval-activation";
	  };

export interface ApprovalWorkflowCommandRequest {
	organizationId: string;
	workflowId: string;
	expectedVersion: number;
	idempotencyKey: string;
	principal: ApprovalWorkflowPrincipal;
	command: ApprovalWorkflowCommand;
}

export interface ApprovalCommandActorResolver {
	resolve(input: {
		dbService: ApprovalDbService;
		organizationId: string;
		principal: ApprovalWorkflowPrincipal;
	}): Promise<ApprovalCommandActor>;
}

export interface ApprovalSourceIdentity {
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	sourceType: string;
	sourceId: string;
}

export interface ApprovalAssignmentSnapshot {
	id: string;
	organizationId: string;
	workflowId: string;
	stageId: string;
	sequence: number;
	approverEmployeeId: string;
	status: ApprovalAssignmentStatus;
	assignedAt: Instant;
	resolvedAt: Instant | null;
	resolvedBy: ApprovalAssignmentActorIdentity | null;
	reassignedByEmployeeId: string | null;
	reassignedFromAssignmentId: string | null;
	reassignmentMetadata: JsonObject | null;
}

export interface ApprovalStageSnapshot {
	id: string;
	organizationId: string;
	workflowId: string;
	sequence: number;
	label: string;
	resolverSnapshot: JsonObject;
	activationMode: string;
	status: ApprovalStageStatus;
	activatedAt: Instant | null;
	decidedAt: Instant | null;
	decisionReason: string | null;
	legacyApprovalRequestId: string | null;
	assignments: ApprovalAssignmentSnapshot[];
}

export interface ApprovalWorkflowSnapshot extends ApprovalSourceIdentity {
	id: string;
	requesterEmployeeId: string | null;
	status: ApprovalWorkflowStatus;
	currentStageOrder: number | null;
	version: number;
	policySnapshot: JsonObject;
	contextSnapshot: JsonObject;
	displaySnapshot: JsonObject;
	submittedAt: Instant;
	completedAt: Instant | null;
	cancelledAt: Instant | null;
	decisionReason: string | null;
	stages: ApprovalStageSnapshot[];
}

export interface ApprovalWorkflowEventSnapshot {
	id: string;
	organizationId: string;
	workflowId: string;
	version: number;
	eventIndex: number;
	eventType: ApprovalWorkflowEventType;
	actor: ApprovalEventActorIdentity;
	previousState: JsonObject | null;
	resultingState: JsonObject;
	reason: string | null;
	metadata: JsonObject | null;
	references?: ApprovalWorkflowEventReferences;
	idempotencyKey: string | null;
	occurredAt: Instant;
}

export type ApprovalPlannedEntityReference =
	| { kind: "persisted"; id: string }
	| { kind: "allocate"; allocationKey: string };

export interface ApprovalIdentityAllocationIntent {
	/** Idempotent within (organizationId, workflowId, allocationKey). */
	allocationKey: string;
	entityKind: "assignment" | "event";
}

export interface ApprovalTransitionIdentityResolution {
	allocationKey: string;
	entityKind: "assignment" | "event";
	id: string;
}

export type ApprovalEventActorIntent =
	| { kind: "command_actor" }
	| { kind: "system" };

export type ApprovalPlannedActorReference =
	| ApprovalEventActorIntent
	| { kind: "persisted"; actor: ApprovalAssignmentActorIdentity };

export type ApprovalPlannedReassignmentActorReference =
	| ApprovalEventActorIntent
	| { kind: "persisted_employee"; employeeId: string };

export interface ApprovalPlannedAssignmentSnapshot {
	reference: ApprovalPlannedEntityReference;
	organizationId: string;
	workflowId: string;
	stageId: string;
	sequence: number;
	approverEmployeeId: string;
	status: ApprovalAssignmentStatus;
	assignedAt: Instant;
	resolvedAt: Instant | null;
	resolvedBy: ApprovalPlannedActorReference | null;
	reassignedBy: ApprovalPlannedReassignmentActorReference | null;
	reassignedFrom: ApprovalPlannedEntityReference | null;
	reassignmentMetadata: JsonObject | null;
}

export interface ApprovalPlannedStageSnapshot
	extends Omit<ApprovalStageSnapshot, "assignments"> {
	assignments: ApprovalPlannedAssignmentSnapshot[];
}

export interface ApprovalPlannedWorkflowSnapshot
	extends Omit<ApprovalWorkflowSnapshot, "stages"> {
	stages: ApprovalPlannedStageSnapshot[];
}

export interface ApprovalWorkflowEventReferenceIntents {
	assignment?: ApprovalPlannedEntityReference;
	sourceAssignment?: ApprovalPlannedEntityReference;
	targetAssignment?: ApprovalPlannedEntityReference;
}

export interface ApprovalWorkflowEventReferences {
	assignmentId?: string;
	sourceAssignmentId?: string;
	targetAssignmentId?: string;
}

export interface ApprovalWorkflowEventIntent {
	reference: Extract<ApprovalPlannedEntityReference, { kind: "allocate" }>;
	organizationId: string;
	workflowId: string;
	version: number;
	eventIndex: number;
	eventType: ApprovalWorkflowEventType;
	actor: ApprovalEventActorIntent;
	previousState: JsonObject | null;
	resultingState: JsonObject;
	reason: string | null;
	metadata: JsonObject | null;
	references: ApprovalWorkflowEventReferenceIntents;
	occurredAt: Instant;
}

export interface ApprovalOutboxWriteInput {
	organizationId: string;
	workflowId: string;
	eventId: string;
	eventType: string;
	dedupeKey: string;
	payload: JsonObject;
	disposition: ApprovalOutboxDisposition;
	createdAt: Instant;
}

export type ApprovalOutboxWriteResult =
	| { kind: "inserted"; id: string }
	| { kind: "duplicate"; id: string };

export interface ApprovalOutboxWriter {
	write(input: ApprovalOutboxWriteInput): Promise<ApprovalOutboxWriteResult>;
}

export interface ApprovalProjectionWriter {
	write(input: ApprovalProjectionWriteInput): Promise<void>;
}

export interface ApprovalCommandResult {
	snapshot: ApprovalWorkflowSnapshot;
	events: ApprovalWorkflowEventSnapshot[];
	projection: ApprovalProjectionWriteInput;
	outbox: ApprovalOutboxWriteInput[];
}

export interface ApprovalWorkflowAuthorization {
	authorize(input: {
		dbService: ApprovalDbService;
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		actor: ApprovalCommandActor;
		command: ApprovalWorkflowCommand;
	}): Promise<"active_assignment" | "requester" | "manage_approval" | "system">;
}

export interface ApprovalTransitionResultBuilder {
	build(input: {
		materializedBatch: readonly [
			ApprovalMaterializedTransitionPlan,
			...ApprovalMaterializedTransitionPlan[],
		];
		finalization: ApprovalTerminalFinalizationResult | null;
	}): ApprovalCommandResult;
}

export interface ApprovalEngineClock {
	nowInstant(): Instant;
}

export interface ObservedApprovalOutboxWriteInput
	extends Omit<ApprovalOutboxWriteInput, "disposition"> {
	disposition: "observe";
}

export interface ObservedLegacyTransitionPlan
	extends Omit<ApprovalCommandResult, "outbox"> {
	outbox: ObservedApprovalOutboxWriteInput[];
}

export interface ObservedLegacyTransitionResult
	extends ObservedLegacyTransitionPlan {
	/** The repository atomically persisted the aggregate, children, and these events exactly once. */
	eventPersistence: {
		kind: "aggregate_and_events_persisted";
		eventIds: string[];
	};
}

export interface ApprovalWorkflowRootState {
	status: ApprovalWorkflowStatus;
	currentStageOrder: number | null;
	version: number;
	completedAt: Instant | null;
	cancelledAt: Instant | null;
	decisionReason: string | null;
}

export interface ApprovalWorkflowRootChange {
	previous: ApprovalWorkflowRootState;
	resulting: ApprovalWorkflowRootState;
}

export interface ApprovalStageChange {
	stageId: string;
	previous: ApprovalStageSnapshot;
	resulting: ApprovalPlannedStageSnapshot;
}

export type ApprovalAssignmentChange =
	| {
			kind: "update";
			reference: Extract<ApprovalPlannedEntityReference, { kind: "persisted" }>;
			previous: ApprovalAssignmentSnapshot;
			resulting: ApprovalPlannedAssignmentSnapshot;
	  }
	| {
			kind: "create";
			reference: Extract<ApprovalPlannedEntityReference, { kind: "allocate" }>;
			resulting: ApprovalPlannedAssignmentSnapshot;
	  };

export interface ApprovalTransitionChanges {
	root: ApprovalWorkflowRootChange;
	stages: ApprovalStageChange[];
	assignments: ApprovalAssignmentChange[];
}

export type ApprovalTerminalTransitionIntent =
	| {
			kind: "approve";
			from: "pending";
			to: "approved";
			reason: string | null;
	  }
	| {
			kind: "reject";
			from: "pending";
			to: "rejected";
			reason: string;
	  }
	| {
			kind: "cancel_pending";
			from: "pending";
			to: "cancelled";
			reason: string;
	  }
	| {
			kind: "expire";
			from: "pending";
			to: "expired";
			reason: string;
	  }
	| {
			kind: "cancel_approved";
			from: "approved";
			to: "cancelled";
			reason: string;
			authorization: ApprovedCancellationAuthorization;
	  };

export type ApprovalTransitionNextAction =
	| { kind: "none" }
	| { kind: "needs_activation"; stageId: string; stageOrder: number }
	| {
			kind: "finalize_terminal";
			transition: ApprovalTerminalTransitionIntent;
	  };

export interface ApprovalTransitionPlan {
	expectedVersion: number;
	previousSnapshot: ApprovalWorkflowSnapshot;
	plannedSnapshot: ApprovalPlannedWorkflowSnapshot;
	changes: ApprovalTransitionChanges;
	events: ApprovalWorkflowEventIntent[];
	identityAllocations: ApprovalIdentityAllocationIntent[];
	nextAction: ApprovalTransitionNextAction;
}

export interface ApprovalMaterializedStageChange {
	stageId: string;
	previous: ApprovalStageSnapshot;
	resulting: ApprovalStageSnapshot;
}

export type ApprovalMaterializedAssignmentChange =
	| {
			kind: "update";
			assignmentId: string;
			previous: ApprovalAssignmentSnapshot;
			resulting: ApprovalAssignmentSnapshot;
	  }
	| {
			kind: "create";
			assignmentId: string;
			resulting: ApprovalAssignmentSnapshot;
	  };

export interface ApprovalMaterializedTransitionChanges {
	root: ApprovalWorkflowRootChange;
	stages: ApprovalMaterializedStageChange[];
	assignments: ApprovalMaterializedAssignmentChange[];
}

export interface ApprovalMaterializedWorkflowEvent
	extends ApprovalWorkflowEventSnapshot {
	references: ApprovalWorkflowEventReferences;
	/** Exact JSONB value the repository writes to approval_workflow_event.metadata. */
	persistenceMetadata: JsonObject | null;
}

export interface ApprovalMaterializedTransitionPlan {
	expectedVersion: number;
	resultingSnapshot: ApprovalWorkflowSnapshot;
	changes: ApprovalMaterializedTransitionChanges;
	events: ApprovalMaterializedWorkflowEvent[];
	nextAction: ApprovalTransitionNextAction;
}

export interface ApprovalCommandReceiptIdentity {
	organizationId: string;
	workflowId: string;
	idempotencyKey: string;
	actorFingerprint: string;
	commandFingerprint: string;
}

export interface ApprovalCommandActorBinding {
	/**
	 * Task 2.3 must resolve and verify the employeeId/userId pair from trusted
	 * organization membership before claiming the command receipt.
	 */
	receipt: ApprovalCommandReceiptIdentity;
	/**
	 * The original receipt actor when an internally generated system transition
	 * is materialized under a caller-owned idempotency receipt.
	 */
	receiptActor?: ApprovalCommandActor;
	actor: ApprovalCommandActor;
}

export interface LegacyApprovalRequestSnapshot {
	id: string;
	organizationId: string;
	entityType: string;
	entityId: string;
	requestedBy: string;
	approverId: string;
	status: "pending" | "approved" | "rejected";
	reason: string | null;
	rejectionReason: string | null;
	approvedAt: Instant | null;
	metadata: JsonObject | null;
	updatedAt: Instant;
}

export type LegacyApprovalChainStatus =
	| "pending"
	| "approved"
	| "rejected"
	| "cancelled";

export interface LegacyApprovalChainSnapshot {
	id: string;
	organizationId: string;
	policyId: string;
	policyNameSnapshot: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	currentStageOrder: number;
	status: LegacyApprovalChainStatus;
	createdAt: Instant;
	updatedAt: Instant;
	completedAt: Instant | null;
}

export interface LegacyApprovalChainRowSnapshot {
	id: string;
	organizationId: string;
	chainInstanceId: string;
	policyStageId: string;
	stepOrder: number;
	labelSnapshot: string;
	approverTypeSnapshot: string;
	resolvedApproverEmployeeId: string;
	approvalRequestId: string | null;
	status: LegacyApprovalChainStatus;
	decidedBy: string | null;
	decidedAt: Instant | null;
	createdAt: Instant;
	updatedAt: Instant;
}

export interface VerifiedLegacyApprovalState {
	organizationId: string;
	source: ApprovalSourceIdentity;
	approvalRequest: LegacyApprovalRequestSnapshot | null;
	chain: LegacyApprovalChainSnapshot | null;
	chainRows: LegacyApprovalChainRowSnapshot[];
	sourceSnapshot: JsonObject;
	displaySnapshot?: JsonObject;
	capturedAt: Instant;
}

export interface ObservedLegacyTransition {
	organizationId: string;
	source: ApprovalSourceIdentity;
	before: VerifiedLegacyApprovalState;
	after: VerifiedLegacyApprovalState;
	actor: ApprovalEventActorIdentity;
	idempotencyKey: string;
	expectedVersion: number | null;
}

export interface TransactionalWorkflowRepository {
	findInitialWorkflow(input: {
		organizationId: string;
		workflowType: ApprovalWorkflowType;
		sourceType: string;
		sourceId: string;
		submissionKey: string;
		requesterEmployeeId: string;
		contextSnapshot: JsonObject;
		displaySnapshot: JsonObject;
	}): Promise<
		| { kind: "none" }
		| { kind: "existing"; snapshot: ApprovalWorkflowSnapshot }
		| { kind: "source_conflict" }
	>;
	loadSnapshot(input: {
		organizationId: string;
		workflowId: string;
	}): Promise<ApprovalWorkflowSnapshot>;
	createInitialWorkflow(input: {
		snapshot: ApprovalWorkflowSnapshot;
		events: ApprovalWorkflowEventSnapshot[];
		submissionKey: string;
	}): Promise<
		| { kind: "created"; snapshot: ApprovalWorkflowSnapshot }
		| { kind: "existing"; snapshot: ApprovalWorkflowSnapshot }
		| { kind: "source_conflict" }
	>;
	/**
	 * The receipt identity is scoped by (organizationId, workflowId, idempotencyKey).
	 * A reused key with different actor/command fingerprints returns mismatch. A
	 * concurrent loser waits for and returns the winner's serialized completed result.
	 */
	claimCommand(
		input: ApprovalCommandReceiptIdentity,
	): Promise<
		| { kind: "reserved" }
		| { kind: "completed"; result: ApprovalCommandResult }
		| { kind: "fingerprint_mismatch" }
	>;
	tryAdvanceVersion(input: {
		organizationId: string;
		workflowId: string;
		expectedVersion: number;
	}): Promise<
		| { kind: "advanced"; version: number }
		| { kind: "conflict"; version: number | null }
	>;
	allocateTransitionIdentities(input: {
		organizationId: string;
		workflowId: string;
		identityAllocations: ApprovalIdentityAllocationIntent[];
	}): Promise<ApprovalTransitionIdentityResolution[]>;
	/**
	 * Called after a successful root version CAS. Persists every non-version root
	 * field, materialized stage/assignment change, and append-only event in the
	 * caller-owned transaction.
	 */
	applyMaterializedTransition(
		plan: ApprovalMaterializedTransitionPlan,
	): Promise<void>;
	completeCommand(
		input: ApprovalCommandReceiptIdentity & { result: ApprovalCommandResult },
	): Promise<void>;
	applyObservedLegacyTransition(
		input: ObservedLegacyTransition,
	): Promise<ObservedLegacyTransitionResult>;
}

export interface StageActivationInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workflow: ApprovalWorkflowSnapshot;
	stage: ApprovalStageSnapshot;
	actor: ApprovalEventActorIdentity;
	routingContext: JsonObject;
}

export interface ResolvedStage {
	organizationId: string;
	workflowId: string;
	stageId: string;
	activationMode: string;
	assignments: Array<{
		approverEmployeeId: string;
		metadata: JsonObject;
	}>;
}

export interface StageActivationResolver {
	resolve(input: StageActivationInput): Promise<ResolvedStage>;
}

export interface ApprovalWorkflowSourceMap {
	absence: unknown;
	time_correction: unknown;
	manual_time_submission: unknown;
	policy_clock_out: unknown;
	travel_expense: unknown;
	shift_request: unknown;
	compliance_exception: unknown;
}

/** Loads a source only from the transaction-scoped canonical workflow identity. */
export interface ApprovalWorkflowSourceLoader {
	load<Type extends ApprovalWorkflowType>(input: {
		dbService: ApprovalDbService;
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot & { workflowType: Type };
		actor: ApprovalEventActorIdentity;
	}): Promise<ApprovalWorkflowSourceMap[Type]>;
}
