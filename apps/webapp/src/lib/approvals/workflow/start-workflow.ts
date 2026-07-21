import { sql } from "drizzle-orm";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import type {
	ApprovalDisplayProjection,
	ApprovalWorkflowTransactionContext,
} from "../domain-adapters/types";
import type {
	ApprovalPolicyConditionDraft,
	ApprovalPolicyDraft,
} from "../policies/types";
import type { ApprovalProjectionWriteInput } from "../projection/contracts";
import { ApprovalStageActivationError } from "../routing/approver-resolver";
import { findMatchingRoutingPolicy } from "../routing/policy-matcher";
import type { ApprovalRoutingContext } from "../routing/types";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
} from "./identity";
import type {
	ApprovalEventActorIdentity,
	ApprovalMaterializedTransitionPlan,
	ApprovalOutboxWriteInput,
	ApprovalOutboxWriteResult,
	ApprovalSourceIdentity,
	ApprovalTransitionPlan,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
	ApprovalWorkflowType,
	JsonObject,
	ResolvedStage,
} from "./ports";
import { normalizeStableData } from "./stable-data";
import {
	fingerprintApprovalCommandActor,
	materializeApprovalTransitionPlan,
	planStageActivation,
} from "./state-machine";

export type ApprovalWorkflowStartErrorCode =
	| "INVALID_INPUT"
	| "WRITE_GATE_REJECTED"
	| "INVALID_POLICY"
	| "NO_DEFAULT_APPROVER"
	| "ACTIVATION_FAILED"
	| "ACTIVATION_LIMIT"
	| "SOURCE_CONFLICT"
	| "SOURCE_BINDING_MISMATCH";

export class ApprovalWorkflowStartError extends Error {
	constructor(
		readonly code: ApprovalWorkflowStartErrorCode,
		readonly details: Readonly<JsonObject> = {},
		options?: ErrorOptions,
	) {
		super(`Approval workflow start: ${code}`, options);
		this.name = "ApprovalWorkflowStartError";
	}
}

export interface ApprovalSourceWorkflowLinkEvidence {
	organizationId: string;
	sourceType: string;
	sourceId: string;
	workflowId: string;
	affectedRows: number;
}

export interface StartApprovalWorkflowInput {
	context: ApprovalWorkflowTransactionContext;
	organizationId: string;
	workflowType: ApprovalWorkflowType;
	sourceIdentity: ApprovalSourceIdentity;
	requesterEmployeeId: string;
	actor: ApprovalEventActorIdentity;
	submissionKey: string;
	defaultApproverEmployeeId: string | null;
	routingContext: ApprovalRoutingContext;
	/** Detached private domain evidence persisted with the workflow. */
	contextSnapshot?: JsonObject;
	/** Adds immutable result evidence after initial planning and before persistence. */
	finalizeContextSnapshot?(input: {
		snapshot: ApprovalWorkflowSnapshot;
		contextSnapshot: JsonObject;
	}): JsonObject;
	displayProjection: ApprovalDisplayProjection;
	bindSourceWorkflow(
		workflowId: string,
	): Promise<ApprovalSourceWorkflowLinkEvidence>;
	verifySourceWorkflow(
		workflowId: string,
	): Promise<ApprovalSourceWorkflowLinkEvidence>;
}

export interface StartApprovalWorkflowResult {
	kind: "created" | "existing";
	status: ApprovalWorkflowSnapshot["status"];
	terminal: boolean;
	snapshot: ApprovalWorkflowSnapshot;
	events: ApprovalWorkflowEventSnapshot[];
	projection: ApprovalProjectionWriteInput;
	outbox: ApprovalOutboxWriteInput[];
	outboxResults: ApprovalOutboxWriteResult[];
}

const CANONICAL_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKFLOW_TYPES = new Set<ApprovalWorkflowType>([
	"absence",
	"time_correction",
	"manual_time_submission",
	"policy_clock_out",
	"travel_expense",
	"shift_request",
	"compliance_exception",
]);

function fail(
	code: ApprovalWorkflowStartErrorCode,
	details: JsonObject = {},
	cause?: unknown,
): never {
	throw new ApprovalWorkflowStartError(code, details, { cause });
}

function nonEmpty(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function canonicalUuid(value: unknown): value is string {
	return typeof value === "string" && CANONICAL_UUID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: object, keys: readonly string[]): boolean {
	const actual = Reflect.ownKeys(value);
	return (
		actual.length === keys.length &&
		actual.every((key) => typeof key === "string" && keys.includes(key))
	);
}

function cloneJson(value: unknown, ancestors = new Set<object>()): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "object" || ancestors.has(value)) {
		return fail("INVALID_INPUT", { field: "json" });
	}
	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			if (Reflect.ownKeys(value).length !== value.length + 1) {
				return fail("INVALID_INPUT", { field: "json" });
			}
			return value.map((item, index) => {
				if (!Object.hasOwn(value, index)) {
					return fail("INVALID_INPUT", { field: "json" });
				}
				return cloneJson(item, ancestors);
			});
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return fail("INVALID_INPUT", { field: "json" });
		}
		const clone: Record<string, unknown> = {};
		for (const key of Reflect.ownKeys(value)) {
			if (typeof key !== "string")
				return fail("INVALID_INPUT", { field: "json" });
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) {
				return fail("INVALID_INPUT", { field: "json" });
			}
			clone[key] = cloneJson(descriptor.value, ancestors);
		}
		return clone;
	} finally {
		ancestors.delete(value);
	}
}

function validateInput(input: StartApprovalWorkflowInput): void {
	const source = input.sourceIdentity;
	const routing = input.routingContext;
	const routingSource = routing?.source;
	const display = input.displayProjection;
	if (
		!isRecord(input) ||
		!nonEmpty(input.organizationId) ||
		!WORKFLOW_TYPES.has(input.workflowType) ||
		!isRecord(source) ||
		!exactKeys(source, [
			"organizationId",
			"workflowType",
			"sourceType",
			"sourceId",
		]) ||
		!nonEmpty(source.sourceType) ||
		!canonicalUuid(source.sourceId) ||
		!canonicalUuid(input.requesterEmployeeId) ||
		!nonEmpty(input.submissionKey) ||
		(input.defaultApproverEmployeeId !== null &&
			!canonicalUuid(input.defaultApproverEmployeeId)) ||
		!isRecord(routing) ||
		!exactKeys(routing, [
			"organizationId",
			"workflowType",
			"source",
			"requesterEmployeeId",
			"teamIds",
			"locationId",
			"absenceCategoryId",
			"travelExpenseAmount",
			"overtimeRisk",
			"employeeGroupIds",
		]) ||
		!isRecord(routingSource) ||
		!exactKeys(routingSource, ["type", "id"]) ||
		!nonEmpty(routingSource.type) ||
		!canonicalUuid(routingSource.id) ||
		!Array.isArray(routing.teamIds) ||
		!routing.teamIds.every(canonicalUuid) ||
		!Array.isArray(routing.employeeGroupIds) ||
		!routing.employeeGroupIds.every(canonicalUuid) ||
		(routing.locationId !== null && !canonicalUuid(routing.locationId)) ||
		(routing.absenceCategoryId !== null &&
			!canonicalUuid(routing.absenceCategoryId)) ||
		(routing.travelExpenseAmount !== null &&
			(typeof routing.travelExpenseAmount !== "number" ||
				!Number.isFinite(routing.travelExpenseAmount))) ||
		(routing.overtimeRisk !== null &&
			routing.overtimeRisk !== "none" &&
			routing.overtimeRisk !== "warning" &&
			routing.overtimeRisk !== "violation") ||
		!isRecord(display) ||
		!exactKeys(display, ["displayPayload", "searchText"]) ||
		!isRecord(display.displayPayload) ||
		typeof display.searchText !== "string" ||
		typeof input.bindSourceWorkflow !== "function" ||
		typeof input.verifySourceWorkflow !== "function"
	) {
		fail("INVALID_INPUT");
	}
	if (
		source.organizationId !== input.organizationId ||
		source.workflowType !== input.workflowType ||
		routing.organizationId !== input.organizationId ||
		routing.workflowType !== input.workflowType ||
		routing.requesterEmployeeId !== input.requesterEmployeeId ||
		routingSource.type !== source.sourceType ||
		routingSource.id !== source.sourceId
	) {
		fail("INVALID_INPUT", { field: "identity" });
	}
	cloneJson(routing);
	if (input.contextSnapshot !== undefined) {
		if (!isRecord(input.contextSnapshot)) {
			fail("INVALID_INPUT", { field: "contextSnapshot" });
		}
		cloneJson(input.contextSnapshot);
	}
	cloneJson(display.displayPayload);
	const actor = input.actor;
	if (
		!isRecord(actor) ||
		!exactKeys(actor, ["kind", "employeeId", "userId"]) ||
		(actor.kind === "employee"
			? !canonicalUuid(actor.employeeId) ||
				(actor.userId !== null && !nonEmpty(actor.userId))
			: actor.kind !== "system" ||
				actor.employeeId !== null ||
				actor.userId !== null)
	) {
		fail("INVALID_INPUT", { field: "actor" });
	}
}

interface StartStageDraft {
	label: string;
	resolverSnapshot: JsonObject;
}

const CONDITION_TYPES = new Set([
	"approval_type",
	"team",
	"location",
	"absence_category",
	"travel_expense_amount",
	"overtime_risk",
	"employee_group",
]);
const CONDITION_OPERATORS = new Set(["equals", "in", "gte", "lte", "between"]);
const APPROVER_TYPES = new Set([
	"direct_manager",
	"manager_manager",
	"org_admin",
	"specific_employee",
]);
const FALLBACKS = new Set(["fail", "default_manager", "organization_admin"]);

export const APPROVAL_WORKFLOW_START_POLICY_LIMITS: Readonly<{
	maxPolicies: number;
	maxConditionsPerPolicy: number;
	maxStagesPerPolicy: number;
	maxAggregateRows: number;
	maxJsonBytes: number;
}> = Object.freeze({
	maxPolicies: 64,
	maxConditionsPerPolicy: 32,
	maxStagesPerPolicy: 16,
	maxAggregateRows: 1_024,
	maxJsonBytes: 512 * 1_024,
});

function decodeCondition(
	value: unknown,
	organizationId: string,
	policyId: string,
): ApprovalPolicyConditionDraft {
	if (!isRecord(value)) fail("INVALID_POLICY", { field: "condition" });
	const baseKeys = [
		"id",
		"organizationId",
		"policyId",
		"conditionType",
		"operator",
	] as const;
	if (
		!canonicalUuid(value.id) ||
		value.organizationId !== organizationId ||
		value.policyId !== policyId ||
		!CONDITION_TYPES.has(String(value.conditionType)) ||
		!CONDITION_OPERATORS.has(String(value.operator))
	) {
		fail("INVALID_POLICY", { field: "condition" });
	}
	const isAmount = value.conditionType === "travel_expense_amount";
	const expectedKeys = isAmount
		? value.operator === "gte"
			? [...baseKeys, "amountMin"]
			: value.operator === "lte"
				? [...baseKeys, "amountMax"]
				: value.operator === "between"
					? [...baseKeys, "amountMin", "amountMax"]
					: null
		: value.operator === "equals"
			? [...baseKeys, "value"]
			: value.operator === "in"
				? [...baseKeys, "values"]
				: null;
	if (!expectedKeys || !exactKeys(value, expectedKeys)) {
		fail("INVALID_POLICY", { field: "condition.shape" });
	}
	const condition: ApprovalPolicyConditionDraft = {
		conditionType:
			value.conditionType as ApprovalPolicyConditionDraft["conditionType"],
		operator: value.operator as ApprovalPolicyConditionDraft["operator"],
	};
	if ("value" in value) {
		if (!nonEmpty(value.value))
			fail("INVALID_POLICY", { field: "condition.value" });
		condition.value = value.value;
	}
	if ("values" in value) {
		if (
			!Array.isArray(value.values) ||
			value.values.length === 0 ||
			!value.values.every(nonEmpty)
		) {
			fail("INVALID_POLICY", { field: "condition.values" });
		}
		condition.values = [...value.values];
	}
	for (const field of ["amountMin", "amountMax"] as const) {
		if (!(field in value)) continue;
		if (typeof value[field] !== "number" || !Number.isFinite(value[field])) {
			fail("INVALID_POLICY", { field: `condition.${field}` });
		}
		condition[field] = value[field];
	}
	return condition;
}

function decodePolicies(
	value: unknown,
	organizationId: string,
): ApprovalPolicyDraft[] {
	if (
		!Array.isArray(value) ||
		value.length > APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxPolicies
	) {
		fail("INVALID_POLICY", { field: "policies" });
	}
	let aggregateRows = value.length;
	for (const raw of value) {
		if (!isRecord(raw)) fail("INVALID_POLICY", { field: "policy" });
		if (
			!Array.isArray(raw.conditions) ||
			raw.conditions.length >
				APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxConditionsPerPolicy
		) {
			fail("INVALID_POLICY", { field: "policy.conditions" });
		}
		if (
			!Array.isArray(raw.stages) ||
			raw.stages.length >
				APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxStagesPerPolicy
		) {
			fail("INVALID_POLICY", { field: "policy.stages" });
		}
		aggregateRows += raw.conditions.length + raw.stages.length;
		if (
			aggregateRows > APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxAggregateRows
		) {
			fail("INVALID_POLICY", { field: "policy.aggregate" });
		}
	}
	const policyIds = new Set<string>();
	const priorities = new Set<number>();
	const policies = value.map((raw): ApprovalPolicyDraft => {
		if (
			!isRecord(raw) ||
			!exactKeys(raw, [
				"id",
				"organizationId",
				"name",
				"isActive",
				"priority",
				"conditions",
				"stages",
			]) ||
			!canonicalUuid(raw.id) ||
			policyIds.has(raw.id) ||
			raw.organizationId !== organizationId ||
			!nonEmpty(raw.name) ||
			raw.isActive !== true ||
			!Number.isInteger(raw.priority) ||
			priorities.has(raw.priority as number) ||
			!Array.isArray(raw.conditions) ||
			!Array.isArray(raw.stages) ||
			raw.stages.length === 0
		) {
			fail("INVALID_POLICY", { field: "policy" });
		}
		policyIds.add(raw.id);
		priorities.add(raw.priority as number);
		const conditionIds = new Set<string>();
		const conditions = raw.conditions.map((condition) => {
			if (
				!isRecord(condition) ||
				!canonicalUuid(condition.id) ||
				conditionIds.has(condition.id)
			) {
				fail("INVALID_POLICY", { field: "condition.id" });
			}
			conditionIds.add(condition.id);
			return decodeCondition(condition, organizationId, raw.id as string);
		});
		const stageIds = new Set<string>();
		const stages = raw.stages.map((stage, index) => {
			if (
				!isRecord(stage) ||
				!exactKeys(stage, [
					"id",
					"organizationId",
					"policyId",
					"stepOrder",
					"label",
					"approverType",
					"approverEmployeeId",
					"fallbackBehavior",
				]) ||
				!canonicalUuid(stage.id) ||
				stageIds.has(stage.id) ||
				stage.organizationId !== organizationId ||
				stage.policyId !== raw.id ||
				stage.stepOrder !== index + 1 ||
				!nonEmpty(stage.label) ||
				!APPROVER_TYPES.has(String(stage.approverType)) ||
				!FALLBACKS.has(String(stage.fallbackBehavior)) ||
				(stage.approverType === "specific_employee"
					? !canonicalUuid(stage.approverEmployeeId)
					: stage.approverEmployeeId !== null)
			) {
				fail("INVALID_POLICY", { field: "stage" });
			}
			stageIds.add(stage.id);
			return {
				id: stage.id,
				stepOrder: stage.stepOrder,
				label: stage.label,
				approverType:
					stage.approverType as ApprovalPolicyDraft["stages"][number]["approverType"],
				...(stage.approverEmployeeId === null
					? {}
					: { approverEmployeeId: stage.approverEmployeeId as string }),
				fallbackBehavior:
					stage.fallbackBehavior as ApprovalPolicyDraft["stages"][number]["fallbackBehavior"],
			};
		});
		return {
			id: raw.id,
			organizationId,
			name: raw.name,
			isActive: true,
			priority: raw.priority as number,
			conditions,
			stages,
		};
	});
	for (let index = 1; index < policies.length; index += 1) {
		const previous = policies[index - 1];
		const current = policies[index];
		if (
			!previous ||
			!current ||
			previous.priority > current.priority ||
			(previous.priority === current.priority && previous.id >= current.id)
		) {
			fail("INVALID_POLICY", { field: "policy.order" });
		}
	}
	return policies;
}

function defaultStages(input: StartApprovalWorkflowInput): StartStageDraft[] {
	if (input.defaultApproverEmployeeId === null) fail("NO_DEFAULT_APPROVER");
	return [
		{
			label: "Approval",
			resolverSnapshot: {
				approverType: "specific_employee",
				fallbackBehavior: "fail",
				approverEmployeeId: input.defaultApproverEmployeeId,
			},
		},
	];
}

function identityResolutions(
	organizationId: string,
	workflowId: string,
	allocations: ReturnType<typeof planStageActivation>["identityAllocations"],
) {
	return allocations.map((allocation) => ({
		...allocation,
		id:
			allocation.entityKind === "assignment"
				? deriveApprovalAssignmentId({
						organizationId,
						workflowId,
						allocationKey: allocation.allocationKey,
					})
				: deriveApprovalEventId({
						organizationId,
						workflowId,
						allocationKey: allocation.allocationKey,
					}),
	}));
}

function sourceLinkMatches(
	evidence: ApprovalSourceWorkflowLinkEvidence,
	input: StartApprovalWorkflowInput,
	workflowId: string,
): boolean {
	return (
		isRecord(evidence) &&
		exactKeys(evidence, [
			"organizationId",
			"sourceType",
			"sourceId",
			"workflowId",
			"affectedRows",
		]) &&
		evidence.affectedRows === 1 &&
		evidence.organizationId === input.organizationId &&
		evidence.sourceType === input.sourceIdentity.sourceType &&
		evidence.sourceId === input.sourceIdentity.sourceId &&
		evidence.workflowId === workflowId
	);
}

function buildProjection(
	snapshot: ApprovalWorkflowSnapshot,
	display: ApprovalDisplayProjection,
	updatedAt: ApprovalWorkflowEventSnapshot["occurredAt"],
): ApprovalProjectionWriteInput {
	const current = snapshot.stages.find(
		(stage) => stage.sequence === snapshot.currentStageOrder,
	);
	return {
		organizationId: snapshot.organizationId,
		workflowId: snapshot.id,
		workflowType: snapshot.workflowType,
		sourceType: snapshot.sourceType,
		sourceId: snapshot.sourceId,
		status: snapshot.status,
		currentStageOrder: snapshot.currentStageOrder,
		requesterEmployeeId: snapshot.requesterEmployeeId,
		displayPayload: cloneJson(display.displayPayload) as JsonObject,
		searchText: display.searchText,
		activeInboxStage:
			snapshot.status === "pending" && current?.status === "pending"
				? { stageId: current.id, stageOrder: current.sequence }
				: null,
		updatedAt,
	};
}

function freezeDeep<Value>(value: Value, seen = new Set<object>()): Value {
	if (typeof value !== "object" || value === null || seen.has(value))
		return value;
	seen.add(value);
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor && "value" in descriptor) freezeDeep(descriptor.value, seen);
	}
	return Object.freeze(value);
}

function cloneWorkflowForResolver(
	snapshot: ApprovalWorkflowSnapshot,
): ApprovalWorkflowSnapshot {
	return freezeDeep({
		...snapshot,
		policySnapshot: cloneJson(snapshot.policySnapshot) as JsonObject,
		contextSnapshot: cloneJson(snapshot.contextSnapshot) as JsonObject,
		displaySnapshot: cloneJson(snapshot.displaySnapshot) as JsonObject,
		submittedAt: parseInstant(snapshot.submittedAt.toString()),
		completedAt: snapshot.completedAt
			? parseInstant(snapshot.completedAt.toString())
			: null,
		cancelledAt: snapshot.cancelledAt
			? parseInstant(snapshot.cancelledAt.toString())
			: null,
		stages: snapshot.stages.map((stage) => ({
			...stage,
			resolverSnapshot: cloneJson(stage.resolverSnapshot) as JsonObject,
			activatedAt: stage.activatedAt
				? parseInstant(stage.activatedAt.toString())
				: null,
			decidedAt: stage.decidedAt
				? parseInstant(stage.decidedAt.toString())
				: null,
			assignments: stage.assignments.map((assignment) => ({
				...assignment,
				assignedAt: parseInstant(assignment.assignedAt.toString()),
				resolvedAt: assignment.resolvedAt
					? parseInstant(assignment.resolvedAt.toString())
					: null,
				resolvedBy: assignment.resolvedBy ? { ...assignment.resolvedBy } : null,
				reassignmentMetadata: assignment.reassignmentMetadata
					? (cloneJson(assignment.reassignmentMetadata) as JsonObject)
					: null,
			})),
		})),
	});
}

function finalizeWorkflowContext(
	finalize: NonNullable<StartApprovalWorkflowInput["finalizeContextSnapshot"]>,
	snapshot: ApprovalWorkflowSnapshot,
	contextSnapshot: JsonObject,
): JsonObject {
	try {
		const finalized = finalize({
			snapshot: cloneWorkflowForResolver(snapshot),
			contextSnapshot: freezeDeep(cloneJson(contextSnapshot) as JsonObject),
		});
		if (!isRecord(finalized)) {
			return fail("INVALID_INPUT", { field: "finalizeContextSnapshot" });
		}
		const detached = cloneJson(finalized);
		if (!isRecord(detached)) {
			return fail("INVALID_INPUT", { field: "finalizeContextSnapshot" });
		}
		return normalizeStableData(detached) as JsonObject;
	} catch (error) {
		if (error instanceof ApprovalWorkflowStartError) throw error;
		return fail("INVALID_INPUT", { field: "finalizeContextSnapshot" }, error);
	}
}

export async function startApprovalWorkflow(
	input: StartApprovalWorkflowInput,
): Promise<StartApprovalWorkflowResult> {
	validateInput(input);
	const gate = await input.context.writeGate.acquire({
		organizationId: input.organizationId,
		workflowType: input.workflowType,
	});
	if (
		(gate.mode !== "canonical" && gate.mode !== "complete") ||
		!gate.behavior.decideCanonical ||
		!gate.behavior.writeCanonical
	) {
		fail("WRITE_GATE_REJECTED", { mode: gate.mode });
	}
	const submissionContextSnapshot = normalizeStableData(
		input.contextSnapshot ?? input.routingContext,
	) as JsonObject;
	const submissionDisplaySnapshot = normalizeStableData(
		input.displayProjection,
	) as JsonObject;
	const initial = await input.context.repository.findInitialWorkflow({
		organizationId: input.organizationId,
		workflowType: input.workflowType,
		sourceType: input.sourceIdentity.sourceType,
		sourceId: input.sourceIdentity.sourceId,
		submissionKey: input.submissionKey,
		requesterEmployeeId: input.requesterEmployeeId,
		contextSnapshot: submissionContextSnapshot,
		displaySnapshot: submissionDisplaySnapshot,
	});
	if (initial.kind === "source_conflict") return fail("SOURCE_CONFLICT");
	if (initial.kind === "existing") {
		const evidence = await input.verifySourceWorkflow(initial.snapshot.id);
		if (!sourceLinkMatches(evidence, input, initial.snapshot.id)) {
			return fail("SOURCE_BINDING_MISMATCH");
		}
		return {
			kind: "existing",
			status: initial.snapshot.status,
			terminal: initial.snapshot.status !== "pending",
			snapshot: initial.snapshot,
			events: [],
			projection: buildProjection(
				initial.snapshot,
				input.displayProjection,
				initial.snapshot.completedAt ?? initial.snapshot.submittedAt,
			),
			outbox: [],
			outboxResults: [],
		};
	}
	const policyResult = await input.context.dbService.db.execute(sql`
		select coalesce(json_agg(policy_row.value order by policy_row.priority, policy_row.id), '[]'::json) as policies
		from (
			select policy.priority, policy.id, jsonb_build_object(
				'id', policy.id,
				'organizationId', policy.organization_id,
				'name', policy.name,
				'isActive', policy.is_active,
				'priority', policy.priority,
				'conditions', coalesce((
					select json_agg(jsonb_strip_nulls(jsonb_build_object(
						'id', condition.id,
						'organizationId', condition.organization_id,
						'policyId', condition.policy_id,
						'conditionType', condition.condition_type,
						'operator', condition.operator,
						'value', condition.value_json -> 'value',
						'values', condition.value_json -> 'values',
						'amountMin', condition.amount_min::double precision,
						'amountMax', condition.amount_max::double precision
					)) order by condition.id)
					from (
						select * from approval_policy_condition
						where organization_id = ${input.organizationId}
							and policy_id = policy.id
						order by id
						limit ${APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxConditionsPerPolicy + 1}
					) condition
				), '[]'::json),
				'stages', coalesce((
					select json_agg(json_build_object(
						'id', stage.id,
						'organizationId', stage.organization_id,
						'policyId', stage.policy_id,
						'stepOrder', stage.step_order,
						'label', stage.label,
						'approverType', stage.approver_type,
						'approverEmployeeId', stage.approver_employee_id,
						'fallbackBehavior', stage.fallback_behavior
					) order by stage.step_order, stage.id)
					from (
						select * from approval_policy_stage
						where organization_id = ${input.organizationId}
							and policy_id = policy.id
						order by step_order, id
						limit ${APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxStagesPerPolicy + 1}
					) stage
				), '[]'::json)
			) as value
			from (
				select * from approval_policy
				where organization_id = ${input.organizationId}
					and is_active = true
				order by priority, id
				limit ${APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxPolicies + 1}
			) policy
		) policy_row
	`);
	if (
		!isRecord(policyResult) ||
		!Array.isArray(policyResult.rows) ||
		policyResult.rows.length !== 1 ||
		!isRecord(policyResult.rows[0]) ||
		!Array.isArray(policyResult.rows[0].policies)
	) {
		return fail("INVALID_POLICY", { field: "query_result" });
	}
	let policyJsonBytes: number;
	try {
		policyJsonBytes = new TextEncoder().encode(
			JSON.stringify(policyResult.rows[0].policies),
		).byteLength;
	} catch (error) {
		return fail("INVALID_POLICY", { field: "policy.json" }, error);
	}
	if (policyJsonBytes > APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxJsonBytes) {
		return fail("INVALID_POLICY", { field: "policy.json" });
	}
	let policies: ApprovalPolicyDraft[];
	let matchedPolicy: ApprovalPolicyDraft | null;
	try {
		policies = decodePolicies(
			policyResult.rows[0].policies,
			input.organizationId,
		);
		matchedPolicy = findMatchingRoutingPolicy(input.routingContext, policies);
	} catch (error) {
		if (error instanceof ApprovalWorkflowStartError) throw error;
		return fail("INVALID_POLICY", {}, error);
	}
	const stages: StartStageDraft[] = matchedPolicy
		? matchedPolicy.stages.map((stage) => ({
				label: stage.label,
				resolverSnapshot: {
					approverType: stage.approverType,
					fallbackBehavior: stage.fallbackBehavior,
					...(stage.approverEmployeeId
						? { approverEmployeeId: stage.approverEmployeeId }
						: {}),
				},
			}))
		: defaultStages(input);
	const workflowId = deriveApprovalWorkflowId({
		organizationId: input.organizationId,
		workflowType: input.workflowType,
		sourceType: input.sourceIdentity.sourceType,
		sourceId: input.sourceIdentity.sourceId,
		allocationKey: input.submissionKey,
	});
	const now = systemClock.nowInstant();
	let snapshot: ApprovalWorkflowSnapshot = {
		id: workflowId,
		organizationId: input.organizationId,
		workflowType: input.workflowType,
		sourceType: input.sourceIdentity.sourceType,
		sourceId: input.sourceIdentity.sourceId,
		requesterEmployeeId: input.requesterEmployeeId,
		status: "pending",
		currentStageOrder: 1,
		version: 0,
		policySnapshot: matchedPolicy
			? (cloneJson(matchedPolicy) as JsonObject)
			: {
					kind: "default",
					defaultApproverEmployeeId: input.defaultApproverEmployeeId,
				},
		contextSnapshot: cloneJson(submissionContextSnapshot) as JsonObject,
		displaySnapshot: cloneJson(submissionDisplaySnapshot) as JsonObject,
		submittedAt: now,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: stages.map((stage, index) => {
			const sequence = index + 1;
			return {
				id: deriveApprovalStageId({
					organizationId: input.organizationId,
					workflowId,
					allocationKey: `stage:${sequence}`,
				}),
				organizationId: input.organizationId,
				workflowId,
				sequence,
				label: stage.label,
				resolverSnapshot: cloneJson(stage.resolverSnapshot) as JsonObject,
				activationMode: "human",
				status: "waiting",
				activatedAt: null,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [],
			};
		}),
	};
	const events: ApprovalWorkflowEventSnapshot[] = [];
	for (let pass = 0; pass < stages.length + 1; pass += 1) {
		if (snapshot.status !== "pending") break;
		const stage = snapshot.stages.find(
			(candidate) => candidate.sequence === snapshot.currentStageOrder,
		);
		if (stage?.status !== "waiting") break;
		let resolved: ResolvedStage;
		try {
			const resolverWorkflow = cloneWorkflowForResolver(snapshot);
			const resolverStage = resolverWorkflow.stages.find(
				(candidate) => candidate.id === stage.id,
			);
			if (!resolverStage) {
				return fail("ACTIVATION_FAILED", {
					activationCode: "resolver_failure",
				});
			}
			resolved = await input.context.activationResolver.resolve({
				dbService: input.context.dbService,
				organizationId: input.organizationId,
				workflow: resolverWorkflow,
				stage: resolverStage,
				actor: { kind: "system", employeeId: null, userId: null },
				routingContext: freezeDeep(
					cloneJson(input.routingContext) as JsonObject,
				),
			});
		} catch (error) {
			return fail("ACTIVATION_FAILED", {
				activationCode:
					error instanceof ApprovalStageActivationError
						? error.code
						: "resolver_failure",
			});
		}
		let plan: ApprovalTransitionPlan;
		try {
			plan = planStageActivation(snapshot, resolved, now);
		} catch {
			return fail("ACTIVATION_FAILED", {
				activationCode: "invalid_activation_plan",
			});
		}
		const systemActor = {
			kind: "system" as const,
			employeeId: null,
			userId: null,
		};
		let materialized: ApprovalMaterializedTransitionPlan;
		try {
			materialized = materializeApprovalTransitionPlan(
				plan,
				identityResolutions(
					input.organizationId,
					workflowId,
					plan.identityAllocations,
				),
				{
					receipt: {
						organizationId: input.organizationId,
						workflowId,
						idempotencyKey: input.submissionKey,
						actorFingerprint: fingerprintApprovalCommandActor(systemActor),
						commandFingerprint: "approval-workflow-start",
					},
					actor: systemActor,
				},
			);
		} catch {
			return fail("ACTIVATION_FAILED", {
				activationCode: "invalid_activation_plan",
			});
		}
		snapshot = materialized.resultingSnapshot;
		for (const event of materialized.events) {
			const { persistenceMetadata: _persistenceMetadata, ...persisted } = event;
			events.push({
				...persisted,
				idempotencyKey:
					events.length === 0
						? input.submissionKey
						: `${input.submissionKey}:${events.length}`,
			});
		}
		if (materialized.nextAction.kind !== "needs_activation") break;
		if (pass === stages.length) return fail("ACTIVATION_LIMIT");
	}
	if (
		snapshot.status === "pending" &&
		snapshot.stages.find(
			(stage) => stage.sequence === snapshot.currentStageOrder,
		)?.status === "waiting"
	) {
		return fail("ACTIVATION_LIMIT");
	}
	if (input.finalizeContextSnapshot) {
		snapshot = {
			...snapshot,
			contextSnapshot: finalizeWorkflowContext(
				input.finalizeContextSnapshot,
				snapshot,
				submissionContextSnapshot,
			),
		};
	}
	const persisted = await input.context.repository.createInitialWorkflow({
		snapshot,
		events,
		submissionKey: input.submissionKey,
	});
	if (persisted.kind === "source_conflict") return fail("SOURCE_CONFLICT");
	const currentSnapshot = persisted.snapshot;
	const updatedAt = events.at(-1)?.occurredAt ?? now;
	const projection = buildProjection(
		currentSnapshot,
		input.displayProjection,
		updatedAt,
	);
	const outbox: ApprovalOutboxWriteInput[] = events.map((event) => ({
		organizationId: input.organizationId,
		workflowId,
		eventId: event.id,
		eventType: event.eventType,
		dedupeKey: `observe:${event.id}`,
		payload: {
			organizationId: input.organizationId,
			workflowId,
			sourceType: input.sourceIdentity.sourceType,
			sourceId: input.sourceIdentity.sourceId,
			requesterEmployeeId: input.requesterEmployeeId,
			eventId: event.id,
			eventType: event.eventType,
		},
		disposition: "observe",
		createdAt: event.occurredAt,
	}));
	if (persisted.kind === "existing") {
		const evidence = await input.verifySourceWorkflow(currentSnapshot.id);
		if (!sourceLinkMatches(evidence, input, currentSnapshot.id)) {
			return fail("SOURCE_BINDING_MISMATCH");
		}
		return {
			kind: "existing",
			status: currentSnapshot.status,
			terminal: currentSnapshot.status !== "pending",
			snapshot: currentSnapshot,
			events,
			projection,
			outbox,
			outboxResults: [],
		};
	}
	const evidence = await input.bindSourceWorkflow(currentSnapshot.id);
	if (!sourceLinkMatches(evidence, input, currentSnapshot.id)) {
		return fail("SOURCE_BINDING_MISMATCH");
	}
	await input.context.projectionWriter.write(projection);
	const outboxResults: ApprovalOutboxWriteResult[] = [];
	for (const item of outbox) {
		outboxResults.push(await input.context.outboxWriter.write(item));
	}
	return {
		kind: "created",
		status: currentSnapshot.status,
		terminal: currentSnapshot.status !== "pending",
		snapshot: currentSnapshot,
		events,
		projection,
		outbox,
		outboxResults,
	};
}
