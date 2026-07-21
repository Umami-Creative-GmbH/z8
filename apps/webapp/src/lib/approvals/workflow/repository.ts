import { sql } from "drizzle-orm";
import { instantFromDB, instantToDB } from "@/lib/datetime/drizzle-adapter";
import type { Clock, Instant } from "@/lib/datetime/temporal-core";
import {
	compareInstants,
	isInstant,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { ApprovalDomainAdapterRegistry } from "../domain-adapters/registry";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { createApprovalOutboxWriter } from "../outbox/writer";
import { createApprovalProjectionWriter } from "../projection/writer";
import { createDatabaseStageActivationResolver } from "../routing/stage-activation-resolver";
import {
	createApprovalCompatibilityWriter,
	createTransactionBoundLegacyApprovalPersistence,
	type LegacyApprovalRowWriter,
} from "./compatibility-writer";
import { createApprovalWriteGate } from "./cutover";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
} from "./identity";
import type {
	ApprovalAssignmentSnapshot,
	ApprovalCommandReceiptIdentity,
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalEventActorIdentity,
	ApprovalMaterializedTransitionPlan,
	ApprovalStageSnapshot,
	ApprovalTransactionClient,
	ApprovalTransitionIdentityResolution,
	ApprovalWorkflowEventReferences,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
	JsonObject,
	JsonValue,
	ObservedLegacyTransition,
	ObservedLegacyTransitionPlan,
	ObservedLegacyTransitionResult,
	StageActivationResolver,
	TransactionalWorkflowRepository,
} from "./ports";
import { normalizeStableData } from "./stable-data";
import {
	assertValidApprovalWorkflowSnapshot,
	deserializeApprovalWorkflowEventMetadata,
	serializeApprovalWorkflowEventMetadata,
	validateMaterializedApprovalTransitionPlan,
} from "./state-machine";
import {
	APPROVAL_ACTOR_KINDS,
	APPROVAL_ASSIGNMENT_STATUSES,
	APPROVAL_OUTBOX_DISPOSITIONS,
	APPROVAL_STAGE_STATUSES,
	APPROVAL_WORKFLOW_EVENT_TYPES,
	APPROVAL_WORKFLOW_STATUSES,
	APPROVAL_WORKFLOW_TYPES,
} from "./types";

export type ApprovalWorkflowRepositoryErrorCode =
	| "not_found"
	| "malformed"
	| "source_conflict"
	| "cas_invariant"
	| "command_invariant"
	| "persistence_count"
	| "codec_failure";

export class ApprovalWorkflowRepositoryError extends Error {
	readonly code: ApprovalWorkflowRepositoryErrorCode;
	readonly details: Readonly<JsonObject>;

	constructor(
		code: ApprovalWorkflowRepositoryErrorCode,
		details: JsonObject = {},
		cause?: unknown,
	) {
		super(`Approval workflow repository: ${code}`, { cause });
		this.name = "ApprovalWorkflowRepositoryError";
		this.code = code;
		this.details = Object.freeze({ ...details });
	}
}

export interface ApprovalWorkflowRepository {
	withTransaction<T>(
		operation: (context: ApprovalWorkflowTransactionContext) => Promise<T>,
	): Promise<T>;
}

export interface ApprovalLegacyObservationPlanner {
	/** Interprets verified legacy evidence without writing or finalizing its source. */
	plan(input: ObservedLegacyTransition): Promise<ObservedLegacyTransitionPlan>;
}

export interface ApprovalWorkflowDatabase {
	transaction<T>(
		operation: (transaction: ApprovalTransactionClient) => Promise<T>,
	): Promise<T>;
}

export interface CreateApprovalWorkflowRepositoryInput {
	db: ApprovalWorkflowDatabase;
	adapterRegistry: ApprovalDomainAdapterRegistry;
	activationResolver?: StageActivationResolver;
	createLegacyRowWriter(dbService: ApprovalDbService): LegacyApprovalRowWriter;
	observationPlanner: ApprovalLegacyObservationPlanner;
	clock?: Clock;
}

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXPLICIT_OFFSET_DB_INSTANT =
	/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::\d{2})?)$/;
const WORKFLOW_TYPES = new Set<string>(APPROVAL_WORKFLOW_TYPES);
const WORKFLOW_STATUSES = new Set<string>(APPROVAL_WORKFLOW_STATUSES);
const STAGE_STATUSES = new Set<string>(APPROVAL_STAGE_STATUSES);
const ASSIGNMENT_STATUSES = new Set<string>(APPROVAL_ASSIGNMENT_STATUSES);
const EVENT_TYPES = new Set<string>(APPROVAL_WORKFLOW_EVENT_TYPES);
const INITIAL_EVENT_TYPES = new Set<string>([
	"stage.activated",
	"assignment.created",
	"stage.auto_approved",
	"workflow.activation_requested",
	"workflow.approved",
]);
const ACTOR_KINDS = new Set<string>(APPROVAL_ACTOR_KINDS);
const OUTBOX_DISPOSITIONS = new Set<string>(APPROVAL_OUTBOX_DISPOSITIONS);
const LEGACY_APPROVAL_REQUEST_STATUSES = new Set<string>([
	"pending",
	"approved",
	"rejected",
]);
const LEGACY_CHAIN_STATUSES = new Set<string>([
	"pending",
	"approved",
	"rejected",
	"cancelled",
]);

function fail(
	code: ApprovalWorkflowRepositoryErrorCode,
	details: JsonObject = {},
	cause?: unknown,
): never {
	throw new ApprovalWorkflowRepositoryError(code, details, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
) {
	const keys = Reflect.ownKeys(value);
	return (
		keys.length === expected.length &&
		keys.every((key) => typeof key === "string" && expected.includes(key))
	);
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function canonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID.test(value);
}

function integer(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

function resultRows(result: unknown): unknown[] {
	return isRecord(result) && Array.isArray(result.rows) ? result.rows : [];
}

function oneRow(
	result: unknown,
	code: ApprovalWorkflowRepositoryErrorCode,
): Record<string, unknown> {
	const rows = resultRows(result);
	if (rows.length !== 1 || !isRecord(rows[0])) fail(code);
	return rows[0];
}

function exactlyOne(result: unknown, entity: string): void {
	const rows = resultRows(result);
	if (rows.length !== 1 || !isRecord(rows[0])) {
		fail("persistence_count", { entity });
	}
}

function databaseErrorCode(error: unknown): string | undefined {
	if (!isRecord(error)) return undefined;
	if (typeof error.code === "string") return error.code;
	return isRecord(error.cause) && typeof error.cause.code === "string"
		? error.cause.code
		: undefined;
}

function cloneJson(value: unknown, ancestors = new Set<object>()): JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return Object.is(value, -0) ? 0 : value;
	}
	if (typeof value !== "object" || ancestors.has(value)) {
		return fail("malformed", { field: "json" });
	}
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			const clone: JsonValue[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) fail("malformed", { field: "json" });
				clone.push(cloneJson(value[index], ancestors));
			}
			if (Reflect.ownKeys(value).length !== value.length + 1) {
				fail("malformed", { field: "json" });
			}
			return clone;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return fail("malformed", { field: "json" });
		}
		const clone: JsonObject = {};
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string") fail("malformed", { field: "json" });
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				fail("malformed", { field: "json" });
			}
			clone[key] = cloneJson(descriptor.value, ancestors);
		}
		return clone;
	} finally {
		ancestors.delete(value);
	}
}

function jsonObject(
	value: unknown,
	field: string,
	nullable = false,
): JsonObject | null {
	if (nullable && value === null) return null;
	const clone = cloneJson(value);
	if (!isRecord(clone)) fail("malformed", { field });
	return clone as JsonObject;
}

function requiredJsonObject(value: unknown, field: string): JsonObject {
	return jsonObject(value, field) ?? fail("malformed", { field });
}

function fromDbInstant(
	value: unknown,
	field: string,
	nullable = false,
): Instant | null {
	if (nullable && value === null) return null;
	if (
		!(value instanceof Date) &&
		(typeof value !== "string" || !EXPLICIT_OFFSET_DB_INSTANT.test(value))
	) {
		return fail("malformed", { field });
	}
	try {
		if (value instanceof Date) {
			return instantFromDB(value) ?? fail("malformed", { field });
		}
		const normalized = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
		return parseInstant(normalized);
	} catch (error) {
		return fail("malformed", { field }, error);
	}
}

function requiredDbInstant(value: unknown, field: string): Instant {
	return fromDbInstant(value, field) ?? fail("malformed", { field });
}

function fromWireInstant(
	value: unknown,
	field: string,
	nullable = false,
): Instant | null {
	if (nullable && value === null) return null;
	if (typeof value !== "string") return fail("codec_failure", { field });
	try {
		return parseInstant(value);
	} catch (error) {
		return fail("codec_failure", { field }, error);
	}
}

function assertScope(input: { organizationId: string; workflowId: string }) {
	if (!nonEmpty(input.organizationId) || !canonicalUuid(input.workflowId)) {
		fail("malformed", { field: "scope" });
	}
}

function hydrateAssignment(row: unknown): ApprovalAssignmentSnapshot {
	if (!isRecord(row)) return fail("malformed", { entity: "assignment" });
	let resolvedBy: ApprovalAssignmentSnapshot["resolvedBy"] = null;
	if (
		row.resolved_by_actor_kind === "employee" &&
		canonicalUuid(row.resolved_by_actor_id)
	) {
		resolvedBy = {
			kind: "employee",
			employeeId: row.resolved_by_actor_id,
			userId: null,
		};
	} else if (
		row.resolved_by_actor_kind === "system" &&
		row.resolved_by_actor_id === null
	) {
		resolvedBy = { kind: "system", employeeId: null, userId: null };
	} else if (
		row.resolved_by_actor_kind !== null ||
		row.resolved_by_actor_id !== null
	) {
		return fail("malformed", { field: "assignment.resolvedBy" });
	}
	return {
		id: canonicalUuid(row.id)
			? row.id
			: fail("malformed", { field: "assignment.id" }),
		organizationId: nonEmpty(row.organization_id)
			? row.organization_id
			: fail("malformed", { field: "assignment.organizationId" }),
		workflowId: canonicalUuid(row.workflow_id)
			? row.workflow_id
			: fail("malformed", { field: "assignment.workflowId" }),
		stageId: canonicalUuid(row.stage_id)
			? row.stage_id
			: fail("malformed", { field: "assignment.stageId" }),
		sequence: integer(row.assignment_sequence)
			? row.assignment_sequence
			: fail("malformed", { field: "assignment.sequence" }),
		approverEmployeeId: canonicalUuid(row.approver_employee_id)
			? row.approver_employee_id
			: fail("malformed", { field: "assignment.approverEmployeeId" }),
		status: ASSIGNMENT_STATUSES.has(String(row.status))
			? (row.status as ApprovalAssignmentSnapshot["status"])
			: fail("malformed", { field: "assignment.status" }),
		assignedAt: requiredDbInstant(row.assigned_at, "assignment.assignedAt"),
		resolvedAt: fromDbInstant(row.resolved_at, "assignment.resolvedAt", true),
		resolvedBy,
		reassignedByEmployeeId:
			row.reassigned_by_employee_id === null
				? null
				: canonicalUuid(row.reassigned_by_employee_id)
					? row.reassigned_by_employee_id
					: fail("malformed", { field: "assignment.reassignedByEmployeeId" }),
		reassignedFromAssignmentId:
			row.reassigned_from_assignment_id === null
				? null
				: canonicalUuid(row.reassigned_from_assignment_id)
					? row.reassigned_from_assignment_id
					: fail("malformed", {
							field: "assignment.reassignedFromAssignmentId",
						}),
		reassignmentMetadata: jsonObject(
			row.reassignment_metadata,
			"assignment.reassignmentMetadata",
			true,
		),
	};
}

function hydrateStage(
	row: unknown,
	assignments: ApprovalAssignmentSnapshot[],
): ApprovalStageSnapshot {
	if (!isRecord(row)) return fail("malformed", { entity: "stage" });
	return {
		id: canonicalUuid(row.id)
			? row.id
			: fail("malformed", { field: "stage.id" }),
		organizationId: nonEmpty(row.organization_id)
			? row.organization_id
			: fail("malformed", { field: "stage.organizationId" }),
		workflowId: canonicalUuid(row.workflow_id)
			? row.workflow_id
			: fail("malformed", { field: "stage.workflowId" }),
		sequence: integer(row.stage_order)
			? row.stage_order
			: fail("malformed", { field: "stage.sequence" }),
		label: nonEmpty(row.label)
			? row.label
			: fail("malformed", { field: "stage.label" }),
		resolverSnapshot: requiredJsonObject(
			row.resolver_snapshot,
			"stage.resolverSnapshot",
		),
		activationMode: nonEmpty(row.activation_mode)
			? row.activation_mode
			: fail("malformed", { field: "stage.activationMode" }),
		status: STAGE_STATUSES.has(String(row.status))
			? (row.status as ApprovalStageSnapshot["status"])
			: fail("malformed", { field: "stage.status" }),
		activatedAt: fromDbInstant(row.activated_at, "stage.activatedAt", true),
		decidedAt: fromDbInstant(row.decided_at, "stage.decidedAt", true),
		decisionReason:
			row.decision_reason === null || typeof row.decision_reason === "string"
				? row.decision_reason
				: fail("malformed", { field: "stage.decisionReason" }),
		legacyApprovalRequestId:
			row.legacy_approval_request_id === null
				? null
				: canonicalUuid(row.legacy_approval_request_id)
					? row.legacy_approval_request_id
					: fail("malformed", { field: "stage.legacyApprovalRequestId" }),
		assignments,
	};
}

function hydrateRoot(row: unknown, stages: ApprovalStageSnapshot[]) {
	if (!isRecord(row)) return fail("malformed", { entity: "workflow" });
	const snapshot: ApprovalWorkflowSnapshot = {
		id: canonicalUuid(row.id)
			? row.id
			: fail("malformed", { field: "workflow.id" }),
		organizationId: nonEmpty(row.organization_id)
			? row.organization_id
			: fail("malformed", { field: "workflow.organizationId" }),
		workflowType: WORKFLOW_TYPES.has(String(row.workflow_type))
			? (row.workflow_type as ApprovalWorkflowSnapshot["workflowType"])
			: fail("malformed", { field: "workflow.workflowType" }),
		sourceType: nonEmpty(row.source_type)
			? row.source_type
			: fail("malformed", { field: "workflow.sourceType" }),
		sourceId: canonicalUuid(row.source_id)
			? row.source_id
			: fail("malformed", { field: "workflow.sourceId" }),
		requesterEmployeeId:
			row.requester_employee_id === null
				? null
				: canonicalUuid(row.requester_employee_id)
					? row.requester_employee_id
					: fail("malformed", { field: "workflow.requesterEmployeeId" }),
		status: WORKFLOW_STATUSES.has(String(row.status))
			? (row.status as ApprovalWorkflowSnapshot["status"])
			: fail("malformed", { field: "workflow.status" }),
		currentStageOrder:
			row.current_stage_order === null
				? null
				: integer(row.current_stage_order)
					? row.current_stage_order
					: fail("malformed", { field: "workflow.currentStageOrder" }),
		version: integer(row.version)
			? row.version
			: fail("malformed", { field: "workflow.version" }),
		policySnapshot: requiredJsonObject(
			row.policy_snapshot,
			"workflow.policySnapshot",
		),
		contextSnapshot: requiredJsonObject(
			row.context_snapshot,
			"workflow.contextSnapshot",
		),
		displaySnapshot: requiredJsonObject(
			row.display_snapshot,
			"workflow.displaySnapshot",
		),
		submittedAt: requiredDbInstant(row.submitted_at, "workflow.submittedAt"),
		completedAt: fromDbInstant(row.completed_at, "workflow.completedAt", true),
		cancelledAt: fromDbInstant(row.cancelled_at, "workflow.cancelledAt", true),
		decisionReason:
			row.decision_reason === null || typeof row.decision_reason === "string"
				? row.decision_reason
				: fail("malformed", { field: "workflow.decisionReason" }),
		stages,
	};
	try {
		assertValidApprovalWorkflowSnapshot(snapshot);
	} catch (error) {
		return fail("malformed", { entity: "workflow_snapshot" }, error);
	}
	return snapshot;
}

const SNAPSHOT_KEYS = [
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
] as const;
const STAGE_KEYS = [
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
] as const;
const ASSIGNMENT_KEYS = [
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
] as const;
const EVENT_KEYS = [
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
	"idempotencyKey",
	"occurredAt",
] as const;
const EVENT_REFERENCE_KEYS = [...EVENT_KEYS, "references"] as const;
const PROJECTION_KEYS = [
	"organizationId",
	"workflowId",
	"workflowType",
	"sourceType",
	"sourceId",
	"status",
	"currentStageOrder",
	"requesterEmployeeId",
	"displayPayload",
	"searchText",
	"activeInboxStage",
	"updatedAt",
] as const;
const OUTBOX_KEYS = [
	"organizationId",
	"workflowId",
	"eventId",
	"eventType",
	"dedupeKey",
	"payload",
	"disposition",
	"createdAt",
] as const;

function assertActor(
	actor: unknown,
): asserts actor is ApprovalEventActorIdentity {
	if (
		!isRecord(actor) ||
		!exactKeys(actor, ["kind", "employeeId", "userId"]) ||
		!ACTOR_KINDS.has(String(actor.kind))
	) {
		fail("codec_failure", { field: "event.actor" });
	}
	if (actor.kind === "employee") {
		if (
			!canonicalUuid(actor.employeeId) ||
			(actor.userId !== null && !nonEmpty(actor.userId))
		) {
			fail("codec_failure", { field: "event.actor" });
		}
	} else if (actor.employeeId !== null || actor.userId !== null) {
		fail("codec_failure", { field: "event.actor" });
	}
}

function assertReferences(
	value: unknown,
): asserts value is ApprovalWorkflowEventReferences {
	if (!isRecord(value)) fail("codec_failure", { field: "event.references" });
	for (const [key, id] of Object.entries(value)) {
		if (
			!["assignmentId", "sourceAssignmentId", "targetAssignmentId"].includes(
				key,
			) ||
			!canonicalUuid(id)
		) {
			fail("codec_failure", { field: "event.references" });
		}
	}
}

function initialEventStage(
	snapshot: ApprovalWorkflowSnapshot,
	event: ApprovalWorkflowEventSnapshot,
	metadataKeys: readonly string[],
): ApprovalStageSnapshot {
	if (
		!isRecord(event.metadata) ||
		!exactKeys(event.metadata, metadataKeys) ||
		!canonicalUuid(event.metadata.stageId) ||
		!integer(event.metadata.stageOrder)
	) {
		return fail("malformed", { entity: "initial_event_stage" });
	}
	const stage = snapshot.stages.find(
		(candidate) => candidate.id === event.metadata?.stageId,
	);
	if (!stage || stage.sequence !== event.metadata.stageOrder) {
		return fail("malformed", { entity: "initial_event_stage" });
	}
	return stage;
}

function assertInitialEventSemantics(
	snapshot: ApprovalWorkflowSnapshot,
	event: ApprovalWorkflowEventSnapshot,
): void {
	if (
		!INITIAL_EVENT_TYPES.has(event.eventType) ||
		event.actor.kind !== "system"
	) {
		fail("malformed", { entity: "initial_event_semantics" });
	}
	if (event.eventType === "assignment.created") {
		if (
			Object.keys(event.references ?? {}).length !== 1 ||
			!Object.hasOwn(event.references ?? {}, "assignmentId") ||
			!canonicalUuid(event.references?.assignmentId) ||
			event.previousState !== null ||
			event.reason !== null
		) {
			fail("malformed", { entity: "initial_assignment_event" });
		}
		const assignment = snapshot.stages
			.flatMap((stage) => stage.assignments)
			.find((candidate) => candidate.id === event.references?.assignmentId);
		if (
			!assignment ||
			!persistedValuesEqual(event.resultingState, {
				approverEmployeeId: assignment.approverEmployeeId,
				sequence: assignment.sequence,
				status: "pending",
			})
		) {
			fail("malformed", { entity: "initial_assignment_event" });
		}
		return;
	}
	if (Object.keys(event.references ?? {}).length > 0) {
		fail("malformed", { entity: "initial_event_references" });
	}
	if (event.eventType === "stage.activated") {
		const stage = initialEventStage(snapshot, event, ["stageId", "stageOrder"]);
		if (
			stage.status !== "pending" ||
			stage.activatedAt === null ||
			event.reason !== null ||
			!persistedValuesEqual(event.previousState, { status: "waiting" }) ||
			!persistedValuesEqual(event.resultingState, { status: "pending" })
		) {
			fail("malformed", { entity: "initial_stage_activation_event" });
		}
		return;
	}
	if (event.eventType === "stage.auto_approved") {
		const stage = initialEventStage(snapshot, event, [
			"stageId",
			"stageOrder",
			"requesterEmployeeId",
		]);
		if (
			stage.status !== "approved" ||
			stage.activationMode !== "requester_auto_approve" ||
			stage.assignments.length !== 0 ||
			event.metadata?.requesterEmployeeId !== snapshot.requesterEmployeeId ||
			event.reason !== "requester_auto_approved" ||
			!persistedValuesEqual(event.previousState, { status: "waiting" }) ||
			!persistedValuesEqual(event.resultingState, { status: "approved" })
		) {
			fail("malformed", { entity: "initial_stage_auto_approval_event" });
		}
		return;
	}
	if (event.eventType === "workflow.activation_requested") {
		const stage = initialEventStage(snapshot, event, ["stageId", "stageOrder"]);
		const previous = event.previousState;
		if (
			event.reason !== null ||
			!persistedValuesEqual(event.resultingState, {
				currentStageOrder: stage.sequence,
				status: "pending",
			}) ||
			(previous !== null &&
				(!isRecord(previous) ||
					!exactKeys(previous, ["currentStageOrder", "status"]) ||
					!integer(previous.currentStageOrder) ||
					previous.currentStageOrder >= stage.sequence ||
					previous.status !== "pending"))
		) {
			fail("malformed", { entity: "initial_activation_request_event" });
		}
		return;
	}
	if (
		event.metadata !== null ||
		(event.previousState !== null &&
			!persistedValuesEqual(event.previousState, { status: "pending" })) ||
		!persistedValuesEqual(event.resultingState, { status: "approved" })
	) {
		fail("malformed", { entity: "initial_workflow_approval_event" });
	}
}

type InitialLifecycleExpectation =
	| { eventType: "assignment.created"; entityId: string }
	| {
			eventType:
				| "stage.activated"
				| "stage.auto_approved"
				| "workflow.activation_requested";
			entityId: string;
	  }
	| { eventType: "workflow.approved"; entityId: null };

function assertInitialLifecycle(
	snapshot: ApprovalWorkflowSnapshot,
	events: ApprovalWorkflowEventSnapshot[],
): void {
	const expected: InitialLifecycleExpectation[] = [];
	const stages = [...snapshot.stages].sort(
		(left, right) => left.sequence - right.sequence,
	);
	const terminalSequence =
		snapshot.status === "pending"
			? snapshot.currentStageOrder
			: snapshot.status === "approved"
				? stages.length
				: null;
	if (
		terminalSequence === null ||
		terminalSequence < 1 ||
		stages.length === 0
	) {
		fail("malformed", { entity: "initial_lifecycle" });
	}
	for (const stage of stages) {
		if (stage.sequence > terminalSequence) break;
		if (stage.activationMode === "requester_auto_approve") {
			if (stage.status !== "approved" || stage.assignments.length !== 0) {
				fail("malformed", { entity: "initial_lifecycle_stage" });
			}
			expected.push({ eventType: "stage.auto_approved", entityId: stage.id });
			const next = stages.find(
				(candidate) => candidate.sequence === stage.sequence + 1,
			);
			if (next) {
				expected.push({
					eventType: "workflow.activation_requested",
					entityId: next.id,
				});
			}
			continue;
		}
		if (
			snapshot.status !== "pending" ||
			stage.sequence !== terminalSequence ||
			stage.activationMode !== "human" ||
			stage.status !== "pending"
		) {
			fail("malformed", { entity: "initial_lifecycle_human_stage" });
		}
		for (const assignment of [...stage.assignments].sort(
			(left, right) => left.sequence - right.sequence,
		)) {
			expected.push({
				eventType: "assignment.created",
				entityId: assignment.id,
			});
		}
		expected.push({ eventType: "stage.activated", entityId: stage.id });
	}
	if (snapshot.status === "approved") {
		if (
			stages.some((stage) => stage.activationMode !== "requester_auto_approve")
		) {
			fail("malformed", { entity: "initial_lifecycle_terminal_stage" });
		}
		expected.push({ eventType: "workflow.approved", entityId: null });
	}
	if (events.length !== expected.length) {
		fail("malformed", { entity: "initial_lifecycle_events" });
	}
	for (const [index, expectation] of expected.entries()) {
		const event = events[index];
		if (!event || event.eventType !== expectation.eventType) {
			fail("malformed", {
				entity: "initial_lifecycle_event",
				eventIndex: index,
			});
		}
		const entityId =
			event.eventType === "assignment.created"
				? (event.references?.assignmentId ?? null)
				: event.eventType === "workflow.approved"
					? null
					: isRecord(event.metadata)
						? (event.metadata.stageId ?? null)
						: null;
		if (entityId !== expectation.entityId) {
			fail("malformed", {
				entity: "initial_lifecycle_entity",
				eventIndex: index,
			});
		}
	}
}

function assertSnapshotShape(
	snapshot: unknown,
): asserts snapshot is ApprovalWorkflowSnapshot {
	if (
		!isRecord(snapshot) ||
		!exactKeys(snapshot, SNAPSHOT_KEYS) ||
		!Array.isArray(snapshot.stages)
	) {
		fail("codec_failure", { field: "snapshot" });
	}
	for (const stage of snapshot.stages) {
		if (
			!isRecord(stage) ||
			!exactKeys(stage, STAGE_KEYS) ||
			!Array.isArray(stage.assignments)
		) {
			fail("codec_failure", { field: "snapshot.stage" });
		}
		for (const assignment of stage.assignments) {
			if (!isRecord(assignment) || !exactKeys(assignment, ASSIGNMENT_KEYS)) {
				fail("codec_failure", { field: "snapshot.assignment" });
			}
		}
	}
	try {
		assertValidApprovalWorkflowSnapshot(snapshot);
	} catch (error) {
		fail("codec_failure", { field: "snapshot" }, error);
	}
}

export interface InitialApprovalWorkflowPersistenceInput {
	snapshot: ApprovalWorkflowSnapshot;
	events: ApprovalWorkflowEventSnapshot[];
	submissionKey: string;
}

export function validateInitialApprovalWorkflowPersistenceInput(
	value: unknown,
): InitialApprovalWorkflowPersistenceInput {
	let normalized: unknown;
	try {
		normalized = normalizeStableData(value);
		if (
			!isRecord(normalized) ||
			!exactKeys(normalized, ["snapshot", "events", "submissionKey"]) ||
			!Array.isArray(normalized.events) ||
			!nonEmpty(normalized.submissionKey)
		) {
			fail("malformed", { entity: "initial_workflow" });
		}
		assertSnapshotShape(normalized.snapshot);
	} catch (error) {
		if (
			error instanceof ApprovalWorkflowRepositoryError &&
			error.code === "malformed"
		) {
			throw error;
		}
		return fail("malformed", { entity: "initial_workflow" }, error);
	}

	const input =
		normalized as unknown as InitialApprovalWorkflowPersistenceInput;
	const { snapshot, events, submissionKey } = input;
	assertInitialDbInstants(snapshot, events);
	if (
		snapshot.id !==
			deriveApprovalWorkflowId({
				organizationId: snapshot.organizationId,
				workflowType: snapshot.workflowType,
				sourceType: snapshot.sourceType,
				sourceId: snapshot.sourceId,
				allocationKey: submissionKey,
			}) ||
		!canonicalUuid(snapshot.requesterEmployeeId) ||
		snapshot.version < 1 ||
		(snapshot.completedAt !== null &&
			compareInstants(snapshot.completedAt, snapshot.submittedAt) < 0) ||
		(snapshot.cancelledAt !== null &&
			compareInstants(snapshot.cancelledAt, snapshot.submittedAt) < 0) ||
		events.length === 0
	) {
		fail("malformed", { entity: "initial_workflow" });
	}

	const assignmentIds = new Set<string>();
	for (const [stageIndex, stage] of snapshot.stages.entries()) {
		const sequence = stageIndex + 1;
		if (
			stage.sequence !== sequence ||
			stage.id !==
				deriveApprovalStageId({
					organizationId: snapshot.organizationId,
					workflowId: snapshot.id,
					allocationKey: `stage:${sequence}`,
				}) ||
			(stage.activatedAt !== null &&
				compareInstants(stage.activatedAt, snapshot.submittedAt) < 0) ||
			(stage.decidedAt !== null &&
				(stage.activatedAt === null ||
					compareInstants(stage.decidedAt, stage.activatedAt) < 0))
		) {
			fail("malformed", { entity: "initial_stage", stageIndex });
		}
		for (const [assignmentIndex, assignment] of stage.assignments.entries()) {
			const assignmentSequence = assignmentIndex + 1;
			if (
				assignment.sequence !== assignmentSequence ||
				assignment.id !==
					deriveApprovalAssignmentId({
						organizationId: snapshot.organizationId,
						workflowId: snapshot.id,
						allocationKey: `${snapshot.id}:stage:${stage.id}:assignment:${assignmentSequence}`,
					}) ||
				(stage.activatedAt !== null &&
					compareInstants(assignment.assignedAt, stage.activatedAt) < 0) ||
				(assignment.resolvedAt !== null &&
					compareInstants(assignment.resolvedAt, assignment.assignedAt) < 0)
			) {
				fail("malformed", {
					entity: "initial_assignment",
					stageIndex,
					assignmentIndex,
				});
			}
			assignmentIds.add(assignment.id);
		}
	}

	let previousVersion = 0;
	let expectedEventIndex = 0;
	let previousOccurredAt: Instant | null = null;
	for (const [index, event] of events.entries()) {
		if (
			!isRecord(event) ||
			!exactKeys(event, EVENT_REFERENCE_KEYS) ||
			!canonicalUuid(event.id) ||
			!integer(event.version) ||
			event.version < 1 ||
			!integer(event.eventIndex) ||
			!EVENT_TYPES.has(event.eventType) ||
			!isInstant(event.occurredAt) ||
			(event.reason !== null && typeof event.reason !== "string")
		) {
			fail("malformed", { entity: "initial_event", eventIndex: index });
		}
		try {
			assertActor(event.actor);
			assertReferences(event.references);
			jsonObject(event.previousState, "event.previousState", true);
			jsonObject(event.resultingState, "event.resultingState");
			jsonObject(event.metadata, "event.metadata", true);
			assertDbRepresentableInstant(event.occurredAt, "event.occurredAt");
		} catch (error) {
			return fail(
				"malformed",
				{ entity: "initial_event", eventIndex: index },
				error,
			);
		}
		if (event.actor.kind === "legacy_unknown") {
			fail("malformed", { entity: "initial_event_actor", eventIndex: index });
		}
		if (event.version === previousVersion + 1) {
			expectedEventIndex = 0;
		} else if (event.version !== previousVersion) {
			fail("malformed", { entity: "initial_event_order", eventIndex: index });
		}
		if (
			event.organizationId !== snapshot.organizationId ||
			event.workflowId !== snapshot.id ||
			event.eventIndex !== expectedEventIndex ||
			event.id !==
				deriveApprovalEventId({
					organizationId: snapshot.organizationId,
					workflowId: snapshot.id,
					allocationKey: `${snapshot.id}:event:${event.version}:${event.eventIndex}`,
				}) ||
			event.idempotencyKey !==
				(index === 0 ? submissionKey : `${submissionKey}:${index}`) ||
			compareInstants(event.occurredAt, snapshot.submittedAt) < 0 ||
			(previousOccurredAt !== null &&
				compareInstants(event.occurredAt, previousOccurredAt) < 0) ||
			Object.values(event.references).some(
				(reference) => !assignmentIds.has(reference),
			)
		) {
			fail("malformed", { entity: "initial_event", eventIndex: index });
		}
		assertInitialEventSemantics(snapshot, event);
		previousVersion = event.version;
		expectedEventIndex += 1;
		previousOccurredAt = event.occurredAt;
	}
	if (previousVersion !== snapshot.version) {
		fail("malformed", { entity: "initial_event_version" });
	}
	if (
		(snapshot.status !== "pending" && snapshot.status !== "approved") ||
		(snapshot.status === "approved") !==
			(events[events.length - 1]?.eventType === "workflow.approved") ||
		(snapshot.status === "pending" &&
			events.some((event) => event.eventType === "workflow.approved"))
	) {
		fail("malformed", { entity: "initial_terminal_event" });
	}
	assertInitialLifecycle(snapshot, events);
	return input;
}

function assertCommandResult(
	result: unknown,
): asserts result is ApprovalCommandResult {
	if (
		!isRecord(result) ||
		!exactKeys(result, ["snapshot", "events", "projection", "outbox"]) ||
		!Array.isArray(result.events) ||
		!Array.isArray(result.outbox)
	) {
		fail("codec_failure", { field: "result" });
	}
	assertSnapshotShape(result.snapshot);
	const eventIds = new Set<string>();
	let previousVersion: number | null = null;
	let expectedEventIndex = 0;
	for (const event of result.events) {
		if (
			!isRecord(event) ||
			(!exactKeys(event, EVENT_KEYS) &&
				!exactKeys(event, EVENT_REFERENCE_KEYS)) ||
			!canonicalUuid(event.id) ||
			!canonicalUuid(event.workflowId) ||
			!integer(event.version) ||
			!integer(event.eventIndex) ||
			!EVENT_TYPES.has(String(event.eventType)) ||
			!isInstant(event.occurredAt) ||
			(event.reason !== null && typeof event.reason !== "string") ||
			(event.idempotencyKey !== null && !nonEmpty(event.idempotencyKey))
		) {
			fail("codec_failure", { field: "event" });
		}
		if (eventIds.has(event.id)) {
			fail("codec_failure", { field: "event.id" });
		}
		eventIds.add(event.id);
		if (event.version < 1) {
			fail("codec_failure", { field: "event.version" });
		}
		if (previousVersion === null || event.version === previousVersion + 1) {
			expectedEventIndex = 0;
		} else if (event.version !== previousVersion) {
			fail("codec_failure", { field: "event.sequence" });
		}
		if (event.eventIndex !== expectedEventIndex) {
			fail("codec_failure", { field: "event.sequence" });
		}
		assertActor(event.actor);
		jsonObject(event.previousState, "event.previousState", true);
		jsonObject(event.resultingState, "event.resultingState");
		jsonObject(event.metadata, "event.metadata", true);
		if (Object.hasOwn(event, "references")) assertReferences(event.references);
		if (
			event.organizationId !== result.snapshot.organizationId ||
			event.workflowId !== result.snapshot.id
		) {
			fail("codec_failure", { field: "event.scope" });
		}
		previousVersion = event.version;
		expectedEventIndex += 1;
	}
	if (previousVersion !== result.snapshot.version) {
		fail("codec_failure", { field: "event.version" });
	}
	const projection = result.projection;
	if (
		!isRecord(projection) ||
		!exactKeys(projection, PROJECTION_KEYS) ||
		!nonEmpty(projection.organizationId) ||
		!canonicalUuid(projection.workflowId) ||
		!WORKFLOW_TYPES.has(String(projection.workflowType)) ||
		!canonicalUuid(projection.sourceId) ||
		!WORKFLOW_STATUSES.has(String(projection.status)) ||
		!isInstant(projection.updatedAt) ||
		typeof projection.searchText !== "string"
	) {
		fail("codec_failure", { field: "projection" });
	}
	jsonObject(projection.displayPayload, "projection.displayPayload");
	if (
		projection.organizationId !== result.snapshot.organizationId ||
		projection.workflowId !== result.snapshot.id ||
		projection.workflowType !== result.snapshot.workflowType ||
		projection.sourceType !== result.snapshot.sourceType ||
		projection.sourceId !== result.snapshot.sourceId ||
		projection.status !== result.snapshot.status ||
		projection.currentStageOrder !== result.snapshot.currentStageOrder ||
		projection.requesterEmployeeId !== result.snapshot.requesterEmployeeId
	) {
		fail("codec_failure", { field: "projection.scope" });
	}
	if (
		projection.activeInboxStage !== null &&
		(!isRecord(projection.activeInboxStage) ||
			!exactKeys(projection.activeInboxStage, ["stageId", "stageOrder"]) ||
			!canonicalUuid(projection.activeInboxStage.stageId) ||
			!integer(projection.activeInboxStage.stageOrder))
	) {
		fail("codec_failure", { field: "projection.activeInboxStage" });
	}
	for (const outbox of result.outbox) {
		if (
			!isRecord(outbox) ||
			!exactKeys(outbox, OUTBOX_KEYS) ||
			!nonEmpty(outbox.organizationId) ||
			!canonicalUuid(outbox.workflowId) ||
			!canonicalUuid(outbox.eventId) ||
			!nonEmpty(outbox.eventType) ||
			!nonEmpty(outbox.dedupeKey) ||
			!OUTBOX_DISPOSITIONS.has(String(outbox.disposition)) ||
			!isInstant(outbox.createdAt)
		) {
			fail("codec_failure", { field: "outbox" });
		}
		jsonObject(outbox.payload, "outbox.payload");
		if (
			outbox.organizationId !== result.snapshot.organizationId ||
			outbox.workflowId !== result.snapshot.id ||
			!result.events.some(
				(event) =>
					event.id === outbox.eventId && event.eventType === outbox.eventType,
			)
		) {
			fail("codec_failure", { field: "outbox.scope" });
		}
	}
}

function snapshotToWire(snapshot: ApprovalWorkflowSnapshot): JsonObject {
	return {
		...snapshot,
		submittedAt: snapshot.submittedAt.toString(),
		completedAt: snapshot.completedAt?.toString() ?? null,
		cancelledAt: snapshot.cancelledAt?.toString() ?? null,
		stages: snapshot.stages.map((stage) => ({
			...stage,
			activatedAt: stage.activatedAt?.toString() ?? null,
			decidedAt: stage.decidedAt?.toString() ?? null,
			assignments: stage.assignments.map((assignment) => ({
				...assignment,
				assignedAt: assignment.assignedAt.toString(),
				resolvedAt: assignment.resolvedAt?.toString() ?? null,
			})),
		})),
	} as unknown as JsonObject;
}

export function encodeApprovalCommandResult(
	result: ApprovalCommandResult,
): JsonObject {
	assertCommandResult(result);
	return {
		version: 1,
		result: cloneJson({
			snapshot: snapshotToWire(result.snapshot),
			events: result.events.map((event) => ({
				...event,
				occurredAt: event.occurredAt.toString(),
			})),
			projection: {
				...result.projection,
				updatedAt: result.projection.updatedAt.toString(),
			},
			outbox: result.outbox.map((item) => ({
				...item,
				createdAt: item.createdAt.toString(),
			})),
		}),
	};
}

function decodeSnapshot(value: unknown): ApprovalWorkflowSnapshot {
	if (
		!isRecord(value) ||
		!exactKeys(value, SNAPSHOT_KEYS) ||
		!Array.isArray(value.stages)
	) {
		return fail("codec_failure", { field: "snapshot" });
	}
	const stages = value.stages.map((stage) => {
		if (
			!isRecord(stage) ||
			!exactKeys(stage, STAGE_KEYS) ||
			!Array.isArray(stage.assignments)
		) {
			return fail("codec_failure", { field: "snapshot.stage" });
		}
		return {
			...stage,
			activatedAt: fromWireInstant(
				stage.activatedAt,
				"stage.activatedAt",
				true,
			),
			decidedAt: fromWireInstant(stage.decidedAt, "stage.decidedAt", true),
			assignments: stage.assignments.map((assignment) => {
				if (!isRecord(assignment) || !exactKeys(assignment, ASSIGNMENT_KEYS)) {
					return fail("codec_failure", { field: "snapshot.assignment" });
				}
				return {
					...assignment,
					assignedAt: fromWireInstant(
						assignment.assignedAt,
						"assignment.assignedAt",
					),
					resolvedAt: fromWireInstant(
						assignment.resolvedAt,
						"assignment.resolvedAt",
						true,
					),
				};
			}),
		};
	});
	const snapshot = {
		...value,
		submittedAt: fromWireInstant(value.submittedAt, "snapshot.submittedAt"),
		completedAt: fromWireInstant(
			value.completedAt,
			"snapshot.completedAt",
			true,
		),
		cancelledAt: fromWireInstant(
			value.cancelledAt,
			"snapshot.cancelledAt",
			true,
		),
		stages,
	};
	assertSnapshotShape(snapshot);
	return snapshot;
}

export function decodeApprovalCommandResult(
	value: unknown,
): ApprovalCommandResult {
	try {
		if (
			!isRecord(value) ||
			!exactKeys(value, ["version", "result"]) ||
			value.version !== 1 ||
			!isRecord(value.result) ||
			!exactKeys(value.result, [
				"snapshot",
				"events",
				"projection",
				"outbox",
			]) ||
			!Array.isArray(value.result.events) ||
			!Array.isArray(value.result.outbox) ||
			!isRecord(value.result.projection)
		) {
			return fail("codec_failure", { field: "envelope" });
		}
		const result = {
			snapshot: decodeSnapshot(value.result.snapshot),
			events: value.result.events.map((event) => {
				if (!isRecord(event)) return fail("codec_failure", { field: "event" });
				return {
					...event,
					occurredAt: fromWireInstant(event.occurredAt, "event.occurredAt"),
				};
			}),
			projection: {
				...value.result.projection,
				updatedAt: fromWireInstant(
					value.result.projection.updatedAt,
					"projection.updatedAt",
				),
			},
			outbox: value.result.outbox.map((item) => {
				if (!isRecord(item)) return fail("codec_failure", { field: "outbox" });
				return {
					...item,
					createdAt: fromWireInstant(item.createdAt, "outbox.createdAt"),
				};
			}),
		};
		assertCommandResult(result);
		return result;
	} catch (error) {
		if (
			error instanceof ApprovalWorkflowRepositoryError &&
			error.code === "codec_failure"
		) {
			throw error;
		}
		return fail("codec_failure", {}, error);
	}
}

function actorColumns(
	actor: ApprovalEventActorIdentity,
): [string, string | null, string | null] {
	return [actor.kind, actor.employeeId, actor.userId];
}

function commandIdentityValid(input: ApprovalCommandReceiptIdentity) {
	return (
		nonEmpty(input.idempotencyKey) &&
		nonEmpty(input.actorFingerprint) &&
		nonEmpty(input.commandFingerprint)
	);
}

function receiptKey(input: ApprovalCommandReceiptIdentity): string {
	return [
		input.organizationId,
		input.workflowId,
		input.idempotencyKey,
		input.actorFingerprint,
		input.commandFingerprint,
	].join("\0");
}

function assertResultReceiptScope(
	identity: ApprovalCommandReceiptIdentity,
	result: ApprovalCommandResult,
): void {
	if (
		result.snapshot.organizationId !== identity.organizationId ||
		result.snapshot.id !== identity.workflowId
	) {
		fail("command_invariant", { entity: "command_result_scope" });
	}
}

function sameInstant(left: Instant | null, right: Instant | null): boolean {
	return left === null
		? right === null
		: right !== null && left.toString() === right.toString();
}

function assertMaterializedPlan(plan: ApprovalMaterializedTransitionPlan) {
	try {
		assertValidApprovalWorkflowSnapshot(plan.resultingSnapshot);
	} catch (error) {
		return fail("malformed", { entity: "materialized_plan" }, error);
	}
	const snapshot = plan.resultingSnapshot;
	if (
		!integer(plan.expectedVersion) ||
		snapshot.version !== plan.expectedVersion + 1 ||
		plan.changes.root.previous.version !== plan.expectedVersion ||
		plan.changes.root.resulting.version !== snapshot.version ||
		plan.changes.root.resulting.status !== snapshot.status ||
		plan.changes.root.resulting.currentStageOrder !==
			snapshot.currentStageOrder ||
		!sameInstant(
			plan.changes.root.resulting.completedAt,
			snapshot.completedAt,
		) ||
		!sameInstant(
			plan.changes.root.resulting.cancelledAt,
			snapshot.cancelledAt,
		) ||
		plan.changes.root.resulting.decisionReason !== snapshot.decisionReason ||
		plan.events.length === 0
	) {
		fail("cas_invariant", { entity: "materialized_plan" });
	}
	for (const [index, event] of plan.events.entries()) {
		if (
			event.organizationId !== snapshot.organizationId ||
			event.workflowId !== snapshot.id ||
			event.version !== snapshot.version ||
			event.eventIndex !== index ||
			!canonicalUuid(event.id) ||
			!EVENT_TYPES.has(event.eventType) ||
			!isInstant(event.occurredAt)
		) {
			fail("malformed", { entity: "event", eventIndex: index });
		}
		const metadata = serializeApprovalWorkflowEventMetadata(
			event.metadata,
			event.references,
		);
		if (
			JSON.stringify(metadata) !== JSON.stringify(event.persistenceMetadata)
		) {
			fail("malformed", { entity: "event_metadata", eventIndex: index });
		}
	}
	const changedStageIds = new Set<string>();
	for (const change of plan.changes.stages) {
		const authoritative = snapshot.stages.find(
			(stage) => stage.id === change.stageId,
		);
		if (
			changedStageIds.has(change.stageId) ||
			!authoritative ||
			change.stageId !== change.resulting.id ||
			change.resulting.organizationId !== snapshot.organizationId ||
			change.resulting.workflowId !== snapshot.id ||
			JSON.stringify(change.resulting) !== JSON.stringify(authoritative)
		) {
			fail("malformed", { entity: "stage_change" });
		}
		changedStageIds.add(change.stageId);
	}
	const authoritativeAssignments = snapshot.stages.flatMap(
		(stage) => stage.assignments,
	);
	const changedAssignmentIds = new Set<string>();
	for (const change of plan.changes.assignments) {
		const authoritative = authoritativeAssignments.find(
			(assignment) => assignment.id === change.assignmentId,
		);
		if (
			changedAssignmentIds.has(change.assignmentId) ||
			!authoritative ||
			change.assignmentId !== change.resulting.id ||
			change.resulting.organizationId !== snapshot.organizationId ||
			change.resulting.workflowId !== snapshot.id ||
			JSON.stringify(change.resulting) !== JSON.stringify(authoritative)
		) {
			fail("malformed", { entity: "assignment_change" });
		}
		changedAssignmentIds.add(change.assignmentId);
	}
}

async function loadSnapshot(
	dbService: ApprovalDbService,
	input: { organizationId: string; workflowId: string },
) {
	assertScope(input);
	const roots = resultRows(
		await dbService.db.execute(sql`
		select id, organization_id, workflow_type, source_type, source_id,
			requester_employee_id, status, current_stage_order, version,
			policy_snapshot, context_snapshot, display_snapshot, submitted_at,
			completed_at, cancelled_at, decision_reason
		from approval_workflow
		where organization_id = ${input.organizationId} and id = ${input.workflowId}
	`),
	);
	if (roots.length === 0) fail("not_found");
	if (roots.length !== 1) fail("malformed", { entity: "workflow" });
	const stageRows = resultRows(
		await dbService.db.execute(sql`
		select id, organization_id, workflow_id, stage_order, label,
			resolver_snapshot, activation_mode, status, activated_at, decided_at,
			decision_reason, legacy_approval_request_id
		from approval_workflow_stage
		where organization_id = ${input.organizationId} and workflow_id = ${input.workflowId}
		order by stage_order, id
	`),
	);
	const assignmentRows = resultRows(
		await dbService.db.execute(sql`
		select id, organization_id, workflow_id, stage_id, assignment_sequence,
			approver_employee_id, status, assigned_at, resolved_at,
			resolved_by_actor_kind, resolved_by_actor_id, reassigned_by_employee_id,
			reassigned_from_assignment_id, reassignment_metadata
		from approval_stage_assignment
		where organization_id = ${input.organizationId} and workflow_id = ${input.workflowId}
		order by stage_id, assignment_sequence, id
	`),
	);
	const assignments = assignmentRows
		.map(hydrateAssignment)
		.sort(
			(left, right) =>
				left.stageId.localeCompare(right.stageId) ||
				left.sequence - right.sequence ||
				left.id.localeCompare(right.id),
		);
	const stages = stageRows
		.map((row) => {
			if (!isRecord(row) || !canonicalUuid(row.id)) {
				return fail("malformed", { entity: "stage" });
			}
			return hydrateStage(
				row,
				assignments.filter((assignment) => assignment.stageId === row.id),
			);
		})
		.sort(
			(left, right) =>
				left.sequence - right.sequence || left.id.localeCompare(right.id),
		);
	const snapshot = hydrateRoot(roots[0], stages);
	if (
		snapshot.organizationId !== input.organizationId ||
		snapshot.id !== input.workflowId
	) {
		return fail("malformed", { entity: "workflow_scope" });
	}
	return snapshot;
}

async function applyTransitionSql(
	dbService: ApprovalDbService,
	plan: ApprovalMaterializedTransitionPlan,
) {
	const snapshot = plan.resultingSnapshot;
	const firstEvent = plan.events[0] ?? fail("malformed", { entity: "event" });
	const updatedAt = instantToDB(firstEvent.occurredAt);
	exactlyOne(
		await dbService.db.execute(sql`
			update approval_workflow set
				status = ${snapshot.status},
				current_stage_order = ${snapshot.currentStageOrder},
				completed_at = ${instantToDB(snapshot.completedAt)},
				cancelled_at = ${instantToDB(snapshot.cancelledAt)},
				decision_reason = ${snapshot.decisionReason},
				updated_at = ${updatedAt}
			where organization_id = ${snapshot.organizationId}
				and id = ${snapshot.id}
				and version = ${snapshot.version}
			returning id
		`),
		"workflow_root",
	);
	for (const change of plan.changes.stages) {
		const stage = change.resulting;
		exactlyOne(
			await dbService.db.execute(sql`
				update approval_workflow_stage set
					label = ${stage.label},
					resolver_snapshot = ${JSON.stringify(stage.resolverSnapshot)}::jsonb,
					activation_mode = ${stage.activationMode},
					status = ${stage.status},
					activated_at = ${instantToDB(stage.activatedAt)},
					decided_at = ${instantToDB(stage.decidedAt)},
					decision_reason = ${stage.decisionReason},
					legacy_approval_request_id = ${stage.legacyApprovalRequestId},
					updated_at = ${updatedAt}
				where organization_id = ${snapshot.organizationId}
					and workflow_id = ${snapshot.id}
					and id = ${stage.id}
				returning id
			`),
			"workflow_stage",
		);
	}
	for (const change of plan.changes.assignments) {
		const assignment = change.resulting;
		const actorKind = assignment.resolvedBy?.kind ?? null;
		const actorId = assignment.resolvedBy?.employeeId ?? null;
		const metadata =
			assignment.reassignmentMetadata === null
				? null
				: JSON.stringify(assignment.reassignmentMetadata);
		if (change.kind === "update") {
			exactlyOne(
				await dbService.db.execute(sql`
					update approval_stage_assignment set
						assignment_sequence = ${assignment.sequence},
						approver_employee_id = ${assignment.approverEmployeeId},
						status = ${assignment.status},
						assigned_at = ${instantToDB(assignment.assignedAt)},
						resolved_at = ${instantToDB(assignment.resolvedAt)},
						resolved_by_actor_kind = ${actorKind},
						resolved_by_actor_id = ${actorId},
						reassigned_by_employee_id = ${assignment.reassignedByEmployeeId},
						reassigned_from_assignment_id = ${assignment.reassignedFromAssignmentId},
						reassignment_metadata = ${metadata}::jsonb,
						updated_at = ${updatedAt}
					where organization_id = ${snapshot.organizationId}
						and workflow_id = ${snapshot.id}
						and stage_id = ${assignment.stageId}
						and id = ${assignment.id}
					returning id
				`),
				"stage_assignment",
			);
		} else {
			exactlyOne(
				await dbService.db.execute(sql`
					insert into approval_stage_assignment (
						id, organization_id, workflow_id, stage_id, assignment_sequence,
						approver_employee_id, status, assigned_at, resolved_at,
						resolved_by_actor_kind, resolved_by_actor_id,
						reassigned_by_employee_id, reassigned_from_assignment_id,
						reassignment_metadata, created_at, updated_at
					) values (
						${assignment.id}, ${snapshot.organizationId}, ${snapshot.id},
						${assignment.stageId}, ${assignment.sequence},
						${assignment.approverEmployeeId}, ${assignment.status},
						${instantToDB(assignment.assignedAt)},
						${instantToDB(assignment.resolvedAt)}, ${actorKind}, ${actorId},
						${assignment.reassignedByEmployeeId},
						${assignment.reassignedFromAssignmentId}, ${metadata}::jsonb,
						${updatedAt}, ${updatedAt}
					) returning id
				`),
				"stage_assignment",
			);
		}
	}
	for (const event of plan.events) {
		const [actorKind, actorEmployeeId, actorUserId] = actorColumns(event.actor);
		let inserted: unknown;
		try {
			inserted = await dbService.db.execute(sql`
				insert into approval_workflow_event (
					id, organization_id, workflow_id, version, event_index, event_type,
					actor_kind, actor_employee_id, actor_user_id, previous_state,
					resulting_state, reason, metadata, idempotency_key,
					occurred_at, created_at
				) values (
					${event.id}, ${event.organizationId}, ${event.workflowId},
					${event.version}, ${event.eventIndex}, ${event.eventType},
					${actorKind}, ${actorEmployeeId}, ${actorUserId},
					${event.previousState === null ? null : JSON.stringify(event.previousState)}::jsonb,
					${JSON.stringify(event.resultingState)}::jsonb, ${event.reason},
					${event.persistenceMetadata === null ? null : JSON.stringify(event.persistenceMetadata)}::jsonb,
					${event.idempotencyKey}, ${instantToDB(event.occurredAt)},
					${instantToDB(event.occurredAt)}
				) returning id
			`);
		} catch (error) {
			if (databaseErrorCode(error) === "23505") {
				fail("persistence_count", { entity: "workflow_event_conflict" }, error);
			}
			throw error;
		}
		exactlyOne(inserted, "workflow_event");
	}
}

function assertObservationScope(
	input: ObservedLegacyTransition,
	result: ObservedLegacyTransitionPlan,
) {
	assertObservationEvidence(input);
	const source = input.source;
	if (
		result.snapshot.organizationId !== input.organizationId ||
		result.snapshot.workflowType !== source.workflowType ||
		result.snapshot.sourceType !== source.sourceType ||
		result.snapshot.sourceId !== source.sourceId
	) {
		fail("malformed", { entity: "legacy_observation_scope" });
	}
	assertCommandResult(result);
	if (result.outbox.some((outbox) => outbox.disposition !== "observe")) {
		fail("malformed", { entity: "legacy_observation_outbox" });
	}
}

function assertObservationVersionAuthority(
	input: ObservedLegacyTransition,
	result: ObservedLegacyTransitionPlan,
): void {
	if (input.expectedVersion === null) {
		if (result.snapshot.version !== 1) {
			fail("cas_invariant", { entity: "legacy_observation_version" });
		}
		return;
	}
	if (!integer(input.expectedVersion) || input.expectedVersion < 1) {
		fail("malformed", { field: "expectedVersion" });
	}
	if (result.snapshot.version !== input.expectedVersion + 1) {
		fail("cas_invariant", { entity: "legacy_observation_version" });
	}
}

const OBSERVED_TRANSITION_KEYS = [
	"organizationId",
	"source",
	"before",
	"after",
	"actor",
	"idempotencyKey",
	"expectedVersion",
] as const;
const OBSERVED_SOURCE_KEYS = [
	"organizationId",
	"workflowType",
	"sourceType",
	"sourceId",
] as const;
const OBSERVED_STATE_KEYS = [
	"organizationId",
	"source",
	"approvalRequest",
	"chain",
	"chainRows",
	"sourceSnapshot",
	"capturedAt",
] as const;
const LEGACY_APPROVAL_REQUEST_KEYS = [
	"id",
	"organizationId",
	"entityType",
	"entityId",
	"requestedBy",
	"approverId",
	"status",
	"reason",
	"rejectionReason",
	"approvedAt",
	"metadata",
	"updatedAt",
] as const;
const LEGACY_CHAIN_KEYS = [
	"id",
	"organizationId",
	"policyId",
	"policyNameSnapshot",
	"entityType",
	"entityId",
	"requesterEmployeeId",
	"currentStageOrder",
	"status",
	"createdAt",
	"updatedAt",
	"completedAt",
] as const;
const LEGACY_CHAIN_ROW_KEYS = [
	"id",
	"organizationId",
	"chainInstanceId",
	"policyStageId",
	"stepOrder",
	"labelSnapshot",
	"approverTypeSnapshot",
	"resolvedApproverEmployeeId",
	"approvalRequestId",
	"status",
	"decidedBy",
	"decidedAt",
	"createdAt",
	"updatedAt",
] as const;

function assertObservedEvidenceShape(
	input: unknown,
): asserts input is ObservedLegacyTransition {
	if (
		!isRecord(input) ||
		!exactKeys(input, OBSERVED_TRANSITION_KEYS) ||
		!isRecord(input.source) ||
		!exactKeys(input.source, OBSERVED_SOURCE_KEYS) ||
		!isRecord(input.actor) ||
		!exactKeys(input.actor, ["kind", "employeeId", "userId"])
	) {
		fail("malformed", { entity: "legacy_observation_shape" });
	}
	for (const state of [input.before, input.after]) {
		const stateKeys =
			state &&
			typeof state === "object" &&
			Object.hasOwn(state, "displaySnapshot")
				? [...OBSERVED_STATE_KEYS, "displaySnapshot"]
				: OBSERVED_STATE_KEYS;
		if (
			!isRecord(state) ||
			!exactKeys(state, stateKeys) ||
			!isRecord(state.source) ||
			!exactKeys(state.source, OBSERVED_SOURCE_KEYS) ||
			(Object.hasOwn(state, "displaySnapshot") &&
				!isRecord(state.displaySnapshot)) ||
			!Array.isArray(state.chainRows) ||
			(state.approvalRequest !== null &&
				(!isRecord(state.approvalRequest) ||
					!exactKeys(state.approvalRequest, LEGACY_APPROVAL_REQUEST_KEYS))) ||
			(state.chain !== null &&
				(!isRecord(state.chain) ||
					!exactKeys(state.chain, LEGACY_CHAIN_KEYS))) ||
			state.chainRows.some(
				(row) => !isRecord(row) || !exactKeys(row, LEGACY_CHAIN_ROW_KEYS),
			)
		) {
			fail("malformed", { entity: "legacy_observation_shape" });
		}
	}
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function nullableUuid(value: unknown): value is string | null {
	return value === null || canonicalUuid(value);
}

function nullableInstant(value: unknown): value is Instant | null {
	return value === null || isInstant(value);
}

function assertObservedEvidenceValues(input: ObservedLegacyTransition): void {
	if (
		!nonEmpty(input.organizationId) ||
		!nonEmpty(input.idempotencyKey) ||
		(input.expectedVersion !== null &&
			(!integer(input.expectedVersion) || input.expectedVersion < 1)) ||
		!nonEmpty(input.source.organizationId) ||
		!WORKFLOW_TYPES.has(input.source.workflowType) ||
		!nonEmpty(input.source.sourceType) ||
		!canonicalUuid(input.source.sourceId)
	) {
		fail("malformed", { entity: "legacy_observation" });
	}
	try {
		assertActor(input.actor);
	} catch (error) {
		fail("malformed", { field: "legacy_observation.actor" }, error);
	}
	for (const state of [input.before, input.after]) {
		if (!isInstant(state.capturedAt)) {
			fail("malformed", { field: "legacy_observation.capturedAt" });
		}
		requiredJsonObject(
			state.sourceSnapshot,
			"legacy_observation.sourceSnapshot",
		);
		const request = state.approvalRequest;
		if (request !== null) {
			if (
				!canonicalUuid(request.id) ||
				!nonEmpty(request.organizationId) ||
				!nonEmpty(request.entityType) ||
				!canonicalUuid(request.entityId) ||
				!canonicalUuid(request.requestedBy) ||
				!canonicalUuid(request.approverId) ||
				!LEGACY_APPROVAL_REQUEST_STATUSES.has(request.status) ||
				!nullableString(request.reason) ||
				!nullableString(request.rejectionReason) ||
				!nullableInstant(request.approvedAt) ||
				!isInstant(request.updatedAt)
			) {
				fail("malformed", { entity: "legacy_approval_request" });
			}
			jsonObject(
				request.metadata,
				"legacy_observation.approvalRequest.metadata",
				true,
			);
		}
		const chain = state.chain;
		if (
			chain !== null &&
			(!canonicalUuid(chain.id) ||
				!nonEmpty(chain.organizationId) ||
				!canonicalUuid(chain.policyId) ||
				!nonEmpty(chain.policyNameSnapshot) ||
				!nonEmpty(chain.entityType) ||
				!canonicalUuid(chain.entityId) ||
				!canonicalUuid(chain.requesterEmployeeId) ||
				!integer(chain.currentStageOrder) ||
				chain.currentStageOrder < 1 ||
				!LEGACY_CHAIN_STATUSES.has(chain.status) ||
				!isInstant(chain.createdAt) ||
				!isInstant(chain.updatedAt) ||
				!nullableInstant(chain.completedAt))
		) {
			fail("malformed", { entity: "legacy_approval_chain" });
		}
		const rowIds = new Set<string>();
		const rowOrders = new Set<number>();
		for (const row of state.chainRows) {
			if (
				!canonicalUuid(row.id) ||
				rowIds.has(row.id) ||
				!nonEmpty(row.organizationId) ||
				!canonicalUuid(row.chainInstanceId) ||
				!canonicalUuid(row.policyStageId) ||
				!integer(row.stepOrder) ||
				row.stepOrder < 1 ||
				rowOrders.has(row.stepOrder) ||
				!nonEmpty(row.labelSnapshot) ||
				!nonEmpty(row.approverTypeSnapshot) ||
				!canonicalUuid(row.resolvedApproverEmployeeId) ||
				!nullableUuid(row.approvalRequestId) ||
				!LEGACY_CHAIN_STATUSES.has(row.status) ||
				!nullableUuid(row.decidedBy) ||
				!nullableInstant(row.decidedAt) ||
				!isInstant(row.createdAt) ||
				!isInstant(row.updatedAt)
			) {
				fail("malformed", { entity: "legacy_approval_chain_row" });
			}
			rowIds.add(row.id);
			rowOrders.add(row.stepOrder);
		}
	}
}

function assertObservationEvidence(
	input: unknown,
): asserts input is ObservedLegacyTransition {
	assertObservedEvidenceShape(input);
	assertObservedEvidenceValues(input);
	const source = input.source;
	if (
		!nonEmpty(input.idempotencyKey) ||
		input.organizationId !== source.organizationId ||
		input.before.organizationId !== input.organizationId ||
		input.after.organizationId !== input.organizationId ||
		input.before.source.organizationId !== input.organizationId ||
		input.after.source.organizationId !== input.organizationId ||
		input.before.source.workflowType !== source.workflowType ||
		input.after.source.workflowType !== source.workflowType ||
		input.before.source.sourceType !== source.sourceType ||
		input.after.source.sourceType !== source.sourceType ||
		input.before.source.sourceId !== source.sourceId ||
		input.after.source.sourceId !== source.sourceId
	) {
		fail("malformed", { entity: "legacy_observation_scope" });
	}
	for (const state of [input.before, input.after]) {
		if (
			(state.approvalRequest !== null &&
				(state.approvalRequest.organizationId !== input.organizationId ||
					state.approvalRequest.entityType !== source.sourceType ||
					state.approvalRequest.entityId !== source.sourceId)) ||
			(state.chain !== null &&
				(state.chain.organizationId !== input.organizationId ||
					state.chain.entityType !== source.sourceType ||
					state.chain.entityId !== source.sourceId)) ||
			state.chainRows.some(
				(row) =>
					row.organizationId !== input.organizationId ||
					state.chain === null ||
					row.chainInstanceId !== state.chain.id,
			)
		) {
			fail("malformed", { entity: "legacy_observation_scope" });
		}
	}
}

export function normalizeObservedLegacyTransition(
	value: unknown,
): ObservedLegacyTransition {
	let normalized: unknown;
	try {
		normalized = normalizeStableData(value);
	} catch (error) {
		return fail("malformed", { entity: "legacy_observation" }, error);
	}
	assertObservationEvidence(normalized);
	return normalized;
}

function canonicalizeObservedEventReferences(
	plan: ObservedLegacyTransitionPlan,
): ObservedLegacyTransitionPlan {
	return {
		...plan,
		events: plan.events.map((event) => ({
			...event,
			references: event.references ?? {},
		})),
	};
}

function normalizeObservedPlan(value: unknown): ObservedLegacyTransitionPlan {
	let normalized: unknown;
	try {
		normalized = normalizeStableData(value);
	} catch (error) {
		return fail("malformed", { entity: "legacy_observation_plan" }, error);
	}
	assertCommandResult(normalized);
	if (normalized.outbox.some((outbox) => outbox.disposition !== "observe")) {
		fail("malformed", { entity: "legacy_observation_outbox" });
	}
	return canonicalizeObservedEventReferences(
		normalized as ObservedLegacyTransitionPlan,
	);
}

function assertDbRepresentableInstant(
	value: Instant | null,
	field: string,
): void {
	try {
		instantToDB(value);
		if (value !== null) {
			const iso = value.toString();
			const year = Number(
				iso.startsWith("+") || iso.startsWith("-")
					? iso.slice(0, 7)
					: iso.slice(0, 4),
			);
			if (!Number.isInteger(year) || year < -4712) {
				throw new RangeError(
					"Instant is outside the PostgreSQL timestamp range",
				);
			}
		}
	} catch (error) {
		fail("malformed", { field }, error);
	}
}

function assertInitialDbInstants(
	snapshot: ApprovalWorkflowSnapshot,
	events: ApprovalWorkflowEventSnapshot[],
): void {
	assertDbRepresentableInstant(snapshot.submittedAt, "snapshot.submittedAt");
	assertDbRepresentableInstant(snapshot.completedAt, "snapshot.completedAt");
	assertDbRepresentableInstant(snapshot.cancelledAt, "snapshot.cancelledAt");
	for (const stage of snapshot.stages) {
		assertDbRepresentableInstant(stage.activatedAt, "stage.activatedAt");
		assertDbRepresentableInstant(stage.decidedAt, "stage.decidedAt");
		for (const assignment of stage.assignments) {
			assertDbRepresentableInstant(
				assignment.assignedAt,
				"assignment.assignedAt",
			);
			assertDbRepresentableInstant(
				assignment.resolvedAt,
				"assignment.resolvedAt",
			);
		}
	}
	for (const event of events) {
		assertDbRepresentableInstant(event.occurredAt, "event.occurredAt");
	}
}

function assertObservedPlanDbInstants(
	plan: ObservedLegacyTransitionPlan,
): void {
	assertDbRepresentableInstant(
		plan.snapshot.submittedAt,
		"snapshot.submittedAt",
	);
	assertDbRepresentableInstant(
		plan.snapshot.completedAt,
		"snapshot.completedAt",
	);
	assertDbRepresentableInstant(
		plan.snapshot.cancelledAt,
		"snapshot.cancelledAt",
	);
	assertDbRepresentableInstant(
		plan.projection.updatedAt,
		"projection.updatedAt",
	);
	for (const stage of plan.snapshot.stages) {
		assertDbRepresentableInstant(stage.activatedAt, "stage.activatedAt");
		assertDbRepresentableInstant(stage.decidedAt, "stage.decidedAt");
		for (const assignment of stage.assignments) {
			assertDbRepresentableInstant(
				assignment.assignedAt,
				"assignment.assignedAt",
			);
			assertDbRepresentableInstant(
				assignment.resolvedAt,
				"assignment.resolvedAt",
			);
		}
	}
	for (const event of plan.events) {
		assertDbRepresentableInstant(event.occurredAt, "event.occurredAt");
	}
	for (const outbox of plan.outbox) {
		assertDbRepresentableInstant(outbox.createdAt, "outbox.createdAt");
	}
}

function observationKeys(input: ObservedLegacyTransition, count: number) {
	return Array.from({ length: count }, (_, index) =>
		index === 0 ? input.idempotencyKey : `${input.idempotencyKey}:${index}`,
	);
}

function comparable(value: unknown): unknown {
	if (isInstant(value)) return value.toString();
	if (Array.isArray(value)) return value.map(comparable);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, comparable(value[key])]),
		);
	}
	return value;
}

function persistedValuesEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function initialReplayMatches(
	initial: InitialApprovalWorkflowPersistenceInput,
	persistedSnapshot: ApprovalWorkflowSnapshot,
	persistedEvents: ApprovalWorkflowEventSnapshot[],
): boolean {
	if (persistedSnapshot.version === initial.snapshot.version) {
		return (
			persistedValuesEqual(persistedSnapshot, initial.snapshot) &&
			persistedEvents.length === initial.events.length &&
			initial.events.every((event, index) =>
				persistedValuesEqual(event, persistedEvents[index]),
			)
		);
	}
	if (persistedSnapshot.version < initial.snapshot.version) return false;
	let persistedVersion = 0;
	let persistedEventIndex = 0;
	for (const event of persistedEvents) {
		if (event.version === persistedVersion + 1) {
			persistedEventIndex = 0;
		} else if (event.version !== persistedVersion) {
			return false;
		}
		if (event.version < 1 || event.eventIndex !== persistedEventIndex) {
			return false;
		}
		persistedVersion = event.version;
		persistedEventIndex += 1;
	}
	if (persistedVersion !== persistedSnapshot.version) return false;
	const immutableRoot = (snapshot: ApprovalWorkflowSnapshot) => ({
		id: snapshot.id,
		organizationId: snapshot.organizationId,
		workflowType: snapshot.workflowType,
		sourceType: snapshot.sourceType,
		sourceId: snapshot.sourceId,
		requesterEmployeeId: snapshot.requesterEmployeeId,
		policySnapshot: snapshot.policySnapshot,
		contextSnapshot: snapshot.contextSnapshot,
		displaySnapshot: snapshot.displaySnapshot,
		submittedAt: snapshot.submittedAt,
	});
	if (
		!persistedValuesEqual(
			immutableRoot(initial.snapshot),
			immutableRoot(persistedSnapshot),
		) ||
		initial.snapshot.stages.length !== persistedSnapshot.stages.length
	) {
		return false;
	}
	for (const initialStage of initial.snapshot.stages) {
		const persistedStage = persistedSnapshot.stages.find(
			(stage) => stage.id === initialStage.id,
		);
		if (
			!persistedStage ||
			!persistedValuesEqual(
				{
					id: initialStage.id,
					organizationId: initialStage.organizationId,
					workflowId: initialStage.workflowId,
					sequence: initialStage.sequence,
					label: initialStage.label,
					resolverSnapshot: initialStage.resolverSnapshot,
				},
				{
					id: persistedStage.id,
					organizationId: persistedStage.organizationId,
					workflowId: persistedStage.workflowId,
					sequence: persistedStage.sequence,
					label: persistedStage.label,
					resolverSnapshot: persistedStage.resolverSnapshot,
				},
			)
		) {
			return false;
		}
		for (const initialAssignment of initialStage.assignments) {
			const persistedAssignment = persistedStage.assignments.find(
				(assignment) => assignment.id === initialAssignment.id,
			);
			if (
				!persistedAssignment ||
				!persistedValuesEqual(
					{
						id: initialAssignment.id,
						organizationId: initialAssignment.organizationId,
						workflowId: initialAssignment.workflowId,
						stageId: initialAssignment.stageId,
						sequence: initialAssignment.sequence,
						approverEmployeeId: initialAssignment.approverEmployeeId,
						assignedAt: initialAssignment.assignedAt,
					},
					{
						id: persistedAssignment.id,
						organizationId: persistedAssignment.organizationId,
						workflowId: persistedAssignment.workflowId,
						stageId: persistedAssignment.stageId,
						sequence: persistedAssignment.sequence,
						approverEmployeeId: persistedAssignment.approverEmployeeId,
						assignedAt: persistedAssignment.assignedAt,
					},
				)
			) {
				return false;
			}
		}
	}
	return (
		persistedEvents.length >= initial.events.length &&
		initial.events.every((event, index) =>
			persistedValuesEqual(event, persistedEvents[index]),
		)
	);
}

function hydrateEvent(row: unknown): ApprovalWorkflowEventSnapshot {
	if (!isRecord(row)) return fail("malformed", { entity: "workflow_event" });
	let actor: ApprovalEventActorIdentity;
	if (
		row.actor_kind === "employee" &&
		canonicalUuid(row.actor_employee_id) &&
		(row.actor_user_id === null || nonEmpty(row.actor_user_id))
	) {
		actor = {
			kind: "employee",
			employeeId: row.actor_employee_id,
			userId: row.actor_user_id,
		};
	} else if (
		(row.actor_kind === "system" || row.actor_kind === "legacy_unknown") &&
		row.actor_employee_id === null &&
		row.actor_user_id === null
	) {
		actor = {
			kind: row.actor_kind,
			employeeId: null,
			userId: null,
		};
	} else {
		return fail("malformed", { field: "event.actor" });
	}
	const persistenceMetadata = jsonObject(row.metadata, "event.metadata", true);
	let metadata: JsonObject | null;
	let references: ApprovalWorkflowEventReferences;
	try {
		({ metadata, references } =
			deserializeApprovalWorkflowEventMetadata(persistenceMetadata));
	} catch (error) {
		return fail("malformed", { field: "event.metadata" }, error);
	}
	const occurredAt = requiredDbInstant(row.occurred_at, "event.occurredAt");
	const createdAt = requiredDbInstant(row.created_at, "event.createdAt");
	if (occurredAt.toString() !== createdAt.toString()) {
		return fail("persistence_count", { entity: "event_created_at" });
	}
	return {
		id: canonicalUuid(row.id)
			? row.id
			: fail("malformed", { field: "event.id" }),
		organizationId: nonEmpty(row.organization_id)
			? row.organization_id
			: fail("malformed", { field: "event.organizationId" }),
		workflowId: canonicalUuid(row.workflow_id)
			? row.workflow_id
			: fail("malformed", { field: "event.workflowId" }),
		version: integer(row.version)
			? row.version
			: fail("malformed", { field: "event.version" }),
		eventIndex: integer(row.event_index)
			? row.event_index
			: fail("malformed", { field: "event.eventIndex" }),
		eventType: EVENT_TYPES.has(String(row.event_type))
			? (row.event_type as ApprovalWorkflowEventSnapshot["eventType"])
			: fail("malformed", { field: "event.eventType" }),
		actor,
		previousState: jsonObject(row.previous_state, "event.previousState", true),
		resultingState: requiredJsonObject(
			row.resulting_state,
			"event.resultingState",
		),
		reason:
			row.reason === null || typeof row.reason === "string"
				? row.reason
				: fail("malformed", { field: "event.reason" }),
		metadata,
		references,
		idempotencyKey:
			row.idempotency_key === null || nonEmpty(row.idempotency_key)
				? row.idempotency_key
				: fail("malformed", { field: "event.idempotencyKey" }),
		occurredAt,
	};
}

const EVENT_SELECT = sql.raw(`
	id, organization_id, workflow_id, version, event_index, event_type,
	actor_kind, actor_employee_id, actor_user_id, previous_state,
	resulting_state, reason, metadata, idempotency_key, occurred_at
	, created_at
`);

function sourceLockKey(input: {
	organizationId: string;
	workflowType: string;
	sourceType: string;
	sourceId: string;
}): string {
	return JSON.stringify([
		input.organizationId,
		input.workflowType,
		input.sourceType,
		input.sourceId,
	]);
}

async function acquireInitialSourceLock(
	dbService: ApprovalDbService,
	input: {
		organizationId: string;
		workflowType: string;
		sourceType: string;
		sourceId: string;
	},
): Promise<void> {
	exactlyOne(
		await dbService.db.execute(sql`
			select pg_advisory_xact_lock(
				hashtextextended(${sourceLockKey(input)}, 0)
			) as locked
		`),
		"initial_source_lock",
	);
}

interface InitialSourceOccupants {
	candidateExists: boolean;
	pendingConflict: boolean;
}

async function inspectInitialSourceOccupants(
	dbService: ApprovalDbService,
	input: {
		organizationId: string;
		workflowType: string;
		sourceType: string;
		sourceId: string;
	},
	candidateId: string,
): Promise<InitialSourceOccupants> {
	const rows = resultRows(
		await dbService.db.execute(sql`
			select id, status from approval_workflow
			where organization_id = ${input.organizationId}
				and workflow_type = ${input.workflowType}
				and source_type = ${input.sourceType}
				and source_id = ${input.sourceId}
				and (id = ${candidateId} or status = 'pending')
			order by id
		`),
	);
	if (rows.length > 2) fail("malformed", { entity: "initial_source" });
	let candidateExists = false;
	let pendingConflict = false;
	const ids = new Set<string>();
	for (const row of rows) {
		if (
			!isRecord(row) ||
			!canonicalUuid(row.id) ||
			!WORKFLOW_STATUSES.has(String(row.status)) ||
			ids.has(row.id)
		) {
			fail("malformed", { entity: "initial_source" });
		}
		ids.add(row.id);
		if (row.id === candidateId) candidateExists = true;
		if (row.status === "pending" && row.id !== candidateId) {
			pendingConflict = true;
		}
	}
	return { candidateExists, pendingConflict };
}

async function loadInitialEvents(
	dbService: ApprovalDbService,
	snapshot: ApprovalWorkflowSnapshot,
): Promise<ApprovalWorkflowEventSnapshot[]> {
	return resultRows(
		await dbService.db.execute(sql`
			select ${EVENT_SELECT} from approval_workflow_event
			where organization_id = ${snapshot.organizationId}
				and workflow_id = ${snapshot.id}
			order by version, event_index, id
		`),
	).map(hydrateEvent);
}

async function verifyInitialPersistence(
	dbService: ApprovalDbService,
	input: InitialApprovalWorkflowPersistenceInput,
): Promise<ApprovalWorkflowSnapshot> {
	const persistedSnapshot = await loadSnapshot(dbService, {
		organizationId: input.snapshot.organizationId,
		workflowId: input.snapshot.id,
	});
	const persistedEvents = await loadInitialEvents(dbService, input.snapshot);
	if (
		!persistedValuesEqual(persistedSnapshot, input.snapshot) ||
		persistedEvents.length !== input.events.length ||
		persistedEvents.some(
			(event, index) => !persistedValuesEqual(event, input.events[index]),
		)
	) {
		fail("persistence_count", { entity: "initial_workflow_reload" });
	}
	return persistedSnapshot;
}

async function persistInitialWorkflow(
	dbService: ApprovalDbService,
	input: InitialApprovalWorkflowPersistenceInput,
): Promise<ApprovalWorkflowSnapshot | null> {
	const { snapshot } = input;
	const updatedAt = instantToDB(
		input.events[input.events.length - 1]?.occurredAt ?? snapshot.submittedAt,
	);
	const insertedRoot = resultRows(
		await dbService.db.execute(sql`
			insert into approval_workflow (
				id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version,
				policy_snapshot, context_snapshot, display_snapshot, submitted_at,
				completed_at, cancelled_at, decision_reason, created_at, updated_at
			) values (
				${snapshot.id}, ${snapshot.organizationId}, ${snapshot.workflowType},
				${snapshot.sourceType}, ${snapshot.sourceId},
				${snapshot.requesterEmployeeId}, ${snapshot.status},
				${snapshot.currentStageOrder}, ${snapshot.version},
				${JSON.stringify(snapshot.policySnapshot)}::jsonb,
				${JSON.stringify(snapshot.contextSnapshot)}::jsonb,
				${JSON.stringify(snapshot.displaySnapshot)}::jsonb,
				${instantToDB(snapshot.submittedAt)}, ${instantToDB(snapshot.completedAt)},
				${instantToDB(snapshot.cancelledAt)}, ${snapshot.decisionReason},
				${instantToDB(snapshot.submittedAt)}, ${updatedAt}
			) on conflict do nothing returning id
		`),
	);
	if (insertedRoot.length === 0) return null;
	if (
		insertedRoot.length !== 1 ||
		!isRecord(insertedRoot[0]) ||
		insertedRoot[0].id !== snapshot.id
	) {
		fail("persistence_count", { entity: "initial_workflow" });
	}
	for (const stage of snapshot.stages) {
		exactlyOne(
			await dbService.db.execute(sql`
				insert into approval_workflow_stage (
					id, organization_id, workflow_id, stage_order, label,
					resolver_snapshot, activation_mode, status, activated_at,
					decided_at, decision_reason, legacy_approval_request_id,
					created_at, updated_at
				) values (
					${stage.id}, ${stage.organizationId}, ${stage.workflowId},
					${stage.sequence}, ${stage.label},
					${JSON.stringify(stage.resolverSnapshot)}::jsonb,
					${stage.activationMode}, ${stage.status},
					${instantToDB(stage.activatedAt)}, ${instantToDB(stage.decidedAt)},
					${stage.decisionReason}, ${stage.legacyApprovalRequestId},
					${instantToDB(snapshot.submittedAt)}, ${updatedAt}
				) returning id
			`),
			"initial_stage",
		);
		for (const assignment of stage.assignments) {
			const actorKind = assignment.resolvedBy?.kind ?? null;
			const actorId = assignment.resolvedBy?.employeeId ?? null;
			exactlyOne(
				await dbService.db.execute(sql`
					insert into approval_stage_assignment (
						id, organization_id, workflow_id, stage_id,
						assignment_sequence, approver_employee_id, status, assigned_at,
						resolved_at, resolved_by_actor_kind, resolved_by_actor_id,
						reassigned_by_employee_id, reassigned_from_assignment_id,
						reassignment_metadata, created_at, updated_at
					) values (
						${assignment.id}, ${assignment.organizationId},
						${assignment.workflowId}, ${assignment.stageId},
						${assignment.sequence}, ${assignment.approverEmployeeId},
						${assignment.status}, ${instantToDB(assignment.assignedAt)},
						${instantToDB(assignment.resolvedAt)}, ${actorKind}, ${actorId},
						${assignment.reassignedByEmployeeId},
						${assignment.reassignedFromAssignmentId},
						${assignment.reassignmentMetadata === null ? null : JSON.stringify(assignment.reassignmentMetadata)}::jsonb,
						${instantToDB(assignment.assignedAt)}, ${updatedAt}
					) returning id
				`),
				"initial_assignment",
			);
		}
	}
	for (const event of input.events) {
		const [actorKind, actorEmployeeId, actorUserId] = actorColumns(event.actor);
		const metadata = serializeApprovalWorkflowEventMetadata(
			event.metadata,
			event.references ?? {},
		);
		const persisted = hydrateEvent(
			oneRow(
				await dbService.db.execute(sql`
					insert into approval_workflow_event (
						id, organization_id, workflow_id, version, event_index, event_type,
						actor_kind, actor_employee_id, actor_user_id, previous_state,
						resulting_state, reason, metadata, idempotency_key,
						occurred_at, created_at
					) values (
						${event.id}, ${event.organizationId}, ${event.workflowId},
						${event.version}, ${event.eventIndex}, ${event.eventType},
						${actorKind}, ${actorEmployeeId}, ${actorUserId},
						${event.previousState === null ? null : JSON.stringify(event.previousState)}::jsonb,
						${JSON.stringify(event.resultingState)}::jsonb, ${event.reason},
						${metadata === null ? null : JSON.stringify(metadata)}::jsonb,
						${event.idempotencyKey}, ${instantToDB(event.occurredAt)},
						${instantToDB(event.occurredAt)}
					) returning ${EVENT_SELECT}
				`),
				"persistence_count",
			),
		);
		if (!persistedValuesEqual(persisted, event)) {
			fail("persistence_count", { entity: "initial_event_reload" });
		}
	}
	return verifyInitialPersistence(dbService, input);
}

async function tryWinObservedRoot(
	dbService: ApprovalDbService,
	input: ObservedLegacyTransition,
	result: ObservedLegacyTransitionPlan,
): Promise<boolean> {
	const snapshot = result.snapshot;
	const updatedAt = instantToDB(result.projection.updatedAt);
	if (input.expectedVersion === null) {
		const inserted = resultRows(
			await dbService.db.execute(sql`
			insert into approval_workflow (
				id, organization_id, workflow_type, source_type, source_id,
				requester_employee_id, status, current_stage_order, version,
				policy_snapshot, context_snapshot, display_snapshot, submitted_at,
				completed_at, cancelled_at, decision_reason, created_at, updated_at
			) values (
				${snapshot.id}, ${snapshot.organizationId}, ${snapshot.workflowType},
				${snapshot.sourceType}, ${snapshot.sourceId},
				${snapshot.requesterEmployeeId}, ${snapshot.status},
				${snapshot.currentStageOrder}, ${snapshot.version},
				${JSON.stringify(snapshot.policySnapshot)}::jsonb,
				${JSON.stringify(snapshot.contextSnapshot)}::jsonb,
				${JSON.stringify(snapshot.displaySnapshot)}::jsonb,
				${instantToDB(snapshot.submittedAt)}, ${instantToDB(snapshot.completedAt)},
				${instantToDB(snapshot.cancelledAt)}, ${snapshot.decisionReason},
				${instantToDB(snapshot.submittedAt)}, ${updatedAt}
			) on conflict (id) do nothing
			returning id, version
		`),
		);
		if (
			inserted.length === 1 &&
			isRecord(inserted[0]) &&
			inserted[0].id === snapshot.id &&
			inserted[0].version === snapshot.version
		) {
			return true;
		}
		if (inserted.length > 0) {
			return fail("persistence_count", { entity: "observed_root_insert" });
		}
		return false;
	}
	const advanced = resultRows(
		await dbService.db.execute(sql`
		update approval_workflow set
			requester_employee_id = ${snapshot.requesterEmployeeId},
			status = ${snapshot.status},
			current_stage_order = ${snapshot.currentStageOrder},
			version = ${snapshot.version},
			policy_snapshot = ${JSON.stringify(snapshot.policySnapshot)}::jsonb,
			context_snapshot = ${JSON.stringify(snapshot.contextSnapshot)}::jsonb,
			display_snapshot = ${JSON.stringify(snapshot.displaySnapshot)}::jsonb,
			submitted_at = ${instantToDB(snapshot.submittedAt)},
			completed_at = ${instantToDB(snapshot.completedAt)},
			cancelled_at = ${instantToDB(snapshot.cancelledAt)},
			decision_reason = ${snapshot.decisionReason},
			updated_at = ${updatedAt}
		where organization_id = ${snapshot.organizationId}
			and id = ${snapshot.id}
			and workflow_type = ${snapshot.workflowType}
			and source_type = ${snapshot.sourceType}
			and source_id = ${snapshot.sourceId}
			and version = ${input.expectedVersion}
		returning id, version
	`),
	);
	if (
		advanced.length === 1 &&
		isRecord(advanced[0]) &&
		advanced[0].id === snapshot.id &&
		advanced[0].version === snapshot.version
	) {
		return true;
	}
	if (advanced.length > 0) {
		return fail("persistence_count", { entity: "observed_root_cas" });
	}
	return false;
}

async function persistObservedChildren(
	dbService: ApprovalDbService,
	result: ApprovalCommandResult,
) {
	const snapshot = result.snapshot;
	const updatedAt = instantToDB(result.projection.updatedAt);
	for (const stage of snapshot.stages) {
		exactlyOne(
			await dbService.db.execute(sql`
				insert into approval_workflow_stage (
					id, organization_id, workflow_id, stage_order, label,
					resolver_snapshot, activation_mode, status, activated_at,
					decided_at, decision_reason, legacy_approval_request_id,
					created_at, updated_at
				) values (
					${stage.id}, ${stage.organizationId}, ${stage.workflowId},
					${stage.sequence}, ${stage.label},
					${JSON.stringify(stage.resolverSnapshot)}::jsonb,
					${stage.activationMode}, ${stage.status},
					${instantToDB(stage.activatedAt)}, ${instantToDB(stage.decidedAt)},
					${stage.decisionReason}, ${stage.legacyApprovalRequestId},
					${instantToDB(snapshot.submittedAt)}, ${updatedAt}
				) on conflict (id) do update set
					stage_order = excluded.stage_order,
					label = excluded.label,
					resolver_snapshot = excluded.resolver_snapshot,
					activation_mode = excluded.activation_mode,
					status = excluded.status,
					activated_at = excluded.activated_at,
					decided_at = excluded.decided_at,
					decision_reason = excluded.decision_reason,
					legacy_approval_request_id = excluded.legacy_approval_request_id,
					updated_at = excluded.updated_at
				where approval_workflow_stage.organization_id = excluded.organization_id
					and approval_workflow_stage.workflow_id = excluded.workflow_id
				returning id
			`),
			"observed_stage",
		);
		for (const assignment of stage.assignments) {
			const actorKind = assignment.resolvedBy?.kind ?? null;
			const actorId = assignment.resolvedBy?.employeeId ?? null;
			exactlyOne(
				await dbService.db.execute(sql`
					insert into approval_stage_assignment (
						id, organization_id, workflow_id, stage_id,
						assignment_sequence, approver_employee_id, status, assigned_at,
						resolved_at, resolved_by_actor_kind, resolved_by_actor_id,
						reassigned_by_employee_id, reassigned_from_assignment_id,
						reassignment_metadata, created_at, updated_at
					) values (
						${assignment.id}, ${assignment.organizationId},
						${assignment.workflowId}, ${assignment.stageId},
						${assignment.sequence}, ${assignment.approverEmployeeId},
						${assignment.status}, ${instantToDB(assignment.assignedAt)},
						${instantToDB(assignment.resolvedAt)}, ${actorKind}, ${actorId},
						${assignment.reassignedByEmployeeId},
						${assignment.reassignedFromAssignmentId},
						${assignment.reassignmentMetadata === null ? null : JSON.stringify(assignment.reassignmentMetadata)}::jsonb,
						${instantToDB(assignment.assignedAt)}, ${updatedAt}
					) on conflict (id) do update set
						assignment_sequence = excluded.assignment_sequence,
						approver_employee_id = excluded.approver_employee_id,
						status = excluded.status,
						assigned_at = excluded.assigned_at,
						resolved_at = excluded.resolved_at,
						resolved_by_actor_kind = excluded.resolved_by_actor_kind,
						resolved_by_actor_id = excluded.resolved_by_actor_id,
						reassigned_by_employee_id = excluded.reassigned_by_employee_id,
						reassigned_from_assignment_id = excluded.reassigned_from_assignment_id,
						reassignment_metadata = excluded.reassignment_metadata,
						updated_at = excluded.updated_at
					where approval_stage_assignment.organization_id = excluded.organization_id
						and approval_stage_assignment.workflow_id = excluded.workflow_id
						and approval_stage_assignment.stage_id = excluded.stage_id
					returning id
				`),
				"observed_assignment",
			);
		}
	}
}

async function persistObservedEvents(
	dbService: ApprovalDbService,
	input: ObservedLegacyTransition,
	result: ApprovalCommandResult,
	keys: string[],
): Promise<ApprovalWorkflowEventSnapshot[]> {
	const persisted: ApprovalWorkflowEventSnapshot[] = [];
	for (const [index, event] of result.events.entries()) {
		const [actorKind, actorEmployeeId, actorUserId] = actorColumns(event.actor);
		const persistenceMetadata = serializeApprovalWorkflowEventMetadata(
			event.metadata,
			event.references ?? {},
		);
		let insertResult: unknown;
		try {
			insertResult = await dbService.db.execute(sql`
				insert into approval_workflow_event (
					id, organization_id, workflow_id, version, event_index, event_type,
					actor_kind, actor_employee_id, actor_user_id, previous_state,
					resulting_state, reason, metadata, idempotency_key,
					occurred_at, created_at
				) values (
					${event.id}, ${input.organizationId}, ${result.snapshot.id},
					${event.version}, ${event.eventIndex}, ${event.eventType},
					${actorKind}, ${actorEmployeeId}, ${actorUserId},
					${event.previousState === null ? null : JSON.stringify(event.previousState)}::jsonb,
					${JSON.stringify(event.resultingState)}::jsonb, ${event.reason},
					${persistenceMetadata === null ? null : JSON.stringify(persistenceMetadata)}::jsonb,
					${keys[index]}, ${instantToDB(event.occurredAt)},
					${instantToDB(event.occurredAt)}
				) on conflict (organization_id, idempotency_key)
					where idempotency_key is not null do nothing
				returning ${EVENT_SELECT}
			`);
		} catch (error) {
			if (databaseErrorCode(error) === "23505") {
				fail("persistence_count", { entity: "observed_event_conflict" }, error);
			}
			throw error;
		}
		const inserted = resultRows(insertResult);
		if (inserted.length > 1) {
			fail("persistence_count", { entity: "observed_event" });
		}
		const key =
			keys[index] ??
			fail("malformed", {
				entity: "legacy_observation_event_key",
			});
		const persistedEvent =
			inserted.length === 1
				? hydrateEvent(inserted[0])
				: hydrateEvent(
						oneRow(
							await dbService.db.execute(sql`
								select ${EVENT_SELECT} from approval_workflow_event
								where organization_id = ${input.organizationId}
									and idempotency_key = ${key}
								for update
							`),
							"persistence_count",
						),
					);
		if (!persistedValuesEqual(persistedEvent, event)) {
			fail("persistence_count", { entity: "observed_event_winner" });
		}
		persisted.push(persistedEvent);
	}
	return persisted;
}

async function verifyObservedWinner(
	dbService: ApprovalDbService,
	intended: ObservedLegacyTransitionPlan,
	keys: string[],
): Promise<ObservedLegacyTransitionPlan> {
	let persistedSnapshot: ApprovalWorkflowSnapshot;
	try {
		persistedSnapshot = await loadSnapshot(dbService, {
			organizationId: intended.snapshot.organizationId,
			workflowId: intended.snapshot.id,
		});
	} catch (error) {
		if (
			error instanceof ApprovalWorkflowRepositoryError &&
			error.code === "not_found"
		) {
			return fail("cas_invariant", { entity: "observed_root_winner" });
		}
		throw error;
	}
	const keyValues = sql.join(
		keys.map((key) => sql`${key}`),
		sql`, `,
	);
	const persistedEvents = resultRows(
		await dbService.db.execute(sql`
		select ${EVENT_SELECT} from approval_workflow_event
		where organization_id = ${intended.snapshot.organizationId}
			and workflow_id = ${intended.snapshot.id}
			and idempotency_key in (${keyValues})
		order by event_index, id
		for update
	`),
	).map(hydrateEvent);
	const { stages: persistedStages, ...persistedRoot } = persistedSnapshot;
	const { stages: intendedStages, ...intendedRoot } = intended.snapshot;
	if (!persistedValuesEqual(persistedRoot, intendedRoot)) {
		fail("cas_invariant", { entity: "observed_root_winner" });
	}
	if (!persistedValuesEqual(persistedStages, intendedStages)) {
		fail("persistence_count", { entity: "observed_children_winner" });
	}
	if (
		persistedEvents.length !== intended.events.length ||
		persistedEvents.some(
			(event, index) => !persistedValuesEqual(event, intended.events[index]),
		)
	) {
		fail("persistence_count", { entity: "observed_events_winner" });
	}
	return {
		...intended,
		snapshot: persistedSnapshot,
		events: persistedEvents,
	};
}

function createTransactionalRepository(
	dbService: ApprovalDbService,
	clock: Clock,
	observationPlanner: ApprovalLegacyObservationPlanner,
	localReservations: Set<string>,
	successfulCas: Set<string>,
): TransactionalWorkflowRepository {
	const casKey = (
		organizationId: string,
		workflowId: string,
		expectedVersion: number,
		resultingVersion: number,
	) =>
		`${organizationId}\0${workflowId}\0${expectedVersion}\0${resultingVersion}`;

	return {
		async findInitialWorkflow(input) {
			let contextSnapshot: JsonObject;
			let displaySnapshot: JsonObject;
			try {
				contextSnapshot = requiredJsonObject(
					input.contextSnapshot,
					"initialLookup.contextSnapshot",
				);
				displaySnapshot = requiredJsonObject(
					input.displaySnapshot,
					"initialLookup.displaySnapshot",
				);
			} catch (error) {
				return fail("malformed", { entity: "initial_workflow_lookup" }, error);
			}
			if (
				!nonEmpty(input.organizationId) ||
				!WORKFLOW_TYPES.has(input.workflowType) ||
				!nonEmpty(input.sourceType) ||
				!canonicalUuid(input.sourceId) ||
				!nonEmpty(input.submissionKey) ||
				!canonicalUuid(input.requesterEmployeeId)
			) {
				return fail("malformed", { entity: "initial_workflow_lookup" });
			}
			const expectedWorkflowId = deriveApprovalWorkflowId({
				organizationId: input.organizationId,
				workflowType: input.workflowType,
				sourceType: input.sourceType,
				sourceId: input.sourceId,
				allocationKey: input.submissionKey,
			});
			await acquireInitialSourceLock(dbService, input);
			let occupants: InitialSourceOccupants;
			try {
				occupants = await inspectInitialSourceOccupants(
					dbService,
					input,
					expectedWorkflowId,
				);
			} catch (error) {
				if (
					error instanceof ApprovalWorkflowRepositoryError &&
					error.code === "malformed"
				) {
					return { kind: "source_conflict" };
				}
				throw error;
			}
			if (occupants.pendingConflict) return { kind: "source_conflict" };
			if (!occupants.candidateExists) return { kind: "none" };
			try {
				const snapshot = await loadSnapshot(dbService, {
					organizationId: input.organizationId,
					workflowId: expectedWorkflowId,
				});
				const events = await loadInitialEvents(dbService, snapshot);
				const first = events[0];
				if (
					snapshot.organizationId !== input.organizationId ||
					snapshot.workflowType !== input.workflowType ||
					snapshot.sourceType !== input.sourceType ||
					snapshot.sourceId !== input.sourceId ||
					snapshot.requesterEmployeeId !== input.requesterEmployeeId ||
					!persistedValuesEqual(snapshot.contextSnapshot, contextSnapshot) ||
					!persistedValuesEqual(snapshot.displaySnapshot, displaySnapshot) ||
					!first ||
					first.version !== 1 ||
					first.eventIndex !== 0 ||
					first.idempotencyKey !== input.submissionKey ||
					first.id !==
						deriveApprovalEventId({
							organizationId: input.organizationId,
							workflowId: expectedWorkflowId,
							allocationKey: `${expectedWorkflowId}:event:1:0`,
						})
				) {
					return { kind: "source_conflict" };
				}
				return { kind: "existing", snapshot };
			} catch (error) {
				if (
					error instanceof ApprovalWorkflowRepositoryError &&
					(error.code === "not_found" ||
						error.code === "malformed" ||
						error.code === "persistence_count")
				) {
					return { kind: "source_conflict" };
				}
				throw error;
			}
		},
		loadSnapshot: (input) => loadSnapshot(dbService, input),
		async createInitialWorkflow(input) {
			const normalized = validateInitialApprovalWorkflowPersistenceInput(input);
			const snapshot = normalized.snapshot;
			await acquireInitialSourceLock(dbService, snapshot);
			let occupants: InitialSourceOccupants;
			try {
				occupants = await inspectInitialSourceOccupants(
					dbService,
					snapshot,
					snapshot.id,
				);
			} catch (error) {
				if (
					error instanceof ApprovalWorkflowRepositoryError &&
					error.code === "malformed"
				) {
					return { kind: "source_conflict" };
				}
				throw error;
			}
			if (occupants.pendingConflict) return { kind: "source_conflict" };
			if (occupants.candidateExists) {
				let persistedSnapshot: ApprovalWorkflowSnapshot;
				let persistedEvents: ApprovalWorkflowEventSnapshot[];
				try {
					persistedSnapshot = await loadSnapshot(dbService, {
						organizationId: snapshot.organizationId,
						workflowId: snapshot.id,
					});
					persistedEvents = await loadInitialEvents(dbService, snapshot);
				} catch (error) {
					if (
						error instanceof ApprovalWorkflowRepositoryError &&
						(error.code === "malformed" || error.code === "persistence_count")
					) {
						return { kind: "source_conflict" };
					}
					throw error;
				}
				if (
					!initialReplayMatches(normalized, persistedSnapshot, persistedEvents)
				) {
					return { kind: "source_conflict" };
				}
				return { kind: "existing", snapshot: persistedSnapshot };
			}
			const persisted = await persistInitialWorkflow(dbService, normalized);
			if (persisted === null) return { kind: "source_conflict" };
			return {
				kind: "created",
				snapshot: persisted,
			};
		},

		async claimCommand(input) {
			assertScope(input);
			if (!commandIdentityValid(input)) {
				fail("malformed", { entity: "command_identity" });
			}
			const timestamp = instantToDB(clock.nowInstant());
			const inserted = resultRows(
				await dbService.db.execute(sql`
				insert into approval_workflow_command (
					organization_id, workflow_id, idempotency_key,
					actor_fingerprint, command_fingerprint, state, result,
					created_at, updated_at
				) values (
					${input.organizationId}, ${input.workflowId}, ${input.idempotencyKey},
					${input.actorFingerprint}, ${input.commandFingerprint},
					${"reserved"}, null, ${timestamp}, ${timestamp}
				)
				on conflict (organization_id, workflow_id, idempotency_key) do nothing
				returning id
			`),
			);
			if (inserted.length === 1) {
				localReservations.add(receiptKey(input));
				return { kind: "reserved" };
			}
			if (inserted.length > 1) {
				return fail("command_invariant", { entity: "claim_insert" });
			}
			const receipt = oneRow(
				await dbService.db.execute(sql`
					select actor_fingerprint, command_fingerprint, state, result
					from approval_workflow_command
					where organization_id = ${input.organizationId}
						and workflow_id = ${input.workflowId}
						and idempotency_key = ${input.idempotencyKey}
					for update
				`),
				"command_invariant",
			);
			if (
				receipt.actor_fingerprint !== input.actorFingerprint ||
				receipt.command_fingerprint !== input.commandFingerprint
			) {
				return { kind: "fingerprint_mismatch" };
			}
			if (receipt.state === "reserved") {
				return fail("command_invariant", {
					entity: "visible_reserved_receipt",
				});
			}
			if (receipt.state !== "completed" || receipt.result === null) {
				return fail("command_invariant", { entity: "completed_receipt" });
			}
			const result = decodeApprovalCommandResult(receipt.result);
			assertResultReceiptScope(input, result);
			return {
				kind: "completed",
				result,
			};
		},

		async tryAdvanceVersion(input) {
			assertScope(input);
			if (!integer(input.expectedVersion) || input.expectedVersion < 0) {
				fail("malformed", { field: "expectedVersion" });
			}
			const advanced = resultRows(
				await dbService.db.execute(sql`
				update approval_workflow
				set version = version + 1
				where organization_id = ${input.organizationId}
					and id = ${input.workflowId}
					and version = ${input.expectedVersion}
				returning version
			`),
			);
			if (
				advanced.length === 1 &&
				isRecord(advanced[0]) &&
				advanced[0].version === input.expectedVersion + 1
			) {
				successfulCas.add(
					casKey(
						input.organizationId,
						input.workflowId,
						input.expectedVersion,
						input.expectedVersion + 1,
					),
				);
				return { kind: "advanced", version: input.expectedVersion + 1 };
			}
			if (advanced.length > 0) {
				return fail("cas_invariant", { entity: "root_version" });
			}
			const observed = resultRows(
				await dbService.db.execute(sql`
				select version from approval_workflow
				where organization_id = ${input.organizationId} and id = ${input.workflowId}
			`),
			);
			if (
				observed.length > 1 ||
				(observed.length === 1 &&
					(!isRecord(observed[0]) || !integer(observed[0].version)))
			) {
				return fail("cas_invariant", { entity: "observed_version" });
			}
			return {
				kind: "conflict",
				version:
					observed.length === 1
						? (observed[0] as { version: number }).version
						: null,
			};
		},

		async allocateTransitionIdentities(
			input,
		): Promise<ApprovalTransitionIdentityResolution[]> {
			assertScope(input);
			if (!Array.isArray(input.identityAllocations)) {
				return fail("malformed", { entity: "identity_allocations" });
			}
			const keys = new Set<string>();
			const ids = new Set<string>();
			return input.identityAllocations.map((allocation) => {
				if (
					!isRecord(allocation) ||
					!exactKeys(allocation, ["allocationKey", "entityKind"]) ||
					!nonEmpty(allocation.allocationKey) ||
					(allocation.entityKind !== "assignment" &&
						allocation.entityKind !== "event") ||
					keys.has(`${allocation.entityKind}\0${allocation.allocationKey}`)
				) {
					return fail("malformed", { entity: "identity_allocation" });
				}
				keys.add(`${allocation.entityKind}\0${allocation.allocationKey}`);
				const deriveIdentity =
					allocation.entityKind === "assignment"
						? deriveApprovalAssignmentId
						: deriveApprovalEventId;
				const id = deriveIdentity({
					organizationId: input.organizationId,
					workflowId: input.workflowId,
					allocationKey: allocation.allocationKey,
				});
				if (!canonicalUuid(id) || ids.has(id)) {
					return fail("malformed", { entity: "identity_resolution" });
				}
				ids.add(id);
				return {
					allocationKey: allocation.allocationKey,
					entityKind: allocation.entityKind,
					id,
				};
			});
		},

		async applyMaterializedTransition(plan) {
			try {
				validateMaterializedApprovalTransitionPlan(plan);
			} catch (error) {
				return fail("malformed", { entity: "materialized_plan" }, error);
			}
			assertMaterializedPlan(plan);
			const snapshot = plan.resultingSnapshot;
			const capability = casKey(
				snapshot.organizationId,
				snapshot.id,
				plan.expectedVersion,
				snapshot.version,
			);
			if (!successfulCas.has(capability)) {
				return fail("cas_invariant", { entity: "missing_successful_cas" });
			}
			await applyTransitionSql(dbService, plan);
			successfulCas.delete(capability);
		},

		async completeCommand(input) {
			assertScope(input);
			if (!commandIdentityValid(input)) {
				fail("malformed", { entity: "command_identity" });
			}
			assertResultReceiptScope(input, input.result);
			const key = receiptKey(input);
			if (!localReservations.has(key)) {
				fail("command_invariant", { entity: "command_reservation_ownership" });
			}
			const encoded = encodeApprovalCommandResult(input.result);
			const completed = resultRows(
				await dbService.db.execute(sql`
				update approval_workflow_command
				set state = ${"completed"},
					result = ${JSON.stringify(encoded)}::jsonb,
					updated_at = ${instantToDB(clock.nowInstant())}
				where organization_id = ${input.organizationId}
					and workflow_id = ${input.workflowId}
					and idempotency_key = ${input.idempotencyKey}
					and actor_fingerprint = ${input.actorFingerprint}
					and command_fingerprint = ${input.commandFingerprint}
					and state = 'reserved'
				returning id
			`),
			);
			if (completed.length !== 1 || !isRecord(completed[0])) {
				fail("command_invariant", { entity: "command_completion" });
			}
			localReservations.delete(key);
		},

		async applyObservedLegacyTransition(
			input,
		): Promise<ObservedLegacyTransitionResult> {
			const normalizedInput = normalizeObservedLegacyTransition(input);
			const planned = normalizeObservedPlan(
				await observationPlanner.plan(normalizedInput),
			);
			assertObservationVersionAuthority(normalizedInput, planned);
			assertObservationScope(normalizedInput, planned);
			assertObservedPlanDbInstants(planned);
			const keys = observationKeys(normalizedInput, planned.events.length);
			if (keys.length === 0) {
				return fail("malformed", { entity: "legacy_observation_events" });
			}
			const persistedResult: ObservedLegacyTransitionPlan = {
				...planned,
				events: planned.events.map((event, index) => ({
					...event,
					idempotencyKey:
						keys[index] ??
						fail("malformed", { entity: "legacy_observation_event_key" }),
				})),
			};
			if (normalizedInput.expectedVersion === null) {
				await acquireInitialSourceLock(dbService, persistedResult.snapshot);
				const occupants = await inspectInitialSourceOccupants(
					dbService,
					persistedResult.snapshot,
					persistedResult.snapshot.id,
				);
				if (occupants.pendingConflict) {
					fail("source_conflict", { entity: "observed_initial_source" });
				}
				if (occupants.candidateExists) {
					const winner = await verifyObservedWinner(
						dbService,
						persistedResult,
						keys,
					);
					return {
						...winner,
						eventPersistence: {
							kind: "aggregate_and_events_persisted",
							eventIds: winner.events.map((event) => event.id),
						},
					};
				}
			}
			const wonRoot = await tryWinObservedRoot(
				dbService,
				normalizedInput,
				persistedResult,
			);
			if (!wonRoot) {
				const winner = await verifyObservedWinner(
					dbService,
					persistedResult,
					keys,
				);
				return {
					...winner,
					eventPersistence: {
						kind: "aggregate_and_events_persisted",
						eventIds: winner.events.map((event) => event.id),
					},
				};
			}
			await persistObservedChildren(dbService, persistedResult);
			const persistedEvents = await persistObservedEvents(
				dbService,
				normalizedInput,
				persistedResult,
				keys,
			);
			return {
				...persistedResult,
				events: persistedEvents,
				eventPersistence: {
					kind: "aggregate_and_events_persisted",
					eventIds: persistedEvents.map((event) => event.id),
				},
			};
		},
	};
}

export function createApprovalWorkflowRepository(
	input: CreateApprovalWorkflowRepositoryInput,
): ApprovalWorkflowRepository {
	const activationResolver =
		input.activationResolver ?? createDatabaseStageActivationResolver();

	return {
		withTransaction<T>(
			operation: (context: ApprovalWorkflowTransactionContext) => Promise<T>,
		): Promise<T> {
			return input.db.transaction(async (transaction) => {
				const dbService: ApprovalDbService = { db: transaction };
				const localReservations = new Set<string>();
				const successfulCas = new Set<string>();
				const repository = createTransactionalRepository(
					dbService,
					input.clock ?? systemClock,
					input.observationPlanner,
					localReservations,
					successfulCas,
				);
				const writeGate = createApprovalWriteGate(dbService);
				const projectionWriter = createApprovalProjectionWriter(dbService);
				const outboxWriter = createApprovalOutboxWriter(dbService);
				const compatibilityWriter = createApprovalCompatibilityWriter({
					writeGate,
					repository,
					projectionWriter,
					outboxWriter,
					legacyPersistence: createTransactionBoundLegacyApprovalPersistence({
						dbService,
						rowWriter: input.createLegacyRowWriter(dbService),
					}),
				});
				const result = await operation({
					dbService,
					writeGate,
					repository,
					adapterRegistry: input.adapterRegistry,
					activationResolver,
					projectionWriter,
					compatibilityWriter,
					outboxWriter,
				});
				if (localReservations.size > 0) {
					fail("command_invariant", { entity: "uncompleted_reservation" });
				}
				if (successfulCas.size > 0) {
					fail("cas_invariant", { entity: "unmaterialized_successful_cas" });
				}
				return result;
			});
		},
	};
}
