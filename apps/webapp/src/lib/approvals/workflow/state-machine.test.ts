import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ApprovedCancellationAuthorization,
	createApprovalDomainAdapterRegistry,
} from "../domain-adapters/registry";
import type {
	ApprovalAssignmentSnapshot,
	ApprovalCommandActor,
	ApprovalPlannedStageSnapshot,
	ApprovalStageSnapshot,
	ApprovalTransitionPlan,
	ApprovalWorkflowSnapshot,
	ResolvedStage,
} from "./ports";
import * as stateMachineModule from "./state-machine";
import {
	APPROVAL_EVENT_REFERENCES_METADATA_KEY,
	ApprovalStateMachineError,
	type ApprovalWorkflowCommand,
	type ApprovalWorkflowPolicy,
	deserializeApprovalWorkflowEventMetadata,
	fingerprintApprovalCommandActor,
	materializeApprovalTransitionPlan,
	planStageActivation,
	planWorkflowTransition,
	serializeApprovalWorkflowEventMetadata,
} from "./state-machine";

const now = parseInstant("2026-07-16T14:00:00Z");
const submittedAt = parseInstant("2026-07-15T09:00:00Z");
const activatedAt = parseInstant("2026-07-15T10:00:00Z");
const organizationId = "org-1";
const workflowId = "10000000-0000-4000-8000-000000000001";
const requesterEmployeeId = "20000000-0000-4000-8000-000000000001";
const approverOne = "30000000-0000-4000-8000-000000000001";
const approverTwo = "30000000-0000-4000-8000-000000000002";
const approverThree = "30000000-0000-4000-8000-000000000003";
const approverFour = "30000000-0000-4000-8000-000000000004";
const stageOneId = "40000000-0000-4000-8000-000000000001";
const stageTwoId = "40000000-0000-4000-8000-000000000002";
const assignmentOneId = "50000000-0000-4000-8000-000000000001";
const assignmentTwoId = "50000000-0000-4000-8000-000000000002";
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const managerActor: ApprovalCommandActor = {
	kind: "employee",
	employeeId: "30000000-0000-4000-8000-000000000099",
	userId: "31000000-0000-4000-8000-000000000099",
};
const systemCommandActor: ApprovalCommandActor = {
	kind: "system",
	employeeId: null,
	userId: null,
};
const standardPolicy: ApprovalWorkflowPolicy = { kind: "standard" };
let approvedCancellationAuthorization: ApprovedCancellationAuthorization;
let approvedCancellationPolicy: ApprovalWorkflowPolicy = standardPolicy;

function createAuthorizationRegistry() {
	const adapter = (workflowType: string, sourceType: string) =>
		({
			workflowType,
			sourceType,
			getTrustedCapabilities: async () => ({ canCancelAfterApproval: true }),
		}) as never;
	return createApprovalDomainAdapterRegistry({
		absence: adapter("absence", "absence_entry"),
		time_correction: adapter("time_correction", "time_correction"),
		manual_time_submission: adapter(
			"manual_time_submission",
			"manual_time_submission",
		),
		policy_clock_out: adapter("policy_clock_out", "policy_clock_out"),
		travel_expense: adapter("travel_expense", "travel_expense"),
		shift_request: adapter("shift_request", "shift_request"),
		compliance_exception: adapter(
			"compliance_exception",
			"compliance_exception",
		),
	});
}

async function authorizeApprovedCancellationFor(
	workflow: ApprovalWorkflowSnapshot,
): Promise<ApprovedCancellationAuthorization> {
	return createAuthorizationRegistry().authorizeApprovedCancellation({
		organizationId: workflow.organizationId,
		workflow,
		sourceIdentity: workflow,
		source: {},
		actor: managerActor,
	});
}

beforeAll(async () => {
	approvedCancellationAuthorization = await authorizeApprovedCancellationFor(
		pendingWorkflow(),
	);
	approvedCancellationPolicy = {
		kind: "approved_cancellation",
		authorization: approvedCancellationAuthorization,
	};
});

function assignment(
	id: string,
	stageId: string,
	sequence: number,
	approverEmployeeId: string,
): ApprovalAssignmentSnapshot {
	return {
		id,
		organizationId,
		workflowId,
		stageId,
		sequence,
		approverEmployeeId,
		status: "pending",
		assignedAt: activatedAt,
		resolvedAt: null,
		resolvedBy: null,
		reassignedByEmployeeId: null,
		reassignedFromAssignmentId: null,
		reassignmentMetadata: null,
	};
}

function stage(input: {
	id: string;
	sequence: number;
	status: "waiting" | "pending";
	activationMode?: string;
	assignments?: ApprovalAssignmentSnapshot[];
}): ApprovalStageSnapshot {
	return {
		id: input.id,
		organizationId,
		workflowId,
		sequence: input.sequence,
		label: `Stage ${input.sequence}`,
		resolverSnapshot: { resolver: "fixture" },
		activationMode: input.activationMode ?? "human",
		status: input.status,
		activatedAt: input.status === "pending" ? activatedAt : null,
		decidedAt: null,
		decisionReason: null,
		legacyApprovalRequestId: null,
		assignments: input.assignments ?? [],
	};
}

function pendingWorkflow(options?: {
	secondStage?: boolean;
	activeAssignments?: ApprovalAssignmentSnapshot[];
	activeMode?: string;
	secondMode?: string;
}): ApprovalWorkflowSnapshot {
	const activeAssignments = options?.activeAssignments ?? [
		assignment(assignmentOneId, stageOneId, 1, approverOne),
		assignment(assignmentTwoId, stageOneId, 2, approverTwo),
	];
	return {
		id: workflowId,
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: "60000000-0000-4000-8000-000000000001",
		requesterEmployeeId,
		status: "pending",
		currentStageOrder: 1,
		version: 7,
		policySnapshot: { policy: "frozen" },
		contextSnapshot: { context: "frozen" },
		displaySnapshot: { title: "Annual leave" },
		submittedAt,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			stage({
				id: stageOneId,
				sequence: 1,
				status: "pending",
				activationMode: options?.activeMode,
				assignments: activeAssignments,
			}),
			...(options?.secondStage === false
				? []
				: [
						stage({
							id: stageTwoId,
							sequence: 2,
							status: "waiting",
							activationMode: options?.secondMode,
						}),
					]),
		],
	};
}

function waitingWorkflow(options?: {
	secondStage?: boolean;
	firstMode?: string;
	secondMode?: string;
}): ApprovalWorkflowSnapshot {
	const snapshot = pendingWorkflow({
		secondStage: options?.secondStage,
		activeMode: options?.firstMode,
		secondMode: options?.secondMode,
	});
	snapshot.stages[0] = stage({
		id: stageOneId,
		sequence: 1,
		status: "waiting",
		activationMode: options?.firstMode,
	});
	return snapshot;
}

function resolvedStage(input?: Partial<ResolvedStage>): ResolvedStage {
	return {
		organizationId,
		workflowId,
		stageId: stageOneId,
		activationMode: "human",
		assignments: [
			{ approverEmployeeId: approverOne, metadata: { source: "manager" } },
			{ approverEmployeeId: approverTwo, metadata: { source: "policy" } },
		],
		...input,
	};
}

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const nested of Object.values(value)) deepFreeze(nested);
		Object.freeze(value);
	}
	return value;
}

function jsonRoundTrip<Value>(value: Value): Value {
	const serialized = JSON.stringify(value);
	return JSON.parse(serialized as string) as Value;
}

function fixtureStage(
	value: ApprovalWorkflowSnapshot,
	index: number,
): ApprovalStageSnapshot {
	const item = value.stages[index];
	if (!item) throw new Error("Invalid test fixture stage index");
	return item;
}

function fixtureAssignment(
	value: ApprovalWorkflowSnapshot,
	stageIndex: number,
	assignmentIndex: number,
): ApprovalAssignmentSnapshot {
	const item = fixtureStage(value, stageIndex).assignments[assignmentIndex];
	if (!item) throw new Error("Invalid test fixture assignment index");
	return item;
}

function plannedStage(
	plan: ApprovalTransitionPlan,
	index: number,
): ApprovalPlannedStageSnapshot {
	const item = plan.plannedSnapshot.stages[index];
	if (!item) throw new Error("Invalid planned stage index");
	return item;
}

function plannedEvent(
	plan: ApprovalTransitionPlan,
	index = 0,
): ApprovalTransitionPlan["events"][number] {
	const event = plan.events[index];
	if (!event) throw new Error("Invalid planned event index");
	return event;
}

function plannedAllocation(
	plan: ApprovalTransitionPlan,
	index = 0,
): ApprovalTransitionPlan["identityAllocations"][number] {
	const allocation = plan.identityAllocations[index];
	if (!allocation) throw new Error("Invalid planned allocation index");
	return allocation;
}

function retainPlanEvents(
	plan: ApprovalTransitionPlan,
	predicate: (event: ApprovalTransitionPlan["events"][number]) => boolean,
): void {
	plan.events = plan.events.filter(predicate);
	for (const [index, event] of plan.events.entries()) event.eventIndex = index;
	const eventAllocationKeys = new Set(
		plan.events.map((event) => event.reference.allocationKey),
	);
	plan.identityAllocations = plan.identityAllocations.filter(
		(allocation) =>
			allocation.entityKind === "assignment" ||
			eventAllocationKeys.has(allocation.allocationKey),
	);
}

function finalApprovalPlan(): ApprovalTransitionPlan {
	return planWorkflowTransition(
		pendingWorkflow({ secondStage: false }),
		{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
		standardPolicy,
		now,
	);
}

function resolutionsFor(plan: ApprovalTransitionPlan, seed = 1) {
	return plan.identityAllocations.map((allocation, index) => ({
		allocationKey: allocation.allocationKey,
		entityKind: allocation.entityKind,
		id: `90000000-0000-4000-8000-${String(seed + index).padStart(12, "0")}`,
	}));
}

function bindCommandActor(
	plan: ApprovalTransitionPlan,
	actor: ApprovalCommandActor = managerActor,
	seed = 1,
) {
	return {
		receipt: {
			organizationId: plan.plannedSnapshot.organizationId,
			workflowId: plan.plannedSnapshot.id,
			idempotencyKey: `test:${seed}`,
			actorFingerprint: fingerprintApprovalCommandActor(actor),
			commandFingerprint: "test-command",
		},
		actor,
	};
}

function materialize(
	plan: ApprovalTransitionPlan,
	actor: ApprovalCommandActor = managerActor,
	seed = 1,
) {
	return materializeApprovalTransitionPlan(
		plan,
		resolutionsFor(plan, seed),
		bindCommandActor(plan, actor, seed),
	);
}

function expectMachineError(
	callback: () => unknown,
	code:
		| "INVALID_SNAPSHOT"
		| "TERMINAL_TRANSITION"
		| "STALE_STAGE"
		| "STALE_ASSIGNMENT"
		| "INVALID_COMMAND"
		| "INVALID_ACTIVATION"
		| "INVALID_EVENT_METADATA"
		| "INVALID_POLICY"
		| "INVALID_TIME"
		| "REASSIGNMENT_CONFLICT"
		| "MATERIALIZATION_CONFLICT",
): ApprovalStateMachineError {
	try {
		callback();
	} catch (error) {
		expect(error).toBeInstanceOf(ApprovalStateMachineError);
		expect(error).toMatchObject({ code });
		expect(jsonRoundTrip((error as ApprovalStateMachineError).details)).toEqual(
			(error as ApprovalStateMachineError).details,
		);
		return error as ApprovalStateMachineError;
	}
	throw new Error(`Expected ${code}`);
}

function expectCoherentPlan(
	plan: ReturnType<typeof planWorkflowTransition>,
	expectedVersion = 7,
	expectedOccurredAt = now,
): void {
	expect(plan.expectedVersion).toBe(expectedVersion);
	expect(plan.plannedSnapshot.version).toBe(expectedVersion + 1);
	expect(plan.events.map((event) => event.version)).toEqual(
		plan.events.map(() => expectedVersion + 1),
	);
	expect(plan.events.map((event) => event.eventIndex)).toEqual(
		plan.events.map((_, index) => index),
	);
	expect(plan.events.map((event) => event.occurredAt)).toEqual(
		plan.events.map(() => expectedOccurredAt),
	);
	expect(plan.events.map((event) => event.reference)).toEqual(
		plan.events.map((_, index) => ({
			kind: "allocate",
			allocationKey: `${workflowId}:event:${expectedVersion + 1}:${index}`,
		})),
	);
}

describe("planWorkflowTransition", () => {
	describe("approve", () => {
		it("approves only the acting assignment, closes siblings, and requests activation without resolving the next stage", () => {
			const snapshot = deepFreeze(pendingWorkflow());
			const plan = planWorkflowTransition(
				snapshot,
				{
					type: "approve",
					stageId: stageOneId,
					assignmentId: assignmentOneId,
					reason: "Looks correct",
				},
				standardPolicy,
				now,
			);

			expectCoherentPlan(plan);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "pending",
				currentStageOrder: 2,
				completedAt: null,
			});
			expect(plan.plannedSnapshot.stages[0]).toMatchObject({
				status: "approved",
				decidedAt: now,
				decisionReason: "Looks correct",
				assignments: [
					{
						reference: { kind: "persisted", id: assignmentOneId },
						status: "approved",
						resolvedAt: now,
						resolvedBy: { kind: "command_actor" },
					},
					{
						reference: { kind: "persisted", id: assignmentTwoId },
						status: "cancelled",
						resolvedAt: now,
						resolvedBy: { kind: "command_actor" },
					},
				],
			});
			expect(plan.plannedSnapshot.stages[1]).toMatchObject(
				snapshot.stages[1] ?? {},
			);
			expect(plan.nextAction).toEqual({
				kind: "needs_activation",
				stageId: stageTwoId,
				stageOrder: 2,
			});
			expect(plan.events.map((event) => event.eventType)).toEqual([
				"assignment.approved",
				"assignment.cancelled",
				"stage.approved",
				"workflow.activation_requested",
			]);
			expect(plan.events[0]).toMatchObject({
				previousState: { status: "pending" },
				resultingState: { status: "approved" },
				reason: "Looks correct",
			});
			expect(plan.changes.assignments).toHaveLength(2);
		});

		it("approves the workflow and requests terminal finalization at the final stage", () => {
			const plan = planWorkflowTransition(
				pendingWorkflow({ secondStage: false }),
				{
					type: "approve",
					stageId: stageOneId,
					assignmentId: assignmentOneId,
				},
				standardPolicy,
				now,
			);

			expectCoherentPlan(plan);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "approved",
				currentStageOrder: null,
				completedAt: now,
				decisionReason: null,
			});
			expect(plan.nextAction).toEqual({
				kind: "finalize_terminal",
				transition: {
					kind: "approve",
					from: "pending",
					to: "approved",
					reason: null,
				},
			});
			expect(plan.events.at(-1)?.eventType).toBe("workflow.approved");
		});

		it.each([
			["wrong stage", { stageId: stageTwoId }, "STALE_STAGE"],
			[
				"unknown assignment",
				{ assignmentId: "50000000-0000-4000-8000-000000000999" },
				"STALE_ASSIGNMENT",
			],
		] as const)("rejects %s", (_label, override, code) => {
			const snapshot = pendingWorkflow();
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{
							type: "approve",
							stageId: override.stageId ?? stageOneId,
							assignmentId: override.assignmentId ?? assignmentOneId,
						},
						standardPolicy,
						now,
					),
				code,
			);
		});

		it("rejects an assignment that belongs to an already approved stage", () => {
			const snapshot = pendingWorkflow();
			const first = snapshot.stages[0];
			const second = snapshot.stages[1];
			if (!first || !second) throw new Error("fixture");
			first.status = "approved";
			first.decidedAt = activatedAt;
			for (const child of first.assignments) {
				child.status = child.id === assignmentOneId ? "approved" : "cancelled";
				child.resolvedAt = activatedAt;
			}
			second.status = "pending";
			second.activatedAt = activatedAt;
			second.assignments = [
				assignment(
					"50000000-0000-4000-8000-000000000003",
					stageTwoId,
					1,
					approverThree,
				),
			];
			snapshot.currentStageOrder = 2;
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{
							type: "approve",
							stageId: stageTwoId,
							assignmentId: assignmentOneId,
						},
						standardPolicy,
						now,
					),
				"STALE_ASSIGNMENT",
			);
		});

		it("rejects an already resolved assignment", () => {
			const snapshot = pendingWorkflow();
			const acting = snapshot.stages[0]?.assignments[0];
			if (!acting) throw new Error("fixture");
			acting.status = "approved";
			acting.resolvedAt = activatedAt;
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{
							type: "approve",
							stageId: stageOneId,
							assignmentId: assignmentOneId,
						},
						standardPolicy,
						now,
					),
				"INVALID_SNAPSHOT",
			);
		});
	});

	describe("reject", () => {
		it("rejects the active assignment, closes siblings, and finalizes the workflow", () => {
			const plan = planWorkflowTransition(
				pendingWorkflow(),
				{
					type: "reject",
					stageId: stageOneId,
					assignmentId: assignmentOneId,
					reason: "Missing evidence",
				},
				standardPolicy,
				now,
			);

			expectCoherentPlan(plan);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "rejected",
				currentStageOrder: null,
				completedAt: now,
				decisionReason: "Missing evidence",
			});
			expect(plan.plannedSnapshot.stages.map((item) => item.status)).toEqual([
				"rejected",
				"cancelled",
			]);
			expect(
				plan.plannedSnapshot.stages[0]?.assignments.map((item) => item.status),
			).toEqual(["rejected", "cancelled"]);
			expect(plan.events.map((event) => event.eventType)).toEqual([
				"assignment.rejected",
				"assignment.cancelled",
				"stage.rejected",
				"stage.cancelled",
				"workflow.rejected",
			]);
			expect(plan.nextAction).toMatchObject({
				kind: "finalize_terminal",
				transition: { kind: "reject", reason: "Missing evidence" },
			});
		});

		it.each(["", "   "])("rejects a runtime-empty reason %#", (reason) => {
			expectMachineError(
				() =>
					planWorkflowTransition(
						pendingWorkflow(),
						{
							type: "reject",
							stageId: stageOneId,
							assignmentId: assignmentOneId,
							reason,
						},
						standardPolicy,
						now,
					),
				"INVALID_COMMAND",
			);
		});
	});

	describe("cancel and expire", () => {
		it("cancels pending active and waiting work consistently", () => {
			const plan = planWorkflowTransition(
				pendingWorkflow(),
				{ type: "cancel", reason: "Request withdrawn" },
				standardPolicy,
				now,
			);

			expectCoherentPlan(plan);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "cancelled",
				currentStageOrder: null,
				completedAt: now,
				cancelledAt: now,
				decisionReason: "Request withdrawn",
			});
			expect(plan.plannedSnapshot.stages.map((item) => item.status)).toEqual([
				"cancelled",
				"cancelled",
			]);
			expect(
				plan.plannedSnapshot.stages[0]?.assignments.map((item) => item.status),
			).toEqual(["cancelled", "cancelled"]);
			expect(plan.nextAction).toMatchObject({
				kind: "finalize_terminal",
				transition: { kind: "cancel_pending" },
			});
		});

		it("allows approved cancellation only with trusted policy", () => {
			const approvalPlan = planWorkflowTransition(
				pendingWorkflow({ secondStage: false }),
				{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
				standardPolicy,
				now,
			);
			const approved = materialize(approvalPlan).resultingSnapshot;
			const cancelledAt = parseInstant("2026-07-17T08:00:00Z");
			const plan = planWorkflowTransition(
				approved,
				{ type: "cancel", reason: "Approved source was withdrawn" },
				approvedCancellationPolicy,
				cancelledAt,
			);

			expectCoherentPlan(plan, 8, cancelledAt);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "cancelled",
				completedAt: now,
				cancelledAt,
				decisionReason: "Approved source was withdrawn",
			});
			expect(plan.plannedSnapshot.stages[0]?.status).toBe("approved");
			expect(plan.nextAction).toMatchObject({
				kind: "finalize_terminal",
				transition: { kind: "cancel_approved" },
			});
		});

		it("rejects approved cancellation without trusted policy", () => {
			const approvalPlan = planWorkflowTransition(
				pendingWorkflow({ secondStage: false }),
				{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
				standardPolicy,
				now,
			);
			const approved = materialize(approvalPlan).resultingSnapshot;
			expectMachineError(
				() =>
					planWorkflowTransition(
						approved,
						{ type: "cancel", reason: "Not trusted" },
						standardPolicy,
						now,
					),
				"INVALID_POLICY",
			);
		});

		it.each([
			"rejected",
			"cancelled",
			"expired",
		] as const)("keeps %s workflows terminal", (status) => {
			const snapshot = terminalSnapshot(status);
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{ type: "cancel", reason: "again" },
						standardPolicy,
						now,
					),
				"TERMINAL_TRANSITION",
			);
		});

		it("expires only a pending workflow and closes active work at the supplied instant", () => {
			const plan = planWorkflowTransition(
				pendingWorkflow(),
				{ type: "expire", reason: "SLA elapsed" },
				standardPolicy,
				now,
			);

			expectCoherentPlan(plan);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "expired",
				currentStageOrder: null,
				completedAt: now,
				cancelledAt: null,
				decisionReason: "SLA elapsed",
			});
			expect(plan.plannedSnapshot.stages.map((item) => item.status)).toEqual([
				"expired",
				"expired",
			]);
			expect(
				plan.plannedSnapshot.stages[0]?.assignments.map((item) => item.status),
			).toEqual(["expired", "expired"]);
			expect(plan.events.at(-1)).toMatchObject({
				eventType: "workflow.expired",
				reason: "SLA elapsed",
				occurredAt: now,
			});
			expect(
				plan.events.every((event) => event.actor.kind === "command_actor"),
			).toBe(true);
		});
	});

	describe("reassign and escalate", () => {
		it.each([
			["reassign", "assignment.reassigned", "reassignment"],
			["escalate", "assignment.escalated", "escalation"],
		] as const)("plans a deterministic %s creation intent", (type, eventType, reasonKind) => {
			const plan = planWorkflowTransition(
				deepFreeze(pendingWorkflow()),
				deepFreeze({
					type,
					stageId: stageOneId,
					fromEmployeeId: approverOne,
					toEmployeeId: approverThree,
				}),
				standardPolicy,
				now,
			);

			expectCoherentPlan(plan);
			expect(plan.plannedSnapshot).toMatchObject({
				status: "pending",
				currentStageOrder: 1,
			});
			expect(plan.plannedSnapshot.stages[0]).toMatchObject({
				status: "pending",
				assignments: [
					{
						reference: { kind: "persisted", id: assignmentOneId },
						status: "cancelled",
						resolvedAt: now,
						resolvedBy: { kind: "command_actor" },
					},
					{
						reference: { kind: "persisted", id: assignmentTwoId },
						status: "pending",
					},
					{
						reference: {
							kind: "allocate",
							allocationKey: `${workflowId}:stage:${stageOneId}:assignment:3`,
						},
						sequence: 3,
						approverEmployeeId: approverThree,
						status: "pending",
						assignedAt: now,
						reassignedBy: { kind: "command_actor" },
						reassignedFrom: {
							kind: "persisted",
							id: assignmentOneId,
						},
						reassignmentMetadata: { kind: reasonKind },
					},
				],
			});
			expect(plan.nextAction).toEqual({ kind: "none" });
			expect(plan.events).toHaveLength(1);
			expect(plan.events[0]).toMatchObject({
				eventType,
				previousState: { status: "pending" },
				resultingState: { status: "pending", targetEmployeeId: approverThree },
				metadata: { kind: reasonKind, sourceEmployeeId: approverOne },
				references: {
					sourceAssignment: { kind: "persisted", id: assignmentOneId },
					targetAssignment: {
						kind: "allocate",
						allocationKey: `${workflowId}:stage:${stageOneId}:assignment:3`,
					},
				},
			});
			expect(plan.changes.assignments.map((change) => change.kind)).toEqual([
				"update",
				"create",
			]);
		});

		it.each([
			["self target", approverOne, "REASSIGNMENT_CONFLICT"],
			["already pending target", approverTwo, "REASSIGNMENT_CONFLICT"],
			[
				"missing source",
				"30000000-0000-4000-8000-000000000999",
				"REASSIGNMENT_CONFLICT",
			],
		] as const)("rejects %s", (_label, target, code) => {
			expectMachineError(
				() =>
					planWorkflowTransition(
						pendingWorkflow(),
						{
							type: "reassign",
							stageId: stageOneId,
							fromEmployeeId:
								_label === "missing source" ? target : approverOne,
							toEmployeeId: target,
						},
						standardPolicy,
						now,
					),
				code,
			);
		});

		it("rejects an ambiguous source employee", () => {
			const snapshot = pendingWorkflow();
			snapshot.stages[0]?.assignments.push(
				assignment(
					"50000000-0000-4000-8000-000000000003",
					stageOneId,
					3,
					approverOne,
				),
			);
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{
							type: "escalate",
							stageId: stageOneId,
							fromEmployeeId: approverOne,
							toEmployeeId: approverThree,
						},
						standardPolicy,
						now,
					),
				"REASSIGNMENT_CONFLICT",
			);
		});
	});

	describe("invalid snapshots and commands", () => {
		it.each([
			[
				"duplicate stage id",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureStage(value, 1).id = stageOneId),
			],
			[
				"duplicate stage order",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureStage(value, 1).sequence = 1),
			],
			[
				"duplicate assignment id",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureAssignment(value, 0, 1).id = assignmentOneId),
			],
			[
				"duplicate assignment sequence",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureAssignment(value, 0, 1).sequence = 1),
			],
			[
				"stage organization mismatch",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureStage(value, 0).organizationId = "org-2"),
			],
			[
				"stage workflow mismatch",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureStage(value, 0).workflowId = "workflow-2"),
			],
			[
				"assignment scope mismatch",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureAssignment(value, 0, 0).stageId = stageTwoId),
			],
			[
				"missing current stage",
				(value: ApprovalWorkflowSnapshot) => (value.currentStageOrder = 9),
			],
			[
				"pending workflow completion timestamp",
				(value: ApprovalWorkflowSnapshot) => (value.completedAt = activatedAt),
			],
			[
				"pending stage decision timestamp",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureStage(value, 0).decidedAt = activatedAt),
			],
			[
				"pending assignment resolution timestamp",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureAssignment(value, 0, 0).resolvedAt = activatedAt),
			],
			[
				"waiting stage activation timestamp",
				(value: ApprovalWorkflowSnapshot) =>
					(fixtureStage(value, 1).activatedAt = activatedAt),
			],
		] as const)("rejects a malformed snapshot with %s", (_label, mutate) => {
			const snapshot = pendingWorkflow();
			mutate(snapshot);
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{ type: "cancel", reason: "withdrawn" },
						standardPolicy,
						now,
					),
				"INVALID_SNAPSHOT",
			);
		});

		it("rejects a waiting current stage decision as stale", () => {
			expectMachineError(
				() =>
					planWorkflowTransition(
						waitingWorkflow(),
						{
							type: "approve",
							stageId: stageOneId,
							assignmentId: assignmentOneId,
						},
						standardPolicy,
						now,
					),
				"STALE_STAGE",
			);
		});
	});
});

describe("planStageActivation", () => {
	it("activates only the current waiting human stage with ordered assignment creation intents", () => {
		const snapshot = deepFreeze(waitingWorkflow());
		const resolved = deepFreeze(resolvedStage());
		const plan = planStageActivation(snapshot, resolved, now);

		expectCoherentPlan(plan);
		expect(plan.plannedSnapshot.stages[0]).toMatchObject({
			status: "pending",
			activatedAt: now,
			decidedAt: null,
			assignments: [
				{
					sequence: 1,
					approverEmployeeId: approverOne,
					status: "pending",
					assignedAt: now,
					reference: {
						kind: "allocate",
						allocationKey: `${workflowId}:stage:${stageOneId}:assignment:1`,
					},
				},
				{ sequence: 2, approverEmployeeId: approverTwo, status: "pending" },
			],
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.created",
			"assignment.created",
			"stage.activated",
		]);
		expect(plan.nextAction).toEqual({ kind: "none" });
	});

	it("uses requester auto-approval resolved at activation for a waiting human stage", () => {
		const plan = planStageActivation(
			waitingWorkflow(),
			resolvedStage({
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
			now,
		);

		expect(plan.plannedSnapshot.stages[0]).toMatchObject({
			activationMode: "requester_auto_approve",
			status: "approved",
			decisionReason: "requester_auto_approved",
		});
		expect(plan.events).toContainEqual(
			expect.objectContaining({ eventType: "stage.auto_approved" }),
		);
	});

	it("auto-approves the requester stage without assignments and leaves the next stage unresolved", () => {
		const snapshot = waitingWorkflow({ firstMode: "requester_auto_approve" });
		const plan = planStageActivation(
			snapshot,
			resolvedStage({
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
			now,
		);

		expectCoherentPlan(plan);
		expect(plan.plannedSnapshot).toMatchObject({
			status: "pending",
			currentStageOrder: 2,
			stages: [
				{
					status: "approved",
					activatedAt: now,
					decidedAt: now,
					decisionReason: "requester_auto_approved",
					assignments: [],
				},
				{ status: "waiting", activatedAt: null, assignments: [] },
			],
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"workflow.activation_requested",
		]);
		expect(plan.nextAction).toEqual({
			kind: "needs_activation",
			stageId: stageTwoId,
			stageOrder: 2,
		});
	});

	it("requires repeated activation calls for consecutive auto stages", () => {
		const first = planStageActivation(
			waitingWorkflow({
				firstMode: "requester_auto_approve",
				secondMode: "requester_auto_approve",
			}),
			resolvedStage({
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
			now,
		);
		expect(first.nextAction.kind).toBe("needs_activation");
		expect(first.plannedSnapshot.stages[1]?.status).toBe("waiting");

		const secondAt = parseInstant("2026-07-16T14:00:01Z");
		const second = planStageActivation(
			materialize(first, systemCommandActor).resultingSnapshot,
			resolvedStage({
				stageId: stageTwoId,
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
			secondAt,
		);
		expect(second.plannedSnapshot).toMatchObject({
			status: "approved",
			currentStageOrder: null,
			completedAt: secondAt,
		});
		expect(second.nextAction).toMatchObject({
			kind: "finalize_terminal",
			transition: { kind: "approve" },
		});
	});

	it("approves an all-auto final stage and requests finalization", () => {
		const plan = planStageActivation(
			waitingWorkflow({
				secondStage: false,
				firstMode: "requester_auto_approve",
			}),
			resolvedStage({
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
			now,
		);
		expect(plan.plannedSnapshot).toMatchObject({
			status: "approved",
			completedAt: now,
			currentStageOrder: null,
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"workflow.approved",
		]);
	});

	it("supports human approval advancing to a separate auto activation", () => {
		const decision = planWorkflowTransition(
			pendingWorkflow({ secondMode: "requester_auto_approve" }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		expect(decision.nextAction.kind).toBe("needs_activation");
		expect(decision.plannedSnapshot.stages[1]?.status).toBe("waiting");
		const activation = planStageActivation(
			materialize(decision).resultingSnapshot,
			resolvedStage({
				stageId: stageTwoId,
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
			now,
		);
		expect(activation.plannedSnapshot.status).toBe("approved");
	});

	it.each([
		[
			"duplicate approver",
			resolvedStage({
				assignments: [
					{ approverEmployeeId: approverOne, metadata: {} },
					{ approverEmployeeId: approverOne, metadata: {} },
				],
			}),
		],
		[
			"empty approver",
			resolvedStage({
				assignments: [{ approverEmployeeId: " ", metadata: {} }],
			}),
		],
		["empty human resolution", resolvedStage({ assignments: [] })],
		["wrong organization", resolvedStage({ organizationId: "org-2" })],
		["wrong workflow", resolvedStage({ workflowId: "workflow-2" })],
		["wrong stage", resolvedStage({ stageId: stageTwoId })],
		[
			"invalid runtime mode",
			resolvedStage({ activationMode: "unsupported" as never }),
		],
	] as const)("rejects invalid activation: %s", (_label, candidate) => {
		expectMachineError(
			() => planStageActivation(waitingWorkflow(), candidate, now),
			"INVALID_ACTIVATION",
		);
	});

	it("rejects activation for active, stale, and terminal workflows", () => {
		expectMachineError(
			() => planStageActivation(pendingWorkflow(), resolvedStage(), now),
			"INVALID_ACTIVATION",
		);
		expectMachineError(
			() =>
				planStageActivation(terminalSnapshot("rejected"), resolvedStage(), now),
			"TERMINAL_TRANSITION",
		);
	});
});

describe("Task 2.1 corrective findings", () => {
	it("accepts a materialized reassignment history for a later target decision", () => {
		const reassignmentPlan = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const reassigned = materialize(reassignmentPlan).resultingSnapshot;
		const target = fixtureStage(reassigned, 0).assignments.at(-1);
		if (!target) throw new Error("fixture");

		const approvalPlan = planWorkflowTransition(
			reassigned,
			{ type: "approve", stageId: stageOneId, assignmentId: target.id },
			standardPolicy,
			now,
		);
		const approved = materialize(
			approvalPlan,
			managerActor,
			20,
		).resultingSnapshot;

		expect(approved.status).toBe("approved");
		expect(
			fixtureStage(approved, 0).assignments.find(
				(assignment) => assignment.id === target.id,
			)?.status,
		).toBe("approved");
	});

	it("supports cancellation after a materialized reassignment", () => {
		const reassignment = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const reassigned = materialize(reassignment).resultingSnapshot;
		const cancellation = planWorkflowTransition(
			reassigned,
			{ type: "cancel", reason: "withdrawn" },
			standardPolicy,
			parseInstant("2026-07-16T15:00:00Z"),
		);

		expect(cancellation.plannedSnapshot.status).toBe("cancelled");
		expect(
			cancellation.plannedSnapshot.stages[0]?.assignments.some(
				(assignment) => assignment.status === "pending",
			),
		).toBe(false);
	});

	it("supports two materialized reassignments with deterministic lineage", () => {
		const first = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const afterFirst = materialize(first).resultingSnapshot;
		const second = planWorkflowTransition(
			afterFirst,
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverThree,
				toEmployeeId: approverFour,
			},
			standardPolicy,
			parseInstant("2026-07-16T15:00:00Z"),
		);
		const afterSecond = materialize(second, managerActor, 20).resultingSnapshot;
		const assignments = fixtureStage(afterSecond, 0).assignments;
		const latest = assignments.find(
			(assignment) => assignment.approverEmployeeId === approverFour,
		);

		expect(assignments.map((assignment) => assignment.sequence)).toEqual([
			1, 2, 3, 4,
		]);
		expect(latest).toMatchObject({
			status: "pending",
			reassignedFromAssignmentId: assignments[2]?.id,
			reassignedByEmployeeId: managerActor.employeeId,
		});
	});

	it("supports escalation followed by target approval", () => {
		const escalation = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{
				type: "escalate",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const escalated = materialize(escalation).resultingSnapshot;
		const target = fixtureStage(escalated, 0).assignments.find(
			(assignment) => assignment.approverEmployeeId === approverThree,
		);
		if (!target) throw new Error("fixture");

		const approval = planWorkflowTransition(
			escalated,
			{ type: "approve", stageId: stageOneId, assignmentId: target.id },
			standardPolicy,
			parseInstant("2026-07-16T15:00:00Z"),
		);
		expect(approval.plannedSnapshot.status).toBe("approved");
	});

	it("returns STALE_ASSIGNMENT when a cancelled reassignment source is selected", () => {
		const reassignment = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const reassigned = materialize(reassignment).resultingSnapshot;

		expectMachineError(
			() =>
				planWorkflowTransition(
					reassigned,
					{
						type: "approve",
						stageId: stageOneId,
						assignmentId: assignmentOneId,
					},
					standardPolicy,
					now,
				),
			"STALE_ASSIGNMENT",
		);
	});

	it("does not place repository allocation keys in assignment ID fields", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const created = plannedStage(plan, 0).assignments.at(-1);

		expect(created).not.toHaveProperty("id");
		expect(created).toMatchObject({
			reference: {
				kind: "allocate",
				allocationKey: `${workflowId}:stage:${stageOneId}:assignment:3`,
			},
		});
		expect(JSON.stringify(plan.events)).not.toContain(
			`"assignmentId":"${workflowId}:stage`,
		);
		expect(plan.events[0]).toMatchObject({
			references: {
				targetAssignment: {
					kind: "allocate",
					allocationKey: `${workflowId}:stage:${stageOneId}:assignment:3`,
				},
			},
		});
	});

	it("materializes exact allocation coverage into persisted assignment and event IDs", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const materialized = materialize(plan);
		const created = fixtureStage(
			materialized.resultingSnapshot,
			0,
		).assignments.at(-1);
		if (!created) throw new Error("fixture");

		expect(created.id).toMatch(UUID_PATTERN);
		expect(created.id).not.toContain(":stage:");
		expect(materialized.events[0]).toMatchObject({
			id: expect.stringMatching(UUID_PATTERN),
			references: { targetAssignmentId: created.id },
		});
	});

	it("materializes the same allocation key independently by entity kind", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const assignmentAllocation = plan.identityAllocations.find(
			(allocation) => allocation.entityKind === "assignment",
		);
		const eventAllocation = plan.identityAllocations.find(
			(allocation) => allocation.entityKind === "event",
		);
		if (!assignmentAllocation || !eventAllocation) throw new Error("fixture");
		eventAllocation.allocationKey = assignmentAllocation.allocationKey;
		plannedEvent(plan).reference.allocationKey =
			assignmentAllocation.allocationKey;
		const assignmentId = "91000000-0000-4000-8000-000000000001";
		const eventId = "92000000-0000-4000-8000-000000000001";
		const materialized = materializeApprovalTransitionPlan(
			plan,
			[
				{
					allocationKey: assignmentAllocation.allocationKey,
					entityKind: "assignment",
					id: assignmentId,
				},
				{
					allocationKey: assignmentAllocation.allocationKey,
					entityKind: "event",
					id: eventId,
				},
			],
			bindCommandActor(plan),
		);
		expect(
			fixtureStage(materialized.resultingSnapshot, 0).assignments.at(-1)?.id,
		).toBe(assignmentId);
		expect(materialized.events[0]?.id).toBe(eventId);
	});

	it.each([
		"missing",
		"extra",
		"duplicate",
	] as const)("rejects %s allocation resolutions", (failure) => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const valid = resolutionsFor(plan);
		const firstResolution = valid[0];
		if (!firstResolution) throw new Error("fixture");
		const resolutions =
			failure === "missing"
				? valid.slice(1)
				: failure === "extra"
					? [
							...valid,
							{
								allocationKey: "extra",
								entityKind: "event" as const,
								id: "99000000-0000-4000-8000-000000000099",
							},
						]
					: [...valid, firstResolution];
		expectMachineError(
			() =>
				materializeApprovalTransitionPlan(
					plan,
					resolutions,
					bindCommandActor(plan),
				),
			"MATERIALIZATION_CONFLICT",
		);
	});

	it("rejects an incompatible legacy command actor during materialization", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		expectMachineError(
			() =>
				materializeApprovalTransitionPlan(
					plan,
					resolutionsFor(plan),
					bindCommandActor(plan, {
						kind: "legacy_unknown",
						employeeId: null,
						userId: null,
					} as never),
				),
			"MATERIALIZATION_CONFLICT",
		);
	});

	it("materializes deeply frozen plans and evidence without mutation", () => {
		const plan = deepFreeze(
			planWorkflowTransition(
				pendingWorkflow(),
				{
					type: "reassign",
					stageId: stageOneId,
					fromEmployeeId: approverOne,
					toEmployeeId: approverThree,
				},
				standardPolicy,
				now,
			),
		);
		const resolutions = deepFreeze(resolutionsFor(plan));
		const actor = deepFreeze({ ...managerActor });

		expect(() =>
			materializeApprovalTransitionPlan(
				plan,
				resolutions,
				bindCommandActor(plan, actor),
			),
		).not.toThrow();
	});

	it("keeps allocation-shaped resolver and event metadata as ordinary business JSON", () => {
		const snapshot = waitingWorkflow({ secondStage: false });
		const matchingShape = {
			kind: "allocate",
			allocationKey: `${workflowId}:stage:${stageOneId}:assignment:1`,
		};
		const nonmatchingShape = {
			kind: "allocate",
			allocationKey: "business-owned-key",
		};
		fixtureStage(snapshot, 0).resolverSnapshot = {
			matchingShape,
			nonmatchingShape,
		};
		const metadata = { matchingShape, nonmatchingShape };
		const plan = planStageActivation(
			snapshot,
			resolvedStage({
				assignments: [{ approverEmployeeId: approverOne, metadata }],
			}),
			now,
		);
		const materialized = materialize(plan, systemCommandActor);

		expect(materialized.resultingSnapshot.stages[0]?.resolverSnapshot).toEqual({
			matchingShape,
			nonmatchingShape,
		});
		expect(materialized.events[0]?.metadata).toEqual(metadata);
	});

	it("stores assignment references only in the typed event reference node", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const event = plan.events[0];

		expect(event).toMatchObject({
			references: {
				sourceAssignment: { kind: "persisted", id: assignmentOneId },
				targetAssignment: {
					kind: "allocate",
					allocationKey: `${workflowId}:stage:${stageOneId}:assignment:3`,
				},
			},
		});
		expect(event?.previousState).not.toHaveProperty("assignmentRef");
		expect(event?.resultingState).not.toHaveProperty("assignmentRef");
		expect(event?.metadata).not.toHaveProperty("assignmentRef");
	});

	it.each([
		[
			"workflow id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				snapshot.id = "not-a-uuid";
				for (const stage of snapshot.stages) {
					stage.workflowId = snapshot.id;
					for (const assignment of stage.assignments) {
						assignment.workflowId = snapshot.id;
					}
				}
			},
		],
		[
			"source id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				snapshot.sourceId = "not-a-uuid";
			},
		],
		[
			"requester employee id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				snapshot.requesterEmployeeId = "not-a-uuid";
			},
		],
		[
			"stage id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				const stage = fixtureStage(snapshot, 0);
				stage.id = "not-a-uuid";
				for (const assignment of stage.assignments)
					assignment.stageId = stage.id;
			},
		],
		[
			"assignment id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				fixtureAssignment(snapshot, 0, 0).id = "not-a-uuid";
			},
		],
		[
			"approver employee id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				fixtureAssignment(snapshot, 0, 0).approverEmployeeId = "not-a-uuid";
			},
		],
		[
			"legacy request id",
			(snapshot: ApprovalWorkflowSnapshot) => {
				fixtureStage(snapshot, 0).legacyApprovalRequestId = "not-a-uuid";
			},
		],
	] as const)("rejects an invalid persisted %s", (_label, mutate) => {
		const snapshot = pendingWorkflow();
		mutate(snapshot);
		expectMachineError(
			() =>
				planWorkflowTransition(
					snapshot,
					{ type: "cancel", reason: "invalid" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it.each([
		[
			"stage",
			{ type: "approve", stageId: "not-a-uuid", assignmentId: assignmentOneId },
		],
		[
			"assignment",
			{ type: "approve", stageId: stageOneId, assignmentId: "not-a-uuid" },
		],
		[
			"reassignment source",
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: "not-a-uuid",
				toEmployeeId: approverThree,
			},
		],
		[
			"reassignment target",
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: "not-a-uuid",
			},
		],
	] as const)("rejects an invalid command %s UUID", (_label, command) => {
		expectMachineError(
			() =>
				planWorkflowTransition(
					pendingWorkflow(),
					command as ApprovalWorkflowCommand,
					standardPolicy,
					now,
				),
			"INVALID_COMMAND",
		);
	});

	it("rejects invalid resolved approver and command actor employee UUIDs", () => {
		expectMachineError(
			() =>
				planStageActivation(
					waitingWorkflow(),
					resolvedStage({
						assignments: [{ approverEmployeeId: "not-a-uuid", metadata: {} }],
					}),
					now,
				),
			"INVALID_ACTIVATION",
		);
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{ type: "cancel", reason: "invalid actor" },
			standardPolicy,
			now,
		);
		expectMachineError(
			() =>
				materializeApprovalTransitionPlan(
					plan,
					resolutionsFor(plan),
					bindCommandActor(plan, {
						kind: "employee",
						employeeId: "not-a-uuid",
						userId: "text-user-id",
					}),
				),
			"MATERIALIZATION_CONFLICT",
		);
		for (const userId of [null, "", "   "]) {
			expectMachineError(
				() =>
					materializeApprovalTransitionPlan(
						plan,
						resolutionsFor(plan),
						bindCommandActor(plan, {
							...managerActor,
							userId,
						} as never),
					),
				"MATERIALIZATION_CONFLICT",
			);
		}
	});

	it("rejects malformed allocation UUIDs and invalid persisted resolver actors", () => {
		const cancellationPlan = planWorkflowTransition(
			pendingWorkflow(),
			{ type: "cancel", reason: "invalid resolution" },
			standardPolicy,
			now,
		);
		const invalidResolutions = resolutionsFor(cancellationPlan);
		const firstResolution = invalidResolutions[0];
		if (!firstResolution) throw new Error("fixture");
		firstResolution.id = "not-a-uuid";
		expectMachineError(
			() =>
				materializeApprovalTransitionPlan(
					cancellationPlan,
					invalidResolutions,
					bindCommandActor(cancellationPlan),
				),
			"MATERIALIZATION_CONFLICT",
		);

		const reassignmentPlan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const reassigned = materialize(reassignmentPlan).resultingSnapshot;
		const historical = fixtureAssignment(reassigned, 0, 0);
		if (!historical.resolvedBy) throw new Error("fixture");
		historical.resolvedBy.employeeId = "not-a-uuid";
		expectMachineError(
			() =>
				planWorkflowTransition(
					reassigned,
					{ type: "cancel", reason: "invalid persisted actor" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it("revalidates the fully materialized authoritative snapshot", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{ type: "cancel", reason: "revalidate" },
			standardPolicy,
			now,
		);
		const assignment = plan.plannedSnapshot.stages[0]?.assignments[0];
		if (!assignment) throw new Error("fixture");
		assignment.approverEmployeeId = "not-a-uuid";

		expectMachineError(
			() => materialize(plan, managerActor),
			"MATERIALIZATION_CONFLICT",
		);
	});

	it("keeps text-backed organization and actor user IDs valid", () => {
		const snapshot = pendingWorkflow();
		snapshot.organizationId = "tenant_external_key";
		for (const stage of snapshot.stages) {
			stage.organizationId = snapshot.organizationId;
			for (const assignment of stage.assignments) {
				assignment.organizationId = snapshot.organizationId;
			}
		}
		const plan = planWorkflowTransition(
			snapshot,
			{ type: "cancel", reason: "valid text ids" },
			standardPolicy,
			now,
		);
		expect(() =>
			materializeApprovalTransitionPlan(
				plan,
				resolutionsFor(plan),
				bindCommandActor(plan, {
					...managerActor,
					userId: "better-auth-user-id",
				}),
			),
		).not.toThrow();
	});

	it("returns deeply isolated changes, event JSON, and materialized next actions", () => {
		const firstPlan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const reassigned = materialize(firstPlan).resultingSnapshot;
		const originalMetadata = structuredClone(
			fixtureAssignment(reassigned, 0, 2).reassignmentMetadata,
		);
		const cancellationPlan = planWorkflowTransition(
			reassigned,
			{ type: "cancel", reason: "nested reason" },
			standardPolicy,
			parseInstant("2026-07-16T15:00:00Z"),
		);
		const previousStage = cancellationPlan.changes.stages[0]?.previous;
		const previousMetadata =
			previousStage?.assignments[2]?.reassignmentMetadata;
		if (!previousMetadata) throw new Error("fixture");
		const previousMetadataKind = previousMetadata.kind;
		previousMetadata.kind = "mutated previous";
		expect(fixtureAssignment(reassigned, 0, 2).reassignmentMetadata).toEqual(
			originalMetadata,
		);

		const resultingStage = cancellationPlan.changes.stages[0]?.resulting;
		if (!resultingStage) throw new Error("fixture");
		resultingStage.resolverSnapshot.mutated = true;
		expect(
			cancellationPlan.plannedSnapshot.stages[0]?.resolverSnapshot,
		).not.toHaveProperty("mutated");
		previousMetadata.kind = previousMetadataKind;
		delete resultingStage.resolverSnapshot.mutated;

		const materialized = materialize(cancellationPlan, managerActor, 30);
		const eventMetadata = cancellationPlan.events[0]?.metadata;
		if (!eventMetadata) throw new Error("fixture");
		eventMetadata.mutated = true;
		expect(fixtureAssignment(reassigned, 0, 2).reassignmentMetadata).toEqual(
			originalMetadata,
		);

		expect(materialized).toHaveProperty("changes");
		const materializedEventMetadata = materialized.events[0]?.metadata;
		if (!materializedEventMetadata) throw new Error("fixture");
		materializedEventMetadata.materializedMutation = true;
		expect(cancellationPlan.events[0]?.metadata).not.toHaveProperty(
			"materializedMutation",
		);

		const materializedPreviousMetadata =
			materialized.changes.stages[0]?.previous.assignments[2]
				?.reassignmentMetadata;
		if (!materializedPreviousMetadata) throw new Error("fixture");
		materializedPreviousMetadata.kind = "materialized previous mutation";
		expect(
			cancellationPlan.changes.stages[0]?.previous.assignments[2]
				?.reassignmentMetadata,
		).toEqual({ kind: previousMetadataKind });

		const materializedResultingStage =
			materialized.changes.stages[0]?.resulting;
		if (!materializedResultingStage) throw new Error("fixture");
		materializedResultingStage.resolverSnapshot.materializedMutation = true;
		expect(
			cancellationPlan.changes.stages[0]?.resulting.resolverSnapshot,
		).not.toHaveProperty("materializedMutation");

		materialized.resultingSnapshot.displaySnapshot.materializedMutation = true;
		expect(cancellationPlan.plannedSnapshot.displaySnapshot).not.toHaveProperty(
			"materializedMutation",
		);
		if (materialized.nextAction.kind !== "finalize_terminal") {
			throw new Error("fixture");
		}
		materialized.nextAction.transition.reason = "mutated materialized";
		expect(cancellationPlan.nextAction).toMatchObject({
			transition: { reason: "nested reason" },
		});
	});

	it("does not alias command actor intent nodes across planned outputs", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		const firstActor = plan.events[0]?.actor;
		if (!firstActor) throw new Error("fixture");
		firstActor.kind = "system";
		expect(plan.events[1]?.actor).toEqual({ kind: "command_actor" });

		const firstResolvedBy =
			plan.plannedSnapshot.stages[0]?.assignments[0]?.resolvedBy;
		if (!firstResolvedBy || firstResolvedBy.kind === "persisted") {
			throw new Error("fixture");
		}
		firstResolvedBy.kind = "system";
		expect(plan.plannedSnapshot.stages[0]?.assignments[1]?.resolvedBy).toEqual({
			kind: "command_actor",
		});
	});

	it("materializes complete previous and resulting root changes", () => {
		const snapshot = pendingWorkflow();
		const plan = planWorkflowTransition(
			snapshot,
			{ type: "cancel", reason: "complete root change" },
			standardPolicy,
			now,
		);
		const materialized = materialize(plan);

		expect(materialized.changes.root).toEqual({
			previous: {
				status: "pending",
				currentStageOrder: 1,
				version: 7,
				completedAt: null,
				cancelledAt: null,
				decisionReason: null,
			},
			resulting: {
				status: "cancelled",
				currentStageOrder: null,
				version: 8,
				completedAt: now,
				cancelledAt: now,
				decisionReason: "complete root change",
			},
		});
		materialized.changes.root.resulting.decisionReason = "mutated root";
		expect(plan.changes.root.resulting.decisionReason).toBe(
			"complete root change",
		);
	});

	it("rejects unexplained expired assignment history in a pending human stage", () => {
		const snapshot = pendingWorkflow();
		const historical = fixtureAssignment(snapshot, 0, 0);
		historical.status = "expired";
		historical.resolvedAt = now;
		historical.resolvedBy = { ...managerActor, userId: null };

		expectMachineError(
			() =>
				planWorkflowTransition(
					snapshot,
					{ type: "cancel", reason: "invalid history" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it.each([
		"approve",
		"reject",
	] as const)("rejects %s on a non-human pending stage before assignment lookup", (type) => {
		const snapshot = pendingWorkflow({ activeMode: "legacy_auto" });
		const command =
			type === "approve"
				? { type, stageId: stageOneId, assignmentId: assignmentOneId }
				: {
						type,
						stageId: stageOneId,
						assignmentId: assignmentOneId,
						reason: "invalid",
					};
		expectMachineError(
			() => planWorkflowTransition(snapshot, command, standardPolicy, now),
			"INVALID_SNAPSHOT",
		);
	});

	it("uses a command actor intent instead of inferring the assignee as actor", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);

		expect(plannedStage(plan, 0).assignments[0]?.resolvedBy).toEqual({
			kind: "command_actor",
		});
		expect(
			plan.events.every((event) => event.actor.kind === "command_actor"),
		).toBe(true);
		const materialized = materialize(plan, managerActor);
		expect(
			fixtureAssignment(materialized.resultingSnapshot, 0, 0).resolvedBy,
		).toEqual({ ...managerActor, userId: null });
		expect(
			materialized.events.every((event) => event.actor === managerActor),
		).toBe(false);
		expect(materialized.events.map((event) => event.actor)).toEqual(
			materialized.events.map(() => managerActor),
		);
	});

	it("materializes system escalation without attributing it to the source approver", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "escalate",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const materialized = materialize(plan, systemCommandActor);
		const assignments = fixtureStage(
			materialized.resultingSnapshot,
			0,
		).assignments;
		const source = assignments.find(
			(assignment) => assignment.id === assignmentOneId,
		);
		const target = assignments.find(
			(assignment) => assignment.approverEmployeeId === approverThree,
		);

		expect(source?.resolvedBy).toMatchObject({
			kind: "system",
			employeeId: null,
		});
		expect(target).toMatchObject({
			reassignedByEmployeeId: null,
			reassignedFromAssignmentId: assignmentOneId,
		});
		expect(materialized.events[0]?.actor).toMatchObject({
			kind: "system",
			employeeId: null,
		});
	});

	it.each([
		"approve",
		"reject",
	] as const)("rejects malformed requester-auto assignments for %s", (type) => {
		const snapshot = pendingWorkflow({ activeMode: "requester_auto_approve" });
		const command =
			type === "approve"
				? { type, stageId: stageOneId, assignmentId: assignmentOneId }
				: {
						type,
						stageId: stageOneId,
						assignmentId: assignmentOneId,
						reason: "invalid",
					};
		expectMachineError(
			() => planWorkflowTransition(snapshot, command, standardPolicy, now),
			"INVALID_SNAPSHOT",
		);
	});

	it.each([
		"approved",
		"rejected",
	] as const)("rejects impossible %s assignment history under a pending human stage", (status) => {
		const snapshot = pendingWorkflow();
		const historical = fixtureAssignment(snapshot, 0, 0);
		historical.status = status;
		historical.resolvedAt = now;
		expectMachineError(
			() =>
				planWorkflowTransition(
					snapshot,
					{ type: "cancel", reason: "invalid" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it("rejects an approved root containing an active pending stage", () => {
		const snapshot = pendingWorkflow({ secondStage: false });
		snapshot.status = "approved";
		snapshot.currentStageOrder = null;
		snapshot.completedAt = now;
		expectMachineError(
			() =>
				planWorkflowTransition(
					snapshot,
					{ type: "cancel", reason: "withdrawn" },
					approvedCancellationPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it("cancels migration-compatible waiting stages after approved cancellation", () => {
		const snapshot = pendingWorkflow();
		const first = fixtureStage(snapshot, 0);
		first.status = "approved";
		first.decidedAt = now;
		for (const child of first.assignments) {
			child.status = child.id === assignmentOneId ? "approved" : "cancelled";
			child.resolvedAt = now;
		}
		snapshot.status = "approved";
		snapshot.currentStageOrder = null;
		snapshot.completedAt = now;

		const plan = planWorkflowTransition(
			snapshot,
			{ type: "cancel", reason: "withdrawn" },
			approvedCancellationPolicy,
			parseInstant("2026-07-17T08:00:00Z"),
		);

		expect(plan.plannedSnapshot.stages.map((item) => item.status)).toEqual([
			"approved",
			"cancelled",
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"stage.cancelled",
			"workflow.cancelled",
		]);
		const cancelledAt = parseInstant("2026-07-17T08:00:00Z");
		const materialized = materialize(plan).resultingSnapshot;
		expect(materialized.completedAt).toBe(now);
		expect(materialized.cancelledAt).toEqual(cancelledAt);
		expect(
			materialized.stages.some(
				(stage) =>
					stage.status === "pending" ||
					stage.status === "waiting" ||
					stage.assignments.some(
						(assignment) => assignment.status === "pending",
					),
			),
		).toBe(false);
	});
});

describe("Task 2.1 quality blockers", () => {
	it("keeps actor fingerprints in receipts rather than persisted actors", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		const result = materialize(plan, managerActor);

		expect(
			result.resultingSnapshot.stages[0]?.assignments[0]?.resolvedBy,
		).not.toHaveProperty("fingerprint");
		expect(result.events[0]?.actor).not.toHaveProperty("fingerprint");
	});

	it("exports deterministic actor fingerprinting and requires a receipt-bound actor", () => {
		expect(
			(stateMachineModule as Record<string, unknown>)
				.fingerprintApprovalCommandActor,
		).toBeTypeOf("function");
		expect(fingerprintApprovalCommandActor(managerActor)).toBe(
			`v1:["employee","${managerActor.employeeId}"]`,
		);
		expect(
			fingerprintApprovalCommandActor({
				...managerActor,
				userId: "other-user",
			}),
		).toBe(fingerprintApprovalCommandActor(managerActor));
		expect(fingerprintApprovalCommandActor(systemCommandActor)).toBe(
			'v1:["system"]',
		);

		const plan = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		const binding = bindCommandActor(plan);
		binding.receipt.actorFingerprint =
			fingerprintApprovalCommandActor(systemCommandActor);
		expectMachineError(
			() =>
				materializeApprovalTransitionPlan(plan, resolutionsFor(plan), binding),
			"MATERIALIZATION_CONFLICT",
		);
	});

	it("rejects forgeable approved-cancellation policy booleans", () => {
		const approval = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		const approved = materialize(approval).resultingSnapshot;

		expectMachineError(
			() =>
				planWorkflowTransition(
					approved,
					{ type: "cancel", reason: "forged" },
					{ canCancelAfterApproval: true } as never,
					now,
				),
			"INVALID_POLICY" as never,
		);
	});

	it("rejects approved-cancellation authorization minted for another workflow", async () => {
		const foreignWorkflow = {
			...pendingWorkflow({ secondStage: false }),
			id: "10000000-0000-4000-8000-000000000002",
		};
		const foreignAuthorization =
			await authorizeApprovedCancellationFor(foreignWorkflow);
		const approval = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		const approved = materialize(approval).resultingSnapshot;

		expectMachineError(
			() =>
				planWorkflowTransition(
					approved,
					{ type: "cancel", reason: "replayed authorization" },
					{
						kind: "approved_cancellation",
						authorization: foreignAuthorization,
					},
					now,
				),
			"INVALID_POLICY",
		);
	});

	it("exports durable event-reference metadata codecs", () => {
		expect(
			(stateMachineModule as Record<string, unknown>)
				.serializeApprovalWorkflowEventMetadata,
		).toBeTypeOf("function");
		expect(
			(stateMachineModule as Record<string, unknown>)
				.deserializeApprovalWorkflowEventMetadata,
		).toBeTypeOf("function");
	});

	it("round-trips business metadata and event references without ambiguity", () => {
		const metadata = { source: "reassignment", nested: { preserved: true } };
		const references = {
			assignmentId: assignmentOneId,
			sourceAssignmentId: assignmentTwoId,
		};
		const persistenceMetadata = serializeApprovalWorkflowEventMetadata(
			metadata,
			references,
		);

		expect(persistenceMetadata).not.toBe(metadata);
		expect(
			deserializeApprovalWorkflowEventMetadata(persistenceMetadata),
		).toEqual({ metadata, references });
		expect(
			deserializeApprovalWorkflowEventMetadata(
				serializeApprovalWorkflowEventMetadata(null, {
					assignmentId: assignmentOneId,
				}),
			),
		).toEqual({
			metadata: null,
			references: { assignmentId: assignmentOneId },
		});
	});

	it("rejects reserved metadata collisions and malformed reference envelopes", () => {
		expectMachineError(
			() =>
				serializeApprovalWorkflowEventMetadata(
					{ [APPROVAL_EVENT_REFERENCES_METADATA_KEY]: {} },
					{},
				),
			"INVALID_EVENT_METADATA",
		);
		expectMachineError(
			() =>
				serializeApprovalWorkflowEventMetadata({}, {
					unexpectedReference: assignmentOneId,
				} as never),
			"INVALID_EVENT_METADATA",
		);
		expectMachineError(
			() =>
				deserializeApprovalWorkflowEventMetadata({
					[APPROVAL_EVENT_REFERENCES_METADATA_KEY]: {
						businessMetadataWasNull: false,
						references: { assignmentId: "not-a-uuid" },
					},
				}),
			"INVALID_EVENT_METADATA",
		);
	});

	it.each([
		[
			"extra envelope key",
			{
				businessMetadataWasNull: false,
				references: { assignmentId: assignmentOneId },
				extra: true,
			},
			{},
		],
		[
			"empty references",
			{ businessMetadataWasNull: false, references: {} },
			{},
		],
		[
			"business metadata with null flag",
			{
				businessMetadataWasNull: true,
				references: { assignmentId: assignmentOneId },
			},
			{ businessKey: "must not be discarded" },
		],
	] as const)("rejects contradictory event-reference envelope: %s", (_label, envelope, businessMetadata) => {
		expectMachineError(
			() =>
				deserializeApprovalWorkflowEventMetadata({
					...businessMetadata,
					[APPROVAL_EVENT_REFERENCES_METADATA_KEY]: envelope,
				}),
			"INVALID_EVENT_METADATA",
		);
	});

	it.each([
		[
			"snapshot",
			() =>
				planWorkflowTransition(
					null as never,
					{} as never,
					null as never,
					null as never,
				),
			"INVALID_SNAPSHOT",
		],
		[
			"command",
			() =>
				planWorkflowTransition(
					pendingWorkflow(),
					{ type: "unknown" } as never,
					standardPolicy,
					now,
				),
			"INVALID_COMMAND",
		],
		[
			"resolved stage",
			() => planStageActivation(waitingWorkflow(), null as never, now),
			"INVALID_ACTIVATION",
		],
	] as const)("classifies malformed %s input", (_label, invoke, code) => {
		expectMachineError(invoke, code);
	});

	it("rejects non-Instants and transition-local backwards time", () => {
		for (const invalid of [
			{},
			{ toString: () => "2026-07-16T14:00:00Z" },
			now.toZonedDateTimeISO("UTC"),
		]) {
			expectMachineError(
				() =>
					planWorkflowTransition(
						pendingWorkflow(),
						{ type: "cancel", reason: "invalid time" },
						standardPolicy,
						invalid as never,
					),
				"INVALID_TIME",
			);
		}
		expectMachineError(
			() =>
				planWorkflowTransition(
					pendingWorkflow(),
					{
						type: "approve",
						stageId: stageOneId,
						assignmentId: assignmentOneId,
					},
					standardPolicy,
					parseInstant("2026-07-15T08:00:00Z"),
				),
			"INVALID_TIME" as never,
		);
	});

	it.each([
		[
			"approve sibling",
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
		],
		[
			"reject sibling",
			{
				type: "reject",
				stageId: stageOneId,
				assignmentId: assignmentOneId,
				reason: "rejected",
			},
		],
		["cancel", { type: "cancel", reason: "cancelled" }],
		["expire", { type: "expire", reason: "expired" }],
	] as const)("rejects a future-dated pending assignment during %s", (_label, command) => {
		const snapshot = pendingWorkflow({ secondStage: false });
		fixtureAssignment(snapshot, 0, 1).assignedAt = parseInstant(
			"2026-07-16T15:00:00Z",
		);

		expectMachineError(
			() => planWorkflowTransition(snapshot, command, standardPolicy, now),
			"INVALID_TIME",
		);
	});

	it("allows incomplete cancelled backfill history but rejects malformed present lineage", () => {
		const snapshot = pendingWorkflow({ secondStage: false });
		const historical = fixtureAssignment(snapshot, 0, 0);
		historical.status = "cancelled";
		historical.resolvedAt = activatedAt;
		historical.resolvedBy = null;

		expect(() =>
			planWorkflowTransition(
				snapshot,
				{ type: "approve", stageId: stageOneId, assignmentId: assignmentTwoId },
				standardPolicy,
				now,
			),
		).not.toThrow();

		const malformed = pendingWorkflow({ secondStage: false });
		const target = fixtureAssignment(malformed, 0, 1);
		target.reassignmentMetadata = { kind: "reassignment" };
		expectMachineError(
			() =>
				planWorkflowTransition(
					malformed,
					{ type: "cancel", reason: "malformed lineage" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it("rejects present lineage assigned before its cancelled source resolved", () => {
		const snapshot = pendingWorkflow({ secondStage: false });
		const source = fixtureAssignment(snapshot, 0, 0);
		const descendant = fixtureAssignment(snapshot, 0, 1);
		source.status = "cancelled";
		source.resolvedAt = now;
		source.resolvedBy = null;
		descendant.reassignedFromAssignmentId = source.id;
		descendant.reassignedByEmployeeId = managerActor.employeeId;
		descendant.reassignmentMetadata = { kind: "reassignment" };

		expectMachineError(
			() =>
				planWorkflowTransition(
					snapshot,
					{ type: "cancel", reason: "invalid lineage chronology" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it("rejects incoherent transition versions and event sequences before materialization", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{ type: "cancel", reason: "coherence" },
			standardPolicy,
			now,
		);
		const firstEvent = plan.events[0];
		if (!firstEvent) throw new Error("fixture");
		firstEvent.eventIndex = 9;
		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it.each([
		[
			"no events",
			(plan: ApprovalTransitionPlan) => {
				plan.events = [];
				plan.identityAllocations = [];
			},
		],
		[
			"null planned stages",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.stages = null as never;
			},
		],
		[
			"null planned assignments",
			(plan: ApprovalTransitionPlan) => {
				plannedStage(plan, 0).assignments = null as never;
			},
		],
		[
			"null stage changes",
			(plan: ApprovalTransitionPlan) => {
				plan.changes.stages = null as never;
			},
		],
		[
			"null assignment changes",
			(plan: ApprovalTransitionPlan) => {
				plan.changes.assignments = null as never;
			},
		],
		[
			"malformed root change",
			(plan: ApprovalTransitionPlan) => {
				plan.changes.root.previous = null as never;
			},
		],
		[
			"unknown event actor",
			(plan: ApprovalTransitionPlan) => {
				plannedEvent(plan).actor = { kind: "unknown" } as never;
			},
		],
		[
			"unknown event reference",
			(plan: ApprovalTransitionPlan) => {
				plannedEvent(plan).references = {
					unknown: { kind: "persisted", id: assignmentOneId },
				} as never;
			},
		],
		[
			"persisted event identity",
			(plan: ApprovalTransitionPlan) => {
				plannedEvent(plan).reference = {
					kind: "persisted",
					id: "70000000-0000-4000-8000-000000000001",
				} as never;
			},
		],
		[
			"empty event type",
			(plan: ApprovalTransitionPlan) => {
				plannedEvent(plan).eventType = "";
			},
		],
		[
			"unknown event type",
			(plan: ApprovalTransitionPlan) => {
				plannedEvent(plan).eventType = "workflow.unrecognized";
			},
		],
		[
			"unknown allocation kind",
			(plan: ApprovalTransitionPlan) => {
				plannedAllocation(plan).entityKind = "unknown" as never;
			},
		],
		[
			"auditless child changes",
			(plan: ApprovalTransitionPlan) => {
				plan.changes.stages = [];
				plan.changes.assignments = [];
			},
		],
	] as const)("classifies malformed materialization plan: %s", (_label, mutate) => {
		const plan = planWorkflowTransition(
			pendingWorkflow({ secondStage: false }),
			{ type: "cancel", reason: "malformed plan" },
			standardPolicy,
			now,
		);
		mutate(plan);

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects a final approval retaining only the approved root event", () => {
		const plan = finalApprovalPlan();
		plan.changes.stages = [];
		plan.changes.assignments = [];
		retainPlanEvents(plan, (event) => event.eventType === "workflow.approved");

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects a terminal result whose next action was changed to none", () => {
		const plan = finalApprovalPlan();
		plan.nextAction = { kind: "none" };

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects an omitted sibling update even when its event is also removed", () => {
		const plan = finalApprovalPlan();
		plan.changes.assignments = plan.changes.assignments.filter(
			(change) =>
				change.reference.kind !== "persisted" ||
				change.reference.id !== assignmentTwoId,
		);
		retainPlanEvents(
			plan,
			(event) =>
				event.references.assignment?.kind !== "persisted" ||
				event.references.assignment.id !== assignmentTwoId,
		);

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects an extra change for an unchanged waiting stage", () => {
		const previous = pendingWorkflow();
		const plan = planWorkflowTransition(
			previous,
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			standardPolicy,
			now,
		);
		const unchangedPrevious = fixtureStage(previous, 1);
		const unchangedResulting = plannedStage(plan, 1);
		plan.changes.stages.push({
			stageId: unchangedPrevious.id,
			previous: {
				...unchangedPrevious,
				resolverSnapshot: { ...unchangedPrevious.resolverSnapshot },
				assignments: [],
			},
			resulting: {
				...unchangedResulting,
				resolverSnapshot: { ...unchangedResulting.resolverSnapshot },
				assignments: [],
			},
		});

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects a changed authoritative previous snapshot", () => {
		const plan = finalApprovalPlan();
		const forgedPrevious = pendingWorkflow({ secondStage: false });
		forgedPrevious.version -= 1;
		(
			plan as ApprovalTransitionPlan & {
				previousSnapshot: ApprovalWorkflowSnapshot;
			}
		).previousSnapshot = forgedPrevious;

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it.each([
		[
			"workflow id",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.id = "10000000-0000-4000-8000-000000000002";
			},
		],
		[
			"organization id",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.organizationId = "org-2";
			},
		],
		[
			"requester employee id",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.requesterEmployeeId = approverFour;
			},
		],
		[
			"workflow type",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.workflowType = "time_correction";
			},
		],
		[
			"source type",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.sourceType = "different_source";
			},
		],
		[
			"source id",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.sourceId = "60000000-0000-4000-8000-000000000002";
			},
		],
		[
			"policy snapshot",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.policySnapshot = { policy: "rewritten" };
			},
		],
		[
			"context snapshot",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.contextSnapshot = { context: "rewritten" };
			},
		],
		[
			"display snapshot",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.displaySnapshot = { title: "Rewritten" };
			},
		],
		[
			"submission instant",
			(plan: ApprovalTransitionPlan) => {
				plan.plannedSnapshot.submittedAt = parseInstant("2026-07-15T09:00:01Z");
			},
		],
	] as const)("rejects a planned immutable root rewrite: %s", (_label, mutate) => {
		const plan = finalApprovalPlan();
		mutate(plan);

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("compares immutable JSON and Instants semantically", () => {
		const snapshot = pendingWorkflow({ secondStage: false });
		snapshot.policySnapshot = { alpha: 1, beta: { enabled: true } };
		const plan = planWorkflowTransition(
			snapshot,
			{ type: "cancel", reason: "semantic immutable values" },
			standardPolicy,
			now,
		);
		plan.plannedSnapshot.policySnapshot = {
			beta: { enabled: true },
			alpha: 1,
		};
		plan.plannedSnapshot.submittedAt = parseInstant(
			plan.previousSnapshot.submittedAt.toString(),
		);

		expect(() => materialize(plan)).not.toThrow();
	});

	it("rejects a silently appended waiting stage", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		plan.plannedSnapshot.stages.push({
			id: "40000000-0000-4000-8000-000000000003",
			organizationId,
			workflowId,
			sequence: 3,
			label: "Injected stage",
			resolverSnapshot: { resolver: "injected" },
			activationMode: "human",
			status: "waiting",
			activatedAt: null,
			decidedAt: null,
			decisionReason: null,
			legacyApprovalRequestId: null,
			assignments: [],
		});

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects a silently appended unknown persisted assignment", () => {
		const plan = planWorkflowTransition(
			pendingWorkflow(),
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			standardPolicy,
			now,
		);
		const injected = {
			reference: {
				kind: "persisted" as const,
				id: "50000000-0000-4000-8000-000000000099",
			},
			organizationId,
			workflowId,
			stageId: stageOneId,
			sequence: 4,
			approverEmployeeId: approverFour,
			status: "pending",
			assignedAt: now,
			resolvedAt: null,
			resolvedBy: null,
			reassignedBy: null,
			reassignedFrom: null,
			reassignmentMetadata: null,
		};
		plannedStage(plan, 0).assignments.push(injected);
		const stageChange = plan.changes.stages.find(
			(change) => change.stageId === stageOneId,
		);
		if (!stageChange) throw new Error("fixture");
		stageChange.resulting.assignments.push({
			...injected,
			reference: { ...injected.reference },
		});

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it("rejects moving a persisted assignment to another stage", () => {
		const plan = finalApprovalPlan();
		const moved = plannedStage(plan, 0).assignments[0];
		if (!moved) throw new Error("fixture");
		moved.stageId = stageTwoId;

		expectMachineError(() => materialize(plan), "MATERIALIZATION_CONFLICT");
	});

	it.each([
		"10000000000040008000000000000001",
		"{10000000-0000-4000-8000-000000000001}",
		"10000000-0000-4000-8000-00000000001",
		"ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF",
	])("rejects noncanonical workflow UUID %s", (id) => {
		const snapshot = pendingWorkflow();
		snapshot.id = id;
		for (const stage of snapshot.stages) {
			stage.workflowId = id;
			for (const assignment of stage.assignments) assignment.workflowId = id;
		}
		expectMachineError(
			() =>
				planWorkflowTransition(
					snapshot,
					{ type: "cancel", reason: "uuid" },
					standardPolicy,
					now,
				),
			"INVALID_SNAPSHOT",
		);
	});

	it("classifies hostile JSON structures and accepts null-prototype JSON", () => {
		const sparse: unknown[] = [];
		sparse.length = 1;
		const accessor = {} as Record<string, unknown>;
		Object.defineProperty(accessor, "value", {
			enumerable: true,
			get() {
				throw new Error("getter executed");
			},
		});
		const nonEnumerable = { visible: true } as Record<string, unknown>;
		Object.defineProperty(nonEnumerable, "hidden", { value: true });
		const symbolValue = { visible: true } as Record<PropertyKey, unknown>;
		symbolValue[Symbol("hidden")] = true;
		for (const invalid of [sparse, accessor, nonEnumerable, symbolValue]) {
			const snapshot = pendingWorkflow();
			snapshot.displaySnapshot = invalid as never;
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{ type: "cancel", reason: "json" },
						standardPolicy,
						now,
					),
				"INVALID_SNAPSHOT",
			);
		}

		const nullPrototype = Object.assign(Object.create(null), {
			dense: [1, 2, 3],
		});
		const snapshot = pendingWorkflow();
		snapshot.displaySnapshot = nullPrototype;
		expect(() =>
			planWorkflowTransition(
				snapshot,
				{ type: "cancel", reason: "json" },
				standardPolicy,
				now,
			),
		).not.toThrow();
	});

	it("classifies stateful and revoked JSON proxies", () => {
		let descriptorReads = 0;
		const stateful = new Proxy(
			{ visible: true },
			{
				getOwnPropertyDescriptor(target, key) {
					descriptorReads += 1;
					if (descriptorReads > 1) throw new Error("state changed");
					return Reflect.getOwnPropertyDescriptor(target, key);
				},
			},
		);
		const revocable = Proxy.revocable({ visible: true }, {});
		revocable.revoke();

		for (const invalid of [stateful, revocable.proxy]) {
			const snapshot = pendingWorkflow();
			snapshot.displaySnapshot = invalid;
			expectMachineError(
				() =>
					planWorkflowTransition(
						snapshot,
						{ type: "cancel", reason: "proxy" },
						standardPolicy,
						now,
					),
				"INVALID_SNAPSHOT",
			);
		}
	});
});

describe("purity and event integrity", () => {
	it("does not mutate frozen snapshots, commands, resolved candidates, metadata, or instants", () => {
		const commands: ApprovalWorkflowCommand[] = [
			{ type: "approve", stageId: stageOneId, assignmentId: assignmentOneId },
			{
				type: "reject",
				stageId: stageOneId,
				assignmentId: assignmentOneId,
				reason: "no",
			},
			{ type: "cancel", reason: "withdrawn" },
			{ type: "expire", reason: "elapsed" },
			{
				type: "reassign",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
			{
				type: "escalate",
				stageId: stageOneId,
				fromEmployeeId: approverOne,
				toEmployeeId: approverThree,
			},
		];
		for (const command of commands) {
			expect(() =>
				planWorkflowTransition(
					deepFreeze(
						pendingWorkflow({ secondStage: command.type !== "approve" }),
					),
					deepFreeze(command),
					deepFreeze(standardPolicy),
					deepFreeze(now),
				),
			).not.toThrow();
		}
		expect(() =>
			planStageActivation(
				deepFreeze(waitingWorkflow()),
				deepFreeze(resolvedStage()),
				deepFreeze(now),
			),
		).not.toThrow();
	});

	it("is deterministic and emits JSON-safe event state and metadata", () => {
		const input = pendingWorkflow();
		const command = {
			type: "reject" as const,
			stageId: stageOneId,
			assignmentId: assignmentOneId,
			reason: "deterministic",
		};
		const first = planWorkflowTransition(input, command, standardPolicy, now);
		const second = planWorkflowTransition(input, command, standardPolicy, now);
		expect(first).toEqual(second);
		for (const event of first.events) {
			expect(jsonRoundTrip(event.previousState)).toEqual(event.previousState);
			expect(jsonRoundTrip(event.resultingState)).toEqual(event.resultingState);
			expect(jsonRoundTrip(event.metadata)).toEqual(event.metadata);
		}
	});

	it("keeps the reducer source free of persistence, clocks, logging, randomness, and I/O imports", () => {
		const source = readFileSync(
			fileURLToPath(new URL("./state-machine.ts", import.meta.url)),
			"utf8",
		);
		expect(source).not.toMatch(
			/from\s+["'](?:drizzle-orm|effect|luxon|node:|@\/db|@\/env|.*(?:logger|random|clock))["']/,
		);
		expect(source).not.toMatch(/\b(?:Date|Math\.random|crypto|console\.)\b/);
		expect(
			[...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]),
		).toEqual([
			"@/lib/datetime/temporal-core",
			"../domain-adapters/registry",
			"./ports",
			"./types",
		]);
	});
});

function terminalSnapshot(
	status: "rejected" | "cancelled" | "expired",
): ApprovalWorkflowSnapshot {
	const snapshot = pendingWorkflow();
	snapshot.status = status;
	snapshot.currentStageOrder = null;
	snapshot.completedAt = now;
	snapshot.cancelledAt = status === "cancelled" ? now : null;
	snapshot.decisionReason = "terminal";
	for (const item of snapshot.stages) {
		item.status = status === "cancelled" ? "cancelled" : status;
		item.activatedAt ??= activatedAt;
		item.decidedAt = now;
		item.decisionReason = "terminal";
		for (const child of item.assignments) {
			child.status = status === "cancelled" ? "cancelled" : status;
			child.resolvedAt = now;
		}
	}
	return snapshot;
}
