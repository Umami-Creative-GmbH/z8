import { describe, expect, it, vi } from "vitest";
import { isInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { deriveApprovalWorkflowId } from "./identity";
import { createLegacyApprovalObservationPlanner } from "./legacy-observation-planner";
import type {
	ObservedLegacyTransition,
	VerifiedLegacyApprovalState,
} from "./ports";

const organizationId = "org-1";
const sourceId = "20000000-0000-4000-8000-000000000001";
const requesterId = "30000000-0000-4000-8000-000000000001";
const approverId = "30000000-0000-4000-8000-000000000002";
const managerActorId = "30000000-0000-4000-8000-000000000003";
const requestId = "40000000-0000-4000-8000-000000000001";
const chainId = "50000000-0000-4000-8000-000000000001";
const policyId = "50000000-0000-4000-8000-000000000002";
const rowIds = [
	"60000000-0000-4000-8000-000000000001",
	"60000000-0000-4000-8000-000000000002",
	"60000000-0000-4000-8000-000000000003",
	"60000000-0000-4000-8000-000000000004",
] as const;
const rowRequestIds = [
	"70000000-0000-4000-8000-000000000001",
	"70000000-0000-4000-8000-000000000002",
	"70000000-0000-4000-8000-000000000003",
	"70000000-0000-4000-8000-000000000004",
] as const;
const capturedAt = parseInstant("2026-07-18T10:00:00Z");
const chainCreatedAt = parseInstant("2026-07-18T08:00:00Z");
const activationAt = parseInstant("2026-07-18T09:00:00Z");
const updatedAt = parseInstant("2026-07-18T09:59:00Z");
const source = {
	organizationId,
	workflowType: "absence" as const,
	sourceType: "absence_entry",
	sourceId,
};

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error("Invalid test fixture");
	return value;
}

function emptyState(): VerifiedLegacyApprovalState {
	return {
		organizationId,
		source: { ...source },
		approvalRequest: null,
		chain: null,
		chainRows: [],
		sourceSnapshot: { id: sourceId, status: "pending", nested: { value: 1 } },
		capturedAt,
	};
}

function directState(status: "pending" | "approved" | "rejected") {
	return {
		...emptyState(),
		approvalRequest: {
			id: requestId,
			organizationId,
			entityType: source.sourceType,
			entityId: sourceId,
			requestedBy: requesterId,
			approverId,
			status,
			reason: "Annual leave",
			rejectionReason: status === "rejected" ? "Coverage unavailable" : null,
			approvedAt: status === "approved" ? updatedAt : null,
			metadata: { origin: "legacy" },
			updatedAt,
		},
		sourceSnapshot: { id: sourceId, status },
	} satisfies VerifiedLegacyApprovalState;
}

function transition(
	before: VerifiedLegacyApprovalState,
	after: VerifiedLegacyApprovalState,
	expectedVersion: number | null,
): ObservedLegacyTransition {
	return {
		organizationId,
		source: { ...source },
		before,
		after,
		actor: { kind: "legacy_unknown", employeeId: null, userId: null },
		idempotencyKey: "legacy-observation-1",
		expectedVersion,
	};
}

function chainState(input: {
	status: "pending" | "approved" | "rejected" | "cancelled";
	currentStageOrder: number;
	rowStatuses: Array<"pending" | "approved" | "rejected" | "cancelled">;
	currentRequestStatus: "pending" | "approved" | "rejected" | null;
	autoRows?: number[];
	approverTypes?: string[];
	requestUpdatedAt?: typeof updatedAt;
	decisionAt?: typeof updatedAt;
}): VerifiedLegacyApprovalState {
	const requestUpdatedAt = input.requestUpdatedAt ?? updatedAt;
	const decisionAt = input.decisionAt ?? updatedAt;
	const completedAt = input.status === "pending" ? null : updatedAt;
	const chainRows = input.rowStatuses.map((status, index) => {
		const stepOrder = index + 1;
		const decided = status === "approved" || status === "rejected";
		return {
			id: rowIds[index] as string,
			organizationId,
			chainInstanceId: chainId,
			policyStageId: `80000000-0000-4000-8000-00000000000${stepOrder}`,
			stepOrder,
			labelSnapshot: `Stage ${stepOrder}`,
			approverTypeSnapshot:
				input.approverTypes?.[index] ??
				(["direct_manager", "org_admin", "specific_employee"][index] as string),
			resolvedApproverEmployeeId: input.autoRows?.includes(stepOrder)
				? requesterId
				: approverId,
			approvalRequestId:
				decided || stepOrder === input.currentStageOrder
					? (rowRequestIds[index] as string)
					: null,
			status,
			decidedBy: decided
				? input.autoRows?.includes(stepOrder)
					? requesterId
					: approverId
				: null,
			decidedAt: decided ? decisionAt : null,
			createdAt: chainCreatedAt,
			updatedAt:
				decided || stepOrder === input.currentStageOrder
					? decided
						? decisionAt
						: requestUpdatedAt
					: chainCreatedAt,
		};
	});
	const currentIndex = input.currentStageOrder - 1;
	const currentRow = chainRows[currentIndex];
	return {
		...emptyState(),
		approvalRequest:
			input.currentRequestStatus === null || !currentRow
				? null
				: {
						id: currentRow.approvalRequestId as string,
						organizationId,
						entityType: source.sourceType,
						entityId: sourceId,
						requestedBy: requesterId,
						approverId: currentRow.resolvedApproverEmployeeId,
						status: input.currentRequestStatus,
						reason: "Chain approval",
						rejectionReason:
							input.currentRequestStatus === "rejected" ? "Rejected" : null,
						approvedAt:
							input.currentRequestStatus === "approved" ? decisionAt : null,
						metadata: null,
						updatedAt: requestUpdatedAt,
					},
		chain: {
			id: chainId,
			organizationId,
			policyId,
			policyNameSnapshot: "Absence policy",
			entityType: source.sourceType,
			entityId: sourceId,
			requesterEmployeeId: requesterId,
			currentStageOrder: input.currentStageOrder,
			status: input.status,
			createdAt: chainCreatedAt,
			updatedAt,
			completedAt,
		},
		chainRows,
		sourceSnapshot: { id: sourceId, status: input.status },
	};
}

describe("legacy approval observation planner", () => {
	it("uses the direct approval request as cycle identity across pending and terminal evidence", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const pending = await planner.plan(
			transition(emptyState(), directState("pending"), null),
		);
		const terminal = await planner.plan(
			transition(directState("pending"), directState("approved"), 1),
		);
		const laterRequestId = "40000000-0000-4000-8000-000000000009";
		const later = directState("pending");
		if (!later.approvalRequest) throw new Error("fixture");
		later.approvalRequest.id = laterRequestId;
		const nextCycle = await planner.plan(transition(emptyState(), later, null));

		expect(pending.snapshot.id).toBe(
			deriveApprovalWorkflowId({ ...source, allocationKey: requestId }),
		);
		expect(terminal.snapshot.id).toBe(pending.snapshot.id);
		expect(nextCycle.snapshot.id).toBe(
			deriveApprovalWorkflowId({ ...source, allocationKey: laterRequestId }),
		);
		expect(nextCycle.snapshot.id).not.toBe(pending.snapshot.id);
	});

	it("uses the chain root as cycle identity across pending and terminal evidence", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const pendingState = chainState({
			status: "pending",
			currentStageOrder: 1,
			rowStatuses: ["pending"],
			currentRequestStatus: "pending",
		});
		const terminalState = chainState({
			status: "approved",
			currentStageOrder: 1,
			rowStatuses: ["approved"],
			currentRequestStatus: "approved",
		});
		const pending = await planner.plan(
			transition(emptyState(), pendingState, null),
		);
		const terminal = await planner.plan(
			transition(pendingState, terminalState, 1),
		);
		const laterChainId = "50000000-0000-4000-8000-000000000009";
		const laterState = chainState({
			status: "pending",
			currentStageOrder: 1,
			rowStatuses: ["pending"],
			currentRequestStatus: "pending",
		});
		if (!laterState.chain) throw new Error("fixture");
		laterState.chain.id = laterChainId;
		for (const row of laterState.chainRows) row.chainInstanceId = laterChainId;
		const nextCycle = await planner.plan(
			transition(emptyState(), laterState, null),
		);

		expect(pending.snapshot.id).toBe(
			deriveApprovalWorkflowId({ ...source, allocationKey: chainId }),
		);
		expect(terminal.snapshot.id).toBe(pending.snapshot.id);
		expect(nextCycle.snapshot.id).toBe(
			deriveApprovalWorkflowId({ ...source, allocationKey: laterChainId }),
		);
		expect(nextCycle.snapshot.id).not.toBe(pending.snapshot.id);
	});

	it("plans a null-to-pending direct submission without wall-clock entropy", async () => {
		const nowInstant = vi.fn(() => parseInstant("2030-01-01T00:00:00Z"));
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant },
		});
		const input = transition(emptyState(), directState("pending"), null);

		const first = await planner.plan(input);
		const second = await planner.plan(input);

		expect(first).toEqual(second);
		expect(nowInstant).not.toHaveBeenCalled();
		expect(first.snapshot).toMatchObject({
			organizationId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId,
			requesterEmployeeId: requesterId,
			status: "pending",
			currentStageOrder: 1,
			version: 1,
			completedAt: null,
			cancelledAt: null,
		});
		expect(first.snapshot.stages).toHaveLength(1);
		expect(first.snapshot.stages[0]).toMatchObject({
			sequence: 1,
			status: "pending",
			activationMode: "human",
			legacyApprovalRequestId: requestId,
		});
		expect(first.snapshot.stages[0]?.assignments[0]).toMatchObject({
			approverEmployeeId: approverId,
			status: "pending",
		});
		expect(
			first.events.map((event) => [event.version, event.eventIndex]),
		).toEqual(first.events.map((_, index) => [1, index]));
		expect(first.events.map((event) => event.eventType)).toEqual([
			"assignment.created",
			"stage.activated",
			"workflow.activation_requested",
		]);
		expect(first.outbox.every((item) => item.disposition === "observe")).toBe(
			true,
		);
		expect(first.projection.activeInboxStage).toEqual({
			stageId: first.snapshot.stages[0]?.id,
			stageOrder: 1,
		});
	});

	it("plans a pending direct request approval", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => parseInstant("2030-01-01T00:00:00Z") },
		});

		const plan = await planner.plan(
			transition(directState("pending"), directState("approved"), 1),
		);

		expect(plan.snapshot).toMatchObject({
			status: "approved",
			currentStageOrder: null,
			version: 2,
			completedAt: updatedAt,
			cancelledAt: null,
		});
		expect(plan.snapshot.stages[0]).toMatchObject({
			status: "approved",
			legacyApprovalRequestId: requestId,
		});
		expect(plan.snapshot.stages[0]?.assignments[0]).toMatchObject({
			status: "approved",
			resolvedAt: updatedAt,
			resolvedBy: null,
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"workflow.approved",
		]);
		expect(
			plan.events.map((event) => [event.version, event.eventIndex]),
		).toEqual([
			[2, 0],
			[2, 1],
			[2, 2],
		]);
	});

	it("plans a chainless requester fallback that is already approved", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = directState("approved");
		if (!after.approvalRequest) throw new Error("fixture");
		after.approvalRequest.approverId = requesterId;

		const plan = await planner.plan(transition(emptyState(), after, null));

		expect(plan.snapshot).toMatchObject({
			status: "approved",
			version: 1,
			currentStageOrder: null,
		});
		expect(plan.snapshot.stages[0]).toMatchObject({
			activationMode: "requester_auto_approve",
			status: "approved",
			assignments: [],
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"workflow.approved",
		]);
	});

	it("plans verified requester auto-approval when the source snapshot is a domain payload", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = directState("approved");
		if (!after.approvalRequest) throw new Error("fixture");
		after.approvalRequest.approverId = requesterId;
		after.sourceSnapshot = { timeRequest: { kind: "manual_time_submission" } };

		const plan = await planner.plan(transition(emptyState(), after, null));

		expect(plan.snapshot).toMatchObject({ status: "approved", version: 1 });
		expect(plan.snapshot.stages[0]).toMatchObject({
			activationMode: "requester_auto_approve",
			status: "approved",
			assignments: [],
		});
	});

	it("rejects unexplained chainless instant approval", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});

		await expect(
			planner.plan(transition(emptyState(), directState("approved"), null)),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it("preserves direct activation time and attributes manager approval to the actor", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = directState("pending");
		const after = directState("approved");
		if (!before.approvalRequest || !after.approvalRequest) {
			throw new Error("fixture");
		}
		before.approvalRequest.updatedAt = activationAt;
		after.approvalRequest.updatedAt = updatedAt;
		after.approvalRequest.approvedAt = updatedAt;
		const input = transition(before, after, 1);
		input.actor = {
			kind: "employee",
			employeeId: managerActorId,
			userId: "manager-user",
		};

		const plan = await planner.plan(input);
		const assignment = required(plan.snapshot.stages[0]?.assignments[0]);

		expect(plan.snapshot.stages[0]?.activatedAt).toBe(activationAt);
		expect(assignment.assignedAt).toBe(activationAt);
		expect(assignment.resolvedAt).toBe(updatedAt);
		expect(assignment.resolvedBy).toEqual({
			kind: "employee",
			employeeId: managerActorId,
			userId: null,
		});
		expect(plan.events[0]?.actor).toEqual(input.actor);
	});

	it("plans a pending direct request rejection with its reason", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});

		const plan = await planner.plan(
			transition(directState("pending"), directState("rejected"), 1),
		);

		expect(plan.snapshot).toMatchObject({
			status: "rejected",
			currentStageOrder: null,
			version: 2,
			decisionReason: "Coverage unavailable",
		});
		expect(plan.snapshot.stages[0]).toMatchObject({
			status: "rejected",
			decisionReason: "Coverage unavailable",
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.rejected",
			"stage.rejected",
			"workflow.rejected",
		]);
	});

	it("plans cancellation only when a prior pending direct request disappears", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => parseInstant("2030-01-01T00:00:00Z") },
		});
		const after = emptyState();
		after.capturedAt = parseInstant("2026-07-18T10:01:00Z");

		const plan = await planner.plan(
			transition(directState("pending"), after, 1),
		);

		expect(plan.snapshot).toMatchObject({
			status: "cancelled",
			currentStageOrder: null,
			version: 2,
			completedAt: after.capturedAt,
			cancelledAt: after.capturedAt,
			decisionReason: "Legacy pending request disappeared",
		});
		expect(plan.snapshot.stages[0]).toMatchObject({ status: "cancelled" });
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.cancelled",
			"stage.cancelled",
			"workflow.cancelled",
		]);
	});

	it("plans owner cancellation when an approved direct request disappears while the source remains approved", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => parseInstant("2030-01-01T00:00:00Z") },
		});
		const before = directState("approved");
		const after = emptyState();
		before.sourceSnapshot = {
			id: sourceId,
			status: "approved",
			approvedBy: approverId,
		};
		after.sourceSnapshot = { ...before.sourceSnapshot };
		after.capturedAt = parseInstant("2026-07-18T10:01:00Z");
		const input = transition(before, after, 1);
		input.actor = {
			kind: "employee",
			employeeId: requesterId,
			userId: "requester-user",
		};

		const plan = await planner.plan(input);

		expect(plan.snapshot).toMatchObject({
			status: "cancelled",
			version: 2,
			completedAt: after.capturedAt,
			cancelledAt: after.capturedAt,
			decisionReason: "Legacy approved request cancelled by owner",
		});
		expect(plan.snapshot.stages[0]).toMatchObject({ status: "approved" });
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"workflow.cancelled",
		]);
		expect(plan.events[0]?.previousState).toEqual({ status: "approved" });
	});

	it.each([
		[
			"an unknown actor",
			(input: ObservedLegacyTransition) => ({
				...input,
				actor: {
					kind: "legacy_unknown" as const,
					employeeId: null,
					userId: null,
				},
			}),
		],
		[
			"a different employee",
			(input: ObservedLegacyTransition) => ({
				...input,
				actor: {
					kind: "employee" as const,
					employeeId: managerActorId,
					userId: "other-user",
				},
			}),
		],
		[
			"a changed approved source",
			(input: ObservedLegacyTransition) => ({
				...input,
				after: {
					...input.after,
					sourceSnapshot: { ...input.after.sourceSnapshot, changed: true },
				},
			}),
		],
	] as const)("rejects approved direct disappearance with %s", async (_name, mutate) => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = directState("approved");
		const after = emptyState();
		before.sourceSnapshot = { id: sourceId, status: "approved" };
		after.sourceSnapshot = { ...before.sourceSnapshot };
		const base = transition(before, after, 1);
		const coherent = {
			...base,
			actor: {
				kind: "employee" as const,
				employeeId: requesterId,
				userId: "requester-user",
			},
		};

		await expect(planner.plan(mutate(coherent))).rejects.toMatchObject({
			code: "invalid_lifecycle",
		});
	});

	it("plans approved chain-root cancellation while preserving approved stages", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "approved",
			currentStageOrder: 2,
			rowStatuses: ["approved", "approved"],
			currentRequestStatus: "approved",
		});
		const after = chainState({
			status: "cancelled",
			currentStageOrder: 2,
			rowStatuses: ["approved", "approved"],
			currentRequestStatus: "approved",
		});
		after.sourceSnapshot = { id: sourceId, status: "approved" };

		const plan = await planner.plan(transition(before, after, 2));

		expect(plan.snapshot).toMatchObject({
			status: "cancelled",
			currentStageOrder: null,
			version: 3,
		});
		expect(plan.snapshot.stages.map((stage) => stage.status)).toEqual([
			"approved",
			"approved",
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"workflow.cancelled",
		]);
		expect(plan.events[0]?.previousState).toEqual({ status: "approved" });
	});

	it("plans a null-to-approved all-requester-auto chain submission", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = chainState({
			status: "approved",
			currentStageOrder: 2,
			rowStatuses: ["approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1, 2],
		});
		expect(isInstant(after.chain?.createdAt)).toBe(true);
		expect(isInstant(after.chain?.updatedAt)).toBe(true);
		expect(isInstant(after.chain?.completedAt)).toBe(true);
		expect(after.chain).toMatchObject({
			id: chainId,
			organizationId,
			entityType: source.sourceType,
			entityId: sourceId,
			policyId,
			requesterEmployeeId: requesterId,
			currentStageOrder: 2,
			status: "approved",
		});

		const plan = await planner.plan(transition(emptyState(), after, null));

		expect(plan.snapshot).toMatchObject({
			status: "approved",
			currentStageOrder: null,
			version: 1,
			requesterEmployeeId: requesterId,
		});
		expect(
			plan.snapshot.stages.map((stage) => ({
				sequence: stage.sequence,
				status: stage.status,
				activationMode: stage.activationMode,
				legacyApprovalRequestId: stage.legacyApprovalRequestId,
				assignments: stage.assignments.length,
			})),
		).toEqual([
			{
				sequence: 1,
				status: "approved",
				activationMode: "requester_auto_approve",
				legacyApprovalRequestId: rowRequestIds[0],
				assignments: 0,
			},
			{
				sequence: 2,
				status: "approved",
				activationMode: "requester_auto_approve",
				legacyApprovalRequestId: rowRequestIds[1],
				assignments: 0,
			},
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"stage.auto_approved",
			"workflow.approved",
		]);
	});

	it("plans multi-stage chain advancement after requester auto-approval", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot).toMatchObject({
			status: "pending",
			currentStageOrder: 3,
			version: 2,
		});
		expect(
			plan.snapshot.stages.map((stage) => ({
				sequence: stage.sequence,
				status: stage.status,
				activationMode: stage.activationMode,
				legacyApprovalRequestId: stage.legacyApprovalRequestId,
				assignmentStatus: stage.assignments[0]?.status ?? null,
			})),
		).toEqual([
			{
				sequence: 1,
				status: "approved",
				activationMode: "requester_auto_approve",
				legacyApprovalRequestId: rowRequestIds[0],
				assignmentStatus: null,
			},
			{
				sequence: 2,
				status: "approved",
				activationMode: "human",
				legacyApprovalRequestId: rowRequestIds[1],
				assignmentStatus: "approved",
			},
			{
				sequence: 3,
				status: "pending",
				activationMode: "human",
				legacyApprovalRequestId: rowRequestIds[2],
				assignmentStatus: "pending",
			},
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"assignment.created",
			"stage.activated",
			"workflow.activation_requested",
		]);
		expect(plan.snapshot.stages.map((stage) => stage.activatedAt)).toEqual([
			updatedAt,
			updatedAt,
			updatedAt,
		]);
		expect(
			plan.snapshot.stages.flatMap((stage) =>
				stage.assignments.map((assignment) => assignment.assignedAt),
			),
		).toEqual([updatedAt, updatedAt]);
		expect(plan.snapshot.submittedAt).toBe(chainCreatedAt);
	});

	it("creates an ordered pending chain with approved auto and waiting future stages", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});

		const plan = await planner.plan(transition(emptyState(), after, null));

		expect(plan.snapshot.stages.map((stage) => stage.status)).toEqual([
			"approved",
			"pending",
			"waiting",
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"assignment.created",
			"stage.activated",
			"workflow.activation_requested",
		]);
	});

	it("emits entity-coherent canonical events and scoped observe payloads", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});

		const plan = await planner.plan(transition(before, after, 1));
		const approvedStage = required(plan.snapshot.stages[1]);
		const activeStage = required(plan.snapshot.stages[2]);
		const approvedAssignment = required(approvedStage.assignments[0]);
		const activeAssignment = required(activeStage.assignments[0]);

		expect(plan.events).toEqual([
			expect.objectContaining({
				eventType: "assignment.approved",
				previousState: { status: "pending" },
				resultingState: { status: "approved" },
				metadata: { stageId: approvedStage.id },
				references: { assignmentId: approvedAssignment.id },
			}),
			expect.objectContaining({
				eventType: "stage.approved",
				previousState: { status: "pending" },
				resultingState: { status: "approved" },
				metadata: { stageId: approvedStage.id, stageOrder: 2 },
			}),
			expect.objectContaining({
				eventType: "assignment.created",
				previousState: null,
				resultingState: {
					approverEmployeeId: approverId,
					sequence: 1,
					status: "pending",
				},
				metadata: { stageId: activeStage.id },
				references: { assignmentId: activeAssignment.id },
			}),
			expect.objectContaining({
				eventType: "stage.activated",
				previousState: { status: "waiting" },
				resultingState: { status: "pending" },
				metadata: { stageId: activeStage.id, stageOrder: 3 },
			}),
			expect.objectContaining({
				eventType: "workflow.activation_requested",
				previousState: { currentStageOrder: 2, status: "pending" },
				resultingState: { currentStageOrder: 3, status: "pending" },
				metadata: { stageId: activeStage.id, stageOrder: 3 },
			}),
		]);
		expect(plan.outbox[0]).toMatchObject({
			payload: {
				organizationId,
				workflowId: plan.snapshot.id,
				sourceType: source.sourceType,
				sourceId,
				eventId: plan.events[0]?.id,
				eventType: "assignment.approved",
				legacyObservation: true,
			},
		});
	});

	it("plans an intermediate transition from the exact decided request and next active target", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		after.approvalRequest = {
			...required(before.approvalRequest),
			status: "approved",
			approvedAt: updatedAt,
			updatedAt,
		};

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot).toMatchObject({
			status: "pending",
			currentStageOrder: 3,
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"assignment.created",
			"stage.activated",
			"workflow.activation_requested",
		]);
	});

	it("drains cancelled requester stages before activating the next human stage", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1, 3],
			approverTypes: [
				"direct_manager",
				"org_admin",
				"specific_employee",
				"specific_employee",
			],
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 4,
			rowStatuses: ["approved", "approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1, 3],
			approverTypes: [
				"direct_manager",
				"org_admin",
				"specific_employee",
				"specific_employee",
			],
		});

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot.stages.map((stage) => stage.status)).toEqual([
			"approved",
			"approved",
			"approved",
			"pending",
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"stage.auto_approved",
			"assignment.created",
			"stage.activated",
			"workflow.activation_requested",
		]);
	});

	it("drains cancelled requester stages through terminal approval", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1, 3, 4],
			approverTypes: [
				"direct_manager",
				"org_admin",
				"specific_employee",
				"specific_employee",
			],
		});
		const after = chainState({
			status: "approved",
			currentStageOrder: 4,
			rowStatuses: ["approved", "approved", "approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1, 3, 4],
			approverTypes: [
				"direct_manager",
				"org_admin",
				"specific_employee",
				"specific_employee",
			],
		});

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot.status).toBe("approved");
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"stage.auto_approved",
			"stage.auto_approved",
			"workflow.approved",
		]);
	});

	it("changes the plan when semantic evidence changes under the same idempotency key", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const firstInput = transition(emptyState(), directState("pending"), null);
		const changedInput = transition(emptyState(), directState("pending"), null);
		changedInput.after.sourceSnapshot = {
			id: sourceId,
			status: "pending",
			revision: 2,
		};

		const first = await planner.plan(firstInput);
		const changed = await planner.plan(changedInput);

		expect(changed).not.toEqual(first);
		expect(changed.events.map((event) => event.id)).not.toEqual(
			first.events.map((event) => event.id),
		);
	});

	it("copies source evidence without input or output aliasing", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const input = transition(emptyState(), directState("pending"), null);
		const plan = await planner.plan(input);
		input.after.sourceSnapshot.status = "changed";

		expect(plan.snapshot.contextSnapshot).toEqual({
			id: sourceId,
			status: "pending",
		});
		expect(plan.snapshot.contextSnapshot).not.toBe(
			plan.snapshot.displaySnapshot,
		);
		expect(plan.snapshot.displaySnapshot).not.toBe(
			plan.projection.displayPayload,
		);
		expect(JSON.stringify(plan.snapshot.displaySnapshot)).toBe(
			JSON.stringify(plan.snapshot.contextSnapshot),
		);
		expect(JSON.stringify(plan.projection.displayPayload)).toBe(
			JSON.stringify(plan.snapshot.contextSnapshot),
		);
	});

	it("rejects a hostile authentic Instant in JSON source evidence generically", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		let calls = 0;
		const hostileInstant = parseInstant("2026-07-18T10:00:00Z");
		Object.defineProperty(hostileInstant, "toString", {
			value() {
				calls += 1;
				throw new Error("private planner source evidence");
			},
		});
		const after = directState("pending");
		after.sourceSnapshot = {
			...after.sourceSnapshot,
			auditInstant: hostileInstant as never,
		};

		try {
			await planner.plan(transition(emptyState(), after, null));
			expect.unreachable("source evidence should be rejected");
		} catch (error) {
			expect(error).toMatchObject({
				name: "LegacyApprovalObservationPlannerError",
				code: "invalid_evidence",
				message: "Legacy approval observation planning failed",
			});
			expect(String(error)).not.toContain("private planner source evidence");
		}
		expect(calls).toBe(0);
	});

	it("uses intrinsic Instant serialization for hostile captured evidence", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		let calls = 0;
		const hostileInstant = parseInstant("2026-07-18T10:00:00Z");
		Object.defineProperty(hostileInstant, "toString", {
			value() {
				calls += 1;
				throw new Error("private planner captured evidence");
			},
		});
		const after = directState("pending");
		after.capturedAt = hostileInstant;

		const plan = await planner.plan(transition(emptyState(), after, null));

		expect(plan.snapshot.status).toBe("pending");
		expect(plan.events).not.toHaveLength(0);
		expect(calls).toBe(0);
	});

	it("keeps private direct correction evidence out of display and projection payloads", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = directState("pending");
		after.sourceSnapshot = {
			id: sourceId,
			status: "pending",
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "private-correction-id",
			},
			clockIn: {
				replacesEntryId: "private-replacement-id",
				rawNotes: "private raw note",
				timezoneDiagnostics: "private timezone diagnostic",
			},
		};
		after.displaySnapshot = {
			status: "pending",
			startDate: "2026-07-20",
			endDate: "2026-07-20",
			requesterLabel: "Ada L.",
		};

		const plan = await planner.plan(transition(emptyState(), after, null));

		expect(plan.snapshot.contextSnapshot).toEqual(after.sourceSnapshot);
		expect(plan.snapshot.displaySnapshot).toEqual(after.displaySnapshot);
		expect(plan.projection.displayPayload).toEqual(after.displaySnapshot);
		expect(plan.snapshot.contextSnapshot).not.toBe(after.sourceSnapshot);
		expect(plan.snapshot.displaySnapshot).not.toBe(after.displaySnapshot);

		const serializedDisplay = JSON.stringify({
			displaySnapshot: plan.snapshot.displaySnapshot,
			projection: plan.projection,
		});
		for (const privateValue of [
			"private-correction-id",
			"private-replacement-id",
			"private raw note",
			"private timezone diagnostic",
		]) {
			expect(serializedDisplay).not.toContain(privateValue);
			expect(JSON.stringify(plan.snapshot.contextSnapshot)).toContain(
				privateValue,
			);
		}
	});

	it("keeps private chain correction evidence out of display and projection payloads", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 1,
			rowStatuses: ["pending"],
			currentRequestStatus: "pending",
		});
		after.sourceSnapshot = {
			id: sourceId,
			status: "pending",
			timeCorrection: {
				action: "delete",
				clockInCorrectionId: "chain-private-clock-in",
				clockOutCorrectionId: "chain-private-clock-out",
			},
			internalTimezoneDiagnostics: "chain-private-timezone",
		};
		after.displaySnapshot = {
			status: "pending",
			startDate: "2026-07-20",
			endDate: "2026-07-20",
		};

		const plan = await planner.plan(transition(emptyState(), after, null));
		const serializedDisplay = JSON.stringify({
			displaySnapshot: plan.snapshot.displaySnapshot,
			projection: plan.projection,
		});

		expect(plan.snapshot.contextSnapshot).toEqual(after.sourceSnapshot);
		expect(plan.snapshot.displaySnapshot).toEqual(after.displaySnapshot);
		expect(plan.projection.displayPayload).toEqual(after.displaySnapshot);
		expect(serializedDisplay).not.toContain("chain-private-clock-in");
		expect(serializedDisplay).not.toContain("chain-private-clock-out");
		expect(serializedDisplay).not.toContain("chain-private-timezone");
	});

	it("keeps private ordinary work-period evidence out of display projections", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = directState("pending");
		after.source = {
			organizationId,
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			sourceId,
		};
		after.approvalRequest = {
			...required(after.approvalRequest),
			entityType: "time_entry",
			metadata: { timeRequest: { kind: "manual_time_submission" } },
		};
		after.sourceSnapshot = {
			timeRequest: { kind: "manual_time_submission" },
			pendingChanges: "private-period-pending-changes",
			internalRequestId: "private-ordinary-request-id",
			diagnostics: "private-ordinary-diagnostics",
		};
		after.displaySnapshot = {
			approvalStatus: "pending",
			labels: { title: "Manual time submission" },
			period: {
				startAt: "2026-07-20T06:00:00Z",
				endAt: "2026-07-20T14:00:00Z",
				durationMinutes: 480,
			},
		};
		const before = emptyState();
		before.source = { ...after.source };

		const input = transition(before, after, null);
		input.source = { ...after.source };
		const plan = await planner.plan(input);
		const serializedDisplay = JSON.stringify({
			displaySnapshot: plan.snapshot.displaySnapshot,
			projection: plan.projection,
		});

		expect(plan.snapshot.contextSnapshot).toEqual(after.sourceSnapshot);
		expect(plan.snapshot.displaySnapshot).toEqual(after.displaySnapshot);
		expect(plan.projection.displayPayload).toEqual(after.displaySnapshot);
		for (const privateValue of [
			"private-period-pending-changes",
			"private-ordinary-request-id",
			"private-ordinary-diagnostics",
		]) {
			expect(serializedDisplay).not.toContain(privateValue);
		}
	});

	it.each([
		[
			"foreign organization",
			(value: ObservedLegacyTransition) => {
				value.after.organizationId = "org-2";
			},
		],
		[
			"source change",
			(value: ObservedLegacyTransition) => {
				value.after.source.sourceId = "20000000-0000-4000-8000-000000000002";
			},
		],
		[
			"malformed actor",
			(value: ObservedLegacyTransition) => {
				value.actor = {
					kind: "employee",
					employeeId: null,
					userId: "user-1",
				} as never;
			},
		],
		[
			"malformed timestamp",
			(value: ObservedLegacyTransition) => {
				value.after.capturedAt = new Date() as never;
			},
		],
	] as const)("rejects %s evidence independently", async (_name, mutate) => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const input = transition(emptyState(), directState("pending"), null);
		mutate(input);

		await expect(planner.plan(input)).rejects.toMatchObject({
			code: "invalid_evidence",
		});
	});

	it.each([
		[
			"duplicate stage order",
			(value: ObservedLegacyTransition) => {
				value.after.chainRows[1] = {
					...(value.after.chainRows[1] as NonNullable<
						(typeof value.after.chainRows)[1]
					>),
					stepOrder: 1,
				};
			},
		],
		[
			"duplicate legacy request mapping",
			(value: ObservedLegacyTransition) => {
				value.after.chainRows[1] = {
					...(value.after.chainRows[1] as NonNullable<
						(typeof value.after.chainRows)[1]
					>),
					approvalRequestId: rowRequestIds[0],
				};
			},
		],
		[
			"request-to-row mismatch",
			(value: ObservedLegacyTransition) => {
				if (!value.after.approvalRequest) throw new Error("fixture");
				value.after.approvalRequest.approverId = approverId;
			},
		],
	] as const)("rejects chain %s", async (_name, mutate) => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = chainState({
			status: "approved",
			currentStageOrder: 2,
			rowStatuses: ["approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1, 2],
		});
		const input = transition(emptyState(), after, null);
		mutate(input);

		await expect(planner.plan(input)).rejects.toMatchObject({
			code: "invalid_evidence",
		});
	});

	it("rejects lifecycle regressions and cancellation without prior pending evidence", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		await expect(
			planner.plan(
				transition(directState("approved"), directState("pending"), 1),
			),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
		await expect(
			planner.plan(transition(emptyState(), emptyState(), 1)),
		).rejects.toMatchObject({
			code: "invalid_lifecycle",
		});
	});

	it("uses chain lifecycle authority for a pending chain approval", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "approved",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1],
		});

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot).toMatchObject({
			status: "approved",
			currentStageOrder: null,
			version: 2,
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"workflow.approved",
		]);
	});

	it("preserves chain activation time and attributes manager approval to the actor", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
			requestUpdatedAt: activationAt,
		});
		const after = chainState({
			status: "approved",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1],
			requestUpdatedAt: updatedAt,
			decisionAt: updatedAt,
		});
		const input = transition(before, after, 1);
		input.actor = {
			kind: "employee",
			employeeId: managerActorId,
			userId: "manager-user",
		};

		const plan = await planner.plan(input);
		const stage = required(plan.snapshot.stages[2]);
		const assignment = required(stage.assignments[0]);

		expect(stage.activatedAt).toBe(activationAt);
		expect(assignment.assignedAt).toBe(activationAt);
		expect(assignment.resolvedAt).toBe(updatedAt);
		expect(assignment.resolvedBy).toEqual({
			kind: "employee",
			employeeId: managerActorId,
			userId: null,
		});
		expect(plan.events[0]?.actor).toEqual(input.actor);
	});

	it("uses chain lifecycle authority for rejection and clears later stages", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "rejected",
			currentStageOrder: 2,
			rowStatuses: ["approved", "rejected", "cancelled"],
			currentRequestStatus: "rejected",
			autoRows: [1],
		});

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot).toMatchObject({
			status: "rejected",
			currentStageOrder: null,
			version: 2,
			decisionReason: "Rejected",
		});
		expect(plan.snapshot.stages.map((stage) => stage.status)).toEqual([
			"approved",
			"rejected",
			"cancelled",
		]);
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.rejected",
			"stage.rejected",
			"stage.cancelled",
			"workflow.rejected",
		]);
	});

	it("cancels a pending chain while preserving the prior request mapping", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "cancelled",
			currentStageOrder: 2,
			rowStatuses: ["approved", "cancelled", "cancelled"],
			currentRequestStatus: null,
			autoRows: [1],
		});
		after.chainRows[1] = {
			...required(after.chainRows[1]),
			approvalRequestId: null,
		};
		after.chainRows[2] = {
			...required(after.chainRows[2]),
			approvalRequestId: null,
		};

		const plan = await planner.plan(transition(before, after, 1));

		expect(plan.snapshot).toMatchObject({
			status: "cancelled",
			currentStageOrder: null,
			version: 2,
			cancelledAt: updatedAt,
		});
		expect(plan.snapshot.stages[1]).toMatchObject({
			status: "cancelled",
			legacyApprovalRequestId: rowRequestIds[1],
		});
		expect(plan.snapshot.stages[1]?.assignments[0]).toMatchObject({
			status: "cancelled",
		});
		expect(plan.events.map((event) => event.eventType)).toEqual([
			"assignment.cancelled",
			"stage.cancelled",
			"stage.cancelled",
			"workflow.cancelled",
		]);
	});

	it.each([
		[
			"employee",
			{
				kind: "employee" as const,
				employeeId: managerActorId,
				userId: "manager-user",
			},
			{ kind: "employee", employeeId: managerActorId, userId: null },
		],
		[
			"system",
			{ kind: "system" as const, employeeId: null, userId: null },
			{ kind: "system", employeeId: null, userId: null },
		],
	] as const)("attributes direct %s cancellation to its actor", async (_name, actor, expected) => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const after = emptyState();
		after.capturedAt = updatedAt;
		const input = transition(directState("pending"), after, 1);
		input.actor = actor;

		const plan = await planner.plan(input);
		const assignment = required(plan.snapshot.stages[0]?.assignments[0]);

		expect(assignment.resolvedBy).toEqual(expected);
		expect(plan.events[0]?.actor).toEqual(actor);
	});

	it("keeps legacy-unknown assignment attribution null while preserving event actor", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const input = transition(
			directState("pending"),
			directState("approved"),
			1,
		);
		input.actor = { kind: "legacy_unknown", employeeId: null, userId: null };

		const plan = await planner.plan(input);
		const assignment = required(plan.snapshot.stages[0]?.assignments[0]);

		expect(assignment.resolvedBy).toBeNull();
		expect(plan.events[0]?.actor).toEqual(input.actor);
	});

	it("rejects malformed terminal request and chain-row cardinality", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const approved = directState("approved");
		if (!approved.approvalRequest) throw new Error("fixture");
		approved.approvalRequest.approvedAt = null;
		await expect(
			planner.plan(transition(directState("pending"), approved, 1)),
		).rejects.toMatchObject({ code: "invalid_evidence" });

		const chain = chainState({
			status: "approved",
			currentStageOrder: 2,
			rowStatuses: ["approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1, 2],
		});
		chain.chainRows[0] = { ...required(chain.chainRows[0]), decidedAt: null };
		await expect(
			planner.plan(transition(emptyState(), chain, null)),
		).rejects.toMatchObject({ code: "invalid_evidence" });
	});

	it("rejects identity changes across direct and chain lifecycle evidence", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const changedDirect = directState("approved");
		if (!changedDirect.approvalRequest) throw new Error("fixture");
		changedDirect.approvalRequest.approverId = requesterId;
		await expect(
			planner.plan(transition(directState("pending"), changedDirect, 1)),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });

		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		after.chainRows[0] = {
			...required(after.chainRows[0]),
			policyStageId: "80000000-0000-4000-8000-000000000009",
		};
		await expect(
			planner.plan(transition(before, after, 1)),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it.each([
		[
			"initial pending chain exposes an earlier approved request",
			() => {
				const after = chainState({
					status: "pending",
					currentStageOrder: 2,
					rowStatuses: ["approved", "pending", "cancelled"],
					currentRequestStatus: "pending",
					autoRows: [1],
				});
				const earlier = required(after.chainRows[0]);
				after.approvalRequest = {
					...required(after.approvalRequest),
					id: required(earlier.approvalRequestId),
					approverId: earlier.resolvedApproverEmployeeId,
					status: "approved",
					approvedAt: updatedAt,
				};
				return transition(emptyState(), after, null);
			},
		],
		[
			"rejected chain exposes an earlier approved request",
			() => {
				const before = chainState({
					status: "pending",
					currentStageOrder: 2,
					rowStatuses: ["approved", "pending", "cancelled"],
					currentRequestStatus: "pending",
					autoRows: [1],
				});
				const after = chainState({
					status: "rejected",
					currentStageOrder: 2,
					rowStatuses: ["approved", "rejected", "cancelled"],
					currentRequestStatus: "rejected",
					autoRows: [1],
				});
				const earlier = required(after.chainRows[0]);
				after.approvalRequest = {
					...required(after.approvalRequest),
					id: required(earlier.approvalRequestId),
					approverId: earlier.resolvedApproverEmployeeId,
					status: "approved",
					approvedAt: updatedAt,
					rejectionReason: null,
				};
				return transition(before, after, 1);
			},
		],
	] as const)("rejects when %s", async (_name, createInput) => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});

		await expect(planner.plan(createInput())).rejects.toMatchObject({
			code: "invalid_evidence",
		});
	});

	it("rejects a changed current request ID during pending-to-approved", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "approved",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "approved"],
			currentRequestStatus: "approved",
			autoRows: [1],
		});
		const changedRequestId = "70000000-0000-4000-8000-000000000009";
		after.chainRows[2] = {
			...required(after.chainRows[2]),
			approvalRequestId: changedRequestId,
		};
		after.approvalRequest = {
			...required(after.approvalRequest),
			id: changedRequestId,
		};

		await expect(
			planner.plan(transition(before, after, 1)),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});

	it("rejects moving existing request IDs between chain rows", async () => {
		const planner = createLegacyApprovalObservationPlanner({
			clock: { nowInstant: () => capturedAt },
		});
		const before = chainState({
			status: "pending",
			currentStageOrder: 2,
			rowStatuses: ["approved", "pending", "cancelled"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		const after = chainState({
			status: "pending",
			currentStageOrder: 3,
			rowStatuses: ["approved", "approved", "pending"],
			currentRequestStatus: "pending",
			autoRows: [1],
		});
		after.chainRows[1] = {
			...required(after.chainRows[1]),
			approvalRequestId: rowRequestIds[2],
		};
		after.chainRows[2] = {
			...required(after.chainRows[2]),
			approvalRequestId: rowRequestIds[1],
		};
		after.approvalRequest = {
			...required(after.approvalRequest),
			id: rowRequestIds[1],
		};

		await expect(
			planner.plan(transition(before, after, 1)),
		).rejects.toMatchObject({ code: "invalid_lifecycle" });
	});
});
