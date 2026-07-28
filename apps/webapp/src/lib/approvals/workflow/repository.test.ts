import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { Clock } from "@/lib/datetime/temporal-core";
import { isInstant, parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalDomainAdapterRegistry } from "../domain-adapters/registry";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import type { LegacyApprovalRowWriter } from "./compatibility-writer";
import {
	deriveApprovalAssignmentId,
	deriveApprovalEventId,
	deriveApprovalStageId,
	deriveApprovalWorkflowId,
} from "./identity";
import type {
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalMaterializedTransitionPlan,
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
	JsonObject,
	ObservedLegacyTransition,
	ObservedLegacyTransitionPlan,
	StageActivationResolver,
} from "./ports";
import {
	ApprovalWorkflowRepositoryError,
	createApprovalWorkflowRepository,
	decodeApprovalCommandResult,
	encodeApprovalCommandResult,
} from "./repository";
import { serializeApprovalWorkflowEventMetadata } from "./state-machine";

const dialect = new PgDialect();
const organizationId = "org-1";
const otherOrganizationId = "org-2";
const workflowId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const requesterId = "30000000-0000-4000-8000-000000000001";
const stageId = "40000000-0000-4000-8000-000000000001";
const assignmentId = "50000000-0000-4000-8000-000000000001";
const eventId = "60000000-0000-4000-8000-000000000001";
const eventIdTwo = "60000000-0000-4000-8000-000000000002";
const eventIdThree = "60000000-0000-4000-8000-000000000003";
const now = parseInstant("2026-07-16T10:11:12.345Z");
const clock: Clock = { nowInstant: () => now };
const submissionKey = "absence-submit:source-1";

interface QueryResult {
	rows: unknown[];
	rowCount?: number;
}

function query(query: SQL) {
	return dialect.sqlToQuery(query);
}

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error("Invalid test fixture");
	return value;
}

function sqlCall(calls: SQL[], index: number): SQL {
	return required(calls[index]);
}

function sequenceClient(responses: Array<QueryResult | Error>) {
	const calls: SQL[] = [];
	let index = 0;
	return {
		calls,
		client: {
			execute: async (statement: SQL) => {
				calls.push(statement);
				const response = responses[index++];
				if (response instanceof Error) throw response;
				return response ?? { rows: [] };
			},
		},
	};
}

function dependencies(
	client: { execute(query: SQL): Promise<unknown> },
	options: {
		observationPlanner?: {
			plan(
				input: ObservedLegacyTransition,
			): Promise<ObservedLegacyTransitionPlan>;
		};
		onTransaction?: (commit: boolean) => void;
	} = {},
) {
	let transactionCalls = 0;
	const db = {
		async transaction<T>(
			operation: (tx: typeof client) => Promise<T>,
		): Promise<T> {
			transactionCalls += 1;
			try {
				const result = await operation(client);
				options.onTransaction?.(true);
				return result;
			} catch (error) {
				options.onTransaction?.(false);
				throw error;
			}
		},
	};
	const adapterRegistry = {} as ApprovalDomainAdapterRegistry;
	const activationResolver = {} as StageActivationResolver;
	let legacyRowWriterDbService: unknown;
	const transactionBoundLegacyRowWriter: LegacyApprovalRowWriter = {
		writeLegacyRows: async () => undefined,
	};
	return {
		input: {
			db,
			adapterRegistry,
			activationResolver,
			createLegacyRowWriter: (dbService: ApprovalDbService) => {
				legacyRowWriterDbService = dbService;
				return transactionBoundLegacyRowWriter;
			},
			observationPlanner: options.observationPlanner ?? {
				plan: async () => observedResultAtVersion(),
			},
			clock,
		},
		transactionCalls: () => transactionCalls,
		legacyRowWriterDbService: () => legacyRowWriterDbService,
	};
}

async function transactionContext(
	client: { execute(query: SQL): Promise<unknown> },
	operation: (context: ApprovalWorkflowTransactionContext) => Promise<void>,
	options: Parameters<typeof dependencies>[1] = {},
) {
	const factory = dependencies(client, options);
	await createApprovalWorkflowRepository(factory.input).withTransaction(
		operation,
	);
	return factory;
}

function pendingSnapshot(
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
): ApprovalWorkflowSnapshot {
	return {
		id: workflowId,
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId,
		requesterEmployeeId: requesterId,
		status: "pending",
		currentStageOrder: 1,
		version: 4,
		policySnapshot: { kind: "standard" },
		contextSnapshot: { timezone: "Europe/Berlin" },
		displaySnapshot: { title: "Vacation" },
		submittedAt: parseInstant("2026-07-15T08:00:00Z"),
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: stageId,
				organizationId,
				workflowId,
				sequence: 1,
				label: "Manager",
				resolverSnapshot: { kind: "manager" },
				activationMode: "human",
				status: "pending",
				activatedAt: parseInstant("2026-07-15T08:01:00Z"),
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [
					{
						id: assignmentId,
						organizationId,
						workflowId,
						stageId,
						sequence: 1,
						approverEmployeeId: requesterId,
						status: "pending",
						assignedAt: parseInstant("2026-07-15T08:01:00Z"),
						resolvedAt: null,
						resolvedBy: null,
						reassignedByEmployeeId: null,
						reassignedFromAssignmentId: null,
						reassignmentMetadata: null,
					},
				],
			},
		],
		...overrides,
	};
}

function initialWorkflowInput(key = submissionKey): {
	snapshot: ApprovalWorkflowSnapshot;
	events: ApprovalWorkflowEventSnapshot[];
	submissionKey: string;
} {
	const id = deriveApprovalWorkflowId({
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId,
		allocationKey: key,
	});
	const initialStageId = deriveApprovalStageId({
		organizationId,
		workflowId: id,
		allocationKey: "stage:1",
	});
	const initialAssignmentId = deriveApprovalAssignmentId({
		organizationId,
		workflowId: id,
		allocationKey: `${id}:stage:${initialStageId}:assignment:1`,
	});
	const snapshot: ApprovalWorkflowSnapshot = {
		...pendingSnapshot(),
		id,
		version: 1,
		displaySnapshot: {
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
		},
		stages: [
			{
				...required(pendingSnapshot().stages[0]),
				id: initialStageId,
				workflowId: id,
				assignments: [
					{
						...required(pendingSnapshot().stages[0]?.assignments[0]),
						id: initialAssignmentId,
						workflowId: id,
						stageId: initialStageId,
					},
				],
			},
		],
	};
	return {
		snapshot,
		submissionKey: key,
		events: [
			{
				id: deriveApprovalEventId({
					organizationId,
					workflowId: id,
					allocationKey: `${id}:event:1:0`,
				}),
				organizationId,
				workflowId: id,
				version: 1,
				eventIndex: 0,
				eventType: "assignment.created",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: null,
				resultingState: {
					approverEmployeeId: requesterId,
					sequence: 1,
					status: "pending",
				},
				reason: null,
				metadata: null,
				references: { assignmentId: initialAssignmentId },
				idempotencyKey: key,
				occurredAt: required(snapshot.stages[0]?.assignments[0]?.assignedAt),
			},
			{
				id: deriveApprovalEventId({
					organizationId,
					workflowId: id,
					allocationKey: `${id}:event:1:1`,
				}),
				organizationId,
				workflowId: id,
				version: 1,
				eventIndex: 1,
				eventType: "stage.activated",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: { status: "waiting" },
				resultingState: { status: "pending" },
				reason: null,
				metadata: { stageId: initialStageId, stageOrder: 1 },
				references: {},
				idempotencyKey: `${key}:1`,
				occurredAt: required(snapshot.stages[0]?.activatedAt),
			},
		],
	};
}

function terminalInitialWorkflowInput(
	key = `${submissionKey}:terminal`,
): ReturnType<typeof initialWorkflowInput> {
	const id = deriveApprovalWorkflowId({
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId,
		allocationKey: key,
	});
	const snapshot: ApprovalWorkflowSnapshot = {
		...pendingSnapshot(),
		id,
		status: "approved",
		currentStageOrder: null,
		version: 1,
		completedAt: now,
		decisionReason: null,
		stages: [
			{
				id: deriveApprovalStageId({
					organizationId,
					workflowId: id,
					allocationKey: "stage:1",
				}),
				organizationId,
				workflowId: id,
				sequence: 1,
				label: "Requester auto approval",
				resolverSnapshot: { kind: "requester" },
				activationMode: "requester_auto_approve",
				status: "approved",
				activatedAt: now,
				decidedAt: now,
				decisionReason: "requester_auto_approved",
				legacyApprovalRequestId: null,
				assignments: [],
			},
		],
	};
	const autoStage = required(snapshot.stages[0]);
	return {
		snapshot,
		submissionKey: key,
		events: [
			{
				id: deriveApprovalEventId({
					organizationId,
					workflowId: id,
					allocationKey: `${id}:event:1:0`,
				}),
				organizationId,
				workflowId: id,
				version: 1,
				eventIndex: 0,
				eventType: "stage.auto_approved",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: { status: "waiting" },
				resultingState: { status: "approved" },
				reason: "requester_auto_approved",
				metadata: {
					stageId: autoStage.id,
					stageOrder: 1,
					requesterEmployeeId: requesterId,
				},
				references: {},
				idempotencyKey: key,
				occurredAt: now,
			},
			{
				id: deriveApprovalEventId({
					organizationId,
					workflowId: id,
					allocationKey: `${id}:event:1:1`,
				}),
				organizationId,
				workflowId: id,
				version: 1,
				eventIndex: 1,
				eventType: "workflow.approved",
				actor: { kind: "system", employeeId: null, userId: null },
				previousState: { status: "pending" },
				resultingState: { status: "approved" },
				reason: "requester_auto_approved",
				metadata: null,
				references: {},
				idempotencyKey: `${key}:1`,
				occurredAt: now,
			},
		],
	};
}

function approvedHumanInitialWorkflowInput(): ReturnType<
	typeof initialWorkflowInput
> {
	const input = initialWorkflowInput();
	input.snapshot.status = "approved";
	input.snapshot.currentStageOrder = null;
	input.snapshot.completedAt = now;
	const stage = required(input.snapshot.stages[0]);
	stage.status = "approved";
	stage.decidedAt = now;
	stage.decisionReason = "approved";
	const assignment = required(stage.assignments[0]);
	assignment.status = "approved";
	assignment.resolvedAt = now;
	assignment.resolvedBy = { kind: "system", employeeId: null, userId: null };
	const event = required(input.events[0]);
	event.eventType = "workflow.approved";
	event.previousState = { status: "pending" };
	event.resultingState = { status: "approved" };
	event.metadata = null;
	event.references = {};
	event.occurredAt = now;
	return input;
}

function cancelledInitialWorkflowInput(): ReturnType<
	typeof initialWorkflowInput
> {
	const input = approvedHumanInitialWorkflowInput();
	input.snapshot.status = "cancelled";
	input.snapshot.cancelledAt = now;
	input.snapshot.decisionReason = "cancelled";
	return input;
}

function autoThenHumanInitialWorkflowInput(): ReturnType<
	typeof initialWorkflowInput
> {
	const input = initialWorkflowInput();
	const workflowId = input.snapshot.id;
	const autoStageId = deriveApprovalStageId({
		organizationId,
		workflowId,
		allocationKey: "stage:1",
	});
	const humanStageId = deriveApprovalStageId({
		organizationId,
		workflowId,
		allocationKey: "stage:2",
	});
	const humanAssignmentId = deriveApprovalAssignmentId({
		organizationId,
		workflowId,
		allocationKey: `${workflowId}:stage:${humanStageId}:assignment:1`,
	});
	const autoAt = parseInstant("2026-07-15T08:00:30Z");
	const humanAt = parseInstant("2026-07-15T08:01:00Z");
	input.snapshot.currentStageOrder = 2;
	input.snapshot.version = 2;
	input.snapshot.stages = [
		{
			id: autoStageId,
			organizationId,
			workflowId,
			sequence: 1,
			label: "Requester",
			resolverSnapshot: { kind: "requester" },
			activationMode: "requester_auto_approve",
			status: "approved",
			activatedAt: autoAt,
			decidedAt: autoAt,
			decisionReason: "requester_auto_approved",
			legacyApprovalRequestId: null,
			assignments: [],
		},
		{
			id: humanStageId,
			organizationId,
			workflowId,
			sequence: 2,
			label: "Manager",
			resolverSnapshot: { kind: "manager" },
			activationMode: "human",
			status: "pending",
			activatedAt: humanAt,
			decidedAt: null,
			decisionReason: null,
			legacyApprovalRequestId: null,
			assignments: [
				{
					id: humanAssignmentId,
					organizationId,
					workflowId,
					stageId: humanStageId,
					sequence: 1,
					approverEmployeeId: requesterId,
					status: "pending",
					assignedAt: humanAt,
					resolvedAt: null,
					resolvedBy: null,
					reassignedByEmployeeId: null,
					reassignedFromAssignmentId: null,
					reassignmentMetadata: null,
				},
			],
		},
	];
	const drafts = [
		{
			eventType: "stage.auto_approved" as const,
			previousState: { status: "waiting" },
			resultingState: { status: "approved" },
			reason: "requester_auto_approved",
			metadata: {
				stageId: autoStageId,
				stageOrder: 1,
				requesterEmployeeId: requesterId,
			},
			references: {},
			occurredAt: autoAt,
		},
		{
			eventType: "workflow.activation_requested" as const,
			previousState: { currentStageOrder: 1, status: "pending" },
			resultingState: { currentStageOrder: 2, status: "pending" },
			reason: null,
			metadata: { stageId: humanStageId, stageOrder: 2 },
			references: {},
			occurredAt: autoAt,
		},
		{
			eventType: "assignment.created" as const,
			previousState: null,
			resultingState: {
				approverEmployeeId: requesterId,
				sequence: 1,
				status: "pending",
			},
			reason: null,
			metadata: null,
			references: { assignmentId: humanAssignmentId },
			occurredAt: humanAt,
		},
		{
			eventType: "stage.activated" as const,
			previousState: { status: "waiting" },
			resultingState: { status: "pending" },
			reason: null,
			metadata: { stageId: humanStageId, stageOrder: 2 },
			references: {},
			occurredAt: humanAt,
		},
	];
	input.events = drafts.map((draft, index) => {
		const version = index < 2 ? 1 : 2;
		const eventIndex = index % 2;
		return {
			...draft,
			id: deriveApprovalEventId({
				organizationId,
				workflowId,
				allocationKey: `${workflowId}:event:${version}:${eventIndex}`,
			}),
			organizationId,
			workflowId,
			version,
			eventIndex,
			actor: { kind: "system", employeeId: null, userId: null },
			idempotencyKey:
				index === 0 ? input.submissionKey : `${input.submissionKey}:${index}`,
		};
	});
	return input;
}

function approvedSnapshot(): ApprovalWorkflowSnapshot {
	const completedAt = parseInstant("2026-07-16T10:00:00Z");
	const previous = pendingSnapshot();
	return {
		...previous,
		status: "approved",
		currentStageOrder: null,
		version: 5,
		completedAt,
		decisionReason: "approved",
		stages: previous.stages.map((stage) => ({
			...stage,
			status: "approved",
			decidedAt: completedAt,
			decisionReason: "approved",
			assignments: stage.assignments.map((assignment) => ({
				...assignment,
				status: "approved",
				resolvedAt: completedAt,
				resolvedBy: {
					kind: "employee",
					employeeId: requesterId,
					userId: null,
				},
			})),
		})),
	};
}

function commandResult(): ApprovalCommandResult {
	const snapshot = approvedSnapshot();
	return {
		snapshot,
		events: [
			{
				id: eventId,
				organizationId,
				workflowId,
				version: 5,
				eventIndex: 0,
				eventType: "workflow.approved",
				actor: {
					kind: "employee",
					employeeId: requesterId,
					userId: "user-1",
				},
				previousState: { status: "pending" },
				resultingState: { status: "approved" },
				reason: "approved",
				metadata: { source: "command" },
				references: { assignmentId },
				idempotencyKey: "command-1",
				occurredAt: now,
			},
		],
		projection: {
			organizationId,
			workflowId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId,
			status: "approved",
			currentStageOrder: null,
			requesterEmployeeId: requesterId,
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
			activeInboxStage: null,
			updatedAt: now,
		},
		outbox: [
			{
				organizationId,
				workflowId,
				eventId,
				eventType: "workflow.approved",
				dedupeKey: "approval:command-1",
				payload: { actor: { employeeId: requesterId } },
				disposition: "deliver",
				createdAt: now,
			},
		],
	};
}

function commandResultForScope(
	resultOrganizationId: string,
	resultWorkflowId: string,
): ApprovalCommandResult {
	const result = commandResult();
	return {
		...result,
		snapshot: {
			...result.snapshot,
			organizationId: resultOrganizationId,
			id: resultWorkflowId,
			stages: result.snapshot.stages.map((stage) => ({
				...stage,
				organizationId: resultOrganizationId,
				workflowId: resultWorkflowId,
				assignments: stage.assignments.map((assignment) => ({
					...assignment,
					organizationId: resultOrganizationId,
					workflowId: resultWorkflowId,
				})),
			})),
		},
		events: result.events.map((event) => ({
			...event,
			organizationId: resultOrganizationId,
			workflowId: resultWorkflowId,
		})),
		projection: {
			...result.projection,
			organizationId: resultOrganizationId,
			workflowId: resultWorkflowId,
		},
		outbox: result.outbox.map((item) => ({
			...item,
			organizationId: resultOrganizationId,
			workflowId: resultWorkflowId,
		})),
	};
}

function materializedPlan(): ApprovalMaterializedTransitionPlan {
	const previous = pendingSnapshot();
	const resulting = approvedSnapshot();
	const previousStage = required(previous.stages[0]);
	const resultingStage = required(resulting.stages[0]);
	const previousAssignment = required(previousStage.assignments[0]);
	const resultingAssignment = required(resultingStage.assignments[0]);
	const event = required(commandResult().events[0]);
	return {
		expectedVersion: 4,
		resultingSnapshot: resulting,
		changes: {
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
			stages: [
				{
					stageId,
					previous: previousStage,
					resulting: resultingStage,
				},
			],
			assignments: [
				{
					kind: "update",
					assignmentId,
					previous: previousAssignment,
					resulting: resultingAssignment,
				},
			],
		},
		events: [
			{
				...event,
				persistenceMetadata: {
					source: "command",
					__z8_approval_workflow_references_v1: {
						businessMetadataWasNull: false,
						references: { assignmentId },
					},
				},
			},
		],
		nextAction: {
			kind: "finalize_terminal",
			transition: {
				kind: "approve",
				from: "pending",
				to: "approved",
				reason: "approved",
			},
		},
	};
}

function rootRow() {
	return {
		id: workflowId,
		organization_id: organizationId,
		workflow_type: "absence",
		source_type: "absence_entry",
		source_id: sourceId,
		requester_employee_id: requesterId,
		status: "pending",
		current_stage_order: 1,
		version: 4,
		policy_snapshot: { kind: "standard" },
		context_snapshot: { timezone: "Europe/Berlin" },
		display_snapshot: { title: "Vacation" },
		submitted_at: new Date("2026-07-15T08:00:00Z"),
		completed_at: null,
		cancelled_at: null,
		decision_reason: null,
	};
}

function stageRow() {
	return {
		id: stageId,
		organization_id: organizationId,
		workflow_id: workflowId,
		stage_order: 1,
		label: "Manager",
		resolver_snapshot: { kind: "manager" },
		activation_mode: "human",
		status: "pending",
		activated_at: new Date("2026-07-15T08:01:00Z"),
		decided_at: null,
		decision_reason: null,
		legacy_approval_request_id: null,
	};
}

function assignmentRow() {
	return {
		id: assignmentId,
		organization_id: organizationId,
		workflow_id: workflowId,
		stage_id: stageId,
		assignment_sequence: 1,
		approver_employee_id: requesterId,
		status: "pending",
		assigned_at: new Date("2026-07-15T08:01:00Z"),
		resolved_at: null,
		resolved_by_actor_kind: null,
		resolved_by_actor_id: null,
		reassigned_by_employee_id: null,
		reassigned_from_assignment_id: null,
		reassignment_metadata: null,
	};
}

function approvedRootRow(overrides: Record<string, unknown> = {}) {
	const snapshot = approvedSnapshot();
	return {
		...rootRow(),
		status: snapshot.status,
		current_stage_order: snapshot.currentStageOrder,
		version: snapshot.version,
		completed_at: new Date(required(snapshot.completedAt).epochMilliseconds),
		decision_reason: snapshot.decisionReason,
		...overrides,
	};
}

function approvedStageRow(overrides: Record<string, unknown> = {}) {
	const stage = required(approvedSnapshot().stages[0]);
	return {
		...stageRow(),
		status: stage.status,
		decided_at: new Date(required(stage.decidedAt).epochMilliseconds),
		decision_reason: stage.decisionReason,
		...overrides,
	};
}

function approvedAssignmentRow(overrides: Record<string, unknown> = {}) {
	const assignment = required(approvedSnapshot().stages[0]?.assignments[0]);
	return {
		...assignmentRow(),
		status: assignment.status,
		resolved_at: new Date(required(assignment.resolvedAt).epochMilliseconds),
		resolved_by_actor_kind: "employee",
		resolved_by_actor_id: requesterId,
		...overrides,
	};
}

function persistedEventRow(overrides: Record<string, unknown> = {}) {
	const event = required(commandResult().events[0]);
	return {
		id: event.id,
		organization_id: event.organizationId,
		workflow_id: event.workflowId,
		version: event.version,
		event_index: event.eventIndex,
		event_type: event.eventType,
		actor_kind: event.actor.kind,
		actor_employee_id: event.actor.employeeId,
		actor_user_id: event.actor.userId,
		previous_state: event.previousState,
		resulting_state: event.resultingState,
		reason: event.reason,
		metadata: required(materializedPlan().events[0]).persistenceMetadata,
		idempotency_key: "legacy-observation-1",
		occurred_at: new Date(event.occurredAt.epochMilliseconds),
		created_at: new Date(event.occurredAt.epochMilliseconds),
		...overrides,
	};
}

function initialWorkflowRows(input = initialWorkflowInput()) {
	const initialStage = required(input.snapshot.stages[0]);
	const initialAssignment = required(initialStage.assignments[0]);
	const events = input.events.map((event) => ({
		id: event.id,
		organization_id: event.organizationId,
		workflow_id: event.workflowId,
		version: event.version,
		event_index: event.eventIndex,
		event_type: event.eventType,
		actor_kind: event.actor.kind,
		actor_employee_id: event.actor.employeeId,
		actor_user_id: event.actor.userId,
		previous_state: event.previousState,
		resulting_state: event.resultingState,
		reason: event.reason,
		metadata: serializeApprovalWorkflowEventMetadata(
			event.metadata,
			event.references ?? {},
		),
		idempotency_key: event.idempotencyKey,
		occurred_at: new Date(event.occurredAt.epochMilliseconds),
		created_at: new Date(event.occurredAt.epochMilliseconds),
	}));
	return {
		root: {
			id: input.snapshot.id,
			organization_id: input.snapshot.organizationId,
			workflow_type: input.snapshot.workflowType,
			source_type: input.snapshot.sourceType,
			source_id: input.snapshot.sourceId,
			requester_employee_id: input.snapshot.requesterEmployeeId,
			status: input.snapshot.status,
			current_stage_order: input.snapshot.currentStageOrder,
			version: input.snapshot.version,
			policy_snapshot: input.snapshot.policySnapshot,
			context_snapshot: input.snapshot.contextSnapshot,
			display_snapshot: input.snapshot.displaySnapshot,
			submitted_at: new Date(input.snapshot.submittedAt.epochMilliseconds),
			completed_at: null,
			cancelled_at: null,
			decision_reason: null,
		},
		stage: {
			id: initialStage.id,
			organization_id: initialStage.organizationId,
			workflow_id: initialStage.workflowId,
			stage_order: initialStage.sequence,
			label: initialStage.label,
			resolver_snapshot: initialStage.resolverSnapshot,
			activation_mode: initialStage.activationMode,
			status: initialStage.status,
			activated_at: new Date(
				required(initialStage.activatedAt).epochMilliseconds,
			),
			decided_at: null,
			decision_reason: null,
			legacy_approval_request_id: null,
		},
		assignment: {
			id: initialAssignment.id,
			organization_id: initialAssignment.organizationId,
			workflow_id: initialAssignment.workflowId,
			stage_id: initialAssignment.stageId,
			assignment_sequence: initialAssignment.sequence,
			approver_employee_id: initialAssignment.approverEmployeeId,
			status: initialAssignment.status,
			assigned_at: new Date(initialAssignment.assignedAt.epochMilliseconds),
			resolved_at: null,
			resolved_by_actor_kind: null,
			resolved_by_actor_id: null,
			reassigned_by_employee_id: null,
			reassigned_from_assignment_id: null,
			reassignment_metadata: null,
		},
		event: required(events[0]),
		events,
	};
}

function advancedInitialWorkflowRows(input = initialWorkflowInput()) {
	const rows = initialWorkflowRows(input);
	const completedAt = now;
	const currentSnapshot: ApprovalWorkflowSnapshot = {
		...input.snapshot,
		status: "approved",
		currentStageOrder: null,
		version: 2,
		completedAt,
		stages: input.snapshot.stages.map((stage) => ({
			...stage,
			status: "approved",
			decidedAt: completedAt,
			decisionReason: "approved",
			assignments: stage.assignments.map((assignment) => ({
				...assignment,
				status: "approved",
				resolvedAt: completedAt,
				resolvedBy: { kind: "system", employeeId: null, userId: null },
			})),
		})),
	};
	const appendedEvent: ApprovalWorkflowEventSnapshot = {
		id: deriveApprovalEventId({
			organizationId: input.snapshot.organizationId,
			workflowId: input.snapshot.id,
			allocationKey: `${input.snapshot.id}:event:2:0`,
		}),
		organizationId: input.snapshot.organizationId,
		workflowId: input.snapshot.id,
		version: 2,
		eventIndex: 0,
		eventType: "workflow.approved",
		actor: { kind: "system", employeeId: null, userId: null },
		previousState: { status: "pending" },
		resultingState: { status: "approved" },
		reason: null,
		metadata: null,
		references: {},
		idempotencyKey: "later-command",
		occurredAt: completedAt,
	};
	return {
		currentSnapshot,
		root: {
			...rows.root,
			status: "approved",
			current_stage_order: null,
			version: 2,
			completed_at: new Date(completedAt.epochMilliseconds),
		},
		stage: {
			...rows.stage,
			status: "approved",
			decided_at: new Date(completedAt.epochMilliseconds),
			decision_reason: "approved",
		},
		assignment: {
			...rows.assignment,
			status: "approved",
			resolved_at: new Date(completedAt.epochMilliseconds),
			resolved_by_actor_kind: "system",
		},
		initialEvents: rows.events,
		appendedEvent: {
			...rows.event,
			id: appendedEvent.id,
			version: 2,
			event_index: 0,
			event_type: appendedEvent.eventType,
			previous_state: appendedEvent.previousState,
			resulting_state: appendedEvent.resultingState,
			metadata: null,
			idempotency_key: appendedEvent.idempotencyKey,
			occurred_at: new Date(completedAt.epochMilliseconds),
			created_at: new Date(completedAt.epochMilliseconds),
		},
	};
}

function commandResultAtVersion(version: number): ApprovalCommandResult {
	const result = commandResult();
	return {
		...result,
		snapshot: { ...result.snapshot, version },
		events: result.events.map((event) => ({ ...event, version })),
	};
}

function commandResultWithEventSequence(
	sequence: ReadonlyArray<readonly [version: number, eventIndex: number]>,
	snapshotVersion: number,
): ApprovalCommandResult {
	const result = commandResultAtVersion(snapshotVersion);
	const template = required(result.events[0]);
	const ids = [eventId, eventIdTwo, eventIdThree] as const;
	const events = sequence.map(([version, eventIndex], index) => ({
		...template,
		id: required(ids[index]),
		version,
		eventIndex,
	}));
	return {
		...result,
		events,
		outbox: events.map((event, index) => ({
			...required(result.outbox[0]),
			eventId: event.id,
			eventType: event.eventType,
			dedupeKey: `approval:command-1:${index}`,
		})),
	};
}

function observedResultAtVersion(version = 5): ObservedLegacyTransitionPlan {
	const result = commandResultAtVersion(version);
	return {
		...result,
		outbox: result.outbox.map((item) => ({
			...item,
			disposition: "observe" as const,
		})),
	};
}

describe("approval workflow repository", () => {
	it("exposes initial workflow creation through the transaction port", async () => {
		const fake = sequenceClient([]);

		await transactionContext(fake.client, async ({ repository }) => {
			expect(repository.createInitialWorkflow).toEqual(expect.any(Function));
		});
	});

	it("preflights an absent source under the transaction advisory lock", async () => {
		const fake = sequenceClient([{ rows: [{ locked: null }] }, { rows: [] }]);

		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: { timezone: "Europe/Berlin" },
				displaySnapshot: { title: "Vacation" },
			});
		});
		expect(result).toEqual({ kind: "none" });
		expect(query(sqlCall(fake.calls, 0)).sql).toContain(
			"pg_advisory_xact_lock",
		);
		expect(query(sqlCall(fake.calls, 1)).sql).toContain(
			"where organization_id = $1",
		);
	});

	it("returns an existing exact initial workflow after validating event evidence", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: null }] },
			{
				rows: [{ id: input.snapshot.id, status: input.snapshot.status }],
			},
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{ rows: rows.events },
		]);

		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: input.snapshot.contextSnapshot,
				displaySnapshot: input.snapshot.displaySnapshot,
			});
		});
		expect(result).toEqual({ kind: "existing", snapshot: input.snapshot });
	});

	it.each([
		[
			"requester",
			{
				requesterEmployeeId: "30000000-0000-4000-8000-000000000099",
			},
		],
		["routing context", { contextSnapshot: { timezone: "America/New_York" } }],
		["display snapshot", { displaySnapshot: { title: "Changed" } }],
	] as const)("returns source conflict for changed immutable %s", async (_name, override) => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: null }] },
			{
				rows: [
					{ id: input.snapshot.id, workflow_type: input.snapshot.workflowType },
				],
			},
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{ rows: rows.events },
		]);
		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: input.snapshot.contextSnapshot,
				displaySnapshot: input.snapshot.displaySnapshot,
				...override,
			});
		});

		expect(result).toEqual({ kind: "source_conflict" });
	});

	it("returns source conflict for another pending cycle", async () => {
		const input = initialWorkflowInput();
		const fake = sequenceClient([
			{ rows: [{ locked: null }] },
			{
				rows: [
					{
						id: input.snapshot.id,
						workflow_type: input.snapshot.workflowType,
						status: "pending",
					},
				],
			},
		]);

		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey: "different-submission",
				requesterEmployeeId: requesterId,
				contextSnapshot: input.snapshot.contextSnapshot,
				displaySnapshot: input.snapshot.displaySnapshot,
			});
		});
		expect(result).toEqual({ kind: "source_conflict" });
	});

	it("isolates pending cycles by workflow type", async () => {
		const fake = sequenceClient([{ rows: [{ locked: null }] }, { rows: [] }]);
		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "travel_expense",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: {},
				displaySnapshot: {},
			});
		});
		expect(result).toEqual({ kind: "none" });
		const lock = query(required(fake.calls[0]));
		expect(lock.params).toEqual([
			JSON.stringify([
				organizationId,
				"travel_expense",
				"absence_entry",
				sourceId,
			]),
		]);
		const lookup = query(required(fake.calls[1]));
		expect(lookup.sql).toContain("workflow_type =");
		expect(lookup.params).toContain("travel_expense");
	});

	it("replays an exact terminal cycle when no newer pending cycle occupies the source", async () => {
		const input = initialWorkflowInput();
		const advanced = advancedInitialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: null }] },
			{
				rows: [
					{
						id: input.snapshot.id,
						workflow_type: "absence",
						status: "approved",
					},
				],
			},
			{ rows: [advanced.root] },
			{ rows: [advanced.stage] },
			{ rows: [advanced.assignment] },
			{ rows: [...advanced.initialEvents, advanced.appendedEvent] },
		]);

		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: input.snapshot.contextSnapshot,
				displaySnapshot: input.snapshot.displaySnapshot,
			});
		});
		expect(result).toEqual({
			kind: "existing",
			snapshot: advanced.currentSnapshot,
		});
	});

	it("returns source conflict for a stale exact terminal replay beside a newer pending cycle", async () => {
		const input = initialWorkflowInput();
		const newerPendingId = "10000000-0000-4000-8000-000000000099";
		const fake = sequenceClient([
			{ rows: [{ locked: null }] },
			{
				rows: [
					{
						id: input.snapshot.id,
						workflow_type: "absence",
						status: "approved",
					},
					{ id: newerPendingId, workflow_type: "absence", status: "pending" },
				],
			},
		]);

		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: input.snapshot.contextSnapshot,
				displaySnapshot: input.snapshot.displaySnapshot,
			});
		});
		expect(result).toEqual({ kind: "source_conflict" });
		expect(fake.calls).toHaveLength(2);
	});

	it("ignores multiple unrelated terminal histories when starting a later cycle", async () => {
		const fake = sequenceClient([{ rows: [{ locked: null }] }, { rows: [] }]);
		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey: "third-cycle",
				requesterEmployeeId: requesterId,
				contextSnapshot: {},
				displaySnapshot: {},
			});
		});
		expect(result).toEqual({ kind: "none" });
		const lookup = query(required(fake.calls[1]));
		expect(lookup.sql).toContain("status = 'pending'");
		expect(lookup.sql).toContain("id =");
	});

	it("returns source conflict when persisted initial idempotency evidence differs", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: null }] },
			{
				rows: [
					{ id: input.snapshot.id, workflow_type: input.snapshot.workflowType },
				],
			},
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{
				rows: [
					{ ...required(rows.events[0]), idempotency_key: "other-submission" },
					...rows.events.slice(1),
				],
			},
		]);

		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.findInitialWorkflow({
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId,
				submissionKey,
				requesterEmployeeId: requesterId,
				contextSnapshot: input.snapshot.contextSnapshot,
				displaySnapshot: input.snapshot.displaySnapshot,
			});
		});
		expect(result).toEqual({ kind: "source_conflict" });
	});

	it.each([
		[
			"empty submission key",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				input.submissionKey = " ";
			},
		],
		[
			"non-deterministic workflow ID",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				input.snapshot.id = workflowId;
			},
		],
		[
			"missing requester",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				input.snapshot.requesterEmployeeId = null;
			},
		],
		[
			"foreign stage organization",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.snapshot.stages[0]).organizationId = otherOrganizationId;
			},
		],
		[
			"non-deterministic stage ID",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.snapshot.stages[0]).id = stageId;
			},
		],
		[
			"non-deterministic assignment ID",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.snapshot.stages[0]?.assignments[0]).id = assignmentId;
			},
		],
		[
			"incoherent pending completion time",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				input.snapshot.completedAt = now;
			},
		],
		[
			"missing event history",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				input.events = [];
			},
		],
		[
			"gapped event index",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).eventIndex = 1;
			},
		],
		[
			"non-deterministic event ID",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).id = eventId;
			},
		],
		[
			"foreign event source scope",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).workflowId = workflowId;
			},
		],
		[
			"legacy actor on a canonical start",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).actor = {
					kind: "legacy_unknown",
					employeeId: null,
					userId: null,
				};
			},
		],
		[
			"foreign event assignment reference",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).references = { assignmentId };
			},
		],
		[
			"mismatched event idempotency key",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).idempotencyKey = "other-submission";
			},
		],
	] as const)("rejects initial workflow %s before SQL", async (_name, mutate) => {
		const input = initialWorkflowInput();
		mutate(input);
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects initial events whose occurrence times move backwards before SQL", async () => {
		const input = initialWorkflowInput();
		required(input.events[0]).occurredAt = parseInstant("2026-07-15T08:02:00Z");
		required(input.events[1]).occurredAt = parseInstant("2026-07-15T08:01:00Z");
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects initial event versions beginning at zero before SQL", async () => {
		const input = initialWorkflowInput();
		const versionOne = required(input.events[0]);
		input.events = [
			{
				...versionOne,
				id: deriveApprovalEventId({
					organizationId,
					workflowId: input.snapshot.id,
					allocationKey: `${input.snapshot.id}:event:0:0`,
				}),
				version: 0,
				idempotencyKey: input.submissionKey,
			},
			{
				...versionOne,
				idempotencyKey: `${input.submissionKey}:1`,
			},
		];
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects negative initial event versions before SQL", async () => {
		const input = initialWorkflowInput();
		const event = required(input.events[0]);
		event.version = -1;
		event.id = deriveApprovalEventId({
			organizationId,
			workflowId: input.snapshot.id,
			allocationKey: `${input.snapshot.id}:event:-1:0`,
		});
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"decision or reassignment vocabulary",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const event = required(input.events[0]);
				event.eventType = "assignment.reassigned";
				event.references = {
					assignmentId: required(input.snapshot.stages[0]?.assignments[0]).id,
				};
			},
		],
		[
			"stage event without stage metadata",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[1]).metadata = null;
			},
		],
		[
			"stage activation with contradictory local state",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				required(input.events[0]).previousState = { status: "pending" };
			},
		],
		[
			"assignment creation without its assignment reference",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const assignment = required(input.snapshot.stages[0]?.assignments[0]);
				const event = required(input.events[0]);
				event.eventType = "assignment.created";
				event.previousState = null;
				event.resultingState = {
					approverEmployeeId: assignment.approverEmployeeId,
					sequence: assignment.sequence,
					status: "pending",
				};
				event.metadata = null;
				event.references = {};
			},
		],
		[
			"assignment creation contradicting the referenced assignment",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const assignment = required(input.snapshot.stages[0]?.assignments[0]);
				const event = required(input.events[0]);
				event.eventType = "assignment.created";
				event.previousState = null;
				event.resultingState = {
					approverEmployeeId: "30000000-0000-4000-8000-000000000002",
					sequence: assignment.sequence,
					status: "pending",
				};
				event.metadata = null;
				event.references = { assignmentId: assignment.id };
			},
		],
		[
			"terminal approval event for a pending snapshot",
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const event = required(input.events[0]);
				event.eventType = "workflow.approved";
				event.previousState = { status: "pending" };
				event.resultingState = { status: "approved" };
				event.metadata = null;
			},
		],
	] as const)("rejects initial workflow %s before SQL", async (_name, mutate) => {
		const input = initialWorkflowInput();
		mutate(input);
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects an approved initial snapshot without a final workflow approval event", async () => {
		const input = terminalInitialWorkflowInput();
		const event = required(input.events[0]);
		event.eventType = "workflow.activation_requested";
		event.previousState = null;
		event.resultingState = { status: "pending", currentStageOrder: 1 };
		event.metadata = { stageId, stageOrder: 1 };
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"pending human stage missing assignment creation",
			() => {
				const input = initialWorkflowInput();
				const stageEvent = required(input.events[1]);
				input.events = [
					{
						...stageEvent,
						id: deriveApprovalEventId({
							organizationId,
							workflowId: input.snapshot.id,
							allocationKey: `${input.snapshot.id}:event:1:0`,
						}),
						eventIndex: 0,
						idempotencyKey: input.submissionKey,
					},
				];
				return input;
			},
		],
		[
			"activation events in the wrong lifecycle order",
			() => {
				const input = initialWorkflowInput();
				input.events = [...input.events].reverse().map((event, index) => ({
					...event,
					id: deriveApprovalEventId({
						organizationId,
						workflowId: input.snapshot.id,
						allocationKey: `${input.snapshot.id}:event:1:${index}`,
					}),
					eventIndex: index,
					idempotencyKey:
						index === 0
							? input.submissionKey
							: `${input.submissionKey}:${index}`,
				}));
				return input;
			},
		],
		[
			"activation request targeting a skipped stage",
			() => {
				const input = autoThenHumanInitialWorkflowInput();
				const event = required(input.events[1]);
				const skipped = required(input.snapshot.stages[0]);
				event.previousState = null;
				event.resultingState = {
					currentStageOrder: skipped.sequence,
					status: "pending",
				};
				event.metadata = {
					stageId: skipped.id,
					stageOrder: skipped.sequence,
				};
				return input;
			},
		],
		[
			"approved human assignment without decision events",
			() => {
				const input = approvedHumanInitialWorkflowInput();
				const event = required(input.events[0]);
				input.events = [event];
				return input;
			},
		],
		[
			"event sequence and final snapshot mismatch",
			() => {
				const input = initialWorkflowInput();
				input.events = [required(input.events[0])];
				return input;
			},
		],
	] as const)("rejects initial lifecycle with %s before SQL", async (_name, makeInput) => {
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(makeInput());
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects a terminal initial workflow completed before submission before SQL", async () => {
		const input = terminalInitialWorkflowInput();
		input.snapshot.completedAt = parseInstant("2026-07-14T08:00:00Z");
		const fake = sequenceClient([]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"snapshot.submittedAt",
			() => initialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				input.snapshot.submittedAt = value;
			},
		],
		[
			"snapshot.completedAt",
			() => approvedHumanInitialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				input.snapshot.completedAt = value;
			},
		],
		[
			"snapshot.cancelledAt",
			() => cancelledInitialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				input.snapshot.cancelledAt = value;
			},
		],
		[
			"stage.activatedAt",
			() => initialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				required(input.snapshot.stages[0]).activatedAt = value;
			},
		],
		[
			"stage.decidedAt",
			() => approvedHumanInitialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				required(input.snapshot.stages[0]).decidedAt = value;
			},
		],
		[
			"assignment.assignedAt",
			() => initialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				required(input.snapshot.stages[0]?.assignments[0]).assignedAt = value;
			},
		],
		[
			"assignment.resolvedAt",
			() => approvedHumanInitialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				required(input.snapshot.stages[0]?.assignments[0]).resolvedAt = value;
			},
		],
		[
			"event.occurredAt",
			() => initialWorkflowInput(),
			(input: ReturnType<typeof initialWorkflowInput>, value: typeof now) => {
				required(input.events[0]).occurredAt = value;
			},
		],
	] as const)("rejects non-database-representable %s before SQL", async (field, makeInput, mutate) => {
		for (const value of [
			parseInstant("2026-07-16T10:11:12.345000001Z"),
			Temporal.Instant.from("-005000-01-01T00:00:00Z"),
		]) {
			const input = makeInput();
			mutate(input, value);
			const fake = sequenceClient([]);

			await expect(
				transactionContext(fake.client, async ({ repository }) => {
					await repository.createInitialWorkflow(input);
				}),
			).rejects.toMatchObject({ code: "malformed", details: { field } });
			expect(fake.calls).toHaveLength(0);
		}
	});

	it("persists and strictly reloads a new initial workflow after locking its exact source identity", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: input.snapshot.id }] },
			{ rows: [{ id: rows.stage.id }] },
			{ rows: [{ id: rows.assignment.id }] },
			{ rows: [required(rows.events[0])] },
			{ rows: [required(rows.events[1])] },
			{ rows: [rows.root] },
			{ rows: rows.events },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "created",
				snapshot: input.snapshot,
			});
		});

		const statements = fake.calls.map(query);
		expect(statements).toHaveLength(11);
		expect(statements[0]?.sql).toContain("pg_advisory_xact_lock");
		expect(statements[0]?.params).toEqual([
			JSON.stringify([organizationId, "absence", "absence_entry", sourceId]),
		]);
		expect(statements[1]?.sql).toContain("from approval_workflow");
		expect(statements[1]?.sql).toContain("status = 'pending'");
		expect(statements[1]?.sql).toContain("workflow_type =");
		expect(statements[1]?.params).toEqual(
			expect.arrayContaining([
				organizationId,
				"absence",
				"absence_entry",
				sourceId,
				input.snapshot.id,
			]),
		);
		expect(statements[2]?.sql).toContain("insert into approval_workflow");
		expect(statements[3]?.sql).toContain("insert into approval_workflow_stage");
		expect(statements[4]?.sql).toContain(
			"insert into approval_stage_assignment",
		);
		expect(statements[5]?.sql).toContain("insert into approval_workflow_event");
		expect(statements[2]?.sql).toContain("on conflict do nothing");
		expect(
			statements.slice(3, 7).every(({ sql }) => !/on conflict/i.test(sql)),
		).toBe(true);
	});

	it("returns the strictly hydrated existing aggregate for an exact initial workflow replay", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "pending" }] },
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{ rows: rows.events },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "existing",
				snapshot: input.snapshot,
			});
		});

		expect(fake.calls).toHaveLength(6);
		expect(
			fake.calls
				.map(query)
				.every(({ sql }) => !/^\s*(?:insert|update|delete)\b/i.test(sql)),
		).toBe(true);
	});

	it("returns source conflict for same-version mutable snapshot drift", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const changedActivatedAt = new Date("2026-07-15T08:00:30Z");
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "pending" }] },
			{ rows: [rows.root] },
			{ rows: [{ ...rows.stage, activated_at: changedActivatedAt }] },
			{ rows: [rows.assignment] },
			{ rows: rows.events },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
	});

	it("returns source conflict for a same-version persisted event postfix", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const postfix = {
			...required(rows.events[1]),
			id: deriveApprovalEventId({
				organizationId,
				workflowId: input.snapshot.id,
				allocationKey: `${input.snapshot.id}:event:1:2`,
			}),
			event_index: 2,
			idempotency_key: "later-same-version-event",
		};
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "pending" }] },
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{ rows: [...rows.events, postfix] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
	});

	it("returns the current snapshot when the exact submission is replayed after later transitions", async () => {
		const input = initialWorkflowInput();
		const advanced = advancedInitialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "approved" }] },
			{ rows: [advanced.root] },
			{ rows: [advanced.stage] },
			{ rows: [advanced.assignment] },
			{ rows: [...advanced.initialEvents, advanced.appendedEvent] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "existing",
				snapshot: advanced.currentSnapshot,
			});
		});
	});

	it("returns source conflict when a persisted initial event prefix changed after later transitions", async () => {
		const input = initialWorkflowInput();
		const advanced = advancedInitialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "approved" }] },
			{ rows: [advanced.root] },
			{ rows: [advanced.stage] },
			{ rows: [advanced.assignment] },
			{
				rows: [
					{
						...required(advanced.initialEvents[0]),
						resulting_state: { status: "pending", changed: true },
					},
					...advanced.initialEvents.slice(1),
					advanced.appendedEvent,
				],
			},
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
	});

	it.each([
		[
			"changed submission key",
			() => initialWorkflowInput("absence-submit:changed"),
			(_input: ReturnType<typeof initialWorkflowInput>) => [
				{ rows: [{ locked: true }] },
				{
					rows: [{ id: initialWorkflowInput().snapshot.id, status: "pending" }],
				},
			],
		],
		[
			"changed immutable snapshot",
			() => {
				const input = initialWorkflowInput();
				input.snapshot.policySnapshot = { kind: "changed" };
				return input;
			},
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const persisted = initialWorkflowInput();
				const rows = initialWorkflowRows(persisted);
				return [
					{ rows: [{ locked: true }] },
					{ rows: [{ id: input.snapshot.id, status: "pending" }] },
					{ rows: [rows.root] },
					{ rows: [rows.stage] },
					{ rows: [rows.assignment] },
					{ rows: rows.events },
				];
			},
		],
		[
			"changed immutable event",
			() => {
				const input = initialWorkflowInput();
				required(input.events[0]).metadata = { changed: true };
				return input;
			},
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const persisted = initialWorkflowInput();
				const rows = initialWorkflowRows(persisted);
				return [
					{ rows: [{ locked: true }] },
					{ rows: [{ id: input.snapshot.id, status: "pending" }] },
					{ rows: [rows.root] },
					{ rows: [rows.stage] },
					{ rows: [rows.assignment] },
					{ rows: rows.events },
				];
			},
		],
		[
			"changed immutable stage field",
			() => {
				const input = initialWorkflowInput();
				required(input.snapshot.stages[0]).label = "Changed manager stage";
				return input;
			},
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const persisted = initialWorkflowInput();
				const rows = initialWorkflowRows(persisted);
				return [
					{ rows: [{ locked: true }] },
					{ rows: [{ id: input.snapshot.id, status: "pending" }] },
					{ rows: [rows.root] },
					{ rows: [rows.stage] },
					{ rows: [rows.assignment] },
					{ rows: rows.events },
				];
			},
		],
		[
			"changed immutable assignment field",
			() => {
				const input = initialWorkflowInput();
				required(input.snapshot.stages[0]?.assignments[0]).approverEmployeeId =
					"30000000-0000-4000-8000-000000000002";
				required(input.events[0]).resultingState = {
					approverEmployeeId: "30000000-0000-4000-8000-000000000002",
					sequence: 1,
					status: "pending",
				};
				return input;
			},
			(input: ReturnType<typeof initialWorkflowInput>) => {
				const persisted = initialWorkflowInput();
				const rows = initialWorkflowRows(persisted);
				return [
					{ rows: [{ locked: true }] },
					{ rows: [{ id: input.snapshot.id, status: "pending" }] },
					{ rows: [rows.root] },
					{ rows: [rows.stage] },
					{ rows: [rows.assignment] },
					{ rows: rows.events },
				];
			},
		],
	] as const)("returns source conflict for an initial workflow with %s", async (_name, makeInput, makeResponses) => {
		const input = makeInput();
		const fake = sequenceClient(makeResponses(input));

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
		expect(
			fake.calls
				.map(query)
				.every(({ sql }) => !/^\s*(?:insert|update|delete)\b/i.test(sql)),
		).toBe(true);
	});

	it("ignores physical terminal history outside the candidate-or-pending lookup", async () => {
		const input = initialWorkflowInput();
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: input.snapshot.id }] },
			{ rows: [{ id: initialWorkflowRows(input).stage.id }] },
			{ rows: [{ id: initialWorkflowRows(input).assignment.id }] },
			{ rows: [required(initialWorkflowRows(input).events[0])] },
			{ rows: [required(initialWorkflowRows(input).events[1])] },
			{ rows: [initialWorkflowRows(input).root] },
			{ rows: initialWorkflowRows(input).events },
			{ rows: [initialWorkflowRows(input).stage] },
			{ rows: [initialWorkflowRows(input).assignment] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "created",
				snapshot: input.snapshot,
			});
		});
		const lookup = query(required(fake.calls[1]));
		expect(lookup.sql).toContain("status = 'pending'");
		expect(lookup.sql).toContain("id =");
	});

	it("uses workflow type in the canonical source lookup", async () => {
		const input = initialWorkflowInput();
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: workflowId, status: "pending" }] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
		const lookup = query(required(fake.calls[1]));
		expect(lookup.sql).toContain("workflow_type =");
		expect(lookup.params).toEqual(
			expect.arrayContaining([
				organizationId,
				"absence",
				"absence_entry",
				sourceId,
				input.snapshot.id,
			]),
		);
	});

	it("translates a concurrent pending-source winner into source conflict", async () => {
		const input = initialWorkflowInput("concurrent-cycle");
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [] },
		]);
		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
		expect(query(required(fake.calls[2])).sql).toContain(
			"on conflict do nothing",
		);
		expect(fake.calls).toHaveLength(3);
	});

	it.each([
		["missing stage", [], [initialWorkflowRows().assignment]],
		[
			"duplicate stage",
			[initialWorkflowRows().stage, initialWorkflowRows().stage],
			[initialWorkflowRows().assignment],
		],
		["missing assignment", [initialWorkflowRows().stage], []],
		[
			"duplicate assignment",
			[initialWorkflowRows().stage],
			[initialWorkflowRows().assignment, initialWorkflowRows().assignment],
		],
	] as const)("returns source conflict when an existing initial workflow has a %s", async (_name, stages, assignments) => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "pending" }] },
			{ rows: [rows.root] },
			{ rows: [...stages] },
			{ rows: [...assignments] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
	});

	it.each([
		["missing", []],
		[
			"duplicate",
			[
				...initialWorkflowRows().events,
				required(initialWorkflowRows().events[0]),
			],
		],
	] as const)("returns source conflict when an existing initial workflow has %s events", async (_name, events) => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "pending" }] },
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{ rows: [...events] },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
	});

	it("returns source conflict when existing initial events are reordered", async () => {
		const input = initialWorkflowInput();
		const rows = initialWorkflowRows(input);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "pending" }] },
			{ rows: [rows.root] },
			{ rows: [rows.stage] },
			{ rows: [rows.assignment] },
			{ rows: [...rows.events].reverse() },
		]);

		await transactionContext(fake.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "source_conflict",
			});
		});
	});

	it.each([
		["source lock", [], 1],
		["source lookup", [{ rows: [{ locked: true }] }], 2],
		["root insert", [{ rows: [{ locked: true }] }, { rows: [] }], 3],
		[
			"stage insert",
			[
				{ rows: [{ locked: true }] },
				{ rows: [] },
				{ rows: [{ id: initialWorkflowInput().snapshot.id }] },
			],
			4,
		],
		[
			"assignment insert",
			[
				{ rows: [{ locked: true }] },
				{ rows: [] },
				{ rows: [{ id: initialWorkflowInput().snapshot.id }] },
				{ rows: [{ id: initialWorkflowRows().stage.id }] },
			],
			5,
		],
		[
			"event insert",
			[
				{ rows: [{ locked: true }] },
				{ rows: [] },
				{ rows: [{ id: initialWorkflowInput().snapshot.id }] },
				{ rows: [{ id: initialWorkflowRows().stage.id }] },
				{ rows: [{ id: initialWorkflowRows().assignment.id }] },
			],
			6,
		],
	] as const)("propagates an initial workflow %s SQL failure", async (_name, responses, callCount) => {
		const cause = new Error("injected SQL failure");
		const fake = sequenceClient([...responses, cause]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.createInitialWorkflow(initialWorkflowInput());
			}),
		).rejects.toBe(cause);
		expect(fake.calls).toHaveLength(callCount);
	});

	it("persists and replays a terminal all-auto initial workflow", async () => {
		const input = terminalInitialWorkflowInput();
		const stage = required(input.snapshot.stages[0]);
		const root = {
			...initialWorkflowRows().root,
			id: input.snapshot.id,
			display_snapshot: input.snapshot.displaySnapshot,
			status: "approved",
			current_stage_order: null,
			version: 1,
			completed_at: new Date(now.epochMilliseconds),
			decision_reason: null,
		};
		const stagePersistence = {
			id: stage.id,
			organization_id: stage.organizationId,
			workflow_id: stage.workflowId,
			stage_order: stage.sequence,
			label: stage.label,
			resolver_snapshot: stage.resolverSnapshot,
			activation_mode: stage.activationMode,
			status: stage.status,
			activated_at: new Date(now.epochMilliseconds),
			decided_at: new Date(now.epochMilliseconds),
			decision_reason: stage.decisionReason,
			legacy_approval_request_id: null,
		};
		const eventRows = input.events.map((event) => ({
			...initialWorkflowRows().event,
			id: event.id,
			workflow_id: event.workflowId,
			version: event.version,
			event_index: event.eventIndex,
			event_type: event.eventType,
			previous_state: event.previousState,
			resulting_state: event.resultingState,
			reason: event.reason,
			metadata: event.metadata,
			idempotency_key: event.idempotencyKey,
			occurred_at: new Date(event.occurredAt.epochMilliseconds),
			created_at: new Date(event.occurredAt.epochMilliseconds),
		}));
		const created = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: input.snapshot.id }] },
			{ rows: [{ id: stage.id }] },
			{ rows: [required(eventRows[0])] },
			{ rows: [required(eventRows[1])] },
			{ rows: [root] },
			{ rows: eventRows },
			{ rows: [stagePersistence] },
			{ rows: [] },
		]);

		await transactionContext(created.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "created",
				snapshot: input.snapshot,
			});
		});

		const replay = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: input.snapshot.id, status: "approved" }] },
			{ rows: [root] },
			{ rows: [stagePersistence] },
			{ rows: [] },
			{ rows: eventRows },
		]);
		await transactionContext(replay.client, async ({ repository }) => {
			await expect(repository.createInitialWorkflow(input)).resolves.toEqual({
				kind: "existing",
				snapshot: input.snapshot,
			});
		});
	});

	it.each([
		["Date", new Date("2026-07-15T08:01:00Z")],
		["PostgreSQL timestamptz text", "2026-07-15 08:01:00+00"],
		["explicit-offset ISO text", "2026-07-15T10:01:00+02:00"],
	] as const)("hydrates assignment.assignedAt from %s", async (_name, assignedAt) => {
		const fake = sequenceClient([
			{ rows: [rootRow()] },
			{ rows: [stageRow()] },
			{ rows: [{ ...assignmentRow(), assigned_at: assignedAt }] },
		]);
		let loaded: ApprovalWorkflowSnapshot | undefined;
		await transactionContext(fake.client, async ({ repository }) => {
			loaded = await repository.loadSnapshot({ organizationId, workflowId });
		});

		expect(loaded?.stages[0]?.assignments[0]?.assignedAt.toString()).toBe(
			"2026-07-15T08:01:00Z",
		);
	});

	it.each([
		["invalid text", "not-a-timestamp"],
		["offset-less date-time text", "2026-07-15T08:01:00"],
		["date-only text", "2026-07-15"],
	] as const)("rejects %s for assignment.assignedAt", async (_name, assignedAt) => {
		const fake = sequenceClient([
			{ rows: [rootRow()] },
			{ rows: [stageRow()] },
			{ rows: [{ ...assignmentRow(), assigned_at: assignedAt }] },
		]);

		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.loadSnapshot({ organizationId, workflowId });
			}),
		).rejects.toMatchObject({
			code: "malformed",
			details: { field: "assignment.assignedAt" },
		});
	});

	it("loads an organization-scoped authoritative snapshot with deterministic child order and Temporal instants", async () => {
		const secondStageId = "40000000-0000-4000-8000-000000000002";
		const secondAssignmentId = "50000000-0000-4000-8000-000000000002";
		const fake = sequenceClient([
			{ rows: [rootRow()] },
			{
				rows: [
					{
						...stageRow(),
						id: secondStageId,
						stage_order: 2,
						status: "waiting",
						activated_at: null,
					},
					stageRow(),
				],
			},
			{
				rows: [
					{
						...assignmentRow(),
						id: secondAssignmentId,
						assignment_sequence: 2,
					},
					assignmentRow(),
				],
			},
		]);
		let loaded: ApprovalWorkflowSnapshot | undefined;
		await transactionContext(fake.client, async ({ repository }) => {
			loaded = await repository.loadSnapshot({ organizationId, workflowId });
		});

		expect(loaded?.stages.map((stage) => stage.id)).toEqual([
			stageId,
			secondStageId,
		]);
		expect(loaded?.stages[0]?.assignments.map((item) => item.id)).toEqual([
			assignmentId,
			secondAssignmentId,
		]);
		expect(loaded?.submittedAt.toString()).toBe("2026-07-15T08:00:00Z");
		expect(loaded?.stages[0]?.assignments[0]?.resolvedBy).toBeNull();
		for (const statement of fake.calls) {
			const rendered = query(statement);
			expect(rendered.params).toEqual(
				expect.arrayContaining([organizationId, workflowId]),
			);
		}
		expect(query(sqlCall(fake.calls, 1)).sql).toContain(
			"order by stage_order, id",
		);
		expect(query(sqlCall(fake.calls, 2)).sql).toContain(
			"order by stage_id, assignment_sequence, id",
		);
	});

	it("does not reveal a same-ID workflow in another organization", async () => {
		const fake = sequenceClient([{ rows: [] }]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.loadSnapshot({
					organizationId: otherOrganizationId,
					workflowId,
				});
			}),
		).rejects.toMatchObject({ code: "not_found" });
		expect(query(sqlCall(fake.calls, 0)).params).toEqual([
			otherOrganizationId,
			workflowId,
		]);
	});

	it("fails closed on malformed physical JSON without leaking another organization", async () => {
		const fake = sequenceClient([
			{ rows: [{ ...rootRow(), policy_snapshot: { invalid: undefined } }] },
			{ rows: [stageRow()] },
			{ rows: [assignmentRow()] },
		]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.loadSnapshot({ organizationId, workflowId });
			}),
		).rejects.toMatchObject({ code: "malformed" });
	});

	it("returns a conflict on zero-row root CAS and prevents later child or event writes", async () => {
		const fake = sequenceClient([{ rows: [] }, { rows: [{ version: 9 }] }]);
		await transactionContext(fake.client, async ({ repository }) => {
			await expect(
				repository.tryAdvanceVersion({
					organizationId,
					workflowId,
					expectedVersion: 4,
				}),
			).resolves.toEqual({ kind: "conflict", version: 9 });
			await expect(
				repository.applyMaterializedTransition(materializedPlan()),
			).rejects.toMatchObject({
				code: "cas_invariant",
			});
		});
		expect(fake.calls).toHaveLength(2);
		for (const statement of fake.calls) {
			expect(query(statement).params).toEqual(
				expect.arrayContaining([organizationId, workflowId]),
			);
		}
	});

	it("rolls back a successful root CAS that is not materialized before the callback completes", async () => {
		const fake = sequenceClient([{ rows: [{ version: 5 }] }]);
		let committed: boolean | undefined;
		const factory = dependencies(fake.client, {
			onTransaction: (didCommit) => {
				committed = didCommit;
			},
		});
		await expect(
			createApprovalWorkflowRepository(factory.input).withTransaction(
				async ({ repository }) => {
					await expect(
						repository.tryAdvanceVersion({
							organizationId,
							workflowId,
							expectedVersion: 4,
						}),
					).resolves.toEqual({ kind: "advanced", version: 5 });
				},
			),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(committed).toBe(false);
		const rendered = query(sqlCall(fake.calls, 0));
		expect(rendered.sql).toContain("set version = version + 1");
		expect(rendered.params).toEqual([organizationId, workflowId, 4]);
	});

	it("does not let a mismatched materialization consume a successful CAS capability", async () => {
		const fake = sequenceClient([{ rows: [{ version: 5 }] }]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.tryAdvanceVersion({
					organizationId,
					workflowId,
					expectedVersion: 4,
				});
				const mismatched = materializedPlan();
				mismatched.expectedVersion = 5;
				mismatched.resultingSnapshot.version = 6;
				mismatched.changes.root.previous.version = 5;
				mismatched.changes.root.resulting.version = 6;
				for (const event of mismatched.events) event.version = 6;
				await expect(
					repository.applyMaterializedTransition(mismatched),
				).rejects.toMatchObject({ code: "cas_invariant" });
			}),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(fake.calls).toHaveLength(1);
	});

	it("applies the exact materialized root, stage, assignment, and append-only event at the committed version", async () => {
		const fake = sequenceClient([
			{ rows: [{ version: 5 }] },
			{ rows: [{ id: workflowId }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [{ id: eventId }] },
		]);
		await transactionContext(fake.client, async ({ repository }) => {
			await repository.tryAdvanceVersion({
				organizationId,
				workflowId,
				expectedVersion: 4,
			});
			await repository.applyMaterializedTransition(materializedPlan());
		});
		const statements = fake.calls.map(query);
		expect(statements).toHaveLength(5);
		expect(statements[1]?.sql).toContain("and version =");
		expect(statements[1]?.params).toEqual(
			expect.arrayContaining([organizationId, workflowId, 5, "approved"]),
		);
		expect(statements[2]?.params).toEqual(
			expect.arrayContaining([organizationId, workflowId, stageId, "approved"]),
		);
		expect(statements[3]?.params).toEqual(
			expect.arrayContaining([
				organizationId,
				workflowId,
				stageId,
				assignmentId,
				"approved",
			]),
		);
		expect(statements[4]?.sql).toContain("insert into approval_workflow_event");
		expect(statements[4]?.sql).not.toMatch(/\b(update|delete)\b/i);
		expect(statements[4]?.params).toEqual(
			expect.arrayContaining([organizationId, workflowId, 5, 0, eventId]),
		);
	});

	it("rejects child changes that do not match the authoritative resulting snapshot before SQL", async () => {
		const fake = sequenceClient([{ rows: [{ version: 5 }] }]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.tryAdvanceVersion({
					organizationId,
					workflowId,
					expectedVersion: 4,
				});
				const plan = materializedPlan();
				plan.changes.stages[0] = {
					...required(plan.changes.stages[0]),
					resulting: {
						...required(plan.changes.stages[0]).resulting,
						label: "caller-derived mismatch",
					},
				};
				await expect(
					repository.applyMaterializedTransition(plan),
				).rejects.toMatchObject({ code: "malformed" });
			}),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(fake.calls).toHaveLength(1);
	});

	it("translates a physical duplicate event conflict into a typed persistence error", async () => {
		const duplicate = Object.assign(new Error("duplicate key"), {
			code: "23505",
		});
		const fake = sequenceClient([
			{ rows: [{ version: 5 }] },
			{ rows: [{ id: workflowId }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			duplicate,
		]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.tryAdvanceVersion({
					organizationId,
					workflowId,
					expectedVersion: 4,
				});
				await repository.applyMaterializedTransition(materializedPlan());
			}),
		).rejects.toMatchObject({ code: "persistence_count" });
	});

	it.each([
		[
			"forged employee actor",
			(plan: ApprovalMaterializedTransitionPlan) => {
				required(plan.events[0]).actor = {
					kind: "employee",
					employeeId: null,
					userId: "user-1",
				} as never;
			},
		],
		[
			"extra actor field",
			(plan: ApprovalMaterializedTransitionPlan) => {
				required(plan.events[0]).actor = {
					...required(plan.events[0]).actor,
					forged: true,
				} as never;
			},
		],
		[
			"allocation reference in persisted event",
			(plan: ApprovalMaterializedTransitionPlan) => {
				required(plan.events[0]).references = {
					assignmentId: {
						kind: "allocate",
						allocationKey: "forged",
					},
				} as never;
			},
		],
		[
			"duplicate event identity",
			(plan: ApprovalMaterializedTransitionPlan) => {
				plan.events.push({
					...required(plan.events[0]),
					eventIndex: 1,
				});
			},
		],
		[
			"extra nested next-action field",
			(plan: ApprovalMaterializedTransitionPlan) => {
				plan.nextAction = { ...plan.nextAction, forged: true } as never;
			},
		],
	] as const)("strictly rejects %s without consuming CAS authority", async (_name, mutate) => {
		const fake = sequenceClient([
			{ rows: [{ version: 5 }] },
			{ rows: [{ id: workflowId }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [{ id: eventId }] },
		]);
		await transactionContext(fake.client, async ({ repository }) => {
			await repository.tryAdvanceVersion({
				organizationId,
				workflowId,
				expectedVersion: 4,
			});
			const invalid = materializedPlan();
			mutate(invalid);
			await expect(
				repository.applyMaterializedTransition(invalid),
			).rejects.toBeInstanceOf(ApprovalWorkflowRepositoryError);
			expect(fake.calls).toHaveLength(1);
			await repository.applyMaterializedTransition(materializedPlan());
		});
		expect(fake.calls).toHaveLength(5);
	});

	it("rolls back every transaction-bound writer when the operation fails", async () => {
		const committed: string[] = [];
		let staged: string[] = [];
		const client = {
			execute: async (statement: SQL) => {
				staged.push(query(statement).sql);
				return { rows: [{ id: "70000000-0000-4000-8000-000000000001" }] };
			},
		};
		const factory = dependencies(client, {
			onTransaction(commit) {
				if (commit) committed.push(...staged);
				staged = [];
			},
		});
		await expect(
			createApprovalWorkflowRepository(factory.input).withTransaction(
				async (context) => {
					await context.outboxWriter.write(required(commandResult().outbox[0]));
					throw new Error("rollback");
				},
			),
		).rejects.toThrow("rollback");
		expect(factory.transactionCalls()).toBe(1);
		expect(committed).toEqual([]);
		expect(staged).toEqual([]);
	});

	it("assembles every context port once from the exact transaction client without nested transactions", async () => {
		const fake = sequenceClient([]);
		const factory = dependencies(fake.client);
		await createApprovalWorkflowRepository(factory.input).withTransaction(
			async (context) => {
				expect(Object.keys(context).sort()).toEqual([
					"activationResolver",
					"adapterRegistry",
					"compatibilityWriter",
					"dbService",
					"outboxWriter",
					"projectionWriter",
					"repository",
					"writeGate",
				]);
				expect("transaction" in context.repository).toBe(false);
				expect("transaction" in context.dbService.db).toBe(false);
				expect(factory.legacyRowWriterDbService()).toBe(context.dbService);
			},
		);
		expect(factory.transactionCalls()).toBe(1);
	});

	it("provides a stage activation resolver when injection is omitted", async () => {
		const fake = sequenceClient([]);
		const factory = dependencies(fake.client);
		const { activationResolver: _activationResolver, ...input } = factory.input;

		await createApprovalWorkflowRepository(input).withTransaction(
			async (context) => {
				expect(context.activationResolver).toEqual({
					resolve: expect.any(Function),
				});
			},
		);
	});

	it("preserves the identity of an explicitly injected activation resolver", async () => {
		const fake = sequenceClient([]);
		const factory = dependencies(fake.client);

		await createApprovalWorkflowRepository(factory.input).withTransaction(
			async (context) => {
				expect(context.activationResolver).toBe(
					factory.input.activationResolver,
				);
			},
		);
	});

	it("allocates deterministic kind-separated canonical UUIDs and preserves intent order", async () => {
		const fake = sequenceClient([]);
		let first: unknown;
		let second: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			const input = {
				organizationId,
				workflowId,
				identityAllocations: [
					{ allocationKey: "same-key", entityKind: "event" as const },
					{
						allocationKey: "same-key",
						entityKind: "assignment" as const,
					},
				],
			};
			first = await repository.allocateTransitionIdentities(input);
			second = await repository.allocateTransitionIdentities(input);
		});
		expect(first).toEqual(second);
		expect(first).toEqual([
			{
				allocationKey: "same-key",
				entityKind: "event",
				id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			},
			{
				allocationKey: "same-key",
				entityKind: "assignment",
				id: expect.stringMatching(/^[0-9a-f-]{36}$/),
			},
		]);
		expect(
			new Set((first as Array<{ id: string }>).map((item) => item.id)).size,
		).toBe(2);
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects duplicate allocation entity-kind and key pairs", async () => {
		const fake = sequenceClient([]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.allocateTransitionIdentities({
					organizationId,
					workflowId,
					identityAllocations: [
						{ allocationKey: "duplicate", entityKind: "event" },
						{ allocationKey: "duplicate", entityKind: "event" },
					],
				});
			}),
		).rejects.toMatchObject({ code: "malformed" });
	});
});

describe("approval command result codec and receipts", () => {
	it("round-trips the exact multi-version command result", () => {
		const result = commandResultWithEventSequence(
			[
				[5, 0],
				[5, 1],
				[6, 0],
			],
			6,
		);

		const decoded = decodeApprovalCommandResult(
			encodeApprovalCommandResult(result),
		);

		expect(decoded).toEqual(result);
		expect(
			decoded.events.map(({ id, version, eventIndex }) => ({
				id,
				version,
				eventIndex,
			})),
		).toEqual([
			{ id: eventId, version: 5, eventIndex: 0 },
			{ id: eventIdTwo, version: 5, eventIndex: 1 },
			{ id: eventIdThree, version: 6, eventIndex: 0 },
		]);
	});

	it("rejects duplicate event IDs across valid version groups", () => {
		const result = commandResultWithEventSequence(
			[
				[5, 0],
				[6, 0],
			],
			6,
		);
		const duplicateId = required(result.events[0]).id;
		required(result.events[1]).id = duplicateId;
		required(result.outbox[1]).eventId = duplicateId;

		expect(() => encodeApprovalCommandResult(result)).toThrowError(
			expect.objectContaining({
				code: "codec_failure",
				details: { field: "event.id" },
			}),
		);
	});

	it.each([
		["empty events", commandResultWithEventSequence([], 6), "event.version"],
		[
			"version below one",
			commandResultWithEventSequence([[0, 0]], 6),
			"event.version",
		],
		[
			"descending version groups",
			commandResultWithEventSequence(
				[
					[6, 0],
					[5, 0],
				],
				5,
			),
			"event.sequence",
		],
		[
			"skipped version groups",
			commandResultWithEventSequence(
				[
					[4, 0],
					[6, 0],
				],
				6,
			),
			"event.sequence",
		],
		[
			"repeated version groups",
			commandResultWithEventSequence(
				[
					[5, 0],
					[6, 0],
					[5, 0],
				],
				5,
			),
			"event.sequence",
		],
		[
			"non-zero initial event index",
			commandResultWithEventSequence([[6, 1]], 6),
			"event.sequence",
		],
		[
			"gapped per-version event indexes",
			commandResultWithEventSequence(
				[
					[5, 0],
					[5, 2],
					[6, 0],
				],
				6,
			),
			"event.sequence",
		],
		[
			"last event version differing from the final snapshot",
			commandResultWithEventSequence(
				[
					[5, 0],
					[5, 1],
					[5, 2],
				],
				6,
			),
			"event.version",
		],
	] as const)("rejects multi-version command result %s", (_name, result, field) => {
		expect(() => encodeApprovalCommandResult(result)).toThrowError(
			expect.objectContaining({
				code: "codec_failure",
				details: { field },
			}),
		);
	});

	it("round-trips the exact result including actor/event references and every Instant", () => {
		const encoded = encodeApprovalCommandResult(commandResult());
		expect(encoded).toMatchObject({ version: 1 });
		const decoded = decodeApprovalCommandResult(encoded);
		expect(decoded).toEqual(commandResult());
		expect(decoded.snapshot.completedAt?.toString()).toBe(
			"2026-07-16T10:00:00Z",
		);
		expect(decoded.events[0]?.references).toEqual({ assignmentId });
		expect(decoded.events[0]?.actor).toEqual({
			kind: "employee",
			employeeId: requesterId,
			userId: "user-1",
		});
		expect(decoded.projection.updatedAt.toString()).toBe(now.toString());
		expect(decoded.outbox[0]?.createdAt.toString()).toBe(now.toString());
	});

	it.each([
		[
			"unknown envelope field",
			{ ...encodeApprovalCommandResult(commandResult()), future: true },
		],
		[
			"unknown version",
			{ ...encodeApprovalCommandResult(commandResult()), version: 2 },
		],
		[
			"malformed instant",
			(() => {
				const value = structuredClone(
					encodeApprovalCommandResult(commandResult()),
				);
				(value.result as JsonObject).snapshot = {
					...((value.result as JsonObject).snapshot as JsonObject),
					submittedAt: "not-an-instant",
				};
				return value;
			})(),
		],
		[
			"unknown result field",
			{
				...encodeApprovalCommandResult(commandResult()),
				result: {
					...(encodeApprovalCommandResult(commandResult())
						.result as JsonObject),
					future: true,
				},
			},
		],
	] as const)("fails closed for %s", (_name, payload) => {
		expect(() => decodeApprovalCommandResult(payload)).toThrowError(
			ApprovalWorkflowRepositoryError,
		);
	});

	it("rejects a decoded result whose projection or event escapes the snapshot scope", () => {
		const projectionMismatch = structuredClone(
			encodeApprovalCommandResult(commandResult()),
		);
		const projectionResult = projectionMismatch.result as JsonObject;
		projectionResult.projection = {
			...(projectionResult.projection as JsonObject),
			organizationId: otherOrganizationId,
		};
		expect(() => decodeApprovalCommandResult(projectionMismatch)).toThrowError(
			ApprovalWorkflowRepositoryError,
		);

		const eventMismatch = structuredClone(
			encodeApprovalCommandResult(commandResult()),
		);
		const eventResult = eventMismatch.result as JsonObject;
		const events = eventResult.events as JsonObject[];
		events[0] = { ...events[0], workflowId: sourceId };
		expect(() => decodeApprovalCommandResult(eventMismatch)).toThrowError(
			ApprovalWorkflowRepositoryError,
		);
	});

	it.each([
		[
			"assignment actor with an extra field",
			(payload: JsonObject) => {
				const result = payload.result as JsonObject;
				const snapshot = result.snapshot as JsonObject;
				const stages = snapshot.stages as JsonObject[];
				const assignments = required(stages[0]).assignments as JsonObject[];
				const assignment = required(assignments[0]);
				assignment.resolvedBy = {
					...(assignment.resolvedBy as JsonObject),
					forged: true,
				};
			},
		],
		[
			"event actor with a null employee id",
			(payload: JsonObject) => {
				const result = payload.result as JsonObject;
				const events = result.events as JsonObject[];
				required(events[0]).actor = {
					kind: "employee",
					employeeId: null,
					userId: "user-1",
				};
			},
		],
		[
			"empty stage label",
			(payload: JsonObject) => {
				const result = payload.result as JsonObject;
				const snapshot = result.snapshot as JsonObject;
				const stages = snapshot.stages as JsonObject[];
				required(stages[0]).label = " ";
			},
		],
		[
			"unknown nested assignment field",
			(payload: JsonObject) => {
				const result = payload.result as JsonObject;
				const snapshot = result.snapshot as JsonObject;
				const stages = snapshot.stages as JsonObject[];
				const assignments = required(stages[0]).assignments as JsonObject[];
				required(assignments[0]).future = true;
			},
		],
	] as const)("fails closed for malformed nested %s", (_name, mutate) => {
		const payload = structuredClone(
			encodeApprovalCommandResult(commandResult()),
		);
		mutate(payload);
		expect(() => decodeApprovalCommandResult(payload)).toThrowError(
			ApprovalWorkflowRepositoryError,
		);
	});

	it("claims a command with atomic insert-on-conflict semantics and injected timestamps", async () => {
		const fake = sequenceClient([
			{ rows: [{ id: "70000000-0000-4000-8000-000000000001" }] },
		]);
		let claim: unknown;
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				claim = await repository.claimCommand({
					organizationId,
					workflowId,
					idempotencyKey: "same-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
		expect(claim).toEqual({ kind: "reserved" });
		const rendered = query(sqlCall(fake.calls, 0));
		expect(rendered.sql).toContain("insert into approval_workflow_command");
		expect(rendered.sql).toContain(
			"on conflict (organization_id, workflow_id, idempotency_key) do nothing",
		);
		expect(rendered.sql).toContain("returning id");
		expect(rendered.params).toEqual(
			expect.arrayContaining([
				organizationId,
				workflowId,
				"same-key",
				"actor-v1",
				"command-v1",
				new Date(now.epochMilliseconds),
			]),
		);
	});

	it("waits through PostgreSQL conflict handling, then returns the scoped winner's completed result", async () => {
		const encoded = encodeApprovalCommandResult(commandResult());
		const fake = sequenceClient([
			{ rows: [] },
			{
				rows: [
					{
						actor_fingerprint: "actor-v1",
						command_fingerprint: "command-v1",
						state: "completed",
						result: encoded,
					},
				],
			},
		]);
		await transactionContext(fake.client, async ({ repository }) => {
			await expect(
				repository.claimCommand({
					organizationId,
					workflowId,
					idempotencyKey: "same-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				}),
			).resolves.toEqual({ kind: "completed", result: commandResult() });
		});
		const read = query(sqlCall(fake.calls, 1));
		expect(read.sql).toContain("for update");
		expect(read.params).toEqual([organizationId, workflowId, "same-key"]);
	});

	it("returns fingerprint mismatch and treats a visible matching reservation as an invariant error", async () => {
		const mismatch = sequenceClient([
			{ rows: [] },
			{
				rows: [
					{
						actor_fingerprint: "other",
						command_fingerprint: "command-v1",
						state: "completed",
						result: encodeApprovalCommandResult(commandResult()),
					},
				],
			},
		]);
		await transactionContext(mismatch.client, async ({ repository }) => {
			await expect(
				repository.claimCommand({
					organizationId,
					workflowId,
					idempotencyKey: "same-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				}),
			).resolves.toEqual({ kind: "fingerprint_mismatch" });
		});

		const reserved = sequenceClient([
			{ rows: [] },
			{
				rows: [
					{
						actor_fingerprint: "actor-v1",
						command_fingerprint: "command-v1",
						state: "reserved",
						result: null,
					},
				],
			},
		]);
		await expect(
			transactionContext(reserved.client, async ({ repository }) => {
				await repository.claimCommand({
					organizationId,
					workflowId,
					idempotencyKey: "same-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
	});

	it("keeps the same command key independent across organizations", async () => {
		const fake = sequenceClient([{ rows: [{ id: eventId }] }]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.claimCommand({
					organizationId: otherOrganizationId,
					workflowId,
					idempotencyKey: "same-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
		expect(query(sqlCall(fake.calls, 0)).params).toContain(otherOrganizationId);
		expect(query(sqlCall(fake.calls, 0)).params).not.toContain(organizationId);
	});

	it("completes only the scoped matching reserved receipt and requires exactly one affected row", async () => {
		const identity = {
			organizationId,
			workflowId,
			idempotencyKey: "same-key",
			actorFingerprint: "actor-v1",
			commandFingerprint: "command-v1",
		};
		const fake = sequenceClient([
			{ rows: [{ id: eventId }] },
			{ rows: [{ id: eventId }] },
		]);
		await transactionContext(fake.client, async ({ repository }) => {
			await repository.claimCommand(identity);
			await repository.completeCommand({
				...identity,
				result: commandResult(),
			});
		});
		const rendered = query(sqlCall(fake.calls, 1));
		expect(rendered.sql).toContain("state = 'reserved'");
		expect(rendered.params).toEqual(
			expect.arrayContaining([
				organizationId,
				workflowId,
				"same-key",
				"actor-v1",
				"command-v1",
			]),
		);

		const missing = sequenceClient([{ rows: [{ id: eventId }] }, { rows: [] }]);
		await expect(
			transactionContext(missing.client, async ({ repository }) => {
				await repository.claimCommand(identity);
				await repository.completeCommand({
					...identity,
					result: commandResult(),
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
	});

	it.each([
		[otherOrganizationId, workflowId],
		[organizationId, sourceId],
	] as const)("rejects completion results outside receipt scope %s/%s before update", async (resultOrganizationId, resultWorkflowId) => {
		const fake = sequenceClient([{ rows: [{ id: eventId }] }]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				const identity = {
					organizationId,
					workflowId,
					idempotencyKey: "scope-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				};
				await repository.claimCommand(identity);
				await repository.completeCommand({
					...identity,
					result: commandResultForScope(resultOrganizationId, resultWorkflowId),
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
		expect(fake.calls).toHaveLength(1);
	});

	it.each([
		[otherOrganizationId, workflowId],
		[organizationId, sourceId],
	] as const)("rejects a completed stored result outside receipt scope %s/%s", async (resultOrganizationId, resultWorkflowId) => {
		const fake = sequenceClient([
			{ rows: [] },
			{
				rows: [
					{
						actor_fingerprint: "actor-v1",
						command_fingerprint: "command-v1",
						state: "completed",
						result: encodeApprovalCommandResult(
							commandResultForScope(resultOrganizationId, resultWorkflowId),
						),
					},
				],
			},
		]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.claimCommand({
					organizationId,
					workflowId,
					idempotencyKey: "scope-key",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				});
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
	});

	it("rolls back multiple reservations when only a subset is completed", async () => {
		const fake = sequenceClient([
			{ rows: [{ id: "70000000-0000-4000-8000-000000000001" }] },
			{ rows: [{ id: "70000000-0000-4000-8000-000000000002" }] },
			{ rows: [{ id: "70000000-0000-4000-8000-000000000001" }] },
		]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				const first = {
					organizationId,
					workflowId,
					idempotencyKey: "first",
					actorFingerprint: "actor-v1",
					commandFingerprint: "command-v1",
				};
				await repository.claimCommand(first);
				await repository.claimCommand({ ...first, idempotencyKey: "second" });
				await repository.completeCommand({ ...first, result: commandResult() });
			}),
		).rejects.toMatchObject({ code: "command_invariant" });
		expect(fake.calls).toHaveLength(3);
	});
});

describe("observed legacy persistence and append-only guard", () => {
	function observedInput(): ObservedLegacyTransition {
		const source = {
			organizationId,
			workflowType: "absence" as const,
			sourceType: "absence_entry",
			sourceId,
		};
		const verified = {
			organizationId,
			source,
			approvalRequest: null,
			chain: null,
			chainRows: [],
			sourceSnapshot: { status: "approved" },
			capturedAt: now,
		};
		return {
			organizationId,
			source,
			before: { ...verified, sourceSnapshot: { status: "pending" } },
			after: verified,
			actor: { kind: "legacy_unknown", employeeId: null, userId: null },
			idempotencyKey: "legacy-observation-1",
			expectedVersion: 4,
		};
	}

	function observedInputWithNestedEvidence(): ObservedLegacyTransition {
		const input = observedInput();
		const approvalRequestId = "70000000-0000-4000-8000-000000000001";
		const chainId = "70000000-0000-4000-8000-000000000002";
		const policyId = "70000000-0000-4000-8000-000000000003";
		const policyStageId = "70000000-0000-4000-8000-000000000004";
		const chainRowId = "70000000-0000-4000-8000-000000000005";
		const approvalRequest = {
			id: approvalRequestId,
			organizationId,
			entityType: input.source.sourceType,
			entityId: sourceId,
			requestedBy: requesterId,
			approverId: requesterId,
			status: "pending" as const,
			reason: "annual leave",
			rejectionReason: null,
			approvedAt: null,
			metadata: { origin: "legacy" },
			updatedAt: now,
		};
		const chain = {
			id: chainId,
			organizationId,
			policyId,
			policyNameSnapshot: "Absence approval",
			entityType: input.source.sourceType,
			entityId: sourceId,
			requesterEmployeeId: requesterId,
			currentStageOrder: 1,
			status: "pending" as const,
			createdAt: now,
			updatedAt: now,
			completedAt: null,
		};
		const chainRow = {
			id: chainRowId,
			organizationId,
			chainInstanceId: chainId,
			policyStageId,
			stepOrder: 1,
			labelSnapshot: "Manager",
			approverTypeSnapshot: "employee",
			resolvedApproverEmployeeId: requesterId,
			approvalRequestId,
			status: "pending" as const,
			decidedBy: null,
			decidedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		return {
			...input,
			before: {
				...input.before,
				approvalRequest,
				chain,
				chainRows: [chainRow],
			},
			after: {
				...input.after,
				approvalRequest: {
					...approvalRequest,
					status: "approved",
					approvedAt: now,
				},
				chain: {
					...chain,
					status: "approved",
					completedAt: now,
				},
				chainRows: [
					{
						...chainRow,
						status: "approved",
						decidedBy: requesterId,
						decidedAt: now,
					},
				],
			},
		};
	}

	it("rejects a stateful expectedVersion getter before planner and SQL", async () => {
		let reads = 0;
		let plannerCalls = 0;
		const input = observedInput();
		Object.defineProperty(input, "expectedVersion", {
			configurable: true,
			enumerable: true,
			get() {
				reads += 1;
				return reads <= 3 ? 4 : null;
			},
		});
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion(1);
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects a stateful nested scope getter before planner and SQL", async () => {
		let reads = 0;
		let plannerCalls = 0;
		const input = observedInput();
		Object.defineProperty(input.after.source, "organizationId", {
			configurable: true,
			enumerable: true,
			get() {
				reads += 1;
				return reads === 1 ? organizationId : otherOrganizationId;
			},
		});
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion();
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"non-plain prototype",
			(input: ObservedLegacyTransition) => {
				Object.setPrototypeOf(input.after.source, { hostile: true });
			},
		],
		[
			"sparse array",
			(input: ObservedLegacyTransition) => {
				input.after.chainRows = new Array(1) as never;
			},
		],
		[
			"augmented array",
			(input: ObservedLegacyTransition) => {
				Object.defineProperty(input.after.chainRows, "hostile", {
					enumerable: true,
					value: true,
				});
			},
		],
		[
			"reflection failure",
			(input: ObservedLegacyTransition) => {
				input.after.source = new Proxy(input.after.source, {
					ownKeys() {
						throw new Error("reflection failed");
					},
				});
			},
		],
	] as const)("rejects observed input with %s before planner and SQL", async (_name, mutate) => {
		let plannerCalls = 0;
		const input = observedInput();
		mutate(input);
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion();
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it("preserves genuine evidence-only Temporal Instants during normalization", async () => {
		const evidenceInstant = parseInstant("2026-07-16T10:11:12.345000001Z");
		const input = observedInput();
		input.before.capturedAt = evidenceInstant;
		input.after.capturedAt = evidenceInstant;
		let observedInstant: unknown;
		const fake = sequenceClient([
			{ rows: [{ id: workflowId, version: 5 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [persistedEventRow()] },
		]);
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				await repository.applyObservedLegacyTransition(input);
			},
			{
				observationPlanner: {
					plan: async (normalizedInput) => {
						observedInstant = normalizedInput.after.capturedAt;
						return observedResultAtVersion();
					},
				},
			},
		);
		expect(isInstant(observedInstant)).toBe(true);
		expect(observedInstant).toBe(evidenceInstant);
		expect(fake.calls).toHaveLength(4);
	});

	it("rejects expected and resulting version inconsistency before SQL", async () => {
		let plannerCalls = 0;
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion(6);
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(plannerCalls).toBe(1);
		expect(fake.calls).toHaveLength(0);
	});

	it("does not insert a missing root when expectedVersion requires an existing version", async () => {
		const fake = sequenceClient([{ rows: [] }, { rows: [] }]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{
					observationPlanner: {
						plan: async () => observedResultAtVersion(),
					},
				},
			),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(fake.calls).toHaveLength(2);
		expect(query(sqlCall(fake.calls, 0)).sql).toContain(
			"update approval_workflow",
		);
		expect(query(sqlCall(fake.calls, 0)).sql).not.toContain(
			"insert into approval_workflow",
		);
	});

	it("rejects a hostile planner deliver disposition before root SQL", async () => {
		const fake = sequenceClient([{ rows: [{ id: workflowId, version: 5 }] }]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{
					observationPlanner: {
						plan: async () =>
							commandResult() as unknown as ObservedLegacyTransitionPlan,
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects a stateful planner outbox disposition getter before root SQL", async () => {
		let reads = 0;
		const planned = observedResultAtVersion();
		Object.defineProperty(required(planned.outbox[0]), "disposition", {
			configurable: true,
			enumerable: true,
			get() {
				reads += 1;
				return reads <= 2 ? "observe" : "deliver";
			},
		});
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{ observationPlanner: { plan: async () => planned } },
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects a stateful planner nested scope getter before root SQL", async () => {
		let reads = 0;
		const planned = observedResultAtVersion();
		Object.defineProperty(planned.snapshot, "organizationId", {
			configurable: true,
			enumerable: true,
			get() {
				reads += 1;
				return reads === 1 ? organizationId : otherOrganizationId;
			},
		});
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{ observationPlanner: { plan: async () => planned } },
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"non-plain prototype",
			(plan: ObservedLegacyTransitionPlan) => {
				Object.setPrototypeOf(plan.projection, { hostile: true });
			},
		],
		[
			"sparse array",
			(plan: ObservedLegacyTransitionPlan) => {
				plan.events = new Array(1) as never;
			},
		],
		[
			"augmented array",
			(plan: ObservedLegacyTransitionPlan) => {
				Object.defineProperty(plan.outbox, "hostile", {
					enumerable: true,
					value: true,
				});
			},
		],
		[
			"reflection failure",
			(plan: ObservedLegacyTransitionPlan) => {
				plan.projection = new Proxy(plan.projection, {
					getOwnPropertyDescriptor() {
						throw new Error("reflection failed");
					},
				});
			},
		],
	] as const)("rejects planner result with %s before root SQL", async (_name, mutate) => {
		const planned = observedResultAtVersion();
		mutate(planned);
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{ observationPlanner: { plan: async () => planned } },
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"root",
			(plan: ObservedLegacyTransitionPlan, value: typeof now) => {
				plan.snapshot.submittedAt = value;
			},
		],
		[
			"stage",
			(plan: ObservedLegacyTransitionPlan, value: typeof now) => {
				required(plan.snapshot.stages[0]).activatedAt = value;
			},
		],
		[
			"assignment",
			(plan: ObservedLegacyTransitionPlan, value: typeof now) => {
				required(required(plan.snapshot.stages[0]).assignments[0]).assignedAt =
					value;
			},
		],
		[
			"event",
			(plan: ObservedLegacyTransitionPlan, value: typeof now) => {
				required(plan.events[0]).occurredAt = value;
			},
		],
		[
			"projection",
			(plan: ObservedLegacyTransitionPlan, value: typeof now) => {
				plan.projection.updatedAt = value;
			},
		],
		[
			"outbox",
			(plan: ObservedLegacyTransitionPlan, value: typeof now) => {
				required(plan.outbox[0]).createdAt = value;
			},
		],
	] as const)("rejects a non-DB-representable planner %s Instant before SQL", async (_name, mutate) => {
		const planned = observedResultAtVersion();
		mutate(planned, parseInstant("2026-07-16T10:11:12.345000001Z"));
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{ observationPlanner: { plan: async () => planned } },
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects malformed nested observed evidence before planner and SQL", async () => {
		let plannerCalls = 0;
		const input = observedInputWithNestedEvidence();
		input.after.chainRows[0] = {
			...required(input.after.chainRows[0]),
			forged: true,
		} as never;
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion();
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"foreign organization",
			(input: ObservedLegacyTransition) => {
				if (!input.after.approvalRequest) throw new Error("fixture");
				input.after.approvalRequest.organizationId = otherOrganizationId;
			},
		],
		[
			"foreign source",
			(input: ObservedLegacyTransition) => {
				if (!input.after.chain) throw new Error("fixture");
				input.after.chain.entityId = assignmentId;
			},
		],
	] as const)("rejects nested observed evidence with %s before planner and SQL", async (_name, mutate) => {
		let plannerCalls = 0;
		const input = observedInputWithNestedEvidence();
		mutate(input);
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion();
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"actor",
			(input: ObservedLegacyTransition) => {
				input.actor = {
					kind: "employee",
					employeeId: null,
					userId: "user-1",
				} as never;
			},
		],
		[
			"Temporal instant",
			(input: ObservedLegacyTransition) => {
				input.after.capturedAt = new Date(now.epochMilliseconds) as never;
			},
		],
		[
			"metadata",
			(input: ObservedLegacyTransition) => {
				if (!input.after.approvalRequest) throw new Error("fixture");
				input.after.approvalRequest.metadata = { invalid: undefined } as never;
			},
		],
	] as const)("rejects malformed observed %s before planner and SQL", async (_name, mutate) => {
		let plannerCalls = 0;
		const input = observedInputWithNestedEvidence();
		mutate(input);
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion();
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it("normalizes hostile observed input access to a typed malformed error before planner and SQL", async () => {
		let plannerCalls = 0;
		const input = observedInput();
		Object.defineProperty(input, "after", {
			configurable: true,
			enumerable: true,
			get() {
				throw new Error("hostile getter");
			},
		});
		const fake = sequenceClient([]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => {
							plannerCalls += 1;
							return observedResultAtVersion();
						},
					},
				},
			),
		).rejects.toMatchObject({ code: "malformed" });
		expect(plannerCalls).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it("accepts scoped chain history that references an older approval request", async () => {
		let plannerCalls = 0;
		const input = observedInputWithNestedEvidence();
		input.expectedVersion = null;
		const olderApprovalRequestId = "70000000-0000-4000-8000-000000000006";
		for (const state of [input.before, input.after]) {
			required(state.chainRows[0]).approvalRequestId = olderApprovalRequestId;
		}
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: workflowId, version: 1 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [persistedEventRow({ version: 1 })] },
		]);
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				await repository.applyObservedLegacyTransition(input);
			},
			{
				observationPlanner: {
					plan: async () => {
						plannerCalls += 1;
						return observedResultAtVersion(1);
					},
				},
			},
		);
		expect(plannerCalls).toBe(1);
		expect(fake.calls).toHaveLength(6);
	});

	it("delegates only pure observation planning while owning canonical aggregate and exact-once event persistence", async () => {
		const input = observedInputWithNestedEvidence();
		input.expectedVersion = null;
		let plannerCalls = 0;
		const planner = {
			async plan() {
				plannerCalls += 1;
				return observedResultAtVersion(1);
			},
		};
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: workflowId, version: 1 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [persistedEventRow({ version: 1 })] },
		]);
		let result: unknown;
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				result = await repository.applyObservedLegacyTransition(input);
			},
			{ observationPlanner: planner },
		);
		expect(plannerCalls).toBe(1);
		expect(result).toMatchObject({
			events: [{ idempotencyKey: "legacy-observation-1" }],
			eventPersistence: {
				kind: "aggregate_and_events_persisted",
				eventIds: [eventId],
			},
		});
		for (const statement of fake.calls.slice(1)) {
			expect(query(statement).params).toContain(organizationId);
		}
		const rootInsert = query(sqlCall(fake.calls, 2)).sql;
		expect(rootInsert).toContain("on conflict (id) do nothing");
		expect(rootInsert).not.toContain("do update set");
		const observedStageWrite = query(sqlCall(fake.calls, 3)).sql;
		expect(observedStageWrite).toContain("label = excluded.label");
		expect(observedStageWrite).toContain(
			"resolver_snapshot = excluded.resolver_snapshot",
		);
		const observedAssignmentWrite = query(sqlCall(fake.calls, 4)).sql;
		expect(observedAssignmentWrite).toContain(
			"assignment_sequence = excluded.assignment_sequence",
		);
		expect(observedAssignmentWrite).toContain(
			"approver_employee_id = excluded.approver_employee_id",
		);
		expect(
			fake.calls.map((statement) => query(statement).sql).join("\n"),
		).not.toContain("finalize");
	});

	it("locks the exact typed source before persisting an initial observed root", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const planned = observedResultAtVersion(1);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: workflowId, version: 1 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [persistedEventRow({ version: 1 })] },
		]);

		await transactionContext(
			fake.client,
			async ({ repository }) => {
				await repository.applyObservedLegacyTransition(input);
			},
			{ observationPlanner: { plan: async () => planned } },
		);

		const lock = query(required(fake.calls[0]));
		expect(lock.sql).toContain("pg_advisory_xact_lock");
		expect(lock.params).toEqual([
			JSON.stringify([organizationId, "absence", "absence_entry", sourceId]),
		]);
		const lookup = query(required(fake.calls[1]));
		expect(lookup.sql).toContain("workflow_type =");
		expect(lookup.sql).toContain("status = 'pending'");
		expect(lookup.params).toEqual(
			expect.arrayContaining([
				organizationId,
				"absence",
				"absence_entry",
				sourceId,
				workflowId,
			]),
		);
	});

	it("rejects a different observed pending cycle with a typed source conflict", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const planned = observedResultAtVersion(1);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{
				rows: [
					{
						id: "10000000-0000-4000-8000-000000000099",
						status: "pending",
					},
				],
			},
		]);

		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{ observationPlanner: { plan: async () => planned } },
			),
		).rejects.toMatchObject({ code: "source_conflict" });
		expect(fake.calls).toHaveLength(2);
	});

	it("replays an exact terminal observation without duplicating events", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const planned = observedResultAtVersion(1);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: workflowId, status: "approved" }] },
			{ rows: [approvedRootRow({ version: 1 })] },
			{ rows: [approvedStageRow()] },
			{ rows: [approvedAssignmentRow()] },
			{ rows: [persistedEventRow({ version: 1 })] },
		]);

		let result: ObservedLegacyTransitionResult | undefined;
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				result = await repository.applyObservedLegacyTransition(input);
			},
			{ observationPlanner: { plan: async () => planned } },
		);

		expect(result?.snapshot.status).toBe("approved");
		expect(result?.events).toHaveLength(1);
		expect(
			fake.calls.slice(2).every((statement) => {
				const rendered = query(statement).sql;
				return !/^\s*(?:insert|update|delete)\b/i.test(rendered);
			}),
		).toBe(true);
	});

	it("canonicalizes omitted event references on first observed write", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const planned = observedResultAtVersion(1);
		delete planned.events[0]?.references;
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [] },
			{ rows: [{ id: workflowId, version: 1 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{
				rows: [
					persistedEventRow({
						version: 1,
						metadata: { source: "command" },
					}),
				],
			},
		]);
		let result: ObservedLegacyTransitionResult | undefined;
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				result = await repository.applyObservedLegacyTransition(input);
			},
			{ observationPlanner: { plan: async () => planned } },
		);
		expect(result?.events[0]?.references).toEqual({});
		expect(fake.calls).toHaveLength(6);
	});

	it("returns hydrated canonical evidence for an exact duplicate with omitted event references", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const planned = observedResultAtVersion(1);
		delete planned.events[0]?.references;
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: workflowId, status: "approved" }] },
			{ rows: [approvedRootRow({ version: 1 })] },
			{ rows: [approvedStageRow()] },
			{ rows: [approvedAssignmentRow()] },
			{
				rows: [
					persistedEventRow({
						version: 1,
						metadata: { source: "command" },
					}),
				],
			},
		]);
		let result: ObservedLegacyTransitionResult | undefined;
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				result = await repository.applyObservedLegacyTransition(input);
			},
			{ observationPlanner: { plan: async () => planned } },
		);
		expect(result?.events[0]?.references).toEqual({});
		expect(result?.events[0]).not.toBe(planned.events[0]);
		expect(fake.calls).toHaveLength(6);
	});

	it("reconstructs a duplicate observation without appending duplicate events", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const planned = observedResultAtVersion(1);
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: workflowId, status: "approved" }] },
			{ rows: [approvedRootRow({ version: 1 })] },
			{ rows: [approvedStageRow()] },
			{ rows: [approvedAssignmentRow()] },
			{ rows: [persistedEventRow({ version: 1 })] },
		]);
		let result: unknown;
		await transactionContext(
			fake.client,
			async ({ repository }) => {
				result = await repository.applyObservedLegacyTransition(input);
			},
			{
				observationPlanner: {
					plan: async () => planned,
				},
			},
		);
		expect(result).toMatchObject({
			snapshot: { version: 1 },
			events: [
				{
					id: eventId,
					idempotencyKey: "legacy-observation-1",
					occurredAt: now,
				},
			],
			eventPersistence: { eventIds: [eventId] },
		});
		expect((result as ObservedLegacyTransitionResult).snapshot).not.toBe(
			planned.snapshot,
		);
		expect((result as ObservedLegacyTransitionResult).events[0]).not.toBe(
			planned.events[0],
		);
		expect(fake.calls).toHaveLength(6);
		expect(
			fake.calls.slice(2).every((statement) => {
				const sql = query(statement).sql;
				return !/^\s*(?:insert|update|delete)\b/i.test(sql);
			}),
		).toBe(true);
	});

	it("wins an existing observed root only with scoped before-to-after CAS", async () => {
		const fake = sequenceClient([
			{ rows: [{ id: workflowId, version: 5 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [persistedEventRow()] },
		]);
		await transactionContext(fake.client, async ({ repository }) => {
			await repository.applyObservedLegacyTransition(observedInput());
		});
		const cas = query(sqlCall(fake.calls, 0));
		expect(cas.sql).toContain("update approval_workflow");
		expect(cas.sql).toContain("and version =");
		expect(cas.sql).toContain("and source_type =");
		expect(cas.sql).toContain("and source_id =");
		expect(cas.params).toEqual(
			expect.arrayContaining([organizationId, workflowId, 4, 5]),
		);
	});

	it("reconstructs the winner when an observed-event insert loses a concurrent race", async () => {
		const fake = sequenceClient([
			{ rows: [{ id: workflowId, version: 5 }] },
			{ rows: [{ id: stageId }] },
			{ rows: [{ id: assignmentId }] },
			{ rows: [] },
			{ rows: [persistedEventRow()] },
		]);
		let result: unknown;
		await transactionContext(fake.client, async ({ repository }) => {
			result = await repository.applyObservedLegacyTransition(observedInput());
		});
		expect(result).toMatchObject({
			events: [{ id: eventId, idempotencyKey: "legacy-observation-1" }],
			eventPersistence: { eventIds: [eventId] },
		});
		const conflictRead = query(sqlCall(fake.calls, 4));
		expect(conflictRead.sql).toContain("from approval_workflow_event");
		expect(conflictRead.params).toEqual([
			organizationId,
			"legacy-observation-1",
		]);
	});

	it("does not advance a newer root with an explicit stale expectedVersion", async () => {
		const fake = sequenceClient([
			{ rows: [] },
			{ rows: [approvedRootRow({ version: 6 })] },
			{ rows: [approvedStageRow()] },
			{ rows: [approvedAssignmentRow()] },
		]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(observedInput());
				},
				{
					observationPlanner: {
						plan: async () => observedResultAtVersion(),
					},
				},
			),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(fake.calls).toHaveLength(5);
		const childWrites = fake.calls
			.slice(1)
			.filter((statement) =>
				/^\s*(?:insert|update|delete)\b/i.test(query(statement).sql),
			);
		expect(childWrites).toEqual([]);
	});

	it("does not advance a non-identical existing root when expectedVersion is null", async () => {
		const input = observedInput();
		input.expectedVersion = null;
		const fake = sequenceClient([
			{ rows: [{ locked: true }] },
			{ rows: [{ id: workflowId, status: "approved" }] },
			{ rows: [approvedRootRow({ version: 1, decision_reason: "different" })] },
			{ rows: [approvedStageRow()] },
			{ rows: [approvedAssignmentRow()] },
		]);
		await expect(
			transactionContext(
				fake.client,
				async ({ repository }) => {
					await repository.applyObservedLegacyTransition(input);
				},
				{
					observationPlanner: {
						plan: async () => observedResultAtVersion(1),
					},
				},
			),
		).rejects.toMatchObject({ code: "cas_invariant" });
		expect(fake.calls).toHaveLength(6);
		expect(query(sqlCall(fake.calls, 2)).sql).toContain(
			"from approval_workflow",
		);
		expect(
			fake.calls.some((statement) =>
				query(statement).sql.includes("update approval_workflow set"),
			),
		).toBe(false);
	});

	it("rejects immutable source evidence changes before SQL", async () => {
		const input = observedInput();
		input.after = {
			...input.after,
			source: { ...input.after.source, sourceId: assignmentId },
		};
		const fake = sequenceClient([]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.applyObservedLegacyTransition(input);
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.calls).toHaveLength(0);
	});

	it.each([
		[
			"child mismatch",
			[approvedStageRow({ label: "Different" })],
			[approvedAssignmentRow()],
			[persistedEventRow()],
		],
		[
			"full event mismatch",
			[approvedStageRow()],
			[approvedAssignmentRow()],
			[persistedEventRow({ reason: "different" })],
		],
		[
			"event creation timestamp mismatch",
			[approvedStageRow()],
			[approvedAssignmentRow()],
			[
				persistedEventRow({
					created_at: new Date(now.epochMilliseconds + 1_000),
				}),
			],
		],
	] as const)("rejects an observed duplicate with %s", async (_name, stages, assignments, events) => {
		const fake = sequenceClient([
			{ rows: [] },
			{ rows: [approvedRootRow()] },
			{ rows: stages },
			{ rows: assignments },
			{ rows: events },
		]);
		await expect(
			transactionContext(fake.client, async ({ repository }) => {
				await repository.applyObservedLegacyTransition(observedInput());
			}),
		).rejects.toMatchObject({ code: "persistence_count" });
	});
});
