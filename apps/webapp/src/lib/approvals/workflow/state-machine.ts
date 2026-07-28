import {
	compareInstants,
	type Instant,
	isInstant,
} from "@/lib/datetime/temporal-core";
import {
	type ApprovedCancellationAuthorization,
	isApprovedCancellationAuthorization,
} from "../domain-adapters/registry";
import type {
	ApprovalAssignmentActorIdentity,
	ApprovalAssignmentChange,
	ApprovalAssignmentSnapshot,
	ApprovalCommandActor,
	ApprovalCommandActorBinding,
	ApprovalEventActorIdentity,
	ApprovalEventActorIntent,
	ApprovalMaterializedTransitionPlan,
	ApprovalPlannedActorReference,
	ApprovalPlannedAssignmentSnapshot,
	ApprovalPlannedEntityReference,
	ApprovalPlannedReassignmentActorReference,
	ApprovalPlannedStageSnapshot,
	ApprovalPlannedWorkflowSnapshot,
	ApprovalStageSnapshot,
	ApprovalTransitionIdentityResolution,
	ApprovalTransitionNextAction,
	ApprovalTransitionPlan,
	ApprovalWorkflowEventIntent,
	ApprovalWorkflowEventReferenceIntents,
	ApprovalWorkflowEventReferences,
	ApprovalWorkflowEventType,
	ApprovalWorkflowRootState,
	ApprovalWorkflowSnapshot,
	JsonObject,
	JsonValue,
	ResolvedStage,
} from "./ports";
import { APPROVAL_WORKFLOW_EVENT_TYPES } from "./types";

export type ApprovalWorkflowCommand =
	| {
			type: "approve";
			stageId: string;
			assignmentId: string;
			reason?: string;
	  }
	| {
			type: "reject";
			stageId: string;
			assignmentId: string;
			reason: string;
	  }
	| { type: "cancel"; reason: string }
	| { type: "expire"; reason: string }
	| {
			type: "reassign";
			stageId: string;
			fromEmployeeId: string;
			toEmployeeId: string;
	  }
	| {
			type: "escalate";
			stageId: string;
			fromEmployeeId: string;
			toEmployeeId: string;
	  };

export type ApprovalStateMachineErrorCode =
	| "INVALID_SNAPSHOT"
	| "TERMINAL_TRANSITION"
	| "STALE_STAGE"
	| "STALE_ASSIGNMENT"
	| "INVALID_COMMAND"
	| "INVALID_ACTIVATION"
	| "REASSIGNMENT_CONFLICT"
	| "MATERIALIZATION_CONFLICT"
	| "INVALID_POLICY"
	| "INVALID_TIME"
	| "INVALID_EVENT_METADATA";

export type ApprovalWorkflowPolicy =
	| { kind: "standard" }
	| {
			kind: "approved_cancellation";
			authorization: ApprovedCancellationAuthorization;
	  };

export class ApprovalStateMachineError extends Error {
	readonly code: ApprovalStateMachineErrorCode;
	readonly details: JsonObject;

	constructor(code: ApprovalStateMachineErrorCode, details: JsonObject = {}) {
		super(code);
		this.name = "ApprovalStateMachineError";
		this.code = code;
		this.details = details;
	}
}

interface EventDraft {
	eventType: ApprovalWorkflowEventType;
	actor: ApprovalEventActorIntent;
	previousState: JsonObject | null;
	resultingState: JsonObject;
	reason: string | null;
	metadata?: JsonObject | null;
	references?: ApprovalWorkflowEventReferenceIntents;
}

const TERMINAL_WORKFLOW_STATUSES = new Set([
	"approved",
	"rejected",
	"cancelled",
	"expired",
]);
const TERMINAL_STAGE_STATUSES = new Set([
	"approved",
	"rejected",
	"cancelled",
	"expired",
]);
const WORKFLOW_STATUSES = new Set([
	"pending",
	"approved",
	"rejected",
	"cancelled",
	"expired",
]);
const WORKFLOW_TYPES = new Set([
	"absence",
	"time_correction",
	"manual_time_submission",
	"policy_clock_out",
	"travel_expense",
	"shift_request",
	"compliance_exception",
]);
const STAGE_STATUSES = new Set([
	"waiting",
	"pending",
	"approved",
	"rejected",
	"cancelled",
	"expired",
]);
const ASSIGNMENT_STATUSES = new Set([
	"pending",
	"approved",
	"rejected",
	"cancelled",
	"expired",
]);
const ACTIVATION_MODES = new Set(["human", "requester_auto_approve"]);
const EVENT_TYPES = new Set<ApprovalWorkflowEventType>(
	APPROVAL_WORKFLOW_EVENT_TYPES,
);
/** Workflow boundaries accept canonical lowercase, hyphenated UUID text only. */
const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(
	code: ApprovalStateMachineErrorCode,
	details: JsonObject = {},
): never {
	throw new ApprovalStateMachineError(code, details);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isWorkflowEventType(
	value: unknown,
): value is ApprovalWorkflowEventType {
	return (
		typeof value === "string" &&
		EVENT_TYPES.has(value as ApprovalWorkflowEventType)
	);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isCanonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID.test(value);
}

function isNullableInstant(value: unknown): value is Instant | null {
	return value === null || isInstant(value);
}

function assertReason(
	value: unknown,
	command: ApprovalWorkflowCommand["type"],
): asserts value is string {
	if (!nonEmpty(value)) fail("INVALID_COMMAND", { command, field: "reason" });
}

function validateCommandIdentities(
	command: unknown,
): asserts command is ApprovalWorkflowCommand {
	if (!isRecord(command) || typeof command.type !== "string") {
		fail("INVALID_COMMAND", { field: "command" });
	}
	const commandType = command.type;
	const invalid = (field: string): never =>
		fail("INVALID_COMMAND", { command: commandType, field });
	if (command.type === "cancel" || command.type === "expire") return;
	if (
		command.type !== "approve" &&
		command.type !== "reject" &&
		command.type !== "reassign" &&
		command.type !== "escalate"
	)
		invalid("type");
	if (!isCanonicalUuid(command.stageId)) invalid("stageId");
	if (command.type === "approve" || command.type === "reject") {
		if (!isCanonicalUuid(command.assignmentId)) invalid("assignmentId");
		return;
	}
	if (!isCanonicalUuid(command.fromEmployeeId)) invalid("fromEmployeeId");
	if (!isCanonicalUuid(command.toEmployeeId)) invalid("toEmployeeId");
}

function validatePolicy(
	policy: unknown,
): asserts policy is ApprovalWorkflowPolicy {
	if (!isRecord(policy) || typeof policy.kind !== "string") {
		fail("INVALID_POLICY", { field: "policy" });
	}
	if (policy.kind === "standard") {
		if (Object.hasOwn(policy, "authorization")) {
			fail("INVALID_POLICY", { field: "authorization" });
		}
		return;
	}
	if (policy.kind !== "approved_cancellation") {
		fail("INVALID_POLICY", { field: "authorization" });
	}
}

function validateNow(now: unknown): asserts now is Instant {
	if (!isInstant(now)) fail("INVALID_TIME", { field: "now" });
}

function assertNotBefore(
	now: Instant,
	boundary: Instant,
	boundaryName: string,
): void {
	if (compareInstants(now, boundary) < 0) {
		fail("INVALID_TIME", { boundary: boundaryName });
	}
}

function assertPendingClosureChronology(
	stages: ApprovalStageSnapshot[],
	now: Instant,
): void {
	for (const stage of stages) {
		if (stage.status === "pending" && stage.activatedAt) {
			assertNotBefore(now, stage.activatedAt, "stage.activatedAt");
		}
		for (const assignment of stage.assignments) {
			if (assignment.status === "pending") {
				assertNotBefore(now, assignment.assignedAt, "assignment.assignedAt");
			}
		}
	}
}

const INVALID_JSON_VALUE = Symbol("invalidJsonValue");

function cloneJsonTraversal(
	value: unknown,
	seen = new Set<object>(),
): JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		if (Number.isFinite(value)) return value;
		throw INVALID_JSON_VALUE;
	}
	if (typeof value !== "object" || seen.has(value)) throw INVALID_JSON_VALUE;
	seen.add(value);
	try {
		const prototype = Object.getPrototypeOf(value);
		const keys = Reflect.ownKeys(value);
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (Array.isArray(value)) {
			if (
				prototype !== Array.prototype ||
				keys.some((key) => typeof key === "symbol") ||
				!keys.every(
					(key) =>
						key === "length" ||
						(typeof key === "string" &&
							/^(?:0|[1-9]\d*)$/.test(key) &&
							Number(key) < value.length),
				)
			) {
				throw INVALID_JSON_VALUE;
			}
			const clone: JsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				const descriptor = descriptors[String(index)];
				if (!descriptor?.enumerable || !("value" in descriptor)) {
					throw INVALID_JSON_VALUE;
				}
				clone.push(cloneJsonTraversal(descriptor.value, seen));
			}
			return clone;
		}
		if (prototype !== Object.prototype && prototype !== null) {
			throw INVALID_JSON_VALUE;
		}
		const clone = Object.create(prototype) as JsonObject;
		for (const key of keys) {
			if (typeof key !== "string") throw INVALID_JSON_VALUE;
			const descriptor = descriptors[key];
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				throw INVALID_JSON_VALUE;
			}
			Object.defineProperty(clone, key, {
				configurable: true,
				enumerable: true,
				value: cloneJsonTraversal(descriptor.value, seen),
				writable: true,
			});
		}
		return clone;
	} catch {
		throw INVALID_JSON_VALUE;
	} finally {
		seen.delete(value);
	}
}

function isJsonValue(value: unknown): value is JsonValue {
	try {
		cloneJsonTraversal(value);
		return true;
	} catch {
		return false;
	}
}

function cloneJson<Value extends JsonValue>(value: Value): Value {
	try {
		return cloneJsonTraversal(value) as Value;
	} catch {
		return fail("INVALID_SNAPSHOT", { invariant: "json_clone_value" });
	}
}

function cloneActor(
	actor: ApprovalAssignmentActorIdentity | null,
): ApprovalAssignmentActorIdentity | null {
	return actor ? { ...actor } : null;
}

function clonePersistedAssignment(
	value: ApprovalAssignmentSnapshot,
): ApprovalAssignmentSnapshot {
	return {
		...value,
		resolvedBy: cloneActor(value.resolvedBy),
		reassignmentMetadata: value.reassignmentMetadata
			? cloneJson(value.reassignmentMetadata)
			: null,
	};
}

function clonePersistedStage(
	value: ApprovalStageSnapshot,
): ApprovalStageSnapshot {
	return {
		...value,
		resolverSnapshot: cloneJson(value.resolverSnapshot),
		assignments: value.assignments.map(clonePersistedAssignment),
	};
}

function clonePersistedSnapshot(
	value: ApprovalWorkflowSnapshot,
): ApprovalWorkflowSnapshot {
	return {
		...value,
		policySnapshot: cloneJson(value.policySnapshot),
		contextSnapshot: cloneJson(value.contextSnapshot),
		displaySnapshot: cloneJson(value.displaySnapshot),
		stages: value.stages.map(clonePersistedStage),
	};
}

function cloneEventReferences(
	references: ApprovalWorkflowEventReferenceIntents = {},
): ApprovalWorkflowEventReferenceIntents {
	return Object.fromEntries(
		Object.entries(references).map(([key, reference]) => [
			key,
			cloneReference(reference),
		]),
	) as ApprovalWorkflowEventReferenceIntents;
}

function cloneNextAction(
	nextAction: ApprovalTransitionNextAction,
): ApprovalTransitionNextAction {
	if (nextAction.kind === "none") return { kind: "none" };
	if (nextAction.kind === "needs_activation") return { ...nextAction };
	return {
		kind: "finalize_terminal",
		transition: { ...nextAction.transition },
	};
}

function persistedReference(
	id: string,
): Extract<ApprovalPlannedEntityReference, { kind: "persisted" }> {
	return { kind: "persisted", id };
}

function allocationReference(
	allocationKey: string,
): Extract<ApprovalPlannedEntityReference, { kind: "allocate" }> {
	return { kind: "allocate", allocationKey };
}

function cloneReference(
	reference: ApprovalPlannedEntityReference,
): ApprovalPlannedEntityReference {
	return { ...reference };
}

function planPersistedAssignment(
	value: ApprovalAssignmentSnapshot,
): ApprovalPlannedAssignmentSnapshot {
	return {
		reference: persistedReference(value.id),
		organizationId: value.organizationId,
		workflowId: value.workflowId,
		stageId: value.stageId,
		sequence: value.sequence,
		approverEmployeeId: value.approverEmployeeId,
		status: value.status,
		assignedAt: value.assignedAt,
		resolvedAt: value.resolvedAt,
		resolvedBy: value.resolvedBy
			? { kind: "persisted", actor: { ...value.resolvedBy } }
			: null,
		reassignedBy: value.reassignedByEmployeeId
			? {
					kind: "persisted_employee",
					employeeId: value.reassignedByEmployeeId,
				}
			: null,
		reassignedFrom: value.reassignedFromAssignmentId
			? persistedReference(value.reassignedFromAssignmentId)
			: null,
		reassignmentMetadata: value.reassignmentMetadata
			? cloneJson(value.reassignmentMetadata)
			: null,
	};
}

function clonePlannedAssignment(
	value: ApprovalPlannedAssignmentSnapshot,
): ApprovalPlannedAssignmentSnapshot {
	return {
		...value,
		reference: cloneReference(value.reference),
		resolvedBy:
			value.resolvedBy?.kind === "persisted"
				? { kind: "persisted", actor: { ...value.resolvedBy.actor } }
				: value.resolvedBy
					? { ...value.resolvedBy }
					: null,
		reassignedBy: value.reassignedBy ? { ...value.reassignedBy } : null,
		reassignedFrom: value.reassignedFrom
			? cloneReference(value.reassignedFrom)
			: null,
		reassignmentMetadata: value.reassignmentMetadata
			? cloneJson(value.reassignmentMetadata)
			: null,
	};
}

function planPersistedStage(
	value: ApprovalStageSnapshot,
): ApprovalPlannedStageSnapshot {
	return {
		...value,
		resolverSnapshot: cloneJson(value.resolverSnapshot),
		assignments: value.assignments.map(planPersistedAssignment),
	};
}

function clonePlannedStage(
	value: ApprovalPlannedStageSnapshot,
): ApprovalPlannedStageSnapshot {
	return {
		...value,
		resolverSnapshot: cloneJson(value.resolverSnapshot),
		assignments: value.assignments.map(clonePlannedAssignment),
	};
}

function planPersistedSnapshot(
	value: ApprovalWorkflowSnapshot,
): ApprovalPlannedWorkflowSnapshot {
	return {
		...value,
		policySnapshot: cloneJson(value.policySnapshot),
		contextSnapshot: cloneJson(value.contextSnapshot),
		displaySnapshot: cloneJson(value.displaySnapshot),
		stages: value.stages.map(planPersistedStage),
	};
}

function invalidSnapshot(invariant: string, details: JsonObject = {}): never {
	return fail("INVALID_SNAPSHOT", { invariant, ...details });
}

function validateAssignmentActor(
	actor: unknown,
	onInvalid: (field: string) => never,
): asserts actor is ApprovalAssignmentActorIdentity {
	if (!isRecord(actor)) onInvalid("actor");
	if (!hasExactKeys(actor, ["kind", "employeeId", "userId"])) {
		onInvalid("actorShape");
	}
	if (actor.kind === "employee") {
		if (!isCanonicalUuid(actor.employeeId) || actor.userId !== null) {
			onInvalid("employeeIdentity");
		}
		return;
	}
	if (actor.kind !== "system") onInvalid("kind");
	if (actor.employeeId !== null || actor.userId !== null) onInvalid("actorIds");
}

function validateEventActor(
	actor: unknown,
	onInvalid: (field: string) => never,
): asserts actor is ApprovalEventActorIdentity {
	if (!isRecord(actor)) onInvalid("actor");
	if (!hasExactKeys(actor, ["kind", "employeeId", "userId"])) {
		onInvalid("actorShape");
	}
	if (actor.userId !== null && !nonEmpty(actor.userId)) onInvalid("userId");
	if (actor.kind === "employee") {
		if (!isCanonicalUuid(actor.employeeId)) onInvalid("employeeId");
		return;
	}
	if (actor.kind !== "system" && actor.kind !== "legacy_unknown") {
		onInvalid("kind");
	}
	if (actor.employeeId !== null || actor.userId !== null) onInvalid("actorIds");
}

function validatePendingHumanStage(stage: ApprovalStageSnapshot): void {
	const pending = stage.assignments.filter(
		(child) => child.status === "pending",
	);
	if (pending.length === 0) {
		invalidSnapshot("pending_human_stage_without_active_assignment", {
			stageId: stage.id,
		});
	}
	const assignmentsById = new Map(
		stage.assignments.map((assignment) => [assignment.id, assignment]),
	);
	for (const child of stage.assignments) {
		if (
			child.status === "approved" ||
			child.status === "rejected" ||
			child.status === "expired"
		) {
			invalidSnapshot("pending_human_stage_decision_history", {
				stageId: stage.id,
				assignmentId: child.id,
				assignmentStatus: child.status,
			});
		}
		if (child.status !== "cancelled") continue;
		const descendants = stage.assignments.filter(
			(candidate) =>
				candidate.reassignedFromAssignmentId === child.id &&
				candidate.sequence > child.sequence,
		);
		if (descendants.length > 1) {
			invalidSnapshot("pending_human_stage_reassignment_lineage", {
				stageId: stage.id,
				assignmentId: child.id,
				descendantCount: descendants.length,
			});
		}
	}
	for (const child of stage.assignments) {
		if (
			child.reassignmentMetadata !== null &&
			child.reassignmentMetadata.kind !== "reassignment" &&
			child.reassignmentMetadata.kind !== "escalation"
		) {
			invalidSnapshot("assignment_reassignment_metadata", {
				assignmentId: child.id,
			});
		}
		if (child.reassignedFromAssignmentId === null) {
			if (
				child.reassignedByEmployeeId !== null ||
				child.reassignmentMetadata !== null
			) {
				invalidSnapshot("assignment_lineage_without_source", {
					assignmentId: child.id,
				});
			}
			continue;
		}
		const source = assignmentsById.get(child.reassignedFromAssignmentId);
		if (
			source?.status !== "cancelled" ||
			source.sequence >= child.sequence ||
			source.resolvedAt === null ||
			compareInstants(child.assignedAt, source.resolvedAt) < 0
		) {
			invalidSnapshot("assignment_reassignment_lineage", {
				assignmentId: child.id,
			});
		}
	}
}

function validateSnapshot(
	input: unknown,
): asserts input is ApprovalWorkflowSnapshot {
	if (!isRecord(input)) invalidSnapshot("snapshot_object");
	const snapshot = input as unknown as ApprovalWorkflowSnapshot;
	if (
		!isCanonicalUuid(snapshot.id) ||
		!nonEmpty(snapshot.organizationId) ||
		!nonEmpty(snapshot.sourceType) ||
		!WORKFLOW_TYPES.has(snapshot.workflowType as string) ||
		!isCanonicalUuid(snapshot.sourceId) ||
		(snapshot.requesterEmployeeId !== null &&
			!isCanonicalUuid(snapshot.requesterEmployeeId)) ||
		!Number.isInteger(snapshot.version) ||
		(snapshot.version as number) < 0 ||
		!WORKFLOW_STATUSES.has(snapshot.status as string) ||
		!isInstant(snapshot.submittedAt) ||
		!isNullableInstant(snapshot.completedAt) ||
		!isNullableInstant(snapshot.cancelledAt) ||
		(snapshot.decisionReason !== null &&
			typeof snapshot.decisionReason !== "string") ||
		!Array.isArray(snapshot.stages)
	) {
		invalidSnapshot("workflow_identity_or_version");
	}
	if (
		!isJsonValue(snapshot.policySnapshot) ||
		!isJsonValue(snapshot.contextSnapshot) ||
		!isJsonValue(snapshot.displaySnapshot)
	) {
		invalidSnapshot("workflow_json_snapshot");
	}

	const stageIds = new Set<string>();
	const stageSequences = new Set<number>();
	const assignmentIds = new Set<string>();
	for (const item of snapshot.stages) {
		if (!isRecord(item)) invalidSnapshot("stage_object");
		if (
			!isCanonicalUuid(item.id) ||
			stageIds.has(item.id) ||
			!Number.isInteger(item.sequence) ||
			item.sequence < 1 ||
			stageSequences.has(item.sequence) ||
			!nonEmpty(item.label) ||
			!STAGE_STATUSES.has(item.status as string) ||
			!ACTIVATION_MODES.has(item.activationMode as string) ||
			!isNullableInstant(item.activatedAt) ||
			!isNullableInstant(item.decidedAt) ||
			(item.decisionReason !== null &&
				typeof item.decisionReason !== "string") ||
			!Array.isArray(item.assignments)
		) {
			invalidSnapshot("unique_stage_identity_and_sequence", {
				stageId: item.id,
				stageOrder: item.sequence,
			});
		}
		stageIds.add(item.id);
		stageSequences.add(item.sequence);
		if (
			item.organizationId !== snapshot.organizationId ||
			item.workflowId !== snapshot.id ||
			!isCanonicalUuid(item.workflowId) ||
			(item.legacyApprovalRequestId !== null &&
				!isCanonicalUuid(item.legacyApprovalRequestId))
		) {
			invalidSnapshot("stage_scope", { stageId: item.id });
		}
		if (!isJsonValue(item.resolverSnapshot)) {
			invalidSnapshot("stage_resolver_snapshot", { stageId: item.id });
		}

		const assignmentSequences = new Set<number>();
		for (const child of item.assignments) {
			if (!isRecord(child)) invalidSnapshot("assignment_object");
			if (
				!isCanonicalUuid(child.id) ||
				assignmentIds.has(child.id) ||
				!Number.isInteger(child.sequence) ||
				child.sequence < 1 ||
				assignmentSequences.has(child.sequence) ||
				!ASSIGNMENT_STATUSES.has(child.status as string) ||
				!isInstant(child.assignedAt) ||
				!isNullableInstant(child.resolvedAt)
			) {
				invalidSnapshot("unique_assignment_identity_and_sequence", {
					assignmentId: child.id,
					assignmentSequence: child.sequence,
				});
			}
			assignmentIds.add(child.id);
			assignmentSequences.add(child.sequence);
			if (
				child.organizationId !== snapshot.organizationId ||
				child.workflowId !== snapshot.id ||
				child.stageId !== item.id ||
				!isCanonicalUuid(child.workflowId) ||
				!isCanonicalUuid(child.stageId) ||
				!isCanonicalUuid(child.approverEmployeeId) ||
				(child.reassignedByEmployeeId !== null &&
					!isCanonicalUuid(child.reassignedByEmployeeId)) ||
				(child.reassignedFromAssignmentId !== null &&
					!isCanonicalUuid(child.reassignedFromAssignmentId))
			) {
				invalidSnapshot("assignment_scope", { assignmentId: child.id });
			}
			if (child.resolvedBy) {
				validateAssignmentActor(child.resolvedBy, (field) =>
					invalidSnapshot("assignment_actor_identity", {
						assignmentId: child.id,
						field,
					}),
				);
			}
			if (
				(child.status === "pending" &&
					(child.resolvedAt !== null || child.resolvedBy !== null)) ||
				(child.status !== "pending" && child.resolvedAt === null) ||
				(child.reassignmentMetadata !== null &&
					!isJsonValue(child.reassignmentMetadata))
			) {
				invalidSnapshot("assignment_status_timestamps", {
					assignmentId: child.id,
				});
			}
		}
		if (
			item.activationMode === "requester_auto_approve" &&
			(item.status === "pending" || item.assignments.length > 0)
		) {
			invalidSnapshot("requester_auto_stage_shape", { stageId: item.id });
		}

		if (
			(item.status === "waiting" &&
				(item.activatedAt !== null ||
					item.decidedAt !== null ||
					item.decisionReason !== null ||
					item.assignments.length > 0)) ||
			(item.status === "pending" &&
				(item.activatedAt === null ||
					item.decidedAt !== null ||
					item.decisionReason !== null ||
					item.assignments.length === 0)) ||
			(TERMINAL_STAGE_STATUSES.has(item.status) && item.decidedAt === null) ||
			(TERMINAL_STAGE_STATUSES.has(item.status) &&
				item.assignments.some((child) => child.status === "pending"))
		) {
			invalidSnapshot("stage_status_timestamps", { stageId: item.id });
		}
		if (item.status === "pending" && item.activationMode === "human") {
			validatePendingHumanStage(item);
		}
	}

	if (snapshot.status === "pending") {
		if (
			snapshot.completedAt !== null ||
			snapshot.cancelledAt !== null ||
			snapshot.decisionReason !== null ||
			snapshot.currentStageOrder === null
		) {
			invalidSnapshot("pending_workflow_timestamps");
		}
		const current = snapshot.stages.find(
			(item) => item.sequence === snapshot.currentStageOrder,
		);
		if (
			!current ||
			(current.status !== "waiting" && current.status !== "pending")
		) {
			invalidSnapshot("current_stage");
		}
		for (const item of snapshot.stages) {
			if (
				(item.sequence < current.sequence && item.status !== "approved") ||
				(item.sequence > current.sequence && item.status !== "waiting")
			) {
				invalidSnapshot("stage_progression", { stageId: item.id });
			}
		}
		return;
	}

	if (
		!TERMINAL_WORKFLOW_STATUSES.has(snapshot.status) ||
		snapshot.currentStageOrder !== null ||
		snapshot.completedAt === null ||
		(snapshot.status === "cancelled") !== (snapshot.cancelledAt !== null) ||
		(snapshot.status !== "approved" && snapshot.decisionReason === null)
	) {
		invalidSnapshot("terminal_workflow_timestamps");
	}
	const invalidTerminalStage = snapshot.stages.find((stage) => {
		if (stage.status === "pending") return true;
		if (snapshot.status === "approved") {
			return stage.status !== "approved" && stage.status !== "waiting";
		}
		if (snapshot.status === "rejected") {
			return (
				stage.status !== "approved" &&
				stage.status !== "rejected" &&
				stage.status !== "cancelled"
			);
		}
		if (snapshot.status === "cancelled") {
			return stage.status !== "approved" && stage.status !== "cancelled";
		}
		return stage.status !== "approved" && stage.status !== "expired";
	});
	if (invalidTerminalStage) {
		invalidSnapshot("terminal_stage_consistency", {
			stageId: invalidTerminalStage.id,
			stageStatus: invalidTerminalStage.status,
			workflowStatus: snapshot.status,
		});
	}
}

function assignmentAllocationKey(
	snapshot: ApprovalWorkflowSnapshot,
	stageId: string,
	sequence: number,
): string {
	return `${snapshot.id}:stage:${stageId}:assignment:${sequence}`;
}

/** Validates an authoritative persisted snapshot without planning a transition. */
export function assertValidApprovalWorkflowSnapshot(
	input: unknown,
): asserts input is ApprovalWorkflowSnapshot {
	validateSnapshot(input);
}

function snapshotsEqual(
	left: unknown,
	right: unknown,
	seen = new Map<object, object>(),
): boolean {
	if (Object.is(left, right)) return true;
	if (isInstant(left) || isInstant(right)) {
		return (
			isInstant(left) && isInstant(right) && compareInstants(left, right) === 0
		);
	}
	if (
		typeof left !== "object" ||
		left === null ||
		typeof right !== "object" ||
		right === null ||
		Array.isArray(left) !== Array.isArray(right)
	) {
		return false;
	}
	const seenRight = seen.get(left);
	if (seenRight) return seenRight === right;
	seen.set(left, right);
	try {
		const leftKeys = Reflect.ownKeys(left).sort((a, b) =>
			String(a).localeCompare(String(b)),
		);
		const rightKeys = Reflect.ownKeys(right).sort((a, b) =>
			String(a).localeCompare(String(b)),
		);
		if (
			leftKeys.length !== rightKeys.length ||
			leftKeys.some((key, index) => key !== rightKeys[index])
		) {
			return false;
		}
		const leftDescriptors = Object.getOwnPropertyDescriptors(left);
		const rightDescriptors = Object.getOwnPropertyDescriptors(right);
		for (const key of leftKeys) {
			if (typeof key !== "string") return false;
			const leftDescriptor = leftDescriptors[key];
			const rightDescriptor = rightDescriptors[key];
			if (
				!leftDescriptor ||
				!rightDescriptor ||
				!("value" in leftDescriptor) ||
				!("value" in rightDescriptor) ||
				!snapshotsEqual(leftDescriptor.value, rightDescriptor.value, seen)
			) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	} finally {
		seen.delete(left);
	}
}

function buildChanges(
	previous: ApprovalWorkflowSnapshot,
	resulting: ApprovalPlannedWorkflowSnapshot,
) {
	const previousStages = new Map(
		previous.stages.map((item) => [item.id, item]),
	);
	const previousAssignments = new Map(
		previous.stages.flatMap((item) =>
			item.assignments.map((child) => [child.id, child] as const),
		),
	);
	const assignments: ApprovalAssignmentChange[] = [];
	for (const item of resulting.stages) {
		for (const child of item.assignments) {
			const before =
				child.reference.kind === "persisted"
					? previousAssignments.get(child.reference.id)
					: undefined;
			if (before && !snapshotsEqual(planPersistedAssignment(before), child)) {
				assignments.push({
					kind: "update",
					reference: persistedReference(before.id),
					previous: clonePersistedAssignment(before),
					resulting: clonePlannedAssignment(child),
				});
			} else if (child.reference.kind === "allocate") {
				assignments.push({
					kind: "create",
					reference: { ...child.reference },
					resulting: clonePlannedAssignment(child),
				});
			}
		}
	}
	return {
		root: {
			previous: {
				status: previous.status,
				currentStageOrder: previous.currentStageOrder,
				version: previous.version,
				completedAt: previous.completedAt,
				cancelledAt: previous.cancelledAt,
				decisionReason: previous.decisionReason,
			},
			resulting: {
				status: resulting.status,
				currentStageOrder: resulting.currentStageOrder,
				version: resulting.version,
				completedAt: resulting.completedAt,
				cancelledAt: resulting.cancelledAt,
				decisionReason: resulting.decisionReason,
			},
		},
		stages: resulting.stages.flatMap((item) => {
			const before = previousStages.get(item.id);
			return before && !snapshotsEqual(planPersistedStage(before), item)
				? [
						{
							stageId: item.id,
							previous: clonePersistedStage(before),
							resulting: clonePlannedStage(item),
						},
					]
				: [];
		}),
		assignments,
	};
}

const TRANSITION_MUTABLE_ROOT_FIELDS = new Set([
	"status",
	"currentStageOrder",
	"version",
	"completedAt",
	"cancelledAt",
	"decisionReason",
	"stages",
]);

function immutableRootFields(
	snapshot: ApprovalWorkflowSnapshot | ApprovalPlannedWorkflowSnapshot,
): Record<PropertyKey, unknown> | null {
	const immutable = Object.create(null) as Record<PropertyKey, unknown>;
	try {
		for (const key of Reflect.ownKeys(snapshot)) {
			if (typeof key === "string" && TRANSITION_MUTABLE_ROOT_FIELDS.has(key)) {
				continue;
			}
			const descriptor = Object.getOwnPropertyDescriptor(snapshot, key);
			if (!descriptor || !("value" in descriptor)) return null;
			Object.defineProperty(immutable, key, {
				value: descriptor.value,
				enumerable: true,
				configurable: true,
			});
		}
		return immutable;
	} catch {
		return null;
	}
}

function assertImmutableTransitionStructure(
	previous: ApprovalWorkflowSnapshot,
	resulting: ApprovalPlannedWorkflowSnapshot,
): void {
	const previousImmutable = immutableRootFields(previous);
	const resultingImmutable = immutableRootFields(resulting);
	if (
		!previousImmutable ||
		!resultingImmutable ||
		!snapshotsEqual(previousImmutable, resultingImmutable)
	) {
		materializationConflict("immutable_root_fields");
	}
	if (previous.stages.length !== resulting.stages.length) {
		materializationConflict("stage_identity_set");
	}
	const resultingStages = new Map(
		resulting.stages.map((stage) => [stage.id, stage]),
	);
	for (const previousStage of previous.stages) {
		const resultingStage = resultingStages.get(previousStage.id);
		if (!resultingStage || resultingStage.sequence !== previousStage.sequence) {
			materializationConflict("stage_identity_set");
		}
		const previousAssignmentIds = new Set(
			previousStage.assignments.map((assignment) => assignment.id),
		);
		const persistedAssignmentIds = resultingStage.assignments.flatMap(
			(assignment) =>
				assignment.reference.kind === "persisted"
					? [assignment.reference.id]
					: [],
		);
		const uniquePersistedAssignmentIds = new Set(persistedAssignmentIds);
		if (
			persistedAssignmentIds.length !== previousAssignmentIds.size ||
			uniquePersistedAssignmentIds.size !== persistedAssignmentIds.length ||
			persistedAssignmentIds.some(
				(assignmentId) => !previousAssignmentIds.has(assignmentId),
			)
		) {
			materializationConflict("persisted_assignment_identity_set", {
				stageId: previousStage.id,
			});
		}
	}
}

function buildPlan(
	previous: ApprovalWorkflowSnapshot,
	resulting: ApprovalPlannedWorkflowSnapshot,
	drafts: EventDraft[],
	nextAction: ApprovalTransitionNextAction,
	now: Instant,
): ApprovalTransitionPlan {
	resulting.version = previous.version + 1;
	const events: ApprovalWorkflowEventIntent[] = drafts.map(
		(draft, eventIndex) => ({
			reference: allocationReference(
				`${previous.id}:event:${resulting.version}:${eventIndex}`,
			),
			organizationId: previous.organizationId,
			workflowId: previous.id,
			version: resulting.version,
			eventIndex,
			eventType: draft.eventType,
			actor: { ...draft.actor },
			previousState: draft.previousState
				? cloneJson(draft.previousState)
				: null,
			resultingState: cloneJson(draft.resultingState),
			reason: draft.reason,
			metadata: draft.metadata ? cloneJson(draft.metadata) : null,
			references: cloneEventReferences(draft.references),
			occurredAt: now,
		}),
	);
	const identityAllocations = [
		...resulting.stages.flatMap((stage) =>
			stage.assignments.flatMap((assignment) =>
				assignment.reference.kind === "allocate"
					? [
							{
								allocationKey: assignment.reference.allocationKey,
								entityKind: "assignment" as const,
							},
						]
					: [],
			),
		),
		...events.map((event) => ({
			allocationKey: event.reference.allocationKey,
			entityKind: "event" as const,
		})),
	];
	const plan: ApprovalTransitionPlan = {
		expectedVersion: previous.version,
		previousSnapshot: clonePersistedSnapshot(previous),
		plannedSnapshot: resulting,
		changes: buildChanges(previous, resulting),
		events,
		identityAllocations,
		nextAction: cloneNextAction(nextAction),
	};
	validateTransitionPlanCoherence(plan);
	return plan;
}

function currentStage(
	snapshot: ApprovalWorkflowSnapshot,
): ApprovalStageSnapshot {
	const current = snapshot.stages.find(
		(item) => item.sequence === snapshot.currentStageOrder,
	);
	if (!current) invalidSnapshot("current_stage");
	return current;
}

function decisionContext(
	snapshot: ApprovalWorkflowSnapshot,
	stageId: string,
	assignmentId: string,
): { stage: ApprovalStageSnapshot; assignment: ApprovalAssignmentSnapshot } {
	const stage = currentStage(snapshot);
	if (
		stage.id !== stageId ||
		stage.status !== "pending" ||
		stage.activationMode !== "human"
	) {
		fail("STALE_STAGE", {
			stageId,
			currentStageId: stage.id,
			currentStageStatus: stage.status,
		});
	}
	const assignment = stage.assignments.find((item) => item.id === assignmentId);
	if (
		!assignment ||
		assignment.stageId !== stage.id ||
		assignment.status !== "pending"
	) {
		fail("STALE_ASSIGNMENT", { stageId, assignmentId });
	}
	return { stage, assignment };
}

function closeAssignment(
	assignment: ApprovalPlannedAssignmentSnapshot,
	status: "approved" | "rejected" | "cancelled" | "expired",
	now: Instant,
	resolvedBy: ApprovalPlannedActorReference,
): void {
	assignment.status = status;
	assignment.resolvedAt = now;
	assignment.resolvedBy =
		resolvedBy.kind === "persisted"
			? { kind: "persisted", actor: { ...resolvedBy.actor } }
			: { ...resolvedBy };
}

function eventForAssignment(
	assignment: ApprovalPlannedAssignmentSnapshot,
	status: "approved" | "rejected" | "cancelled" | "expired",
	actor: ApprovalEventActorIntent,
	reason: string | null,
): EventDraft {
	return {
		eventType: `assignment.${status}`,
		actor,
		previousState: { status: "pending" },
		resultingState: { status },
		reason,
		metadata: {
			stageId: assignment.stageId,
		},
		references: { assignment: cloneReference(assignment.reference) },
	};
}

function closeStage(
	stage: ApprovalPlannedStageSnapshot,
	status: "approved" | "rejected" | "cancelled" | "expired",
	reason: string | null,
	now: Instant,
): void {
	stage.status = status;
	stage.decidedAt = now;
	stage.decisionReason = reason;
}

function stageEvent(
	stage: ApprovalPlannedStageSnapshot,
	previousStatus: "waiting" | "pending",
	status: "approved" | "rejected" | "cancelled" | "expired",
	actor: ApprovalEventActorIntent,
	reason: string | null,
): EventDraft {
	return {
		eventType: `stage.${status}`,
		actor,
		previousState: { status: previousStatus },
		resultingState: { status },
		reason,
		metadata: { stageId: stage.id, stageOrder: stage.sequence },
	};
}

function terminalNextAction(
	transition: Extract<
		ApprovalTransitionNextAction,
		{ kind: "finalize_terminal" }
	>["transition"],
): ApprovalTransitionNextAction {
	return { kind: "finalize_terminal", transition };
}

function finishAfterApprovedStage(
	resulting: ApprovalPlannedWorkflowSnapshot,
	stage: ApprovalPlannedStageSnapshot,
	reason: string | null,
	actor: ApprovalEventActorIntent,
	drafts: EventDraft[],
	now: Instant,
): ApprovalTransitionNextAction {
	const next = resulting.stages
		.filter((item) => item.sequence > stage.sequence)
		.sort((left, right) => left.sequence - right.sequence)[0];
	if (next) {
		resulting.currentStageOrder = next.sequence;
		drafts.push({
			eventType: "workflow.activation_requested",
			actor,
			previousState: { currentStageOrder: stage.sequence, status: "pending" },
			resultingState: { currentStageOrder: next.sequence, status: "pending" },
			reason: null,
			metadata: { stageId: next.id, stageOrder: next.sequence },
		});
		return {
			kind: "needs_activation",
			stageId: next.id,
			stageOrder: next.sequence,
		};
	}
	resulting.status = "approved";
	resulting.currentStageOrder = null;
	resulting.completedAt = now;
	resulting.decisionReason = reason;
	drafts.push({
		eventType: "workflow.approved",
		actor,
		previousState: { status: "pending" },
		resultingState: { status: "approved" },
		reason,
		metadata: null,
	});
	return terminalNextAction({
		kind: "approve",
		from: "pending",
		to: "approved",
		reason,
	});
}

function planDecision(
	snapshot: ApprovalWorkflowSnapshot,
	command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>,
	now: Instant,
): ApprovalTransitionPlan {
	if (command.type === "reject") assertReason(command.reason, command.type);
	if (command.type === "approve" && command.reason !== undefined) {
		assertReason(command.reason, command.type);
	}
	const { stage, assignment } = decisionContext(
		snapshot,
		command.stageId,
		command.assignmentId,
	);
	assertPendingClosureChronology([stage], now);
	const resulting = planPersistedSnapshot(snapshot);
	const resultingStage = resulting.stages.find((item) => item.id === stage.id);
	const acting = resultingStage?.assignments.find(
		(item) =>
			item.reference.kind === "persisted" &&
			item.reference.id === assignment.id,
	);
	if (!resultingStage || !acting) invalidSnapshot("decision_clone");
	const reason = command.reason ?? null;
	const actorIntent: ApprovalEventActorIntent = { kind: "command_actor" };
	const status = command.type === "approve" ? "approved" : "rejected";
	const drafts: EventDraft[] = [];
	closeAssignment(acting, status, now, actorIntent);
	drafts.push(eventForAssignment(acting, status, actorIntent, reason));
	for (const sibling of resultingStage.assignments) {
		if (
			snapshotsEqual(sibling.reference, acting.reference) ||
			sibling.status !== "pending"
		)
			continue;
		closeAssignment(sibling, "cancelled", now, actorIntent);
		drafts.push(eventForAssignment(sibling, "cancelled", actorIntent, reason));
	}
	closeStage(resultingStage, status, reason, now);
	drafts.push(
		stageEvent(resultingStage, "pending", status, actorIntent, reason),
	);

	let nextAction: ApprovalTransitionNextAction;
	if (command.type === "approve") {
		nextAction = finishAfterApprovedStage(
			resulting,
			resultingStage,
			reason,
			actorIntent,
			drafts,
			now,
		);
	} else {
		for (const future of resulting.stages
			.filter((item) => item.sequence > resultingStage.sequence)
			.sort((left, right) => left.sequence - right.sequence)) {
			closeStage(future, "cancelled", reason, now);
			drafts.push(
				stageEvent(future, "waiting", "cancelled", actorIntent, reason),
			);
		}
		resulting.status = "rejected";
		resulting.currentStageOrder = null;
		resulting.completedAt = now;
		resulting.decisionReason = command.reason;
		drafts.push({
			eventType: "workflow.rejected",
			actor: actorIntent,
			previousState: { status: "pending" },
			resultingState: { status: "rejected" },
			reason: command.reason,
		});
		nextAction = terminalNextAction({
			kind: "reject",
			from: "pending",
			to: "rejected",
			reason: command.reason,
		});
	}
	return buildPlan(snapshot, resulting, drafts, nextAction, now);
}

function planPendingClosure(
	snapshot: ApprovalWorkflowSnapshot,
	command: Extract<ApprovalWorkflowCommand, { type: "cancel" | "expire" }>,
	now: Instant,
): ApprovalTransitionPlan {
	assertReason(command.reason, command.type);
	assertPendingClosureChronology(snapshot.stages, now);
	const resulting = planPersistedSnapshot(snapshot);
	const targetStatus = command.type === "cancel" ? "cancelled" : "expired";
	const actor: ApprovalEventActorIntent = { kind: "command_actor" };
	const drafts: EventDraft[] = [];
	for (const item of [...resulting.stages].sort(
		(left, right) => left.sequence - right.sequence,
	)) {
		if (item.status === "approved") continue;
		if (item.status !== "waiting" && item.status !== "pending") {
			invalidSnapshot("pending_closure_stage", { stageId: item.id });
		}
		const previousStatus = item.status;
		for (const child of item.assignments) {
			if (child.status !== "pending") continue;
			closeAssignment(child, targetStatus, now, actor);
			drafts.push(
				eventForAssignment(child, targetStatus, actor, command.reason),
			);
		}
		closeStage(item, targetStatus, command.reason, now);
		drafts.push(
			stageEvent(item, previousStatus, targetStatus, actor, command.reason),
		);
	}
	resulting.status = targetStatus;
	resulting.currentStageOrder = null;
	resulting.completedAt = now;
	resulting.cancelledAt = command.type === "cancel" ? now : null;
	resulting.decisionReason = command.reason;
	drafts.push({
		eventType: `workflow.${targetStatus}`,
		actor,
		previousState: { status: "pending" },
		resultingState: { status: targetStatus },
		reason: command.reason,
	});
	const nextAction: ApprovalTransitionNextAction =
		command.type === "cancel"
			? terminalNextAction({
					kind: "cancel_pending",
					from: "pending",
					to: "cancelled",
					reason: command.reason,
				})
			: terminalNextAction({
					kind: "expire",
					from: "pending",
					to: "expired",
					reason: command.reason,
				});
	return buildPlan(snapshot, resulting, drafts, nextAction, now);
}

function planApprovedCancellation(
	snapshot: ApprovalWorkflowSnapshot,
	command: Extract<ApprovalWorkflowCommand, { type: "cancel" }>,
	authorization: ApprovedCancellationAuthorization,
	now: Instant,
): ApprovalTransitionPlan {
	assertReason(command.reason, command.type);
	assertPendingClosureChronology(snapshot.stages, now);
	const resulting = planPersistedSnapshot(snapshot);
	const drafts: EventDraft[] = [];
	for (const stage of [...resulting.stages].sort(
		(left, right) => left.sequence - right.sequence,
	)) {
		if (stage.status !== "waiting") continue;
		closeStage(stage, "cancelled", command.reason, now);
		drafts.push(
			stageEvent(
				stage,
				"waiting",
				"cancelled",
				{ kind: "command_actor" },
				command.reason,
			),
		);
	}
	resulting.status = "cancelled";
	resulting.cancelledAt = now;
	resulting.decisionReason = command.reason;
	drafts.push({
		eventType: "workflow.cancelled",
		actor: { kind: "command_actor" },
		previousState: { status: "approved" },
		resultingState: { status: "cancelled" },
		reason: command.reason,
	});
	return buildPlan(
		snapshot,
		resulting,
		drafts,
		terminalNextAction({
			kind: "cancel_approved",
			from: "approved",
			to: "cancelled",
			reason: command.reason,
			authorization,
		}),
		now,
	);
}

function planReassignment(
	snapshot: ApprovalWorkflowSnapshot,
	command: Extract<ApprovalWorkflowCommand, { type: "reassign" | "escalate" }>,
	now: Instant,
): ApprovalTransitionPlan {
	const stage = currentStage(snapshot);
	if (
		stage.id !== command.stageId ||
		stage.status !== "pending" ||
		stage.activationMode !== "human"
	) {
		fail("REASSIGNMENT_CONFLICT", {
			conflict: "active_human_stage",
			stageId: command.stageId,
		});
	}
	if (
		!nonEmpty(command.fromEmployeeId) ||
		!nonEmpty(command.toEmployeeId) ||
		command.fromEmployeeId === command.toEmployeeId
	) {
		fail("REASSIGNMENT_CONFLICT", { conflict: "target" });
	}
	const sources = stage.assignments.filter(
		(item) =>
			item.status === "pending" &&
			item.approverEmployeeId === command.fromEmployeeId,
	);
	if (sources.length !== 1) {
		fail("REASSIGNMENT_CONFLICT", {
			conflict: "source_assignment_count",
			count: sources.length,
		});
	}
	if (
		stage.assignments.some(
			(item) =>
				item.status === "pending" &&
				item.approverEmployeeId === command.toEmployeeId,
		)
	) {
		fail("REASSIGNMENT_CONFLICT", { conflict: "target_already_pending" });
	}
	const source = sources[0];
	if (!source) fail("REASSIGNMENT_CONFLICT", { conflict: "source" });
	const resulting = planPersistedSnapshot(snapshot);
	const resultingStage = resulting.stages.find((item) => item.id === stage.id);
	const resultingSource = resultingStage?.assignments.find(
		(item) =>
			item.reference.kind === "persisted" && item.reference.id === source.id,
	);
	if (!resultingStage || !resultingSource)
		invalidSnapshot("reassignment_clone");
	closeAssignment(resultingSource, "cancelled", now, { kind: "command_actor" });
	const sequence =
		Math.max(...resultingStage.assignments.map((item) => item.sequence)) + 1;
	const allocationKey = assignmentAllocationKey(snapshot, stage.id, sequence);
	const kind = command.type === "reassign" ? "reassignment" : "escalation";
	const created: ApprovalPlannedAssignmentSnapshot = {
		reference: allocationReference(allocationKey),
		organizationId: snapshot.organizationId,
		workflowId: snapshot.id,
		stageId: stage.id,
		sequence,
		approverEmployeeId: command.toEmployeeId,
		status: "pending",
		assignedAt: now,
		resolvedAt: null,
		resolvedBy: null,
		reassignedBy: { kind: "command_actor" },
		reassignedFrom: persistedReference(source.id),
		reassignmentMetadata: { kind },
	};
	resultingStage.assignments.push(created);
	const actor: ApprovalEventActorIntent = { kind: "command_actor" };
	return buildPlan(
		snapshot,
		resulting,
		[
			{
				eventType:
					command.type === "reassign"
						? "assignment.reassigned"
						: "assignment.escalated",
				actor,
				previousState: { status: "pending" },
				resultingState: {
					status: "pending",
					targetEmployeeId: command.toEmployeeId,
				},
				reason: kind,
				metadata: {
					kind,
					sourceEmployeeId: command.fromEmployeeId,
					stageId: stage.id,
				},
				references: {
					sourceAssignment: persistedReference(source.id),
					targetAssignment: allocationReference(allocationKey),
				},
			},
		],
		{ kind: "none" },
		now,
	);
}

function materializationConflict(
	conflict: string,
	details: JsonObject = {},
): never {
	return fail("MATERIALIZATION_CONFLICT", { conflict, ...details });
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
	const keys = Reflect.ownKeys(value);
	return (
		keys.length === expected.length &&
		keys.every((key) => typeof key === "string" && expected.includes(key))
	);
}

function validatePlannedReference(
	reference: unknown,
	allowedKinds: ReadonlySet<"persisted" | "allocate"> = new Set([
		"persisted",
		"allocate",
	]),
): asserts reference is ApprovalPlannedEntityReference {
	if (!isRecord(reference) || !allowedKinds.has(reference.kind as never)) {
		materializationConflict("planned_reference");
	}
	if (
		(reference.kind === "persisted" &&
			!hasExactKeys(reference, ["kind", "id"])) ||
		(reference.kind === "allocate" &&
			!hasExactKeys(reference, ["kind", "allocationKey"]))
	) {
		materializationConflict("planned_reference_shape");
	}
	if (
		(reference.kind === "persisted" && !isCanonicalUuid(reference.id)) ||
		(reference.kind === "allocate" && !nonEmpty(reference.allocationKey))
	) {
		materializationConflict("planned_reference_identity");
	}
}

function validatePlannedActorReference(reference: unknown): void {
	if (!isRecord(reference)) materializationConflict("planned_actor_reference");
	if (reference.kind === "command_actor" || reference.kind === "system") return;
	if (reference.kind !== "persisted") {
		materializationConflict("planned_actor_reference_kind");
	}
	validateAssignmentActor(reference.actor, (field) =>
		materializationConflict("planned_actor_reference_identity", { field }),
	);
}

function validatePlannedReassignmentActorReference(reference: unknown): void {
	if (reference === null) return;
	if (!isRecord(reference)) {
		materializationConflict("planned_reassignment_actor_reference");
	}
	if (reference.kind === "command_actor" || reference.kind === "system") return;
	if (
		reference.kind !== "persisted_employee" ||
		!isCanonicalUuid(reference.employeeId)
	) {
		materializationConflict("planned_reassignment_actor_reference_kind");
	}
}

function validatePlannedAssignmentShape(
	assignment: unknown,
	stage: { id?: unknown },
	snapshot: { id?: unknown; organizationId?: unknown },
): asserts assignment is ApprovalPlannedAssignmentSnapshot {
	if (!isRecord(assignment)) materializationConflict("planned_assignment");
	validatePlannedReference(assignment.reference);
	if (
		assignment.organizationId !== snapshot.organizationId ||
		assignment.workflowId !== snapshot.id ||
		assignment.stageId !== stage.id ||
		!Number.isInteger(assignment.sequence) ||
		(assignment.sequence as number) < 1 ||
		!isCanonicalUuid(assignment.approverEmployeeId) ||
		!ASSIGNMENT_STATUSES.has(assignment.status as string) ||
		!isInstant(assignment.assignedAt) ||
		!isNullableInstant(assignment.resolvedAt) ||
		(assignment.reassignmentMetadata !== null &&
			!isJsonValue(assignment.reassignmentMetadata))
	) {
		materializationConflict("planned_assignment_shape");
	}
	if (assignment.resolvedBy !== null) {
		validatePlannedActorReference(assignment.resolvedBy);
	}
	validatePlannedReassignmentActorReference(assignment.reassignedBy);
	if (assignment.reassignedFrom !== null) {
		validatePlannedReference(assignment.reassignedFrom);
	}
	if (
		(assignment.status === "pending" &&
			(assignment.resolvedAt !== null || assignment.resolvedBy !== null)) ||
		(assignment.status !== "pending" && assignment.resolvedAt === null)
	) {
		materializationConflict("planned_assignment_status");
	}
}

function validatePlannedStageShape(
	stage: unknown,
	snapshot: { id?: unknown; organizationId?: unknown },
): asserts stage is ApprovalPlannedStageSnapshot {
	if (!isRecord(stage) || !Array.isArray(stage.assignments)) {
		materializationConflict("planned_stage");
	}
	if (
		!isCanonicalUuid(stage.id) ||
		stage.organizationId !== snapshot.organizationId ||
		stage.workflowId !== snapshot.id ||
		!Number.isInteger(stage.sequence) ||
		(stage.sequence as number) < 1 ||
		!nonEmpty(stage.label) ||
		!isJsonValue(stage.resolverSnapshot) ||
		!ACTIVATION_MODES.has(stage.activationMode as string) ||
		!STAGE_STATUSES.has(stage.status as string) ||
		!isNullableInstant(stage.activatedAt) ||
		!isNullableInstant(stage.decidedAt) ||
		(stage.decisionReason !== null &&
			typeof stage.decisionReason !== "string") ||
		(stage.legacyApprovalRequestId !== null &&
			!isCanonicalUuid(stage.legacyApprovalRequestId))
	) {
		materializationConflict("planned_stage_shape");
	}
	const sequences = new Set<number>();
	for (const assignment of stage.assignments) {
		validatePlannedAssignmentShape(assignment, stage, snapshot);
		if (sequences.has(assignment.sequence)) {
			materializationConflict("planned_assignment_sequence");
		}
		sequences.add(assignment.sequence);
	}
}

function validatePlannedSnapshotShape(
	snapshot: unknown,
): asserts snapshot is ApprovalPlannedWorkflowSnapshot {
	if (!isRecord(snapshot) || !Array.isArray(snapshot.stages)) {
		materializationConflict("planned_snapshot");
	}
	if (
		!isCanonicalUuid(snapshot.id) ||
		!nonEmpty(snapshot.organizationId) ||
		!WORKFLOW_TYPES.has(snapshot.workflowType as string) ||
		!nonEmpty(snapshot.sourceType) ||
		!isCanonicalUuid(snapshot.sourceId) ||
		(snapshot.requesterEmployeeId !== null &&
			!isCanonicalUuid(snapshot.requesterEmployeeId)) ||
		!WORKFLOW_STATUSES.has(snapshot.status as string) ||
		(!Number.isInteger(snapshot.currentStageOrder) &&
			snapshot.currentStageOrder !== null) ||
		!Number.isInteger(snapshot.version) ||
		!isJsonValue(snapshot.policySnapshot) ||
		!isJsonValue(snapshot.contextSnapshot) ||
		!isJsonValue(snapshot.displaySnapshot) ||
		!isInstant(snapshot.submittedAt) ||
		!isNullableInstant(snapshot.completedAt) ||
		!isNullableInstant(snapshot.cancelledAt) ||
		(snapshot.decisionReason !== null &&
			typeof snapshot.decisionReason !== "string")
	) {
		materializationConflict("planned_snapshot_shape");
	}
	const stageIds = new Set<string>();
	const stageSequences = new Set<number>();
	for (const stage of snapshot.stages) {
		validatePlannedStageShape(stage, snapshot);
		if (stageIds.has(stage.id) || stageSequences.has(stage.sequence)) {
			materializationConflict("planned_stage_identity");
		}
		stageIds.add(stage.id);
		stageSequences.add(stage.sequence);
	}
}

function validateEventReferenceIntents(references: unknown): void {
	if (!isRecord(references) || Array.isArray(references)) {
		materializationConflict("event_references");
	}
	for (const key of Reflect.ownKeys(references)) {
		if (
			typeof key !== "string" ||
			(key !== "assignment" &&
				key !== "sourceAssignment" &&
				key !== "targetAssignment")
		) {
			materializationConflict("event_reference_key");
		}
		validatePlannedReference(references[key]);
	}
}

function validateEventIntent(
	event: unknown,
	index: number,
	snapshot: ApprovalPlannedWorkflowSnapshot,
	resultingVersion: number,
): asserts event is ApprovalWorkflowEventIntent {
	if (!isRecord(event)) materializationConflict("plan_event");
	validatePlannedReference(event.reference, new Set(["allocate"]));
	if (
		event.organizationId !== snapshot.organizationId ||
		event.workflowId !== snapshot.id ||
		event.version !== resultingVersion ||
		event.eventIndex !== index ||
		!isWorkflowEventType(event.eventType) ||
		(event.reason !== null && typeof event.reason !== "string") ||
		(event.previousState !== null && !isJsonValue(event.previousState)) ||
		!isJsonValue(event.resultingState) ||
		(event.metadata !== null && !isJsonValue(event.metadata)) ||
		!isInstant(event.occurredAt)
	) {
		materializationConflict("plan_event_sequence", { eventIndex: index });
	}
	if (
		!isRecord(event.actor) ||
		(event.actor.kind !== "command_actor" && event.actor.kind !== "system") ||
		!hasExactKeys(event.actor, ["kind"])
	) {
		materializationConflict("plan_event_actor", { eventIndex: index });
	}
	validateEventReferenceIntents(event.references);
}

function validateRootState(value: unknown): value is ApprovalWorkflowRootState {
	return (
		isRecord(value) &&
		WORKFLOW_STATUSES.has(value.status as string) &&
		(value.currentStageOrder === null ||
			(Number.isInteger(value.currentStageOrder) &&
				(value.currentStageOrder as number) > 0)) &&
		Number.isInteger(value.version) &&
		isNullableInstant(value.completedAt) &&
		isNullableInstant(value.cancelledAt) &&
		(value.decisionReason === null || typeof value.decisionReason === "string")
	);
}

function validatePersistedAssignmentChangeShape(
	assignment: unknown,
	stageId: string,
	snapshot: Pick<ApprovalPlannedWorkflowSnapshot, "id" | "organizationId">,
): void {
	if (
		!isRecord(assignment) ||
		!isCanonicalUuid(assignment.id) ||
		assignment.organizationId !== snapshot.organizationId ||
		assignment.workflowId !== snapshot.id ||
		assignment.stageId !== stageId ||
		!Number.isInteger(assignment.sequence) ||
		!isCanonicalUuid(assignment.approverEmployeeId) ||
		!ASSIGNMENT_STATUSES.has(assignment.status as string) ||
		!isInstant(assignment.assignedAt) ||
		!isNullableInstant(assignment.resolvedAt) ||
		(assignment.reassignmentMetadata !== null &&
			!isJsonValue(assignment.reassignmentMetadata))
	) {
		materializationConflict("previous_assignment_change");
	}
	if (assignment.resolvedBy !== null) {
		validateAssignmentActor(assignment.resolvedBy, (field) =>
			materializationConflict("previous_assignment_actor", { field }),
		);
	}
}

function validatePersistedStageChangeShape(
	stage: unknown,
	snapshot: Pick<ApprovalPlannedWorkflowSnapshot, "id" | "organizationId">,
): void {
	if (
		!isRecord(stage) ||
		!Array.isArray(stage.assignments) ||
		!isCanonicalUuid(stage.id) ||
		stage.organizationId !== snapshot.organizationId ||
		stage.workflowId !== snapshot.id ||
		!Number.isInteger(stage.sequence) ||
		!isJsonValue(stage.resolverSnapshot) ||
		!ACTIVATION_MODES.has(stage.activationMode as string) ||
		!STAGE_STATUSES.has(stage.status as string) ||
		!isNullableInstant(stage.activatedAt) ||
		!isNullableInstant(stage.decidedAt)
	) {
		materializationConflict("previous_stage_change");
	}
	for (const assignment of stage.assignments) {
		validatePersistedAssignmentChangeShape(assignment, stage.id, snapshot);
	}
}

function referenceKey(reference: ApprovalPlannedEntityReference): string {
	return reference.kind === "persisted"
		? `persisted:${reference.id}`
		: `allocate:${reference.allocationKey}`;
}

function validateNextAction(
	nextAction: unknown,
	previous: ApprovalWorkflowSnapshot,
	resulting: ApprovalPlannedWorkflowSnapshot,
): void {
	if (!isRecord(nextAction)) materializationConflict("next_action");
	if (resulting.status === "pending") {
		const current = resulting.stages.find(
			(stage) => stage.sequence === resulting.currentStageOrder,
		);
		if (!current) materializationConflict("next_action_current_stage");
		if (current.status === "waiting") {
			if (
				!hasExactKeys(nextAction, ["kind", "stageId", "stageOrder"]) ||
				nextAction.kind !== "needs_activation" ||
				nextAction.stageId !== current.id ||
				nextAction.stageOrder !== current.sequence
			) {
				materializationConflict("next_action_activation");
			}
			return;
		}
		if (
			current.status !== "pending" ||
			current.activationMode !== "human" ||
			!hasExactKeys(nextAction, ["kind"]) ||
			nextAction.kind !== "none"
		) {
			materializationConflict("next_action_pending");
		}
		return;
	}
	if (
		!hasExactKeys(nextAction, ["kind", "transition"]) ||
		nextAction.kind !== "finalize_terminal" ||
		!isRecord(nextAction.transition)
	) {
		materializationConflict("next_action_terminal");
	}
	const transition = nextAction.transition;
	const expectedKind =
		resulting.status === "approved"
			? "approve"
			: resulting.status === "rejected"
				? "reject"
				: resulting.status === "expired"
					? "expire"
					: previous.status === "approved"
						? "cancel_approved"
						: "cancel_pending";
	const expectedFrom =
		expectedKind === "cancel_approved" ? "approved" : "pending";
	const expectedKeys =
		expectedKind === "cancel_approved"
			? ["kind", "from", "to", "reason", "authorization"]
			: ["kind", "from", "to", "reason"];
	if (
		!hasExactKeys(transition, expectedKeys) ||
		previous.status !== expectedFrom ||
		transition.kind !== expectedKind ||
		transition.from !== expectedFrom ||
		transition.to !== resulting.status ||
		transition.reason !== resulting.decisionReason
	) {
		materializationConflict("next_action_terminal_transition");
	}
	if (
		expectedKind === "cancel_approved" &&
		!isApprovedCancellationAuthorization(transition.authorization, {
			organizationId: resulting.organizationId,
			workflowId: resulting.id,
			workflowType: resulting.workflowType,
			sourceType: resulting.sourceType,
			sourceId: resulting.sourceId,
		})
	) {
		materializationConflict("next_action_terminal_authorization");
	}
}

function validateTransitionPlanCoherence(
	plan: unknown,
): asserts plan is ApprovalTransitionPlan {
	if (
		!isRecord(plan) ||
		!isRecord(plan.previousSnapshot) ||
		!isRecord(plan.changes) ||
		!isRecord(plan.changes.root) ||
		!Array.isArray(plan.changes.stages) ||
		!Array.isArray(plan.changes.assignments) ||
		!Array.isArray(plan.events) ||
		plan.events.length === 0 ||
		!Array.isArray(plan.identityAllocations)
	) {
		materializationConflict("plan_shape");
	}
	validateSnapshot(plan.previousSnapshot);
	validatePlannedSnapshotShape(plan.plannedSnapshot);
	const expectedVersion = plan.expectedVersion;
	const resultingVersion = (expectedVersion as number) + 1;
	if (
		!Number.isInteger(expectedVersion) ||
		plan.previousSnapshot.version !== expectedVersion ||
		plan.previousSnapshot.id !== plan.plannedSnapshot.id ||
		plan.previousSnapshot.organizationId !==
			plan.plannedSnapshot.organizationId ||
		plan.previousSnapshot.workflowType !== plan.plannedSnapshot.workflowType ||
		plan.previousSnapshot.sourceType !== plan.plannedSnapshot.sourceType ||
		plan.previousSnapshot.sourceId !== plan.plannedSnapshot.sourceId ||
		!validateRootState(plan.changes.root.previous) ||
		!validateRootState(plan.changes.root.resulting) ||
		plan.changes.root.previous.version !== expectedVersion ||
		plan.changes.root.resulting.version !== resultingVersion ||
		plan.plannedSnapshot.version !== resultingVersion ||
		!snapshotsEqual(plan.changes.root.resulting, {
			status: plan.plannedSnapshot.status,
			currentStageOrder: plan.plannedSnapshot.currentStageOrder,
			version: plan.plannedSnapshot.version,
			completedAt: plan.plannedSnapshot.completedAt,
			cancelledAt: plan.plannedSnapshot.cancelledAt,
			decisionReason: plan.plannedSnapshot.decisionReason,
		})
	) {
		materializationConflict("plan_version");
	}
	assertImmutableTransitionStructure(
		plan.previousSnapshot,
		plan.plannedSnapshot,
	);
	const expectedChanges = buildChanges(
		plan.previousSnapshot,
		plan.plannedSnapshot,
	);
	if (!snapshotsEqual(plan.changes, expectedChanges)) {
		materializationConflict("plan_changes_incomplete");
	}
	for (const [index, event] of plan.events.entries()) {
		validateEventIntent(event, index, plan.plannedSnapshot, resultingVersion);
	}
	for (const allocation of plan.identityAllocations) {
		if (
			!isRecord(allocation) ||
			!hasExactKeys(allocation, ["allocationKey", "entityKind"]) ||
			!nonEmpty(allocation.allocationKey) ||
			(allocation.entityKind !== "assignment" &&
				allocation.entityKind !== "event")
		) {
			materializationConflict("allocation_intent_shape");
		}
	}

	const plannedStages = new Map(
		plan.plannedSnapshot.stages.map((stage) => [stage.id, stage]),
	);
	const stageChangeIds = new Set<string>();
	for (const change of plan.changes.stages) {
		if (
			!isRecord(change) ||
			!isCanonicalUuid(change.stageId) ||
			stageChangeIds.has(change.stageId)
		) {
			materializationConflict("stage_change_shape");
		}
		const planned = plannedStages.get(change.stageId);
		if (!planned) materializationConflict("stage_change_target");
		validatePersistedStageChangeShape(change.previous, plan.plannedSnapshot);
		if ((change.previous as ApprovalStageSnapshot).id !== change.stageId) {
			materializationConflict("stage_change_previous_target");
		}
		validatePlannedStageShape(change.resulting, plan.plannedSnapshot);
		if (!snapshotsEqual(change.resulting, planned)) {
			materializationConflict("stage_change_result");
		}
		stageChangeIds.add(change.stageId);
	}

	const plannedAssignments = new Map<
		string,
		ApprovalPlannedAssignmentSnapshot
	>();
	for (const stage of plan.plannedSnapshot.stages) {
		for (const assignment of stage.assignments) {
			plannedAssignments.set(referenceKey(assignment.reference), assignment);
		}
	}
	const assignmentChangeKeys = new Set<string>();
	for (const change of plan.changes.assignments) {
		if (
			!isRecord(change) ||
			(change.kind !== "update" && change.kind !== "create")
		) {
			materializationConflict("assignment_change_shape");
		}
		validatePlannedReference(
			change.reference,
			new Set([change.kind === "create" ? "allocate" : "persisted"]),
		);
		const key = referenceKey(change.reference);
		const planned = plannedAssignments.get(key);
		if (!planned || assignmentChangeKeys.has(key)) {
			materializationConflict("assignment_change_target");
		}
		const stage = plannedStages.get(planned.stageId);
		if (!stage) materializationConflict("assignment_change_stage");
		validatePlannedAssignmentShape(
			change.resulting,
			stage,
			plan.plannedSnapshot,
		);
		if (!snapshotsEqual(change.resulting, planned)) {
			materializationConflict("assignment_change_result");
		}
		if (change.kind === "update") {
			if (change.reference.kind !== "persisted") {
				materializationConflict("assignment_change_reference_kind");
			}
			validatePersistedAssignmentChangeShape(
				change.previous,
				planned.stageId,
				plan.plannedSnapshot,
			);
			if (
				(change.previous as ApprovalAssignmentSnapshot).id !==
				change.reference.id
			) {
				materializationConflict("assignment_change_previous_target");
			}
		}
		assignmentChangeKeys.add(key);
	}

	for (const event of plan.events) {
		if (event.eventType.startsWith("stage.")) {
			const stageId = isRecord(event.metadata) ? event.metadata.stageId : null;
			if (!isCanonicalUuid(stageId) || !stageChangeIds.has(stageId)) {
				materializationConflict("stage_event_without_change");
			}
		}
		if (event.eventType.startsWith("assignment.")) {
			if (
				event.eventType === "assignment.reassigned" ||
				event.eventType === "assignment.escalated"
			) {
				const source = event.references.sourceAssignment;
				const target = event.references.targetAssignment;
				if (
					!source ||
					!target ||
					!assignmentChangeKeys.has(referenceKey(source)) ||
					!assignmentChangeKeys.has(referenceKey(target))
				) {
					materializationConflict("assignment_event_without_change");
				}
			} else {
				const reference = event.references.assignment;
				if (!reference || !assignmentChangeKeys.has(referenceKey(reference))) {
					materializationConflict("assignment_event_without_change");
				}
			}
		}
	}
	for (const change of plan.changes.assignments) {
		if (
			!plan.events.some(
				(event) =>
					event.eventType.startsWith("assignment.") &&
					Object.values(event.references).some((reference) =>
						snapshotsEqual(reference, change.reference),
					),
			)
		) {
			materializationConflict("assignment_change_without_event");
		}
	}
	for (const change of plan.changes.stages) {
		const { assignments: previousAssignments, ...previousStageState } =
			change.previous;
		const { assignments: resultingAssignments, ...resultingStageState } =
			change.resulting;
		void previousAssignments;
		void resultingAssignments;
		if (
			!snapshotsEqual(previousStageState, resultingStageState) &&
			!plan.events.some(
				(event) =>
					event.eventType.startsWith("stage.") &&
					isRecord(event.metadata) &&
					event.metadata.stageId === change.stageId,
			)
		) {
			materializationConflict("stage_change_without_event");
		}
	}
	validateNextAction(
		plan.nextAction,
		plan.previousSnapshot,
		plan.plannedSnapshot,
	);
}

function validateCommandActor(
	actor: unknown,
): asserts actor is ApprovalCommandActor {
	validateEventActor(actor, (field) =>
		materializationConflict("command_actor_identity", { field }),
	);
	if (actor.kind !== "employee" && actor.kind !== "system") {
		materializationConflict("command_actor_kind", { actorKind: actor.kind });
	}
	if (actor.kind === "employee" && !nonEmpty(actor.userId)) {
		materializationConflict("command_actor_identity", { field: "userId" });
	}
}

export function fingerprintApprovalCommandActor(
	actor: ApprovalCommandActor,
): string {
	validateCommandActor(actor);
	return `v1:${JSON.stringify(
		actor.kind === "system" ? ["system"] : ["employee", actor.employeeId],
	)}`;
}

function systemActor(): ApprovalAssignmentActorIdentity {
	return {
		kind: "system",
		employeeId: null,
		userId: null,
	};
}

function materializeActorReference(
	reference: ApprovalPlannedActorReference,
	commandActor: ApprovalCommandActor,
): ApprovalAssignmentActorIdentity {
	if (reference.kind === "command_actor") {
		return commandActor.kind === "employee"
			? { ...commandActor, userId: null }
			: { ...commandActor };
	}
	if (reference.kind === "system") return systemActor();
	return { ...reference.actor };
}

function materializeReassignmentActor(
	reference: ApprovalPlannedReassignmentActorReference | null,
	commandActor: ApprovalCommandActor,
): string | null {
	if (reference === null || reference.kind === "system") return null;
	if (reference.kind === "persisted_employee") return reference.employeeId;
	if (reference.kind === "command_actor") {
		if (commandActor.kind === "system") return null;
		if (commandActor.kind !== "employee" || !commandActor.employeeId) {
			materializationConflict("reassignment_actor_employee_id");
		}
		return commandActor.employeeId;
	}
	return null;
}

function resolveEntityReference(
	reference: ApprovalPlannedEntityReference,
	resolutions: Map<string, string>,
	entityKind: "assignment" | "event",
): string {
	if (reference.kind === "persisted") return reference.id;
	const id = resolutions.get(`${entityKind}\0${reference.allocationKey}`);
	if (!id) {
		materializationConflict("missing_resolution", {
			allocationKey: reference.allocationKey,
		});
	}
	return id;
}

function materializeEventReferences(
	references: ApprovalWorkflowEventReferenceIntents,
	resolutions: Map<string, string>,
): ApprovalWorkflowEventReferences {
	return {
		...(references.assignment
			? {
					assignmentId: resolveEntityReference(
						references.assignment,
						resolutions,
						"assignment",
					),
				}
			: {}),
		...(references.sourceAssignment
			? {
					sourceAssignmentId: resolveEntityReference(
						references.sourceAssignment,
						resolutions,
						"assignment",
					),
				}
			: {}),
		...(references.targetAssignment
			? {
					targetAssignmentId: resolveEntityReference(
						references.targetAssignment,
						resolutions,
						"assignment",
					),
				}
			: {}),
	};
}

export const APPROVAL_EVENT_REFERENCES_METADATA_KEY =
	"__z8_approval_workflow_references_v1";
const APPROVAL_EVENT_REFERENCE_KEYS = new Set([
	"assignmentId",
	"sourceAssignmentId",
	"targetAssignmentId",
]);

export function serializeApprovalWorkflowEventMetadata(
	metadata: JsonObject | null,
	references: ApprovalWorkflowEventReferences,
): JsonObject | null {
	if (
		(metadata !== null && !isJsonValue(metadata)) ||
		!isJsonValue(references) ||
		Array.isArray(references)
	) {
		fail("INVALID_EVENT_METADATA", { invalid: "metadata_or_references" });
	}
	if (
		metadata !== null &&
		Object.hasOwn(metadata, APPROVAL_EVENT_REFERENCES_METADATA_KEY)
	) {
		fail("INVALID_EVENT_METADATA", { invalid: "reserved_key_collision" });
	}
	for (const [key, id] of Object.entries(references)) {
		if (!APPROVAL_EVENT_REFERENCE_KEYS.has(key) || !isCanonicalUuid(id)) {
			fail("INVALID_EVENT_METADATA", { invalid: "reference_id" });
		}
	}
	if (Object.keys(references).length === 0) {
		return metadata ? cloneJson(metadata) : null;
	}
	const serialized = metadata ? cloneJson(metadata) : {};
	const serializedReferences: JsonObject = {};
	for (const [key, id] of Object.entries(references)) {
		serializedReferences[key] = id as string;
	}
	serialized[APPROVAL_EVENT_REFERENCES_METADATA_KEY] = {
		businessMetadataWasNull: metadata === null,
		references: serializedReferences,
	};
	return serialized;
}

export function deserializeApprovalWorkflowEventMetadata(
	persistenceMetadata: JsonObject | null,
): {
	metadata: JsonObject | null;
	references: ApprovalWorkflowEventReferences;
} {
	if (persistenceMetadata !== null && !isJsonValue(persistenceMetadata)) {
		fail("INVALID_EVENT_METADATA", { invalid: "persistence_metadata" });
	}
	if (
		persistenceMetadata === null ||
		!Object.hasOwn(persistenceMetadata, APPROVAL_EVENT_REFERENCES_METADATA_KEY)
	) {
		return {
			metadata: persistenceMetadata ? cloneJson(persistenceMetadata) : null,
			references: {},
		};
	}
	const envelope = persistenceMetadata[APPROVAL_EVENT_REFERENCES_METADATA_KEY];
	if (
		!isRecord(envelope) ||
		Array.isArray(envelope) ||
		Object.keys(envelope).length !== 2 ||
		!Object.hasOwn(envelope, "businessMetadataWasNull") ||
		!Object.hasOwn(envelope, "references") ||
		typeof envelope.businessMetadataWasNull !== "boolean" ||
		!isRecord(envelope.references) ||
		Array.isArray(envelope.references) ||
		Object.keys(envelope.references).length === 0
	) {
		fail("INVALID_EVENT_METADATA", { invalid: "reference_envelope" });
	}
	const references = envelope.references as ApprovalWorkflowEventReferences;
	for (const [key, id] of Object.entries(references)) {
		if (!APPROVAL_EVENT_REFERENCE_KEYS.has(key) || !isCanonicalUuid(id)) {
			fail("INVALID_EVENT_METADATA", { invalid: "reference_envelope_value" });
		}
	}
	const metadata = cloneJson(persistenceMetadata);
	delete metadata[APPROVAL_EVENT_REFERENCES_METADATA_KEY];
	if (envelope.businessMetadataWasNull && Object.keys(metadata).length > 0) {
		fail("INVALID_EVENT_METADATA", { invalid: "contradictory_null_metadata" });
	}
	return {
		metadata: envelope.businessMetadataWasNull ? null : metadata,
		references: { ...references },
	};
}

function materializeAssignment(
	assignment: ApprovalPlannedAssignmentSnapshot,
	resolutions: Map<string, string>,
	commandActor: ApprovalCommandActor,
): ApprovalAssignmentSnapshot {
	return {
		id: resolveEntityReference(assignment.reference, resolutions, "assignment"),
		organizationId: assignment.organizationId,
		workflowId: assignment.workflowId,
		stageId: assignment.stageId,
		sequence: assignment.sequence,
		approverEmployeeId: assignment.approverEmployeeId,
		status: assignment.status,
		assignedAt: assignment.assignedAt,
		resolvedAt: assignment.resolvedAt,
		resolvedBy: assignment.resolvedBy
			? materializeActorReference(assignment.resolvedBy, commandActor)
			: null,
		reassignedByEmployeeId: materializeReassignmentActor(
			assignment.reassignedBy,
			commandActor,
		),
		reassignedFromAssignmentId: assignment.reassignedFrom
			? resolveEntityReference(
					assignment.reassignedFrom,
					resolutions,
					"assignment",
				)
			: null,
		reassignmentMetadata: assignment.reassignmentMetadata
			? cloneJson(assignment.reassignmentMetadata)
			: null,
	};
}

function materializeStage(
	stage: ApprovalPlannedStageSnapshot,
	resolutions: Map<string, string>,
	commandActor: ApprovalCommandActor,
): ApprovalStageSnapshot {
	return {
		...stage,
		resolverSnapshot: cloneJson(stage.resolverSnapshot),
		assignments: stage.assignments.map((assignment) =>
			materializeAssignment(assignment, resolutions, commandActor),
		),
	};
}

function validateMaterializedEvents(
	snapshot: ApprovalWorkflowSnapshot,
	events: ApprovalMaterializedTransitionPlan["events"],
): void {
	const ids = new Set<string>();
	const indexes = new Set<number>();
	for (const [index, event] of events.entries()) {
		if (
			!isRecord(event) ||
			!hasExactKeys(event, [
				"id",
				"organizationId",
				"workflowId",
				"version",
				"eventIndex",
				"eventType",
				"actor",
				"previousState",
				"resultingState",
				"reason",
				"metadata",
				"references",
				"persistenceMetadata",
				"idempotencyKey",
				"occurredAt",
			]) ||
			!isCanonicalUuid(event.id) ||
			ids.has(event.id) ||
			!isCanonicalUuid(event.workflowId) ||
			event.workflowId !== snapshot.id ||
			event.organizationId !== snapshot.organizationId ||
			event.version !== snapshot.version ||
			event.eventIndex !== index ||
			indexes.has(event.eventIndex) ||
			!isWorkflowEventType(event.eventType) ||
			(event.reason !== null && typeof event.reason !== "string") ||
			(event.idempotencyKey !== null && !nonEmpty(event.idempotencyKey)) ||
			!isJsonValue(event.resultingState) ||
			(event.previousState !== null && !isJsonValue(event.previousState)) ||
			(event.metadata !== null && !isJsonValue(event.metadata)) ||
			(event.persistenceMetadata !== null &&
				!isJsonValue(event.persistenceMetadata)) ||
			!isInstant(event.occurredAt) ||
			!isRecord(event.references) ||
			Reflect.ownKeys(event.references).some(
				(key) =>
					typeof key !== "string" ||
					!APPROVAL_EVENT_REFERENCE_KEYS.has(key) ||
					!isCanonicalUuid(
						(event.references as unknown as Record<PropertyKey, unknown>)[key],
					),
			)
		) {
			materializationConflict("materialized_event_identity", {
				eventId: event.id,
			});
		}
		validateEventActor(event.actor, (field) =>
			materializationConflict("materialized_event_actor", {
				eventId: event.id,
				field,
			}),
		);
		let persistenceMetadata: JsonObject | null;
		try {
			persistenceMetadata = serializeApprovalWorkflowEventMetadata(
				event.metadata,
				event.references,
			);
		} catch {
			materializationConflict("materialized_event_metadata", {
				eventId: event.id,
			});
		}
		if (!snapshotsEqual(persistenceMetadata, event.persistenceMetadata)) {
			materializationConflict("materialized_event_metadata", {
				eventId: event.id,
			});
		}
		ids.add(event.id);
		indexes.add(event.eventIndex);
	}
}

function validateExactPersistedSnapshot(
	snapshot: unknown,
): asserts snapshot is ApprovalWorkflowSnapshot {
	validateSnapshot(snapshot);
	if (
		!isRecord(snapshot) ||
		!hasExactKeys(snapshot, [
			"id",
			"organizationId",
			"workflowType",
			"sourceType",
			"sourceId",
			"requesterEmployeeId",
			"status",
			"currentStageOrder",
			"version",
			"policySnapshot",
			"contextSnapshot",
			"displaySnapshot",
			"submittedAt",
			"completedAt",
			"cancelledAt",
			"decisionReason",
			"stages",
		])
	) {
		materializationConflict("materialized_snapshot_shape");
	}
	for (const stage of snapshot.stages) {
		validateExactPersistedStageShape(stage);
	}
}

function validateExactPersistedAssignmentShape(
	assignment: ApprovalAssignmentSnapshot,
): void {
	if (
		!hasExactKeys(assignment, [
			"id",
			"organizationId",
			"workflowId",
			"stageId",
			"sequence",
			"approverEmployeeId",
			"status",
			"assignedAt",
			"resolvedAt",
			"resolvedBy",
			"reassignedByEmployeeId",
			"reassignedFromAssignmentId",
			"reassignmentMetadata",
		])
	) {
		materializationConflict("materialized_assignment_shape");
	}
}

function validateExactPersistedStageShape(stage: ApprovalStageSnapshot): void {
	if (
		!hasExactKeys(stage, [
			"id",
			"organizationId",
			"workflowId",
			"sequence",
			"label",
			"resolverSnapshot",
			"activationMode",
			"status",
			"activatedAt",
			"decidedAt",
			"decisionReason",
			"legacyApprovalRequestId",
			"assignments",
		])
	) {
		materializationConflict("materialized_stage_shape");
	}
	for (const assignment of stage.assignments) {
		validateExactPersistedAssignmentShape(assignment);
	}
}

export function validateMaterializedApprovalTransitionPlan(
	plan: unknown,
): asserts plan is ApprovalMaterializedTransitionPlan {
	if (
		!isRecord(plan) ||
		!hasExactKeys(plan, [
			"expectedVersion",
			"resultingSnapshot",
			"changes",
			"events",
			"nextAction",
		]) ||
		!isRecord(plan.changes) ||
		!hasExactKeys(plan.changes, ["root", "stages", "assignments"]) ||
		!isRecord(plan.changes.root) ||
		!hasExactKeys(plan.changes.root, ["previous", "resulting"]) ||
		!Array.isArray(plan.changes.stages) ||
		!Array.isArray(plan.changes.assignments) ||
		!Array.isArray(plan.events) ||
		plan.events.length === 0
	) {
		materializationConflict("materialized_plan_shape");
	}
	validateExactPersistedSnapshot(plan.resultingSnapshot);
	const snapshot = plan.resultingSnapshot;
	if (
		!Number.isInteger(plan.expectedVersion) ||
		snapshot.version !== (plan.expectedVersion as number) + 1 ||
		!validateRootState(plan.changes.root.previous) ||
		!validateRootState(plan.changes.root.resulting) ||
		!hasExactKeys(plan.changes.root.previous, [
			"status",
			"currentStageOrder",
			"version",
			"completedAt",
			"cancelledAt",
			"decisionReason",
		]) ||
		!hasExactKeys(plan.changes.root.resulting, [
			"status",
			"currentStageOrder",
			"version",
			"completedAt",
			"cancelledAt",
			"decisionReason",
		]) ||
		plan.changes.root.previous.version !== plan.expectedVersion ||
		!snapshotsEqual(plan.changes.root.resulting, {
			status: snapshot.status,
			currentStageOrder: snapshot.currentStageOrder,
			version: snapshot.version,
			completedAt: snapshot.completedAt,
			cancelledAt: snapshot.cancelledAt,
			decisionReason: snapshot.decisionReason,
		})
	) {
		materializationConflict("materialized_root_change");
	}
	const stagesById = new Map(snapshot.stages.map((stage) => [stage.id, stage]));
	const stageIds = new Set<string>();
	for (const change of plan.changes.stages) {
		if (
			!isRecord(change) ||
			!hasExactKeys(change, ["stageId", "previous", "resulting"]) ||
			!isCanonicalUuid(change.stageId) ||
			stageIds.has(change.stageId)
		) {
			materializationConflict("materialized_stage_change");
		}
		const authoritative = stagesById.get(change.stageId);
		if (!authoritative || !snapshotsEqual(authoritative, change.resulting)) {
			materializationConflict("materialized_stage_change_result");
		}
		validateExactPersistedStageShape(change.previous as ApprovalStageSnapshot);
		validateExactPersistedStageShape(change.resulting as ApprovalStageSnapshot);
		validatePersistedStageChangeShape(change.previous, snapshot);
		validatePersistedStageChangeShape(change.resulting, snapshot);
		stageIds.add(change.stageId);
	}
	const assignmentsById = new Map(
		snapshot.stages.flatMap((stage) =>
			stage.assignments.map(
				(assignment) => [assignment.id, assignment] as const,
			),
		),
	);
	const assignmentIds = new Set<string>();
	for (const change of plan.changes.assignments) {
		if (
			!isRecord(change) ||
			(change.kind !== "update" && change.kind !== "create") ||
			!hasExactKeys(
				change,
				change.kind === "update"
					? ["kind", "assignmentId", "previous", "resulting"]
					: ["kind", "assignmentId", "resulting"],
			) ||
			!isCanonicalUuid(change.assignmentId) ||
			assignmentIds.has(change.assignmentId)
		) {
			materializationConflict("materialized_assignment_change");
		}
		const authoritative = assignmentsById.get(change.assignmentId);
		if (!authoritative || !snapshotsEqual(authoritative, change.resulting)) {
			materializationConflict("materialized_assignment_change_result");
		}
		validateExactPersistedAssignmentShape(
			change.resulting as ApprovalAssignmentSnapshot,
		);
		const stage = stagesById.get(authoritative.stageId);
		if (!stage) materializationConflict("materialized_assignment_stage");
		validatePersistedAssignmentChangeShape(
			change.resulting,
			stage.id,
			snapshot,
		);
		if (change.kind === "update") {
			validateExactPersistedAssignmentShape(
				change.previous as ApprovalAssignmentSnapshot,
			);
			validatePersistedAssignmentChangeShape(
				change.previous,
				stage.id,
				snapshot,
			);
		}
		assignmentIds.add(change.assignmentId);
	}
	validateMaterializedEvents(snapshot, plan.events);
	if (!isRecord(plan.nextAction) || typeof plan.nextAction.kind !== "string") {
		materializationConflict("materialized_next_action");
	}
	if (plan.nextAction.kind === "none") {
		if (!hasExactKeys(plan.nextAction, ["kind"])) {
			materializationConflict("materialized_next_action");
		}
	} else if (plan.nextAction.kind === "needs_activation") {
		if (
			!hasExactKeys(plan.nextAction, ["kind", "stageId", "stageOrder"]) ||
			!isCanonicalUuid(plan.nextAction.stageId) ||
			!Number.isInteger(plan.nextAction.stageOrder)
		) {
			materializationConflict("materialized_next_action");
		}
	} else if (plan.nextAction.kind === "finalize_terminal") {
		if (
			!hasExactKeys(plan.nextAction, ["kind", "transition"]) ||
			!isRecord(plan.nextAction.transition) ||
			typeof plan.nextAction.transition.kind !== "string"
		) {
			materializationConflict("materialized_next_action");
		}
		const transitionKeys =
			plan.nextAction.transition.kind === "cancel_approved"
				? ["kind", "from", "to", "reason", "authorization"]
				: ["kind", "from", "to", "reason"];
		if (!hasExactKeys(plan.nextAction.transition, transitionKeys)) {
			materializationConflict("materialized_next_action");
		}
	} else {
		materializationConflict("materialized_next_action");
	}
}

function materializeApprovalTransitionPlanUnchecked(
	plan: ApprovalTransitionPlan,
	identityResolutions: ApprovalTransitionIdentityResolution[],
	binding: ApprovalCommandActorBinding,
): ApprovalMaterializedTransitionPlan {
	validateTransitionPlanCoherence(plan);
	if (!Array.isArray(identityResolutions)) {
		materializationConflict("identity_resolutions_array");
	}
	if (!isRecord(binding) || !isRecord(binding.receipt)) {
		materializationConflict("command_actor_binding");
	}
	validateCommandActor(binding.actor);
	const commandActor = binding.actor;
	const receiptActor = binding.receiptActor ?? commandActor;
	validateCommandActor(receiptActor);
	if (binding.receiptActor && commandActor.kind !== "system") {
		materializationConflict("receipt_actor_binding");
	}
	if (
		binding.receipt.organizationId !== plan.plannedSnapshot.organizationId ||
		binding.receipt.workflowId !== plan.plannedSnapshot.id
	) {
		materializationConflict("receipt_scope");
	}
	if (
		!nonEmpty(binding.receipt.idempotencyKey) ||
		!nonEmpty(binding.receipt.commandFingerprint) ||
		binding.receipt.actorFingerprint !==
			fingerprintApprovalCommandActor(receiptActor)
	) {
		materializationConflict("receipt_actor_fingerprint");
	}
	const expected = new Set<string>();
	for (const allocation of plan.identityAllocations) {
		const key = `${allocation.entityKind}\0${allocation.allocationKey}`;
		if (!nonEmpty(allocation.allocationKey) || expected.has(key)) {
			materializationConflict("duplicate_allocation_intent", {
				allocationKey: allocation.allocationKey,
			});
		}
		expected.add(key);
	}
	const principalAllocations = [
		...plan.plannedSnapshot.stages.flatMap((stage) =>
			stage.assignments.flatMap((assignment) =>
				assignment.reference.kind === "allocate"
					? [
							{
								allocationKey: assignment.reference.allocationKey,
								entityKind: "assignment" as const,
							},
						]
					: [],
			),
		),
		...plan.events.map((event) => ({
			allocationKey: event.reference.allocationKey,
			entityKind: "event" as const,
		})),
	];
	if (
		principalAllocations.length !== expected.size ||
		principalAllocations.some(
			(allocation) =>
				!expected.has(`${allocation.entityKind}\0${allocation.allocationKey}`),
		)
	) {
		materializationConflict("allocation_intent_mismatch");
	}

	const resolutions = new Map<string, string>();
	const resolvedIds = new Set<string>();
	const persistedAssignmentIds = new Set(
		plan.plannedSnapshot.stages.flatMap((stage) =>
			stage.assignments.flatMap((assignment) =>
				assignment.reference.kind === "persisted"
					? [assignment.reference.id]
					: [],
			),
		),
	);
	for (const resolution of identityResolutions) {
		if (!isRecord(resolution)) {
			materializationConflict("identity_resolution_object");
		}
		const key = `${resolution.entityKind}\0${resolution.allocationKey}`;
		if (
			!hasExactKeys(resolution, ["allocationKey", "entityKind", "id"]) ||
			(resolution.entityKind !== "assignment" &&
				resolution.entityKind !== "event") ||
			!expected.has(key) ||
			resolutions.has(key)
		) {
			materializationConflict("extra_or_duplicate_resolution", {
				allocationKey: resolution.allocationKey,
			});
		}
		if (
			!isCanonicalUuid(resolution.id) ||
			resolvedIds.has(resolution.id) ||
			(resolution.entityKind === "assignment" &&
				persistedAssignmentIds.has(resolution.id))
		) {
			materializationConflict("invalid_or_duplicate_persisted_id", {
				id: resolution.id,
			});
		}
		resolutions.set(key, resolution.id);
		resolvedIds.add(resolution.id);
	}
	if (resolutions.size !== expected.size) {
		materializationConflict("missing_resolution", {
			expectedCount: expected.size,
			resolvedCount: resolutions.size,
		});
	}

	const stages = plan.plannedSnapshot.stages.map((stage) =>
		materializeStage(stage, resolutions, commandActor),
	);
	const resultingSnapshot: ApprovalWorkflowSnapshot = {
		...plan.plannedSnapshot,
		policySnapshot: cloneJson(plan.plannedSnapshot.policySnapshot),
		contextSnapshot: cloneJson(plan.plannedSnapshot.contextSnapshot),
		displaySnapshot: cloneJson(plan.plannedSnapshot.displaySnapshot),
		stages,
	};
	const events: ApprovalMaterializedTransitionPlan["events"] = plan.events.map(
		(event) => {
			const metadata = event.metadata ? cloneJson(event.metadata) : null;
			const references = materializeEventReferences(
				event.references,
				resolutions,
			);
			return {
				id: resolveEntityReference(event.reference, resolutions, "event"),
				organizationId: event.organizationId,
				workflowId: event.workflowId,
				version: event.version,
				eventIndex: event.eventIndex,
				eventType: event.eventType,
				actor:
					event.actor.kind === "command_actor"
						? { ...commandActor }
						: systemActor(),
				previousState: event.previousState
					? cloneJson(event.previousState)
					: null,
				resultingState: cloneJson(event.resultingState),
				reason: event.reason,
				metadata,
				references,
				persistenceMetadata: serializeApprovalWorkflowEventMetadata(
					metadata,
					references,
				),
				idempotencyKey: null,
				occurredAt: event.occurredAt,
			};
		},
	);
	const changes: ApprovalMaterializedTransitionPlan["changes"] = {
		root: {
			previous: { ...plan.changes.root.previous },
			resulting: { ...plan.changes.root.resulting },
		},
		stages: plan.changes.stages.map((change) => ({
			stageId: change.stageId,
			previous: clonePersistedStage(change.previous),
			resulting: materializeStage(change.resulting, resolutions, commandActor),
		})),
		assignments: plan.changes.assignments.map((change) => {
			const assignmentId = resolveEntityReference(
				change.reference,
				resolutions,
				"assignment",
			);
			const resulting = materializeAssignment(
				change.resulting,
				resolutions,
				commandActor,
			);
			return change.kind === "update"
				? {
						kind: "update" as const,
						assignmentId,
						previous: clonePersistedAssignment(change.previous),
						resulting,
					}
				: { kind: "create" as const, assignmentId, resulting };
		}),
	};
	validateSnapshot(resultingSnapshot);
	validateMaterializedEvents(resultingSnapshot, events);
	return {
		expectedVersion: plan.expectedVersion,
		resultingSnapshot,
		changes,
		events,
		nextAction: cloneNextAction(plan.nextAction),
	};
}

export function materializeApprovalTransitionPlan(
	plan: ApprovalTransitionPlan,
	identityResolutions: ApprovalTransitionIdentityResolution[],
	binding: ApprovalCommandActorBinding,
): ApprovalMaterializedTransitionPlan {
	try {
		return materializeApprovalTransitionPlanUnchecked(
			plan,
			identityResolutions,
			binding,
		);
	} catch (error) {
		if (
			error instanceof ApprovalStateMachineError &&
			error.code === "MATERIALIZATION_CONFLICT"
		) {
			throw error;
		}
		return materializationConflict("malformed_materialization_input");
	}
}

export function planWorkflowTransition(
	snapshot: ApprovalWorkflowSnapshot,
	command: ApprovalWorkflowCommand,
	policy: ApprovalWorkflowPolicy,
	now: Instant,
): ApprovalTransitionPlan {
	validateSnapshot(snapshot);
	validateCommandIdentities(command);
	validatePolicy(policy);
	validateNow(now);
	assertNotBefore(now, snapshot.submittedAt, "submittedAt");
	if (snapshot.status !== "pending") {
		if (snapshot.status === "approved" && command.type === "cancel") {
			if (policy.kind !== "approved_cancellation") {
				fail("INVALID_POLICY", { transition: "cancel_approved" });
			}
			if (
				!isApprovedCancellationAuthorization(policy.authorization, {
					organizationId: snapshot.organizationId,
					workflowId: snapshot.id,
					workflowType: snapshot.workflowType,
					sourceType: snapshot.sourceType,
					sourceId: snapshot.sourceId,
				})
			) {
				fail("INVALID_POLICY", { transition: "cancel_approved_scope" });
			}
			if (!snapshot.completedAt) invalidSnapshot("approved_completed_at");
			assertNotBefore(now, snapshot.completedAt, "completedAt");
			return planApprovedCancellation(
				snapshot,
				command,
				policy.authorization,
				now,
			);
		}
		fail("TERMINAL_TRANSITION", {
			status: snapshot.status,
			command: command.type,
		});
	}
	if (policy.kind !== "standard") {
		fail("INVALID_POLICY", { transition: command.type });
	}
	const activeStage = currentStage(snapshot);
	if (activeStage.activatedAt) {
		assertNotBefore(now, activeStage.activatedAt, "stage.activatedAt");
	}
	if (command.type === "reassign" || command.type === "escalate") {
		const source = activeStage.assignments.find(
			(assignment) =>
				assignment.status === "pending" &&
				assignment.approverEmployeeId === command.fromEmployeeId,
		);
		if (source)
			assertNotBefore(now, source.assignedAt, "assignment.assignedAt");
	}
	switch (command.type) {
		case "approve":
		case "reject":
			return planDecision(snapshot, command, now);
		case "cancel":
		case "expire":
			return planPendingClosure(snapshot, command, now);
		case "reassign":
		case "escalate":
			return planReassignment(snapshot, command, now);
		default:
			return fail("INVALID_COMMAND", { field: "type" });
	}
}

function validateResolvedStage(
	snapshot: ApprovalWorkflowSnapshot,
	stage: ApprovalStageSnapshot,
	resolved: unknown,
): asserts resolved is ResolvedStage {
	if (!isRecord(resolved) || !Array.isArray(resolved.assignments)) {
		fail("INVALID_ACTIVATION", { invalid: "resolved_stage_object" });
	}
	if (
		!nonEmpty(resolved.organizationId) ||
		!isCanonicalUuid(resolved.workflowId) ||
		!isCanonicalUuid(resolved.stageId) ||
		resolved.organizationId !== snapshot.organizationId ||
		resolved.workflowId !== snapshot.id ||
		resolved.stageId !== stage.id
	) {
		fail("INVALID_ACTIVATION", { invalid: "scope_or_mode" });
	}
	if (
		resolved.activationMode !== "human" &&
		resolved.activationMode !== "requester_auto_approve"
	) {
		fail("INVALID_ACTIVATION", { invalid: "activation_mode" });
	}
	if (
		resolved.assignments.some(
			(item) =>
				!isCanonicalUuid(item.approverEmployeeId) ||
				!isJsonValue(item.metadata),
		)
	) {
		fail("INVALID_ACTIVATION", { invalid: "assignment" });
	}
	const approvers = resolved.assignments.map((item) => item.approverEmployeeId);
	if (new Set(approvers).size !== approvers.length) {
		fail("INVALID_ACTIVATION", { invalid: "duplicate_approver" });
	}
	if (
		(resolved.activationMode === "human" && approvers.length === 0) ||
		(resolved.activationMode === "requester_auto_approve" &&
			approvers.length !== 0)
	) {
		fail("INVALID_ACTIVATION", { invalid: "assignment_count" });
	}
}

export function planStageActivation(
	snapshot: ApprovalWorkflowSnapshot,
	resolvedStage: ResolvedStage,
	now: Instant,
): ApprovalTransitionPlan {
	validateSnapshot(snapshot);
	validateNow(now);
	assertNotBefore(now, snapshot.submittedAt, "submittedAt");
	if (snapshot.status !== "pending") {
		fail("TERMINAL_TRANSITION", {
			status: snapshot.status,
			command: "activate",
		});
	}
	const stage = currentStage(snapshot);
	if (stage.status !== "waiting") {
		fail("INVALID_ACTIVATION", {
			invalid: "current_stage_status",
			stageId: stage.id,
		});
	}
	validateResolvedStage(snapshot, stage, resolvedStage);
	const resulting = planPersistedSnapshot(snapshot);
	const resultingStage = resulting.stages.find((item) => item.id === stage.id);
	if (!resultingStage) invalidSnapshot("activation_clone");
	resultingStage.activationMode = resolvedStage.activationMode;
	resultingStage.activatedAt = now;
	const drafts: EventDraft[] = [];
	let nextAction: ApprovalTransitionNextAction = { kind: "none" };
	if (resolvedStage.activationMode === "human") {
		resultingStage.status = "pending";
		for (const [index, candidate] of resolvedStage.assignments.entries()) {
			const sequence = index + 1;
			const allocationKey = assignmentAllocationKey(
				snapshot,
				stage.id,
				sequence,
			);
			const created: ApprovalPlannedAssignmentSnapshot = {
				reference: allocationReference(allocationKey),
				organizationId: snapshot.organizationId,
				workflowId: snapshot.id,
				stageId: stage.id,
				sequence,
				approverEmployeeId: candidate.approverEmployeeId,
				status: "pending",
				assignedAt: now,
				resolvedAt: null,
				resolvedBy: null,
				reassignedBy: null,
				reassignedFrom: null,
				reassignmentMetadata: null,
			};
			resultingStage.assignments.push(created);
			drafts.push({
				eventType: "assignment.created",
				actor: { kind: "system" },
				previousState: null,
				resultingState: {
					approverEmployeeId: candidate.approverEmployeeId,
					sequence,
					status: "pending",
				},
				reason: null,
				metadata: cloneJson(candidate.metadata),
				references: { assignment: allocationReference(allocationKey) },
			});
		}
		drafts.push({
			eventType: "stage.activated",
			actor: { kind: "system" },
			previousState: { status: "waiting" },
			resultingState: { status: "pending" },
			reason: null,
			metadata: { stageId: stage.id, stageOrder: stage.sequence },
		});
	} else {
		const reason = "requester_auto_approved";
		closeStage(resultingStage, "approved", reason, now);
		drafts.push({
			eventType: "stage.auto_approved",
			actor: { kind: "system" },
			previousState: { status: "waiting" },
			resultingState: { status: "approved" },
			reason,
			metadata: {
				stageId: stage.id,
				stageOrder: stage.sequence,
				requesterEmployeeId: snapshot.requesterEmployeeId,
			},
		});
		nextAction = finishAfterApprovedStage(
			resulting,
			resultingStage,
			reason,
			{ kind: "system" },
			drafts,
			now,
		);
	}
	return buildPlan(snapshot, resulting, drafts, nextAction, now);
}
