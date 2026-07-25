import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { TimeCorrectionWorkflowPayload } from "../domain-adapters/time-correction-contract";
import {
	createApprovalCompatibilityWriter,
	createLegacyApprovalRowWriter,
	deterministicLegacyApprovalRequestId,
	type LegacyApprovalPersistence,
	type LegacyCanonicalIdMapping,
} from "./compatibility-writer";
import { getCutoverBehavior } from "./cutover";
import type {
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalProjectionWriter,
	ObservedLegacyTransitionResult,
	TransactionalWorkflowRepository,
	VerifiedLegacyApprovalState,
} from "./ports";
import { StableDataNormalizationError } from "./stable-data";

const occurredAt = parseInstant("2026-07-16T14:00:00Z");
const source = {
	organizationId: "org-1",
	workflowType: "absence" as const,
	sourceType: "absence_entry",
	sourceId: "20000000-0000-4000-8000-000000000001",
};
const actor = {
	kind: "legacy_unknown" as const,
	employeeId: null,
	userId: null,
};
const sqlDialect = new PgDialect();
const firstDecisionAt = parseInstant("2026-07-16T15:00:00Z");
const secondDecisionAt = parseInstant("2026-07-16T16:00:00Z");
const replacementApproverId = "42000000-0000-4000-8000-000000000099";
const clockInCorrectionId = "45000000-0000-4000-8000-000000000001";
const clockOutCorrectionId = "45000000-0000-4000-8000-000000000002";
const ordinaryBreakPolicySnapshot = {
	version: 1,
	evaluatedAt: "2026-03-29T08:01:00Z",
	resolution: "none",
} as const;
const ordinarySurchargeSnapshot = {
	version: 1,
	evaluatedAt: "2026-03-29T08:01:00Z",
	resolution: { kind: "none" },
} as const;

function asTimeCorrectionResult(
	result: ApprovalCommandResult,
	correction: TimeCorrectionWorkflowPayload["timeCorrection"],
): ApprovalCommandResult {
	result.snapshot.workflowType = "time_correction";
	result.snapshot.sourceType = "time_entry";
	result.snapshot.contextSnapshot = {
		privateRouting: { policyId: "policy-1", stage: 1 },
		timeCorrection: correction,
	};
	result.snapshot.displaySnapshot = { kind: "time_correction" };
	result.projection.workflowType = "time_correction";
	result.projection.sourceType = "time_entry";
	result.projection.displayPayload = { kind: "time_correction" };
	return result;
}

function asOrdinaryWorkPeriodResult(
	result: ApprovalCommandResult,
	kind: "manual_time_submission" | "policy_clock_out",
): ApprovalCommandResult {
	result.snapshot.workflowType = kind;
	result.snapshot.sourceType = "time_entry";
	result.snapshot.contextSnapshot = {
		timeRequest: { kind },
		surchargeSnapshot: ordinarySurchargeSnapshot,
		...(kind === "policy_clock_out"
			? {
					breakPolicySnapshot: ordinaryBreakPolicySnapshot,
				}
			: {}),
	};
	result.snapshot.displaySnapshot = { kind: "hostile_display_projection" };
	result.projection.workflowType = kind;
	result.projection.sourceType = "time_entry";
	result.projection.displayPayload = { kind: "hostile_display_projection" };
	return result;
}

function moveResultToCycle(
	result: ApprovalCommandResult,
	cycle: number,
): ApprovalCommandResult {
	result.snapshot.id = `10000000-0000-4000-8000-${String(cycle).padStart(12, "0")}`;
	result.projection.workflowId = result.snapshot.id;
	for (const event of result.events) event.workflowId = result.snapshot.id;
	for (const outbox of result.outbox) outbox.workflowId = result.snapshot.id;
	for (const [index, stage] of result.snapshot.stages.entries()) {
		stage.id = `40000000-0000-4000-8000-${String(cycle * 100 + index).padStart(12, "0")}`;
		stage.workflowId = result.snapshot.id;
		for (const [assignmentIndex, assignment] of stage.assignments.entries()) {
			assignment.id = `41000000-0000-4000-8000-${String(cycle * 100 + assignmentIndex).padStart(12, "0")}`;
			assignment.workflowId = result.snapshot.id;
			assignment.stageId = stage.id;
		}
	}
	return result;
}

function resultStage(result: ApprovalCommandResult, index: number) {
	const stage = result.snapshot.stages[index];
	if (!stage) throw new Error("Invalid test fixture");
	return stage;
}

function expectedRequestMetadata(
	result: ApprovalCommandResult,
	stage: ApprovalCommandResult["snapshot"]["stages"][number],
): Record<string, unknown> {
	const assignment = stage.assignments
		.filter((candidate) => candidate.status === stage.status)
		.toSorted(
			(left, right) =>
				left.sequence - right.sequence || left.id.localeCompare(right.id),
		)[0];
	const metadata = {
		workflow: {
			id: result.snapshot.id,
			organizationId: result.snapshot.organizationId,
		},
		stage: {
			id: stage.id,
			sequence: stage.sequence,
			...(assignment ? { assignmentId: assignment.id } : {}),
		},
	};
	if (
		result.snapshot.sourceType === "time_entry" &&
		(result.snapshot.workflowType === "manual_time_submission" ||
			result.snapshot.workflowType === "policy_clock_out")
	) {
		return {
			workflow: metadata.workflow,
			stage: {
				id: stage.id,
				sequence: stage.sequence,
			},
			timeRequest: { kind: result.snapshot.workflowType },
			surchargeSnapshot: result.snapshot.contextSnapshot.surchargeSnapshot,
			...(result.snapshot.workflowType === "policy_clock_out"
				? {
						breakPolicySnapshot:
							result.snapshot.contextSnapshot.breakPolicySnapshot,
					}
				: {}),
		};
	}
	if (
		result.snapshot.workflowType !== "time_correction" ||
		result.snapshot.sourceType !== "time_entry"
	) {
		return metadata;
	}
	const descriptor = Object.getOwnPropertyDescriptor(
		result.snapshot.contextSnapshot,
		"timeCorrection",
	);
	if (!descriptor || !("value" in descriptor)) {
		throw new Error("Invalid time correction test fixture");
	}
	return { ...metadata, timeCorrection: descriptor.value };
}

function insertedRequestMetadata(
	calls: Array<{ sql: string; params: unknown[] }>,
) {
	const insert = calls.find((call) =>
		/^\s*insert into approval_request/i.test(call.sql),
	);
	const serialized = insert?.params[8];
	if (typeof serialized !== "string") {
		throw new Error("Expected an approval request metadata parameter");
	}
	return JSON.parse(serialized) as Record<string, unknown>;
}

function writeGate(
	mode: "legacy" | "shadow" | "ready" | "canonical" | "complete",
	onAcquire?: (input: unknown) => void,
) {
	return {
		acquire: async (input: unknown) => {
			onAcquire?.(input);
			return { mode, behavior: getCutoverBehavior(mode) };
		},
	};
}

function legacyState(
	status: "pending" | "approved" | "rejected" | null,
	sourceStatus: string = status ?? "submitted",
): VerifiedLegacyApprovalState {
	return {
		organizationId: source.organizationId,
		source,
		approvalRequest:
			status === null
				? null
				: {
						id: "50000000-0000-4000-8000-000000000001",
						organizationId: source.organizationId,
						entityType: source.sourceType,
						entityId: source.sourceId,
						requestedBy: "30000000-0000-4000-8000-000000000001",
						approverId: "40000000-0000-4000-8000-000000000001",
						status,
						reason: null,
						rejectionReason: status === "rejected" ? "not allowed" : null,
						approvedAt: status === "approved" ? occurredAt : null,
						metadata: {},
						updatedAt: occurredAt,
					},
		chain: null,
		chainRows: [],
		sourceSnapshot: { status: sourceStatus },
		capturedAt: occurredAt,
	};
}

function commandResult(
	status: "pending" | "approved" | "rejected" | "cancelled",
) {
	return {
		snapshot: {
			id: "10000000-0000-4000-8000-000000000001",
			...source,
			requesterEmployeeId: "30000000-0000-4000-8000-000000000001",
			status,
			currentStageOrder: status === "pending" ? 1 : null,
			version: 2,
			policySnapshot: {},
			contextSnapshot: {},
			displaySnapshot: { kind: "absence" },
			submittedAt: occurredAt,
			completedAt: status === "pending" ? null : occurredAt,
			cancelledAt: status === "cancelled" ? occurredAt : null,
			decisionReason: null,
			stages: [],
		},
		events: [
			{
				id: "60000000-0000-4000-8000-000000000001",
				organizationId: source.organizationId,
				workflowId: "10000000-0000-4000-8000-000000000001",
				version: 2,
				eventIndex: 0,
				eventType: "workflow.legacy_observed",
				actor,
				previousState: null,
				resultingState: { status },
				reason: null,
				metadata: null,
				idempotencyKey: `legacy:${status}:observed`,
				occurredAt,
			},
			{
				id: "60000000-0000-4000-8000-000000000002",
				organizationId: source.organizationId,
				workflowId: "10000000-0000-4000-8000-000000000001",
				version: 2,
				eventIndex: 1,
				eventType: `workflow.${status}`,
				actor,
				previousState: null,
				resultingState: { status },
				reason: null,
				metadata: null,
				idempotencyKey: `legacy:${status}:status`,
				occurredAt,
			},
		],
		projection: {
			organizationId: source.organizationId,
			workflowId: "10000000-0000-4000-8000-000000000001",
			workflowType: source.workflowType,
			sourceType: source.sourceType,
			sourceId: source.sourceId,
			status,
			currentStageOrder: status === "pending" ? 1 : null,
			requesterEmployeeId: "30000000-0000-4000-8000-000000000001",
			displayPayload: { kind: "absence" },
			searchText: "absence",
			activeInboxStage: null,
			updatedAt: occurredAt,
		},
		outbox: [
			{
				organizationId: source.organizationId,
				workflowId: "10000000-0000-4000-8000-000000000001",
				eventId: "60000000-0000-4000-8000-000000000001",
				eventType: "workflow.legacy_observed",
				dedupeKey: `legacy:${status}`,
				payload: { status },
				disposition: "observe" as const,
				createdAt: occurredAt,
			},
			{
				organizationId: source.organizationId,
				workflowId: "10000000-0000-4000-8000-000000000001",
				eventId: "60000000-0000-4000-8000-000000000002",
				eventType: `workflow.${status}`,
				dedupeKey: `legacy:${status}:status`,
				payload: { status, eventIndex: 1 },
				disposition: "observe" as const,
				createdAt: occurredAt,
			},
		],
		eventPersistence: {
			kind: "aggregate_and_events_persisted" as const,
			eventIds: [
				"60000000-0000-4000-8000-000000000001",
				"60000000-0000-4000-8000-000000000002",
			],
		},
	} satisfies ObservedLegacyTransitionResult;
}

function commandResultWithStages() {
	const result = commandResult("approved");
	result.snapshot.stages = [
		{
			id: "40000000-0000-4000-8000-000000000001",
			organizationId: source.organizationId,
			workflowId: result.snapshot.id,
			sequence: 1,
			label: "Manager",
			resolverSnapshot: {},
			activationMode: "manual",
			status: "approved",
			activatedAt: occurredAt,
			decidedAt: occurredAt,
			decisionReason: null,
			legacyApprovalRequestId: null,
			assignments: [
				{
					id: "41000000-0000-4000-8000-000000000001",
					organizationId: source.organizationId,
					workflowId: result.snapshot.id,
					stageId: "40000000-0000-4000-8000-000000000001",
					sequence: 1,
					approverEmployeeId: "42000000-0000-4000-8000-000000000001",
					status: "approved",
					assignedAt: occurredAt,
					resolvedAt: occurredAt,
					resolvedBy: {
						kind: "employee",
						employeeId: "42000000-0000-4000-8000-000000000001",
						userId: null,
					},
					reassignedByEmployeeId: null,
					reassignedFromAssignmentId: null,
					reassignmentMetadata: null,
				},
			],
		},
		{
			id: "40000000-0000-4000-8000-000000000002",
			organizationId: source.organizationId,
			workflowId: result.snapshot.id,
			sequence: 2,
			label: "Finance",
			resolverSnapshot: {},
			activationMode: "manual",
			status: "approved",
			activatedAt: occurredAt,
			decidedAt: occurredAt,
			decisionReason: null,
			legacyApprovalRequestId: null,
			assignments: [
				{
					id: "41000000-0000-4000-8000-000000000002",
					organizationId: source.organizationId,
					workflowId: result.snapshot.id,
					stageId: "40000000-0000-4000-8000-000000000002",
					sequence: 1,
					approverEmployeeId: "42000000-0000-4000-8000-000000000002",
					status: "approved",
					assignedAt: occurredAt,
					resolvedAt: occurredAt,
					resolvedBy: {
						kind: "employee",
						employeeId: "42000000-0000-4000-8000-000000000002",
						userId: null,
					},
					reassignedByEmployeeId: null,
					reassignedFromAssignmentId: null,
					reassignmentMetadata: null,
				},
			],
		},
	];
	return result;
}

function harness(
	result = commandResult("pending"),
	mode: "legacy" | "shadow" | "ready" | "canonical" | "complete" = "shadow",
) {
	const observed: unknown[] = [];
	const persistedEvents: string[] = [];
	const projected: unknown[] = [];
	const outboxed: unknown[] = [];
	const mirrored: unknown[] = [];
	const modeReads: unknown[] = [];
	let transactionCalls = 0;
	const repository = {
		applyObservedLegacyTransition: async (value: unknown) => {
			observed.push(value);
			persistedEvents.push(...result.events.map((event) => event.id));
			return result;
		},
		transaction: () => {
			transactionCalls += 1;
		},
	} as unknown as TransactionalWorkflowRepository;
	const projectionWriter = {
		write: async (value: unknown) => {
			projected.push(value);
		},
	} as ApprovalProjectionWriter;
	const outboxWriter = {
		write: async (value: unknown) => {
			outboxed.push(value);
			return { kind: "inserted" as const, id: "outbox-1" };
		},
	};
	const legacyPersistence = {
		resolveOrCreateStableIds: async (input: {
			organizationId: string;
			workflowId: string;
			stageIds: string[];
		}) =>
			input.stageIds.map((stageId, index) => ({
				organizationId: input.organizationId,
				workflowId: input.workflowId,
				stageId,
				legacyApprovalRequestId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
			})),
		writeLegacyRows: async (value: unknown) => {
			mirrored.push(value);
		},
		transaction: () => {
			transactionCalls += 1;
		},
	} as unknown as LegacyApprovalPersistence;
	return {
		writer: createApprovalCompatibilityWriter({
			writeGate: writeGate(mode, (input) => modeReads.push(input)),
			repository,
			projectionWriter,
			outboxWriter,
			legacyPersistence,
		}),
		observed,
		persistedEvents,
		projected,
		outboxed,
		mirrored,
		modeReads,
		transactionCalls: () => transactionCalls,
	};
}

describe("approval compatibility writer", () => {
	it("rejects a stateful nested scope getter before acquiring the write gate", async () => {
		const fake = harness(commandResult("pending"));
		const before = legacyState(null);
		const after = legacyState("pending");
		after.source = { ...after.source };
		let reads = 0;
		Object.defineProperty(after.source, "organizationId", {
			configurable: true,
			enumerable: true,
			get() {
				reads += 1;
				return reads === 1 ? source.organizationId : "org-2";
			},
		});

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before,
				after,
				actor,
				idempotencyKey: "stateful-scope",
				expectedVersion: null,
			}),
		).rejects.toBeInstanceOf(StableDataNormalizationError);
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.observed).toHaveLength(0);
	});

	it("rejects a throwing nested accessor before acquiring the write gate", async () => {
		const fake = harness(commandResult("pending"));
		const after = legacyState("pending");
		after.source = { ...after.source };
		Object.defineProperty(after.source, "workflowType", {
			configurable: true,
			enumerable: true,
			get() {
				throw new Error("nested accessor must not be evaluated");
			},
		});

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState(null),
				after,
				actor,
				idempotencyKey: "throwing-accessor",
				expectedVersion: null,
			}),
		).rejects.toBeInstanceOf(StableDataNormalizationError);
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.observed).toHaveLength(0);
		expect(fake.projected).toHaveLength(0);
		expect(fake.outboxed).toHaveLength(0);
	});

	it("rejects malformed observed values before acquiring the write gate", async () => {
		const fake = harness(commandResult("pending"));
		const after = legacyState("pending");
		after.approvalRequest = {
			...after.approvalRequest,
			status: "forged",
		} as never;

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState(null),
				after,
				actor,
				idempotencyKey: "malformed-before-gate",
				expectedVersion: null,
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.observed).toHaveLength(0);
		expect(fake.projected).toHaveLength(0);
		expect(fake.outboxed).toHaveLength(0);
	});

	it("uses the persisted organization/workflow rollout mode as mirror control", async () => {
		const modeReads: unknown[] = [];
		const observed: unknown[] = [];
		const result = commandResult("pending");
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("shadow", (input) => modeReads.push(input)),
			repository: {
				applyObservedLegacyTransition: async (input: unknown) => {
					observed.push(input);
					return result;
				},
			} as unknown as TransactionalWorkflowRepository,
			projectionWriter: { write: async () => undefined },
			outboxWriter: {
				write: async () => ({ kind: "inserted" as const, id: "outbox-1" }),
			},
			legacyPersistence: {
				resolveOrCreateStableIds: async () => [],
				writeLegacyRows: async () => undefined,
			},
		});

		await writer.mirrorLegacyToCanonical({
			before: legacyState(null),
			after: legacyState("pending"),
			actor,
			idempotencyKey: "legacy-submit",
			expectedVersion: null,
		});

		expect(modeReads).toEqual([
			{ organizationId: "org-1", workflowType: "absence" },
		]);
		expect(observed).toEqual([
			expect.objectContaining({ expectedVersion: null }),
		]);
	});

	it.each([
		[null, "pending", "pending"],
		[null, "approved", "approved"],
		["pending", "approved", "approved"],
		["pending", "rejected", "rejected"],
		["pending", null, "cancelled"],
	] as const)("observes %s -> %s legacy %s transition without running a domain finalizer", async (beforeStatus, afterStatus, resultStatus) => {
		const result = commandResult(resultStatus);
		const fake = harness(result);
		const returned = await fake.writer.mirrorLegacyToCanonical({
			before: legacyState(beforeStatus),
			after: legacyState(afterStatus, resultStatus),
			actor,
			idempotencyKey: `legacy-${resultStatus}`,
			expectedVersion: beforeStatus === null ? null : 1,
		});

		expect(returned).toBe(result);
		expect(fake.modeReads).toHaveLength(1);
		expect(fake.observed).toHaveLength(1);
		expect(fake.persistedEvents).toEqual(result.eventPersistence.eventIds);
		expect(new Set(fake.persistedEvents).size).toBe(result.events.length);
		expect(fake.projected).toEqual([result.projection]);
		expect(fake.outboxed).toEqual(result.outbox);
		expect(
			result.outbox.every((entry) => entry.disposition === "observe"),
		).toBe(true);
		expect(fake.transactionCalls()).toBe(0);
	});

	it.each([
		"legacy",
		"canonical",
		"complete",
	] as const)("does not mirror legacy to canonical in %s mode", async (mode) => {
		const fake = harness(commandResult("pending"), mode);
		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState(null),
				after: legacyState("pending"),
				actor,
				idempotencyKey: "legacy-submit",
				expectedVersion: null,
			}),
		).resolves.toBeNull();
		expect(fake.modeReads).toHaveLength(1);
		expect(fake.observed).toHaveLength(0);
	});

	it("also observes legacy transitions in ready mode", async () => {
		const fake = harness(commandResult("pending"), "ready");
		await fake.writer.mirrorLegacyToCanonical({
			before: legacyState(null),
			after: legacyState("pending"),
			actor,
			idempotencyKey: "legacy-submit",
			expectedVersion: null,
		});
		expect(fake.modeReads).toHaveLength(1);
		expect(fake.observed).toHaveLength(1);
	});

	it("accepts verified multi-stage history with older approval request IDs", async () => {
		const fake = harness(commandResult("approved"));
		const before = legacyState("pending");
		const after = legacyState("approved");
		const chain = {
			id: "70000000-0000-4000-8000-000000000001",
			organizationId: "org-1",
			policyId: "71000000-0000-4000-8000-000000000001",
			policyNameSnapshot: "Default",
			entityType: source.sourceType,
			entityId: source.sourceId,
			requesterEmployeeId: "30000000-0000-4000-8000-000000000001",
			currentStageOrder: 2,
			status: "approved",
			createdAt: occurredAt,
			updatedAt: occurredAt,
			completedAt: occurredAt,
		};
		const stage = {
			id: "72000000-0000-4000-8000-000000000001",
			organizationId: "org-1",
			chainInstanceId: chain.id,
			policyStageId: "73000000-0000-4000-8000-000000000001",
			stepOrder: 1,
			labelSnapshot: "Manager",
			approverTypeSnapshot: "direct_manager",
			resolvedApproverEmployeeId: "40000000-0000-4000-8000-000000000001",
			approvalRequestId: "74000000-0000-4000-8000-000000000001",
			status: "approved",
			decidedBy: "40000000-0000-4000-8000-000000000001",
			decidedAt: occurredAt,
			createdAt: occurredAt,
			updatedAt: occurredAt,
		};
		before.chain = chain;
		after.chain = chain;
		before.chainRows = [stage];
		after.chainRows = [stage];

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before,
				after,
				actor,
				idempotencyKey: "legacy-stage-two-approved",
				expectedVersion: 1,
			}),
		).resolves.toMatchObject({ snapshot: { status: "approved" } });
	});

	it("rejects unverified before/after scope changes before touching canonical state", async () => {
		const fake = harness();
		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: { ...legacyState("approved"), organizationId: "org-2" },
				actor,
				idempotencyKey: "legacy-approve",
				expectedVersion: 1,
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.observed).toHaveLength(0);
	});

	it("rejects snapshots whose source organization disagrees with their persistence scope", async () => {
		const fake = harness();
		const before = legacyState("pending");
		const after = legacyState("approved");
		before.source = { ...before.source, organizationId: "org-2" };
		after.source = { ...after.source, organizationId: "org-2" };

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before,
				after,
				actor,
				idempotencyKey: "legacy-approve",
				expectedVersion: 1,
			}),
		).rejects.toMatchObject({ code: "malformed" });
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.observed).toHaveLength(0);
	});

	it("rejects repository output outside the observed organization before child writes", async () => {
		const result = commandResult("approved");
		result.snapshot.organizationId = "org-2";
		const fake = harness(result);

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: legacyState("approved"),
				actor,
				idempotencyKey: "legacy-approve",
				expectedVersion: 1,
			}),
		).rejects.toThrow(/scope|organization/i);
		expect(fake.projected).toHaveLength(0);
		expect(fake.outboxed).toHaveLength(0);
	});

	it.each([
		[
			"snapshot workflow type",
			(result: ApprovalCommandResult) =>
				(result.snapshot.workflowType = "travel_expense"),
		],
		[
			"snapshot source type",
			(result: ApprovalCommandResult) =>
				(result.snapshot.sourceType = "travel_expense_claim"),
		],
		[
			"snapshot source ID",
			(result: ApprovalCommandResult) =>
				(result.snapshot.sourceId = "20000000-0000-4000-8000-000000000099"),
		],
		[
			"projection organization",
			(result: ApprovalCommandResult) =>
				(result.projection.organizationId = "org-2"),
		],
		[
			"projection workflow",
			(result: ApprovalCommandResult) =>
				(result.projection.workflowId = "10000000-0000-4000-8000-000000000099"),
		],
		[
			"projection workflow type",
			(result: ApprovalCommandResult) =>
				(result.projection.workflowType = "travel_expense"),
		],
		[
			"projection source type",
			(result: ApprovalCommandResult) =>
				(result.projection.sourceType = "travel_expense_claim"),
		],
		[
			"projection source ID",
			(result: ApprovalCommandResult) =>
				(result.projection.sourceId = "20000000-0000-4000-8000-000000000099"),
		],
	] as const)("rejects repository output with wrong %s before child writes", async (_label, mutate) => {
		const result = commandResult("approved");
		mutate(result);
		const fake = harness(result);

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: legacyState("approved"),
				actor,
				idempotencyKey: "legacy-approve",
				expectedVersion: 1,
			}),
		).rejects.toThrow(/scope/i);
		expect(fake.projected).toHaveLength(0);
		expect(fake.outboxed).toHaveLength(0);
	});

	it("rejects a non-observe legacy outbox intent before projection or outbox writes", async () => {
		const result = commandResult("approved");
		result.outbox[0] = { ...result.outbox[0], disposition: "deliver" };
		const fake = harness(result);

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: legacyState("approved"),
				actor,
				idempotencyKey: "legacy-approve",
				expectedVersion: 1,
			}),
		).rejects.toThrow(/observe-only/i);
		expect(fake.projected).toHaveLength(0);
		expect(fake.outboxed).toHaveLength(0);
	});

	it("rejects repository event-persistence evidence that is not exact-once", async () => {
		const result = commandResult("approved");
		result.eventPersistence.eventIds = [
			result.events[0].id,
			result.events[0].id,
		];
		const fake = harness(result);

		await expect(
			fake.writer.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: legacyState("approved"),
				actor,
				idempotencyKey: "legacy-approve",
				expectedVersion: 1,
			}),
		).rejects.toThrow(/event persistence/i);
		expect(fake.projected).toHaveLength(0);
		expect(fake.outboxed).toHaveLength(0);
	});

	it("durably resolves and reuses exact canonical-to-legacy stage IDs", async () => {
		const result = commandResultWithStages();
		const ids = new Map<string, string>();
		const writes: unknown[] = [];
		const persistence = {
			resolveOrCreateStableIds: async (input: {
				organizationId: string;
				workflowId: string;
				stageIds: string[];
			}) =>
				input.stageIds.map((stageId, index) => ({
					organizationId: input.organizationId,
					workflowId: input.workflowId,
					stageId,
					legacyApprovalRequestId:
						ids.get(stageId) ??
						(() => {
							const id = `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
							ids.set(stageId, id);
							return id;
						})(),
				})),
			writeLegacyRows: async (input: unknown) => {
				writes.push(input);
			},
		} as LegacyApprovalPersistence;
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: persistence,
		});

		await writer.mirrorCanonicalToLegacy({ result });
		await writer.mirrorCanonicalToLegacy({ result });

		expect(writes).toHaveLength(2);
		expect(writes[0]).toEqual(writes[1]);
		expect(writes[0]).toMatchObject({
			organizationId: "org-1",
			legacyIds: [
				{ stageId: result.snapshot.stages[0]?.id },
				{ stageId: result.snapshot.stages[1]?.id },
			],
		});
	});

	it.each([
		"unknown",
		"missing",
		"duplicate",
		"duplicate_legacy_id",
	] as const)("rejects %s stable stage mappings before legacy writes", async (failure) => {
		const result = commandResultWithStages();
		let writes = 0;
		const expectedMappings = result.snapshot.stages.map((stage, index) => ({
			organizationId: result.snapshot.organizationId,
			workflowId: result.snapshot.id,
			stageId: stage.id,
			legacyApprovalRequestId: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
		}));
		const mappings =
			failure === "unknown"
				? [
						...expectedMappings,
						{
							...expectedMappings[0],
							stageId: "40000000-0000-4000-8000-999999999999",
						},
					]
				: failure === "missing"
					? expectedMappings.slice(0, 1)
					: failure === "duplicate"
						? [expectedMappings[0], expectedMappings[0], expectedMappings[1]]
						: [
								expectedMappings[0],
								{
									...expectedMappings[1],
									legacyApprovalRequestId:
										expectedMappings[0].legacyApprovalRequestId,
								},
							];
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => mappings,
				writeLegacyRows: async () => {
					writes += 1;
				},
			} as LegacyApprovalPersistence,
		});

		await expect(writer.mirrorCanonicalToLegacy({ result })).rejects.toThrow(
			/stable id mapping/i,
		);
		expect(writes).toBe(0);
	});

	it.each([
		["legacy", 0],
		["shadow", 0],
		["ready", 0],
		["canonical", 1],
		["complete", 0],
	] as const)("writes canonical state to legacy exactly in %s mode", async (mode, expectedWrites) => {
		const fake = harness(commandResult("approved"), mode);
		await fake.writer.mirrorCanonicalToLegacy({
			result: commandResult("approved"),
		});
		expect(fake.mirrored).toHaveLength(expectedWrites);
		expect(fake.modeReads).toHaveLength(1);
	});

	it("does not finalize the domain source a second time during canonical mirroring", async () => {
		let sourceFinalizerCalls = 0;
		let legacyWrites = 0;
		const normalCanonicalFinalizer = async () => {
			sourceFinalizerCalls += 1;
			return commandResult("approved");
		};
		const result = await normalCanonicalFinalizer();
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => [],
				writeLegacyRows: async () => {
					legacyWrites += 1;
				},
			},
		});

		await writer.mirrorCanonicalToLegacy({
			result,
		});

		expect(sourceFinalizerCalls).toBe(1);
		expect(legacyWrites).toBe(1);
	});

	it("uses the transaction-bound write gate before canonical legacy writes", async () => {
		const timeline: string[] = [];
		const result = commandResult("approved");
		const writer = createApprovalCompatibilityWriter({
			writeGate: {
				acquire: async () => {
					timeline.push("gate");
					return {
						mode: "canonical" as const,
						behavior: {
							serveFrom: "canonical" as const,
							writeLegacy: true,
							writeCanonical: true,
							decideCanonical: true,
							mirror: "canonical_to_legacy" as const,
						},
					};
				},
			},
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => {
					timeline.push("resolve");
					return [];
				},
				writeLegacyRows: async () => {
					timeline.push("write");
				},
			},
		} as unknown as Parameters<typeof createApprovalCompatibilityWriter>[0]);

		await writer.mirrorCanonicalToLegacy({ result });
		expect(timeline).toEqual(["gate", "resolve", "write"]);
	});

	it("validates correction metadata before stable ID persistence", async () => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockInCorrectionId,
		});
		result.snapshot.contextSnapshot = {
			timeCorrection: { action: "edit", clockInCorrectionId: "private-bad-id" },
		} as never;
		const timeline: string[] = [];
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical", () => timeline.push("gate")),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => {
					timeline.push("resolve");
					return [];
				},
				writeLegacyRows: async () => {
					timeline.push("write");
				},
			},
		});

		await expect(writer.mirrorCanonicalToLegacy({ result })).rejects.toThrow(
			"Legacy time correction compatibility metadata is invalid",
		);
		expect(timeline).toEqual([]);
	});

	it("validates ordinary metadata before stable ID persistence", async () => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult("pending"),
			"manual_time_submission",
		);
		result.snapshot.contextSnapshot = {
			timeRequest: { kind: "policy_clock_out" },
			privateEvidence: "must-not-leak",
		} as never;
		const timeline: string[] = [];
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical", () => timeline.push("gate")),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => {
					timeline.push("resolve");
					return [];
				},
				writeLegacyRows: async () => {
					timeline.push("write");
				},
			},
		});

		await expect(writer.mirrorCanonicalToLegacy({ result })).rejects.toThrow(
			"Ordinary work-period workflow payload is invalid",
		);
		expect(timeline).toEqual([]);
	});

	it("reads immutable correction evidence once and persists the validated snapshot", async () => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockInCorrectionId,
		});
		let descriptorReads = 0;
		result.snapshot.contextSnapshot = new Proxy(
			{},
			{
				ownKeys: () => ["timeCorrection"],
				getOwnPropertyDescriptor(_target, property) {
					if (property !== "timeCorrection") return undefined;
					descriptorReads += 1;
					return {
						configurable: true,
						enumerable: true,
						writable: true,
						value: {
							action: "edit",
							...(descriptorReads === 1
								? { clockInCorrectionId }
								: { clockOutCorrectionId }),
						},
					};
				},
			},
		) as never;
		const legacy = rowWriterHarness(result);
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => legacy.mappings,
				writeLegacyRows: (input) => legacy.writer.writeLegacyRows(input),
			},
		});

		await writer.mirrorCanonicalToLegacy({ result });

		expect(descriptorReads).toBe(1);
		expect(insertedRequestMetadata(legacy.calls)).toMatchObject({
			timeCorrection: { action: "edit", clockInCorrectionId },
		});
	});

	it("uses one detached canonical identity across gate, stable IDs, decorators, and writes", async () => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockInCorrectionId,
		});
		const originalStage = result.snapshot.stages[0];
		if (!originalStage) throw new Error("Invalid test fixture");
		const originalStageId = originalStage.id;
		const gateInputs: unknown[] = [];
		const stableInputs: unknown[] = [];
		const writes: ApprovalCommandResult[] = [];
		const legacyCalls: Array<{ sql: string; params: unknown[] }> = [];
		const legacy = rowWriterHarness(result);
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical", (input) => gateInputs.push(input)),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async (input) => {
					stableInputs.push(input);
					await Promise.resolve();
					result.snapshot.organizationId = "org-2";
					result.snapshot.id = "10000000-0000-4000-8000-000000000099";
					result.snapshot.workflowType = "absence";
					result.snapshot.sourceType = "absence_entry";
					result.snapshot.sourceId = "20000000-0000-4000-8000-000000000099";
					result.snapshot.contextSnapshot = {
						timeCorrection: { action: "edit", clockOutCorrectionId },
					};
					originalStage.id = "40000000-0000-4000-8000-000000000099";
					result.projection.organizationId = "org-2";
					result.projection.workflowId = result.snapshot.id;
					result.projection.workflowType = "absence";
					result.projection.sourceType = "absence_entry";
					result.projection.sourceId = result.snapshot.sourceId;
					return legacy.mappings;
				},
				writeLegacyRows: async ({
					organizationId,
					result: planned,
					legacyIds,
				}) => {
					writes.push(planned);
					const decoratedPersistence = rowWriterHarness(planned);
					await decoratedPersistence.writer.writeLegacyRows({
						organizationId,
						result: planned,
						legacyIds,
					});
					legacyCalls.push(...decoratedPersistence.calls);
				},
			},
		});

		await writer.mirrorCanonicalToLegacy({ result });

		expect(gateInputs).toEqual([
			{ organizationId: "org-1", workflowType: "time_correction" },
		]);
		expect(stableInputs).toEqual([
			{
				organizationId: "org-1",
				workflowId: "10000000-0000-4000-8000-000000000001",
				stageIds: [originalStageId],
			},
		]);
		expect(writes).toHaveLength(1);
		expect(writes[0]).not.toBe(result);
		expect(writes[0]?.snapshot).toMatchObject({
			organizationId: "org-1",
			id: "10000000-0000-4000-8000-000000000001",
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: source.sourceId,
			contextSnapshot: {
				timeCorrection: { action: "edit", clockInCorrectionId },
			},
		});
		expect(insertedRequestMetadata(legacyCalls)).toMatchObject({
			timeCorrection: { action: "edit", clockInCorrectionId },
		});
	});

	it.each([
		"result",
		"snapshot",
		"projection",
		"context",
	] as const)("rejects an accessor-backed canonical %s before the write gate", async (target) => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockInCorrectionId,
		});
		const holder = result;
		const key =
			target === "result"
				? "result"
				: target === "snapshot"
					? "snapshot"
					: target === "projection"
						? "projection"
						: "contextSnapshot";
		const owner = target === "context" ? result.snapshot : holder;
		const value = (owner as Record<string, unknown>)[key];
		const mirrorInput =
			target === "result"
				? Object.defineProperty({}, "result", {
						enumerable: true,
						get: () => result,
					})
				: { result };
		if (target !== "result") {
			Object.defineProperty(owner, key, {
				enumerable: true,
				get: () => value,
			});
		}
		const fake = harness(result, "canonical");

		await expect(
			fake.writer.mirrorCanonicalToLegacy(
				mirrorInput as { result: ApprovalCommandResult },
			),
		).rejects.toBeInstanceOf(StableDataNormalizationError);
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.mirrored).toHaveLength(0);
	});

	it("rejects canonical projection identity disagreement before the write gate", async () => {
		const result = canonicalLegacyResult("pending");
		result.projection.sourceId = "20000000-0000-4000-8000-000000000099";
		const fake = harness(result, "canonical");

		await expect(
			fake.writer.mirrorCanonicalToLegacy({ result }),
		).rejects.toThrow(/canonical compatibility result/i);
		expect(fake.modeReads).toHaveLength(0);
		expect(fake.mirrored).toHaveLength(0);
	});

	it("performs no compatibility mutation when correction evidence is malformed", async () => {
		const result = asTimeCorrectionResult(
			canonicalLegacyResult("pending", true),
			{ action: "edit", clockInCorrectionId },
		);
		result.snapshot.contextSnapshot = {
			timeCorrection: {
				action: "edit",
				clockInCorrectionId,
				privateEvidence: "disagrees",
			},
		} as never;
		const store = sharedCompatibilityStore();
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: store.persistence,
		});

		await expect(writer.mirrorCanonicalToLegacy({ result })).rejects.toThrow(
			"Legacy time correction compatibility metadata is invalid",
		);

		expect(store.mutationCount()).toBe(0);
		expect(store.rows()).toEqual({
			requests: new Map(),
			chains: new Map(),
			chainStages: new Map(),
			stableIds: new Map(),
		});
	});

	it("restores compatibility IDs and rows when persistence fails after a mutation", async () => {
		const result = asTimeCorrectionResult(
			canonicalLegacyResult("pending", true),
			{ action: "edit", clockInCorrectionId },
		);
		const store = sharedCompatibilityStore();
		const beforeTransaction = store.rows();
		store.failOnMutation(5);
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: store.persistence,
		});

		await expect(writer.mirrorCanonicalToLegacy({ result })).rejects.toThrow(
			"compatibility persistence failed",
		);

		expect(store.rowsAtFailure()?.chainStages.size).toBeGreaterThan(0);
		expect(store.mutationCount()).toBe(0);
		expect(store.rows()).toEqual(beforeTransaction);
	});

	it("propagates canonical and legacy mirror failures", async () => {
		const canonicalFailure = harness();
		canonicalFailure.writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("shadow"),
			repository: {
				applyObservedLegacyTransition: async () => {
					throw new Error("canonical mirror failed");
				},
			} as unknown as TransactionalWorkflowRepository,
			projectionWriter: { write: async () => undefined },
			outboxWriter: {
				write: async () => ({ kind: "duplicate" as const }),
			},
			legacyPersistence: {
				resolveOrCreateStableIds: async () => [],
				writeLegacyRows: async () => undefined,
			},
		});
		await expect(
			canonicalFailure.writer.mirrorLegacyToCanonical({
				before: legacyState(null),
				after: legacyState("pending"),
				actor,
				idempotencyKey: "submit",
				expectedVersion: null,
			}),
		).rejects.toThrow("canonical mirror failed");

		const legacyFailure = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: {
				resolveOrCreateStableIds: async () => [],
				writeLegacyRows: async () => {
					throw new Error("legacy mirror failed");
				},
			},
		});
		await expect(
			legacyFailure.mirrorCanonicalToLegacy({
				result: commandResult("approved"),
			}),
		).rejects.toThrow("legacy mirror failed");
	});

	it("propagates projection and outbox failures without continuing downstream", async () => {
		const result = commandResult("approved");
		let outboxWrites = 0;
		const projectionFailure = createApprovalCompatibilityWriter({
			writeGate: writeGate("shadow"),
			repository: {
				applyObservedLegacyTransition: async () => result,
			} as unknown as TransactionalWorkflowRepository,
			projectionWriter: {
				write: async () => {
					throw new Error("projection failed");
				},
			},
			outboxWriter: {
				write: async () => {
					outboxWrites += 1;
					return { kind: "duplicate" as const };
				},
			},
			legacyPersistence: {
				resolveOrCreateStableIds: async () => [],
				writeLegacyRows: async () => undefined,
			},
		});
		await expect(
			projectionFailure.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: legacyState("approved"),
				actor,
				idempotencyKey: "projection-failure",
				expectedVersion: 1,
			}),
		).rejects.toThrow("projection failed");
		expect(outboxWrites).toBe(0);

		let projectionWrites = 0;
		const outboxFailure = createApprovalCompatibilityWriter({
			writeGate: writeGate("shadow"),
			repository: {
				applyObservedLegacyTransition: async () => result,
			} as unknown as TransactionalWorkflowRepository,
			projectionWriter: {
				write: async () => {
					projectionWrites += 1;
				},
			},
			outboxWriter: {
				write: async () => {
					throw new Error("outbox failed");
				},
			},
			legacyPersistence: {
				resolveOrCreateStableIds: async () => [],
				writeLegacyRows: async () => undefined,
			},
		});
		await expect(
			outboxFailure.mirrorLegacyToCanonical({
				before: legacyState("pending"),
				after: legacyState("approved"),
				actor,
				idempotencyKey: "outbox-failure",
				expectedVersion: 1,
			}),
		).rejects.toThrow("outbox failed");
		expect(projectionWrites).toBe(1);
	});
});

function canonicalLegacyResult(
	status: "pending" | "approved" | "rejected" | "cancelled",
	multistage = false,
): ApprovalCommandResult {
	const base = commandResult(status);
	const stages = [
		{
			id: "40000000-0000-4000-8000-000000000001",
			organizationId: "org-1",
			workflowId: base.snapshot.id,
			sequence: 1,
			label: "Manager",
			resolverSnapshot: { approverType: "direct_manager" },
			activationMode: "human",
			status:
				status === "pending"
					? ("pending" as const)
					: status === "approved"
						? ("approved" as const)
						: status === "rejected"
							? ("rejected" as const)
							: ("cancelled" as const),
			activatedAt: occurredAt,
			decidedAt: status === "pending" ? null : occurredAt,
			decisionReason: status === "rejected" ? "not allowed" : null,
			legacyApprovalRequestId: null,
			assignments: [
				{
					id: "41000000-0000-4000-8000-000000000001",
					organizationId: "org-1",
					workflowId: base.snapshot.id,
					stageId: "40000000-0000-4000-8000-000000000001",
					sequence: 1,
					approverEmployeeId: "42000000-0000-4000-8000-000000000001",
					status:
						status === "pending"
							? ("pending" as const)
							: status === "approved"
								? ("approved" as const)
								: status === "rejected"
									? ("rejected" as const)
									: ("cancelled" as const),
					assignedAt: occurredAt,
					resolvedAt: status === "pending" ? null : occurredAt,
					resolvedBy:
						status === "pending"
							? null
							: {
									kind: "employee" as const,
									employeeId: "42000000-0000-4000-8000-000000000001",
									userId: null,
								},
					reassignedByEmployeeId: null,
					reassignedFromAssignmentId: null,
					reassignmentMetadata: null,
				},
			],
		},
	];
	if (multistage) {
		stages.push({
			...stages[0],
			id: "40000000-0000-4000-8000-000000000002",
			sequence: 2,
			label: "HR",
			status:
				status === "pending"
					? "waiting"
					: status === "rejected"
						? "cancelled"
						: stages[0].status,
			activatedAt:
				status === "pending" || status === "rejected" ? null : occurredAt,
			assignments:
				status === "pending" || status === "rejected"
					? []
					: [
							{
								...stages[0].assignments[0],
								id: "41000000-0000-4000-8000-000000000002",
								stageId: "40000000-0000-4000-8000-000000000002",
								approverEmployeeId: "42000000-0000-4000-8000-000000000002",
							},
						],
		} as (typeof stages)[number]);
	}
	return {
		...base,
		snapshot: {
			...base.snapshot,
			policySnapshot: multistage
				? {
						id: "43000000-0000-4000-8000-000000000001",
						name: "Two stage",
						stages: stages.map((stage) => ({
							id: `44000000-0000-4000-8000-${String(stage.sequence).padStart(12, "0")}`,
							stepOrder: stage.sequence,
							approverType: "direct_manager",
						})),
					}
				: { kind: "default" },
			stages,
		},
	} as ApprovalCommandResult;
}

function secondStageRejectedResult(): ApprovalCommandResult {
	const result = canonicalLegacyResult("approved", true);
	const firstStage = result.snapshot.stages[0];
	const secondStage = result.snapshot.stages[1];
	const firstAssignment = firstStage?.assignments[0];
	const secondAssignment = secondStage?.assignments[0];
	if (!firstStage || !secondStage || !firstAssignment || !secondAssignment) {
		throw new Error("Invalid test fixture");
	}
	firstStage.status = "approved";
	firstStage.decidedAt = firstDecisionAt;
	firstStage.decisionReason = "manager approved";
	firstAssignment.status = "approved";
	firstAssignment.resolvedAt = firstDecisionAt;
	secondStage.status = "rejected";
	secondStage.decidedAt = secondDecisionAt;
	secondStage.decisionReason = "HR rejected";
	secondAssignment.status = "rejected";
	secondAssignment.resolvedAt = secondDecisionAt;
	secondAssignment.resolvedBy = {
		kind: "employee",
		employeeId: secondAssignment.approverEmployeeId,
		userId: null,
	};
	result.snapshot.status = "rejected";
	result.snapshot.decisionReason = "workflow terminal reason";
	result.snapshot.completedAt = secondDecisionAt;
	const finalEvent = result.events.at(-1);
	if (!finalEvent) throw new Error("Invalid test fixture");
	result.events[result.events.length - 1] = {
		...finalEvent,
		eventType: "workflow.rejected",
		reason: "workflow terminal reason",
		occurredAt: occurredAt,
	};
	return result;
}

function stageTwoPendingResult(): ApprovalCommandResult {
	const result = canonicalLegacyResult("approved", true);
	const firstStage = result.snapshot.stages[0];
	const secondStage = result.snapshot.stages[1];
	const firstAssignment = firstStage?.assignments[0];
	const secondAssignment = secondStage?.assignments[0];
	if (!firstStage || !secondStage || !firstAssignment || !secondAssignment) {
		throw new Error("Invalid test fixture");
	}
	firstStage.status = "approved";
	firstStage.decidedAt = firstDecisionAt;
	firstStage.decisionReason = "manager approved";
	firstAssignment.status = "approved";
	firstAssignment.resolvedAt = firstDecisionAt;
	secondStage.status = "pending";
	secondStage.decidedAt = null;
	secondStage.decisionReason = null;
	secondAssignment.status = "pending";
	secondAssignment.resolvedAt = null;
	secondAssignment.resolvedBy = null;
	secondAssignment.assignedAt = secondDecisionAt;
	result.snapshot.status = "pending";
	result.snapshot.currentStageOrder = 2;
	result.snapshot.completedAt = null;
	result.snapshot.decisionReason = null;
	result.projection.status = "pending";
	result.projection.currentStageOrder = 2;
	const finalEvent = result.events.at(-1);
	if (!finalEvent) throw new Error("Invalid test fixture");
	result.events[result.events.length - 1] = {
		...finalEvent,
		eventType: "stage.activated",
		resultingState: { status: "pending" },
		reason: null,
		occurredAt: secondDecisionAt,
	};
	return result;
}

function stageTwoApprovedResult(): ApprovalCommandResult {
	const result = stageTwoPendingResult();
	const secondStage = result.snapshot.stages[1];
	const secondAssignment = secondStage?.assignments[0];
	if (!secondStage || !secondAssignment)
		throw new Error("Invalid test fixture");
	secondStage.status = "approved";
	secondStage.decidedAt = secondDecisionAt;
	secondAssignment.status = "approved";
	secondAssignment.resolvedAt = secondDecisionAt;
	secondAssignment.resolvedBy = {
		kind: "employee",
		employeeId: secondAssignment.approverEmployeeId,
		userId: null,
	};
	result.snapshot.status = "approved";
	result.snapshot.currentStageOrder = null;
	result.snapshot.completedAt = secondDecisionAt;
	result.projection.status = "approved";
	result.projection.currentStageOrder = null;
	const finalEvent = result.events.at(-1);
	if (!finalEvent) throw new Error("Invalid test fixture");
	result.events[result.events.length - 1] = {
		...finalEvent,
		eventType: "workflow.approved",
		resultingState: { status: "approved" },
		occurredAt: secondDecisionAt,
	};
	return result;
}

function stageOnePersistedState(
	result: ApprovalCommandResult,
): RowWriterHarnessOptions {
	const firstRequest = exactRequestRow(result, 0);
	const firstStage = exactChainStageRow(result, 0);
	const secondStage = exactChainStageRow(result, 1);
	firstRequest.status = "pending";
	firstRequest.reason = null;
	firstRequest.approved_at = null;
	firstRequest.updated_at = new Date(result.snapshot.submittedAt.toString());
	firstStage.status = "pending";
	firstStage.decided_by = null;
	firstStage.decided_at = null;
	firstStage.updated_at = new Date(result.snapshot.submittedAt.toString());
	secondStage.status = "pending";
	secondStage.approval_request_id = null;
	secondStage.decided_by = null;
	secondStage.decided_at = null;
	secondStage.updated_at = new Date(result.snapshot.submittedAt.toString());
	return {
		requestRows: [firstRequest],
		chainRows: [
			{
				...exactChainRow(result),
				current_stage_order: 1,
				updated_at: new Date(result.snapshot.submittedAt.toString()),
			},
		],
		chainStageRows: [firstStage, secondStage],
	};
}

function pendingReplacementResult(
	eventType: "assignment.reassigned" | "assignment.escalated",
): ApprovalCommandResult {
	const result = canonicalLegacyResult("pending");
	const stage = result.snapshot.stages[0];
	const original = stage?.assignments[0];
	if (!stage || !original) throw new Error("Invalid test fixture");
	original.status = "cancelled";
	original.resolvedAt = secondDecisionAt;
	original.resolvedBy = {
		kind: "employee",
		employeeId: "30000000-0000-4000-8000-000000000001",
		userId: null,
	};
	stage.assignments.push({
		...original,
		id: "41000000-0000-4000-8000-000000000099",
		sequence: 2,
		approverEmployeeId: replacementApproverId,
		status: "pending",
		assignedAt: secondDecisionAt,
		resolvedAt: null,
		resolvedBy: null,
		reassignedByEmployeeId: "30000000-0000-4000-8000-000000000001",
		reassignedFromAssignmentId: original.id,
		reassignmentMetadata: { reason: eventType },
	});
	const finalEvent = result.events.at(-1);
	if (!finalEvent) throw new Error("Invalid test fixture");
	result.events[result.events.length - 1] = {
		...finalEvent,
		eventType,
		occurredAt: secondDecisionAt,
	};
	return result;
}

function parallelPendingResult(): ApprovalCommandResult {
	const result = canonicalLegacyResult("pending");
	const stage = result.snapshot.stages[0];
	const first = stage?.assignments[0];
	if (!stage || !first) throw new Error("Invalid test fixture");
	stage.assignments.push({
		...first,
		id: "41000000-0000-4000-8000-000000000002",
		sequence: 2,
		approverEmployeeId: "42000000-0000-4000-8000-000000000002",
		assignedAt: secondDecisionAt,
	});
	return result;
}

function parallelTerminalResult(
	status: "approved" | "rejected",
): ApprovalCommandResult {
	const result = parallelPendingResult();
	const stage = result.snapshot.stages[0];
	const first = stage?.assignments[0];
	const winner = stage?.assignments[1];
	if (!stage || !first || !winner) throw new Error("Invalid test fixture");
	first.status = "cancelled";
	first.resolvedAt = secondDecisionAt;
	first.resolvedBy = {
		kind: "employee",
		employeeId: winner.approverEmployeeId,
		userId: null,
	};
	winner.status = status;
	winner.resolvedAt = secondDecisionAt;
	winner.resolvedBy = {
		kind: "employee",
		employeeId: winner.approverEmployeeId,
		userId: null,
	};
	stage.status = status;
	stage.decidedAt = secondDecisionAt;
	stage.decisionReason =
		status === "rejected" ? "second reviewer rejected" : null;
	result.snapshot.status = status;
	result.snapshot.currentStageOrder = null;
	result.snapshot.completedAt = secondDecisionAt;
	result.snapshot.decisionReason = stage.decisionReason;
	result.projection.status = status;
	result.projection.currentStageOrder = null;
	return result;
}

function legacyMappings(
	result: ApprovalCommandResult,
): LegacyCanonicalIdMapping[] {
	return result.snapshot.stages.map((stage) => ({
		organizationId: result.snapshot.organizationId,
		workflowId: result.snapshot.id,
		stageId: stage.id,
		legacyApprovalRequestId: deterministicLegacyApprovalRequestId(stage.id, 0),
	}));
}

interface RowWriterHarnessOptions {
	requestRows?: Array<Record<string, unknown>>;
	chainRows?: Array<Record<string, unknown>>;
	chainStageRows?: Array<Record<string, unknown>>;
}

function rowWriterHarness(
	result: ApprovalCommandResult,
	options: RowWriterHarnessOptions = {},
) {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	let failWith: Error | null = null;
	let emptyNextMutation = false;
	const mappings = legacyMappings(result);
	const defaultRequestRows =
		result.snapshot.status === "pending"
			? []
			: result.snapshot.stages.flatMap((stage, index) => {
					const assignment = stage.assignments[0];
					const mapping = mappings[index];
					return assignment && mapping
						? [
								{
									id: mapping.legacyApprovalRequestId,
									organization_id: result.snapshot.organizationId,
									entity_type: result.snapshot.sourceType,
									entity_id: result.snapshot.sourceId,
									requested_by: result.snapshot.requesterEmployeeId,
									approver_id: assignment.approverEmployeeId,
									status: "pending",
									reason: null,
									rejection_reason: null,
									approved_at: null,
									metadata: expectedRequestMetadata(result, stage),
									updated_at: new Date(result.snapshot.submittedAt.toString()),
								},
							]
						: [];
				});
	const policyStages = Array.isArray(result.snapshot.policySnapshot.stages)
		? result.snapshot.policySnapshot.stages
		: [];
	const defaultChainStageRows =
		result.snapshot.stages.length < 2 || result.snapshot.status === "pending"
			? []
			: result.snapshot.stages.map((stage, index) => ({
					id: stage.id,
					organization_id: result.snapshot.organizationId,
					chain_instance_id: result.snapshot.id,
					policy_stage_id: (policyStages[index] as { id?: string } | undefined)
						?.id,
					step_order: stage.sequence,
					label_snapshot: stage.label,
					approver_type_snapshot: "direct_manager",
					resolved_approver_employee_id:
						stage.assignments[0]?.approverEmployeeId ??
						result.snapshot.requesterEmployeeId,
					approval_request_id:
						stage.status === "waiting"
							? null
							: mappings[index]?.legacyApprovalRequestId,
					status: "pending",
					decided_by: null,
					decided_at: null,
					created_at: new Date(result.snapshot.submittedAt.toString()),
					updated_at: new Date(result.snapshot.submittedAt.toString()),
				}));
	const defaultChainRows =
		result.snapshot.stages.length < 2 || result.snapshot.status === "pending"
			? []
			: [
					{
						id: result.snapshot.id,
						organization_id: result.snapshot.organizationId,
						policy_id: result.snapshot.policySnapshot.id,
						policy_name_snapshot: result.snapshot.policySnapshot.name,
						entity_type: result.snapshot.sourceType,
						entity_id: result.snapshot.sourceId,
						requester_employee_id: result.snapshot.requesterEmployeeId,
						current_stage_order: 1,
						status: "pending",
						created_at: new Date(result.snapshot.submittedAt.toString()),
						updated_at: new Date(result.snapshot.submittedAt.toString()),
						completed_at: null,
					},
				];
	const requestRows = options.requestRows ?? defaultRequestRows;
	const chainRows = options.chainRows ?? defaultChainRows;
	const chainStageRows = options.chainStageRows ?? defaultChainStageRows;
	const service: ApprovalDbService = {
		db: {
			execute: async (statement) => {
				if (failWith) throw failWith;
				const compiled = sqlDialect.sqlToQuery(statement);
				calls.push(compiled);
				if (
					emptyNextMutation &&
					/^\s*(?:insert|update|delete)\b/i.test(compiled.sql)
				) {
					emptyNextMutation = false;
					return { rows: [] };
				}
				if (
					/^\s*select[\s\S]*from approval_request[\s\S]*for update/i.test(
						compiled.sql,
					)
				) {
					return { rows: requestRows };
				}
				if (
					/^\s*select[\s\S]*from approval_chain_stage_instance[\s\S]*for update/i.test(
						compiled.sql,
					)
				) {
					return { rows: chainStageRows };
				}
				if (
					/^\s*select[\s\S]*from approval_chain_instance[\s\S]*for update/i.test(
						compiled.sql,
					)
				) {
					return { rows: chainRows };
				}
				if (/approval_chain_stage_instance/i.test(compiled.sql)) {
					const stage = result.snapshot.stages.find((candidate) =>
						compiled.params.includes(candidate.id),
					);
					return { rows: stage ? [{ id: stage.id }] : [] };
				}
				if (/approval_chain_instance/i.test(compiled.sql)) {
					return { rows: [{ id: result.snapshot.id }] };
				}
				if (/approval_request/i.test(compiled.sql)) {
					const mapping = mappings.find((candidate) =>
						compiled.params.includes(candidate.legacyApprovalRequestId),
					);
					return {
						rows: mapping
							? [
									{
										id: mapping.legacyApprovalRequestId,
										organization_id: "org-1",
										entity_type: result.snapshot.sourceType,
										entity_id: result.snapshot.sourceId,
									},
								]
							: [],
					};
				}
				return { rows: [] };
			},
		},
	};
	return {
		calls,
		mappings,
		writer: createLegacyApprovalRowWriter(service),
		fail(error: Error) {
			failWith = error;
		},
		emptyNextMutation() {
			emptyNextMutation = true;
		},
	};
}

function sharedCompatibilityStore() {
	let requests = new Map<string, Record<string, unknown>>();
	let chains = new Map<string, Record<string, unknown>>();
	let chainStages = new Map<string, Record<string, unknown>>();
	const stableIds = new Map<string, LegacyCanonicalIdMapping>();
	let stagedStableIds: string[] = [];
	let mutationCount = 0;
	let failMutationAt: number | null = null;

	const rowsForIds = (
		rows: Map<string, Record<string, unknown>>,
		params: unknown[],
	) => [...rows.values()].filter((row) => params.includes(row.id));
	const copyMap = (rows: Map<string, Record<string, unknown>>) =>
		new Map([...rows].map(([id, row]) => [id, structuredClone(row)] as const));
	const snapshotRows = () => ({
		requests: copyMap(requests),
		chains: copyMap(chains),
		chainStages: copyMap(chainStages),
		stableIds: new Map(stableIds),
	});
	let rowsAtFailure: ReturnType<typeof snapshotRows> | null = null;
	const resultEvidence = (row: Record<string, unknown>) => ({
		id: row.id,
		organization_id: row.organization_id,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
	});

	const persistence: LegacyApprovalPersistence = {
		async resolveOrCreateStableIds(input) {
			const mappings = input.stageIds.map((stageId) => {
				const existing = stableIds.get(stageId);
				if (existing) return existing;
				const mapping = {
					organizationId: input.organizationId,
					workflowId: input.workflowId,
					stageId,
					legacyApprovalRequestId: deterministicLegacyApprovalRequestId(
						stageId,
						0,
					),
				};
				stableIds.set(stageId, mapping);
				stagedStableIds.push(stageId);
				mutationCount += 1;
				return mapping;
			});
			return mappings;
		},
		async writeLegacyRows(input) {
			const before = {
				requests: copyMap(requests),
				chains: copyMap(chains),
				chainStages: copyMap(chainStages),
				mutationCount,
			};
			const service: ApprovalDbService = {
				db: {
					execute: async (statement) => {
						const compiled = sqlDialect.sqlToQuery(statement);
						if (/^\s*select[\s\S]*from approval_request/i.test(compiled.sql)) {
							return { rows: rowsForIds(requests, compiled.params) };
						}
						if (
							/^\s*select[\s\S]*from approval_chain_stage_instance/i.test(
								compiled.sql,
							)
						) {
							return { rows: rowsForIds(chainStages, compiled.params) };
						}
						if (
							/^\s*select[\s\S]*from approval_chain_instance/i.test(
								compiled.sql,
							)
						) {
							return { rows: rowsForIds(chains, compiled.params) };
						}

						mutationCount += 1;
						const params = compiled.params;
						let evidence: Record<string, unknown>;
						if (/^\s*insert into approval_request/i.test(compiled.sql)) {
							const row = {
								id: params[0],
								organization_id: params[1],
								entity_type: params[2],
								entity_id: params[3],
								requested_by: params[4],
								approver_id: params[5],
								status: params[6],
								reason: params[7],
								metadata: JSON.parse(String(params[8])),
								approved_at: params[9],
								rejection_reason: params[10],
								created_at: params[11],
								updated_at: params[12],
							};
							if (
								row.status === "pending" &&
								[...requests.values()].some(
									(current) =>
										current.organization_id === row.organization_id &&
										current.entity_type === row.entity_type &&
										current.entity_id === row.entity_id &&
										current.status === "pending",
								)
							) {
								throw new Error("approvalRequest_pending_entity_unique_idx");
							}
							requests.set(String(row.id), row);
							evidence = resultEvidence(row);
						} else if (/^\s*update approval_request/i.test(compiled.sql)) {
							const row = requests.get(String(params[6]));
							if (!row) return { rows: [] };
							Object.assign(row, {
								approver_id: params[0],
								status: params[1],
								reason: params[2],
								approved_at: params[3],
								rejection_reason: params[4],
								updated_at: params[5],
							});
							evidence = resultEvidence(row);
						} else if (/^\s*delete from approval_request/i.test(compiled.sql)) {
							const row = requests.get(String(params[0]));
							if (!row) return { rows: [] };
							requests.delete(String(row.id));
							evidence = resultEvidence(row);
						} else if (
							/^\s*insert into approval_chain_instance/i.test(compiled.sql)
						) {
							const row = {
								id: params[0],
								organization_id: params[1],
								policy_id: params[2],
								policy_name_snapshot: params[3],
								entity_type: params[4],
								entity_id: params[5],
								requester_employee_id: params[6],
								current_stage_order: params[7],
								status: params[8],
								created_at: params[9],
								updated_at: params[10],
								completed_at: params[11],
							};
							chains.set(String(row.id), row);
							evidence = row;
						} else if (
							/^\s*update approval_chain_instance/i.test(compiled.sql)
						) {
							const terminal =
								params[1] !== undefined && typeof params[1] === "string";
							const id = String(params[terminal ? 4 : 2]);
							const row = chains.get(id);
							if (!row) return { rows: [] };
							Object.assign(
								row,
								terminal
									? {
											current_stage_order: params[0],
											status: params[1],
											updated_at: params[2],
											completed_at: params[3],
										}
									: { current_stage_order: params[0], updated_at: params[1] },
							);
							evidence = row;
						} else if (
							/^\s*insert into approval_chain_stage_instance/i.test(
								compiled.sql,
							)
						) {
							const row = {
								id: params[0],
								organization_id: params[1],
								chain_instance_id: params[2],
								policy_stage_id: params[3],
								step_order: params[4],
								label_snapshot: params[5],
								approver_type_snapshot: params[6],
								resolved_approver_employee_id: params[7],
								approval_request_id: params[8],
								status: params[9],
								decided_by: params[10],
								decided_at: params[11],
								created_at: params[12],
								updated_at: params[13],
							};
							chainStages.set(String(row.id), row);
							evidence = row;
						} else if (
							/^\s*update approval_chain_stage_instance/i.test(compiled.sql)
						) {
							const row = chainStages.get(String(params[6]));
							if (!row) return { rows: [] };
							Object.assign(row, {
								resolved_approver_employee_id: params[0],
								approval_request_id: params[1],
								status: params[2],
								decided_by: params[3],
								decided_at: params[4],
								updated_at: params[5],
							});
							evidence = row;
						} else {
							throw new Error("Unexpected shared-store statement");
						}
						if (failMutationAt === mutationCount) {
							rowsAtFailure = snapshotRows();
							throw new Error("compatibility persistence failed");
						}
						return { rows: [evidence] };
					},
				},
			};
			try {
				await createLegacyApprovalRowWriter(service).writeLegacyRows(input);
				stagedStableIds = [];
			} catch (error) {
				requests = before.requests;
				chains = before.chains;
				chainStages = before.chainStages;
				mutationCount = before.mutationCount - stagedStableIds.length;
				for (const stageId of stagedStableIds) stableIds.delete(stageId);
				stagedStableIds = [];
				throw error;
			}
		},
	};

	return {
		persistence,
		rows: snapshotRows,
		rowsAtFailure: () => rowsAtFailure,
		mutationCount: () => mutationCount,
		failOnMutation(offset: number) {
			failMutationAt = mutationCount + offset;
		},
	};
}

function exactRequestRow(result: ApprovalCommandResult, stageIndex: number) {
	const stage = result.snapshot.stages[stageIndex];
	const assignment = stage?.assignments.find((candidate) =>
		stage.status === "pending"
			? candidate.status === "pending"
			: stage.status === "approved"
				? candidate.status === "approved"
				: stage.status === "rejected"
					? candidate.status === "rejected"
					: false,
	);
	const mapping = legacyMappings(result)[stageIndex];
	if (!stage || !assignment || !mapping)
		throw new Error("Invalid test fixture");
	const status =
		stage.status === "approved"
			? "approved"
			: stage.status === "rejected"
				? "rejected"
				: "pending";
	const decisionAt = stage.decidedAt
		? new Date(stage.decidedAt.toString())
		: null;
	return {
		id: mapping.legacyApprovalRequestId,
		organization_id: result.snapshot.organizationId,
		entity_type: result.snapshot.sourceType,
		entity_id: result.snapshot.sourceId,
		requested_by: result.snapshot.requesterEmployeeId,
		approver_id: assignment.approverEmployeeId,
		status,
		reason: stage.decisionReason,
		rejection_reason: status === "rejected" ? stage.decisionReason : null,
		approved_at: status === "approved" ? decisionAt : null,
		metadata: expectedRequestMetadata(result, stage),
		updated_at:
			decisionAt ??
			new Date(
				(
					assignment.assignedAt ??
					stage.activatedAt ??
					result.snapshot.submittedAt
				).toString(),
			),
	};
}

function exactChainRow(result: ApprovalCommandResult) {
	const policy = result.snapshot.policySnapshot;
	const status =
		result.snapshot.status === "pending" ? "pending" : result.snapshot.status;
	if (status === "expired") throw new Error("Invalid test fixture");
	return {
		id: result.snapshot.id,
		organization_id: result.snapshot.organizationId,
		policy_id: policy.id,
		policy_name_snapshot: policy.name,
		entity_type: result.snapshot.sourceType,
		entity_id: result.snapshot.sourceId,
		requester_employee_id: result.snapshot.requesterEmployeeId,
		current_stage_order:
			result.snapshot.currentStageOrder ?? result.snapshot.stages.length,
		status,
		created_at: new Date(result.snapshot.submittedAt.toString()),
		updated_at: new Date(
			(
				result.events.at(-1)?.occurredAt ?? result.snapshot.submittedAt
			).toString(),
		),
		completed_at:
			status === "pending"
				? null
				: new Date(
						(
							result.snapshot.cancelledAt ??
							result.snapshot.completedAt ??
							result.events.at(-1)?.occurredAt ??
							result.snapshot.submittedAt
						).toString(),
					),
	};
}

function exactChainStageRow(result: ApprovalCommandResult, stageIndex: number) {
	const stage = result.snapshot.stages[stageIndex];
	const assignment = stage?.assignments.find((candidate) =>
		stage.status === "pending"
			? candidate.status === "pending"
			: stage.status === "approved"
				? candidate.status === "approved"
				: stage.status === "rejected"
					? candidate.status === "rejected"
					: false,
	);
	const mapping = legacyMappings(result)[stageIndex];
	const policyStages = result.snapshot.policySnapshot.stages;
	const policyStage = Array.isArray(policyStages)
		? (policyStages[stageIndex] as { id?: string } | undefined)
		: undefined;
	if (!stage || !mapping || !policyStage?.id)
		throw new Error("Invalid test fixture");
	const status =
		stage.status === "approved" ||
		stage.status === "rejected" ||
		stage.status === "cancelled"
			? stage.status
			: "pending";
	const decisionAt = stage.decidedAt
		? new Date(stage.decidedAt.toString())
		: null;
	return {
		id: stage.id,
		organization_id: result.snapshot.organizationId,
		chain_instance_id: result.snapshot.id,
		policy_stage_id: policyStage.id,
		step_order: stage.sequence,
		label_snapshot: stage.label,
		approver_type_snapshot: "direct_manager",
		resolved_approver_employee_id:
			assignment?.approverEmployeeId ?? result.snapshot.requesterEmployeeId,
		approval_request_id:
			stage.status === "waiting" ||
			stage.status === "cancelled" ||
			stage.activationMode === "requester_auto_approve"
				? null
				: mapping.legacyApprovalRequestId,
		status,
		decided_by:
			assignment?.resolvedBy?.kind === "employee"
				? assignment.resolvedBy.employeeId
				: null,
		decided_at: decisionAt,
		created_at: new Date(result.snapshot.submittedAt.toString()),
		updated_at:
			decisionAt ??
			new Date(
				(
					assignment?.assignedAt ??
					stage.activatedAt ??
					result.snapshot.submittedAt
				).toString(),
			),
	};
}

describe("transaction-bound legacy approval row writer", () => {
	it.each([
		[
			"clock-in-only edit",
			{
				action: "edit",
				clockInCorrectionId: ` ${clockInCorrectionId.toUpperCase()} `,
			},
			{ action: "edit", clockInCorrectionId },
		],
		[
			"clock-out-only edit",
			{ action: "edit", clockOutCorrectionId },
			{ action: "edit", clockOutCorrectionId },
		],
		[
			"two-endpoint edit",
			{ action: "edit", clockInCorrectionId, clockOutCorrectionId },
			{ action: "edit", clockInCorrectionId, clockOutCorrectionId },
		],
		[
			"delete",
			{ action: "delete", clockInCorrectionId, clockOutCorrectionId },
			{ action: "delete", clockInCorrectionId, clockOutCorrectionId },
		],
	] as const)("writes exact normalized %s request metadata", async (_label, correction, expected) => {
		const result = asTimeCorrectionResult(
			canonicalLegacyResult("pending"),
			correction,
		);
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const stage = result.snapshot.stages[0];
		if (!stage) throw new Error("Invalid test fixture");
		expect(insertedRequestMetadata(harness.calls)).toEqual({
			workflow: {
				id: result.snapshot.id,
				organizationId: result.snapshot.organizationId,
			},
			stage: {
				id: stage.id,
				sequence: stage.sequence,
				assignmentId: stage.assignments[0]?.id,
			},
			timeCorrection: expected,
		});
		expect(result.snapshot.displaySnapshot).not.toHaveProperty(
			"clockInCorrectionId",
		);
		expect(result.projection.displayPayload).not.toHaveProperty(
			"clockOutCorrectionId",
		);
	});

	it.each([
		["missing", {}],
		[
			"malformed",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "private-bad-id",
				},
			},
		],
		[
			"unknown nested key",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					privateNote: "must not leak",
				},
			},
		],
		[
			"duplicate endpoint IDs",
			{
				timeCorrection: {
					action: "edit",
					clockInCorrectionId,
					clockOutCorrectionId: clockInCorrectionId,
				},
			},
		],
		["edit without an endpoint", { timeCorrection: { action: "edit" } }],
		[
			"delete without both endpoints",
			{ timeCorrection: { action: "delete", clockInCorrectionId } },
		],
	] as const)("rejects %s time correction context before reading or mutating legacy rows", async (_label, contextSnapshot) => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockInCorrectionId,
		});
		result.snapshot.contextSnapshot = contextSnapshot as never;
		result.snapshot.displaySnapshot = {
			kind: "time_correction",
			timeCorrection: { action: "edit", clockInCorrectionId },
		};
		const harness = rowWriterHarness(result);

		let thrown: unknown;
		try {
			await harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			});
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toMatchObject({
			message: "Legacy time correction compatibility metadata is invalid",
		});
		expect(String(thrown)).not.toContain(clockInCorrectionId);
		expect(String(thrown)).not.toContain("must not leak");
		expect(harness.calls).toHaveLength(0);
	});

	it.each([
		"inherited",
		"accessor",
	] as const)("rejects an %s time correction context member without invoking it", async (shape) => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockInCorrectionId,
		});
		let accesses = 0;
		result.snapshot.contextSnapshot = (
			shape === "inherited"
				? Object.assign(
						Object.create({
							timeCorrection: { action: "edit", clockInCorrectionId },
						}),
						{ privateRouting: { policyId: "policy-1" } },
					)
				: Object.defineProperty({}, "timeCorrection", {
						enumerable: true,
						get() {
							accesses += 1;
							return { action: "edit", clockInCorrectionId };
						},
					})
		) as never;
		const harness = rowWriterHarness(result);

		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(
			"Legacy time correction compatibility metadata is invalid",
		);
		expect(accesses).toBe(0);
		expect(harness.calls).toHaveLength(0);
	});

	it("preserves correction metadata through multistage advancement", async () => {
		const result = asTimeCorrectionResult(stageTwoPendingResult(), {
			action: "edit",
			clockInCorrectionId,
			clockOutCorrectionId,
		});
		const harness = rowWriterHarness(result, stageOnePersistedState(result));

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const secondStage = result.snapshot.stages[1];
		if (!secondStage) throw new Error("Invalid test fixture");
		expect(insertedRequestMetadata(harness.calls)).toEqual({
			workflow: {
				id: result.snapshot.id,
				organizationId: result.snapshot.organizationId,
			},
			stage: {
				id: secondStage.id,
				sequence: secondStage.sequence,
				assignmentId: secondStage.assignments[0]?.id,
			},
			timeCorrection: {
				action: "edit",
				clockInCorrectionId,
				clockOutCorrectionId,
			},
		});
	});

	it("rejects later-stage correction metadata disagreement before any legacy mutation", async () => {
		const result = asTimeCorrectionResult(stageTwoPendingResult(), {
			action: "edit",
			clockInCorrectionId,
		});
		const first = exactRequestRow(result, 0);
		first.status = "pending";
		first.reason = null;
		first.approved_at = null;
		first.updated_at = new Date(result.snapshot.submittedAt.toString());
		const second = exactRequestRow(result, 1);
		second.metadata = {
			...(second.metadata as Record<string, unknown>),
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "45000000-0000-4000-8000-000000000099",
			},
		};
		const state = stageOnePersistedState(result);
		const harness = rowWriterHarness(result, {
			...state,
			requestRows: [first, second],
		});

		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/immutable evidence/i);
		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it.each([
		"approved",
		"rejected",
		"cancelled",
	] as const)("preserves exact correction identity while mirroring a terminal %s result", async (status) => {
		const result = asTimeCorrectionResult(canonicalLegacyResult(status), {
			action: "delete",
			clockInCorrectionId,
			clockOutCorrectionId,
		});
		const current = exactRequestRow(
			status === "cancelled"
				? asTimeCorrectionResult(canonicalLegacyResult("pending"), {
						action: "delete",
						clockInCorrectionId,
						clockOutCorrectionId,
					})
				: result,
			0,
		);
		current.status = "pending";
		current.reason = null;
		current.rejection_reason = null;
		current.approved_at = null;
		current.updated_at = new Date(result.snapshot.submittedAt.toString());
		const metadataBefore = structuredClone(current.metadata);
		const harness = rowWriterHarness(result, { requestRows: [current] });

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(current.metadata).toEqual(metadataBefore);
		const mutation = harness.calls.find((call) =>
			/^\s*(?:update approval_request|delete from approval_request)/i.test(
				call.sql,
			),
		);
		expect(mutation).toBeDefined();
		expect(mutation?.sql).not.toMatch(/metadata\s*=/i);
	});

	it("replays exact correction metadata without a duplicate row or event", async () => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("pending"), {
			action: "edit",
			clockOutCorrectionId,
		});
		const harness = rowWriterHarness(result, {
			requestRows: [exactRequestRow(result, 0)],
		});

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it("isolates terminal history across repeated correction cycles in one shared store", async () => {
		const firstPending = asTimeCorrectionResult(
			canonicalLegacyResult("pending", true),
			{ action: "edit", clockInCorrectionId },
		);
		const firstAdvanced = asTimeCorrectionResult(stageTwoPendingResult(), {
			action: "edit",
			clockInCorrectionId,
		});
		const firstTerminal = asTimeCorrectionResult(stageTwoApprovedResult(), {
			action: "edit",
			clockInCorrectionId,
		});
		const secondPending = asTimeCorrectionResult(
			canonicalLegacyResult("pending", true),
			{ action: "edit", clockOutCorrectionId },
		);
		secondPending.snapshot.id = "10000000-0000-4000-8000-000000000002";
		secondPending.projection.workflowId = secondPending.snapshot.id;
		for (const event of secondPending.events)
			event.workflowId = secondPending.snapshot.id;
		for (const outbox of secondPending.outbox)
			outbox.workflowId = secondPending.snapshot.id;
		for (const [index, stage] of secondPending.snapshot.stages.entries()) {
			stage.id = `40000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`;
			stage.workflowId = secondPending.snapshot.id;
			for (const assignment of stage.assignments) {
				assignment.id = `41000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`;
				assignment.workflowId = secondPending.snapshot.id;
				assignment.stageId = stage.id;
			}
		}
		const store = sharedCompatibilityStore();
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: store.persistence,
		});

		await writer.mirrorCanonicalToLegacy({ result: firstPending });
		const pendingCycleOne = store.rows();
		await expect(
			writer.mirrorCanonicalToLegacy({ result: secondPending }),
		).rejects.toThrow(/pending_entity_unique/i);
		expect(store.rows()).toEqual(pendingCycleOne);

		await writer.mirrorCanonicalToLegacy({ result: firstAdvanced });
		await writer.mirrorCanonicalToLegacy({ result: firstTerminal });
		const terminalCycleOne = store.rows();
		const firstRequestIds = firstTerminal.snapshot.stages.map((stage) =>
			deterministicLegacyApprovalRequestId(stage.id, 0),
		);
		const firstRequestsBeforeCycleTwo = firstRequestIds.map((id) =>
			terminalCycleOne.requests.get(id),
		);
		const firstChainBeforeCycleTwo = terminalCycleOne.chains.get(
			firstTerminal.snapshot.id,
		);

		await writer.mirrorCanonicalToLegacy({ result: secondPending });
		const afterCycleTwo = store.rows();
		const secondRequestId = deterministicLegacyApprovalRequestId(
			secondPending.snapshot.stages[0]?.id ?? "",
			0,
		);
		expect(secondPending.snapshot.id).not.toBe(firstTerminal.snapshot.id);
		expect(secondRequestId).not.toBe(firstRequestIds[0]);
		expect(afterCycleTwo.chains).toHaveLength(2);
		expect(afterCycleTwo.requests.get(secondRequestId)?.metadata).toMatchObject(
			{
				workflow: { id: secondPending.snapshot.id },
				timeCorrection: { action: "edit", clockOutCorrectionId },
			},
		);
		expect(firstRequestIds.map((id) => afterCycleTwo.requests.get(id))).toEqual(
			firstRequestsBeforeCycleTwo,
		);
		expect(afterCycleTwo.chains.get(firstTerminal.snapshot.id)).toEqual(
			firstChainBeforeCycleTwo,
		);
		for (const request of firstRequestsBeforeCycleTwo) {
			expect(request).toMatchObject({
				status: "approved",
				metadata: {
					workflow: { id: firstTerminal.snapshot.id },
					timeCorrection: { action: "edit", clockInCorrectionId },
				},
			});
		}
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("writes exact canonical %s metadata for direct creation", async (kind) => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult("pending"),
			kind,
		);
		resultStage(result, 0).decisionReason = "policy_clock_out";
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const activeStage = resultStage(result, 0);
		expect(insertedRequestMetadata(harness.calls)).toEqual({
			workflow: { id: result.snapshot.id, organizationId: "org-1" },
			stage: { id: activeStage.id, sequence: activeStage.sequence },
			timeRequest: { kind },
			surchargeSnapshot: ordinarySurchargeSnapshot,
			...(kind === "policy_clock_out"
				? {
						breakPolicySnapshot: ordinaryBreakPolicySnapshot,
					}
				: {}),
		});
	});

	it("preserves ordinary metadata through multistage advancement", async () => {
		const result = asOrdinaryWorkPeriodResult(
			stageTwoPendingResult(),
			"manual_time_submission",
		);
		const harness = rowWriterHarness(result, stageOnePersistedState(result));

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const activeStage = resultStage(result, 1);
		expect(insertedRequestMetadata(harness.calls)).toEqual({
			workflow: { id: result.snapshot.id, organizationId: "org-1" },
			stage: { id: activeStage.id, sequence: activeStage.sequence },
			timeRequest: { kind: "manual_time_submission" },
			surchargeSnapshot: ordinarySurchargeSnapshot,
		});
	});

	it("carries policy clock-out break evidence into compatibility metadata", async () => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult("pending"),
			"policy_clock_out",
		);
		const breakPolicySnapshot = {
			version: 1,
			evaluatedAt: "2026-03-29T08:01:00Z",
			resolution: "none",
		} as const;
		result.snapshot.contextSnapshot = {
			timeRequest: { kind: "policy_clock_out" },
			breakPolicySnapshot,
			surchargeSnapshot: ordinarySurchargeSnapshot,
		};
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(insertedRequestMetadata(harness.calls)).toMatchObject({
			timeRequest: { kind: "policy_clock_out" },
			breakPolicySnapshot,
			surchargeSnapshot: ordinarySurchargeSnapshot,
		});
	});

	it("uses ordinary context for the request after requester auto-approval", async () => {
		const result = asOrdinaryWorkPeriodResult(
			stageTwoPendingResult(),
			"policy_clock_out",
		);
		const autoStage = resultStage(result, 0);
		autoStage.activationMode = "requester_auto_approve";
		autoStage.decisionReason = "requester_auto_approved";
		autoStage.assignments = [];
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const activeStage = resultStage(result, 1);
		expect(insertedRequestMetadata(harness.calls)).toEqual({
			workflow: { id: result.snapshot.id, organizationId: "org-1" },
			stage: { id: activeStage.id, sequence: activeStage.sequence },
			timeRequest: { kind: "policy_clock_out" },
			breakPolicySnapshot: ordinaryBreakPolicySnapshot,
			surchargeSnapshot: ordinarySurchargeSnapshot,
		});
	});

	it.each([
		["approved", "manual_time_submission"],
		["rejected", "policy_clock_out"],
	] as const)("preserves ordinary metadata through terminal %s", async (status, kind) => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult(status),
			kind,
		);
		const current = exactRequestRow(result, 0);
		current.status = "pending";
		current.reason = null;
		current.rejection_reason = null;
		current.approved_at = null;
		current.updated_at = new Date(result.snapshot.submittedAt.toString());
		const metadataBefore = structuredClone(current.metadata);
		const harness = rowWriterHarness(result, { requestRows: [current] });

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(current.metadata).toEqual(metadataBefore);
		expect(metadataBefore).toEqual(
			expectedRequestMetadata(result, resultStage(result, 0)),
		);
		const update = harness.calls.find((call) =>
			/^\s*update approval_request/i.test(call.sql),
		);
		expect(update?.sql).not.toMatch(/metadata\s*=/i);
	});

	it("replays exact ordinary metadata without rewriting legacy rows", async () => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult("pending"),
			"manual_time_submission",
		);
		const harness = rowWriterHarness(result, {
			requestRows: [exactRequestRow(result, 0)],
		});

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it("isolates ordinary kinds across terminal cycles for the same source", async () => {
		const firstPending = asOrdinaryWorkPeriodResult(
			moveResultToCycle(canonicalLegacyResult("pending"), 1),
			"manual_time_submission",
		);
		const firstTerminal = asOrdinaryWorkPeriodResult(
			moveResultToCycle(canonicalLegacyResult("approved"), 1),
			"manual_time_submission",
		);
		const secondPending = asOrdinaryWorkPeriodResult(
			moveResultToCycle(canonicalLegacyResult("pending"), 2),
			"policy_clock_out",
		);
		const secondTerminal = asOrdinaryWorkPeriodResult(
			moveResultToCycle(canonicalLegacyResult("approved"), 2),
			"policy_clock_out",
		);
		const store = sharedCompatibilityStore();
		const writer = createApprovalCompatibilityWriter({
			writeGate: writeGate("canonical"),
			repository: {} as TransactionalWorkflowRepository,
			projectionWriter: {} as ApprovalProjectionWriter,
			outboxWriter: { write: async () => ({ kind: "duplicate" as const }) },
			legacyPersistence: store.persistence,
		});

		await writer.mirrorCanonicalToLegacy({ result: firstPending });
		await writer.mirrorCanonicalToLegacy({ result: firstTerminal });
		await writer.mirrorCanonicalToLegacy({ result: secondPending });
		await writer.mirrorCanonicalToLegacy({ result: secondTerminal });

		const rows = store.rows().requests;
		const firstId = deterministicLegacyApprovalRequestId(
			resultStage(firstTerminal, 0).id,
			0,
		);
		const secondId = deterministicLegacyApprovalRequestId(
			resultStage(secondTerminal, 0).id,
			0,
		);
		expect(rows.get(firstId)?.metadata).toEqual(
			expectedRequestMetadata(firstTerminal, resultStage(firstTerminal, 0)),
		);
		expect(rows.get(secondId)?.metadata).toEqual(
			expectedRequestMetadata(secondTerminal, resultStage(secondTerminal, 0)),
		);
	});

	it.each([
		["missing", {}],
		["malformed", { timeRequest: { kind: "time_correction" } }],
		[
			"private root data",
			{
				timeRequest: { kind: "manual_time_submission" },
				privateRouting: { policyId: "must-not-leak" },
			},
		],
		["kind mismatch", { timeRequest: { kind: "policy_clock_out" } }],
	] as const)("rejects %s ordinary context before any legacy read or write", async (_label, contextSnapshot) => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult("pending"),
			"manual_time_submission",
		);
		result.snapshot.contextSnapshot = contextSnapshot as never;
		const harness = rowWriterHarness(result);
		const stringify = vi.spyOn(JSON, "stringify");

		try {
			await expect(
				harness.writer.writeLegacyRows({
					organizationId: "org-1",
					result,
					legacyIds: harness.mappings,
				}),
			).rejects.toThrow("Ordinary work-period workflow payload is invalid");
			expect(harness.calls).toHaveLength(0);
			expect(stringify).not.toHaveBeenCalled();
		} finally {
			stringify.mockRestore();
		}
	});

	it("rejects hostile ordinary context without invoking accessors", async () => {
		const result = asOrdinaryWorkPeriodResult(
			canonicalLegacyResult("pending"),
			"manual_time_submission",
		);
		let accesses = 0;
		result.snapshot.contextSnapshot = Object.defineProperty({}, "timeRequest", {
			enumerable: true,
			get() {
				accesses += 1;
				return { kind: "manual_time_submission" };
			},
		}) as never;
		const harness = rowWriterHarness(result);

		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow("Ordinary work-period workflow payload is invalid");
		expect(accesses).toBe(0);
		expect(harness.calls).toHaveLength(0);
	});

	it.each([
		[
			"ordinary workflow on another source",
			"manual_time_submission",
			"absence_entry",
		],
		["another workflow on a time entry", "absence", "time_entry"],
	] as const)("keeps metadata byte-equivalent for %s", async (_label, workflowType, sourceType) => {
		const result = canonicalLegacyResult("pending");
		result.snapshot.workflowType = workflowType;
		result.snapshot.sourceType = sourceType;
		result.snapshot.contextSnapshot = { hostile: { kind: "policy_clock_out" } };
		result.projection.workflowType = workflowType;
		result.projection.sourceType = sourceType;
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const stage = resultStage(result, 0);
		expect(JSON.stringify(insertedRequestMetadata(harness.calls))).toBe(
			JSON.stringify({
				stage: {
					assignmentId: stage.assignments[0]?.id,
					id: stage.id,
					sequence: stage.sequence,
				},
				workflow: { id: result.snapshot.id, organizationId: "org-1" },
			}),
		);
	});

	it("keeps non-correction request metadata byte-equivalent and ignores display correction data", async () => {
		const result = canonicalLegacyResult("pending");
		result.snapshot.displaySnapshot = {
			kind: "absence",
			timeCorrection: { action: "edit", clockInCorrectionId },
		};
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const stage = result.snapshot.stages[0];
		if (!stage) throw new Error("Invalid test fixture");
		expect(insertedRequestMetadata(harness.calls)).toEqual({
			workflow: {
				id: result.snapshot.id,
				organizationId: result.snapshot.organizationId,
			},
			stage: {
				id: stage.id,
				sequence: stage.sequence,
				assignmentId: stage.assignments[0]?.id,
			},
		});
	});
	it("stores a null request reference for an initially auto-approved stage", async () => {
		const result = stageTwoPendingResult();
		const autoStage = result.snapshot.stages[0];
		if (!autoStage) throw new Error("Invalid test fixture");
		autoStage.activationMode = "requester_auto_approve";
		autoStage.decisionReason = "requester_auto_approved";
		autoStage.assignments = [];
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const autoStageInsert = harness.calls.find(
			(call) =>
				/^\s*insert into approval_chain_stage_instance/i.test(call.sql) &&
				call.params[0] === autoStage.id,
		);
		expect(autoStageInsert?.params[8]).toBeNull();
	});

	it("does not leave a stale request for a directly auto-approved correction", async () => {
		const result = asTimeCorrectionResult(canonicalLegacyResult("approved"), {
			action: "edit",
			clockInCorrectionId,
		});
		const stage = result.snapshot.stages[0];
		if (!stage) throw new Error("Invalid test fixture");
		stage.activationMode = "requester_auto_approve";
		stage.decisionReason = "requester_auto_approved";
		stage.assignments = [];
		const harness = rowWriterHarness(result, { requestRows: [] });

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(
			harness.calls.some((call) =>
				/^(?:\s*insert into|\s*update|\s*delete from) approval_request/i.test(
					call.sql,
				),
			),
		).toBe(false);
	});

	it("advances a pending chain monotonically from stage one to stage two", async () => {
		const result = stageTwoPendingResult();
		const harness = rowWriterHarness(result, stageOnePersistedState(result));

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const chainUpdate = harness.calls.find((call) =>
			/^\s*update approval_chain_instance/i.test(call.sql),
		);
		expect(chainUpdate?.params).toEqual(expect.arrayContaining([2]));
		expect(chainUpdate?.sql).toMatch(/status = 'pending'/i);
	});

	it("advances across a coherent requester-auto-approved intermediate stage", async () => {
		const result = stageTwoPendingResult();
		const active = result.snapshot.stages[1];
		const policyStages = result.snapshot.policySnapshot.stages;
		if (!active || !Array.isArray(policyStages)) {
			throw new Error("Invalid test fixture");
		}
		const firstStage = result.snapshot.stages[0];
		if (!firstStage) throw new Error("Invalid test fixture");
		active.id = "40000000-0000-4000-8000-000000000003";
		active.sequence = 3;
		for (const assignment of active.assignments) assignment.stageId = active.id;
		const autoStage = {
			...firstStage,
			id: "40000000-0000-4000-8000-000000000002",
			sequence: 2,
			label: "Requester auto approval",
			activationMode: "requester_auto_approve",
			status: "approved" as const,
			activatedAt: firstDecisionAt,
			decidedAt: firstDecisionAt,
			decisionReason: "requester_auto_approved",
			assignments: [],
		};
		result.snapshot.stages.splice(1, 0, autoStage);
		result.snapshot.currentStageOrder = 3;
		result.projection.currentStageOrder = 3;
		result.snapshot.policySnapshot.stages = result.snapshot.stages.map(
			(stage) => ({
				id: `44000000-0000-4000-8000-${String(stage.sequence).padStart(12, "0")}`,
				stepOrder: stage.sequence,
				approverType: "direct_manager",
			}),
		);
		const firstRequest = exactRequestRow(result, 0);
		firstRequest.status = "pending";
		firstRequest.reason = null;
		firstRequest.approved_at = null;
		firstRequest.updated_at = new Date(result.snapshot.submittedAt.toString());
		const chainStages = result.snapshot.stages.map((_stage, index) => ({
			...exactChainStageRow(result, index),
			status: "pending",
			approval_request_id: index === 0 ? firstRequest.id : null,
			decided_by: null,
			decided_at: null,
			updated_at: new Date(result.snapshot.submittedAt.toString()),
		}));
		const harness = rowWriterHarness(result, {
			requestRows: [firstRequest],
			chainRows: [
				{
					...exactChainRow(result),
					current_stage_order: 1,
					updated_at: new Date(result.snapshot.submittedAt.toString()),
				},
			],
			chainStageRows: chainStages,
		});

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const chainUpdate = harness.calls.find((call) =>
			/^\s*update approval_chain_instance/i.test(call.sql),
		);
		expect(chainUpdate?.params).toEqual(expect.arrayContaining([3]));
		expect(
			harness.calls.some(
				(call) =>
					/^\s*(?:insert|update) approval_request/i.test(call.sql) &&
					call.params.includes(autoStage.id),
			),
		).toBe(false);
		const autoStageUpdate = harness.calls.find(
			(call) =>
				/^\s*update approval_chain_stage_instance/i.test(call.sql) &&
				call.params.includes(autoStage.id),
		);
		expect(autoStageUpdate?.params[1]).toBeNull();
	});

	it("rejects stale lower pending chain order and contradictory advancement", async () => {
		const lower = stageTwoPendingResult();
		const lowerState = stageOnePersistedState(lower);
		if (!lowerState.chainRows?.[0]) throw new Error("Invalid test fixture");
		lowerState.chainRows[0].current_stage_order = 3;
		const lowerHarness = rowWriterHarness(lower, lowerState);
		await expect(
			lowerHarness.writer.writeLegacyRows({
				organizationId: "org-1",
				result: lower,
				legacyIds: lowerHarness.mappings,
			}),
		).rejects.toThrow(/order|replay evidence|regress/i);

		const contradictory = stageTwoPendingResult();
		const contradictoryState = stageOnePersistedState(contradictory);
		const firstStage = contradictory.snapshot.stages[0];
		if (!firstStage) throw new Error("Invalid test fixture");
		firstStage.status = "pending";
		firstStage.decidedAt = null;
		firstStage.decisionReason = null;
		const contradictoryHarness = rowWriterHarness(
			contradictory,
			contradictoryState,
		);
		await expect(
			contradictoryHarness.writer.writeLegacyRows({
				organizationId: "org-1",
				result: contradictory,
				legacyIds: contradictoryHarness.mappings,
			}),
		).rejects.toThrow(/coherent|approved|active stage/i);
	});

	it("treats same pending chain order as exact replay only", async () => {
		const result = stageTwoPendingResult();
		const harness = rowWriterHarness(result, {
			requestRows: [exactRequestRow(result, 0), exactRequestRow(result, 1)],
			chainRows: [exactChainRow(result)],
			chainStageRows: result.snapshot.stages.map((_stage, index) =>
				exactChainStageRow(result, index),
			),
		});
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it.each([
		"assignment.reassigned",
		"assignment.escalated",
	] as const)("uses the replacement pending assignment for %s", async (eventType) => {
		const result = pendingReplacementResult(eventType);
		const current = exactRequestRow(result, 0);
		current.approver_id = "42000000-0000-4000-8000-000000000001";
		current.updated_at = new Date(result.snapshot.submittedAt.toString());
		const harness = rowWriterHarness(result, { requestRows: [current] });

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const update = harness.calls.find((call) =>
			/^\s*update approval_request/i.test(call.sql),
		);
		expect(update?.params).toEqual(
			expect.arrayContaining([
				replacementApproverId,
				"42000000-0000-4000-8000-000000000001",
			]),
		);
		expect(update?.sql).toMatch(/status = 'pending'/i);
	});

	it("keeps replacement-assignment replay stable and rejects stale legacy status", async () => {
		const result = pendingReplacementResult("assignment.reassigned");
		const replay = exactRequestRow(result, 0);
		replay.approver_id = replacementApproverId;
		replay.updated_at = new Date(secondDecisionAt.toString());
		const replayHarness = rowWriterHarness(result, { requestRows: [replay] });
		await replayHarness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: replayHarness.mappings,
		});
		expect(
			replayHarness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);

		const stale = { ...replay, status: "approved" };
		const staleHarness = rowWriterHarness(result, { requestRows: [stale] });
		await expect(
			staleHarness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: staleHarness.mappings,
			}),
		).rejects.toThrow(/status|decided|reassign|regress/i);
	});

	it("represents parallel pending assignments with the lowest sequence", async () => {
		const result = parallelPendingResult();
		const stage = result.snapshot.stages[0];
		const first = stage?.assignments[0];
		if (!stage || !first) throw new Error("Invalid test fixture");
		stage.assignments.reverse();
		const harness = rowWriterHarness(result);

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const insert = harness.calls.find((call) =>
			/^\s*insert into approval_request/i.test(call.sql),
		);
		expect(insert?.params).toEqual(
			expect.arrayContaining([first.approverEmployeeId]),
		);
		expect(insertedRequestMetadata(harness.calls)).toMatchObject({
			stage: {
				id: stage.id,
				sequence: stage.sequence,
				assignmentId: first.id,
			},
		});
	});

	it("moves the parallel representative when the lowest sequence is replaced", async () => {
		const result = parallelPendingResult();
		const stage = result.snapshot.stages[0];
		const first = stage?.assignments[0];
		const second = stage?.assignments[1];
		if (!stage || !first || !second) throw new Error("Invalid test fixture");
		first.status = "cancelled";
		first.resolvedAt = secondDecisionAt;
		first.resolvedBy = {
			kind: "employee",
			employeeId: first.approverEmployeeId,
			userId: null,
		};
		stage.assignments.push({
			...second,
			id: "41000000-0000-4000-8000-000000000003",
			sequence: 3,
			approverEmployeeId: replacementApproverId,
		});
		const current = exactRequestRow(result, 0);
		current.approver_id = first.approverEmployeeId;
		current.updated_at = new Date(result.snapshot.submittedAt.toString());
		const harness = rowWriterHarness(result, { requestRows: [current] });

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const update = harness.calls.find((call) =>
			/^\s*update approval_request/i.test(call.sql),
		);
		expect(update?.params).toEqual(
			expect.arrayContaining([
				second.approverEmployeeId,
				first.approverEmployeeId,
			]),
		);
	});

	it("keeps an unchanged parallel pending representative as an exact replay", async () => {
		const result = parallelPendingResult();
		const harness = rowWriterHarness(result, {
			requestRows: [exactRequestRow(result, 0)],
		});

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it.each([
		"approved",
		"rejected",
	] as const)("uses the resolved parallel winner for a %s stage", async (status) => {
		const result = parallelTerminalResult(status);
		const stage = result.snapshot.stages[0];
		const first = stage?.assignments[0];
		const winner = stage?.assignments[1];
		if (!first || !winner) throw new Error("Invalid test fixture");
		const current = exactRequestRow(result, 0);
		current.approver_id = first.approverEmployeeId;
		current.status = "pending";
		current.reason = null;
		current.rejection_reason = null;
		current.approved_at = null;
		current.updated_at = new Date(result.snapshot.submittedAt.toString());
		const harness = rowWriterHarness(result, { requestRows: [current] });

		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});

		const update = harness.calls.find((call) =>
			/^\s*update approval_request/i.test(call.sql),
		);
		expect(update?.sql).toMatch(/approver_id\s*=/i);
		expect(update?.params).toEqual(
			expect.arrayContaining([
				winner.approverEmployeeId,
				first.approverEmployeeId,
				status,
			]),
		);
	});

	it.each([
		"approved",
		"rejected",
	] as const)("rejects multiple %s assignment winners", async (status) => {
		const result = parallelTerminalResult(status);
		const assignments = result.snapshot.stages[0]?.assignments;
		if (!assignments?.[0] || !assignments[1]) {
			throw new Error("Invalid test fixture");
		}
		assignments[0].status = status;
		const harness = rowWriterHarness(result);

		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/exactly one.*assignment candidate/i);
	});

	it("rejects a pending stage without an active assignment candidate", async () => {
		const zero = pendingReplacementResult("assignment.reassigned");
		for (const assignment of zero.snapshot.stages[0]?.assignments ?? []) {
			assignment.status = "cancelled";
		}
		const zeroHarness = rowWriterHarness(zero);
		await expect(
			zeroHarness.writer.writeLegacyRows({
				organizationId: "org-1",
				result: zero,
				legacyIds: zeroHarness.mappings,
			}),
		).rejects.toThrow(/assignment candidate|pending assignment/i);
	});

	it("accepts exact replay metadata with recursively reordered JSONB object keys", async () => {
		const result = canonicalLegacyResult("pending");
		const stage = result.snapshot.stages[0];
		if (!stage) throw new Error("Invalid test fixture");
		const reordered = {
			...exactRequestRow(result, 0),
			metadata: {
				stage: {
					assignmentId: stage.assignments[0]?.id,
					sequence: stage.sequence,
					id: stage.id,
				},
				workflow: {
					organizationId: result.snapshot.organizationId,
					id: result.snapshot.id,
				},
			},
		};
		const harness = rowWriterHarness(result, { requestRows: [reordered] });

		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).resolves.toBeUndefined();
		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it("rejects replay metadata with a changed nested JSONB value", async () => {
		const result = canonicalLegacyResult("pending");
		const current = exactRequestRow(result, 0);
		current.metadata = {
			...(current.metadata as Record<string, unknown>),
			stage: {
				...(current.metadata as { stage: Record<string, unknown> }).stage,
				sequence: 99,
			},
		};
		const harness = rowWriterHarness(result, { requestRows: [current] });

		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/metadata|immutable evidence/i);
	});

	it.each([
		["pending", "insert"],
		["approved", "update"],
		["rejected", "update"],
		["cancelled", "delete"],
	] as const)("handles a direct %s result from exact expected state", async (status, operation) => {
		const result = canonicalLegacyResult(status);
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const mutations = harness.calls.filter((call) =>
			/^\s*(?:insert|update|delete)\b/i.test(call.sql),
		);
		expect(mutations).toHaveLength(1);
		expect(mutations[0]?.sql).toMatch(new RegExp(`^\\s*${operation}`, "i"));
		if (status === "approved") {
			expect(mutations[0]?.params).toEqual(
				expect.arrayContaining([new Date(occurredAt.toString())]),
			);
		}
		if (status === "rejected") {
			expect(mutations[0]?.params).toEqual(
				expect.arrayContaining([
					"not allowed",
					new Date(occurredAt.toString()),
				]),
			);
		}
	});

	it.each([
		"pending",
		"approved",
		"rejected",
	] as const)("replays an exact direct %s result without rewriting bytes", async (status) => {
		const result = canonicalLegacyResult(status);
		const harness = rowWriterHarness(result, {
			requestRows: [exactRequestRow(result, 0)],
		});
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it("fails when an active direct cancellation request is missing", async () => {
		const result = canonicalLegacyResult("cancelled");
		const harness = rowWriterHarness(result, { requestRows: [] });
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/missing active request/i);
	});

	it("rejects a stale decision that would regress an approved direct request", async () => {
		const approved = canonicalLegacyResult("approved");
		const rejected = canonicalLegacyResult("rejected");
		const harness = rowWriterHarness(rejected, {
			requestRows: [exactRequestRow(approved, 0)],
		});
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result: rejected,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/regress|decided request/i);
	});

	it("rejects a stale rejection when its active direct request is missing", async () => {
		const result = canonicalLegacyResult("rejected");
		const harness = rowWriterHarness(result, { requestRows: [] });
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/missing active request/i);
	});

	it("preserves an earlier approved request and chain stage when a later stage rejects", async () => {
		const result = secondStageRejectedResult();
		const pendingSecondRequest = {
			...exactRequestRow(result, 1),
			status: "pending",
			reason: null,
			rejection_reason: null,
			approved_at: null,
			updated_at: new Date(result.snapshot.submittedAt.toString()),
		};
		const pendingSecondStage = {
			...exactChainStageRow(result, 1),
			status: "pending",
			decided_by: null,
			decided_at: null,
			updated_at: new Date(result.snapshot.submittedAt.toString()),
		};
		const harness = rowWriterHarness(result, {
			requestRows: [exactRequestRow(result, 0), pendingSecondRequest],
			chainRows: [
				{ ...exactChainRow(result), status: "pending", completed_at: null },
			],
			chainStageRows: [exactChainStageRow(result, 0), pendingSecondStage],
		});
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const firstMapping = harness.mappings[0];
		const firstStage = result.snapshot.stages[0];
		if (!firstMapping || !firstStage) throw new Error("Invalid test fixture");
		const mutations = harness.calls.filter((call) =>
			/^\s*(?:insert|update|delete)\b/i.test(call.sql),
		);
		expect(
			mutations.some(
				(call) =>
					call.params.includes(firstMapping.legacyApprovalRequestId) ||
					call.params.includes(firstStage.id),
			),
		).toBe(false);
	});

	it("replays an exact multistage terminal result without rewriting requests or stages", async () => {
		const result = canonicalLegacyResult("approved", true);
		const harness = rowWriterHarness(result, {
			requestRows: result.snapshot.stages.map((_stage, index) =>
				exactRequestRow(result, index),
			),
			chainRows: [exactChainRow(result)],
			chainStageRows: result.snapshot.stages.map((_stage, index) =>
				exactChainStageRow(result, index),
			),
		});
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it("rejects a terminal replay with stale chain-root time evidence", async () => {
		const result = canonicalLegacyResult("approved", true);
		const staleChain = exactChainRow(result);
		staleChain.updated_at = new Date("2026-07-16T13:59:59Z");
		const harness = rowWriterHarness(result, {
			requestRows: result.snapshot.stages.map((_stage, index) =>
				exactRequestRow(result, index),
			),
			chainRows: [staleChain],
			chainStageRows: result.snapshot.stages.map((_stage, index) =>
				exactChainStageRow(result, index),
			),
		});
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/chain replay evidence/i);
	});

	it("rejects multistage cancellation when the active request is stale-missing", async () => {
		const result = canonicalLegacyResult("cancelled", true);
		const harness = rowWriterHarness(result, { requestRows: [] });
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/missing active request/i);
	});

	it("accepts missing cancelled requests only after matching chain stages are durably cancelled", async () => {
		const result = canonicalLegacyResult("cancelled", true);
		const harness = rowWriterHarness(result, {
			requestRows: [],
			chainRows: [exactChainRow(result)],
			chainStageRows: result.snapshot.stages.map((_stage, index) =>
				exactChainStageRow(result, index),
			),
		});
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		expect(
			harness.calls.filter((call) =>
				/^\s*(?:insert|update|delete)\b/i.test(call.sql),
			),
		).toHaveLength(0);
	});

	it("keeps prior approved requests and stages byte-stable during approved cancellation", async () => {
		const result = canonicalLegacyResult("approved", true);
		const approvedRequests = result.snapshot.stages.map((_stage, index) =>
			exactRequestRow(result, index),
		);
		const approvedStages = result.snapshot.stages.map((_stage, index) =>
			exactChainStageRow(result, index),
		);
		const approvedChain = exactChainRow(result);
		result.snapshot.status = "cancelled";
		result.snapshot.cancelledAt = occurredAt;
		result.snapshot.decisionReason = "approved source withdrawn";
		result.projection.status = "cancelled";
		const finalEvent = result.events.at(-1);
		if (!finalEvent) throw new Error("Invalid test fixture");
		result.events[result.events.length - 1] = {
			...finalEvent,
			eventType: "workflow.cancelled",
			previousState: { status: "approved" },
			resultingState: { status: "cancelled" },
			reason: "approved source withdrawn",
		};
		const harness = rowWriterHarness(result, {
			requestRows: approvedRequests,
			chainRows: [approvedChain],
			chainStageRows: approvedStages,
		});
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const mutations = harness.calls.filter((call) =>
			/^\s*(?:insert|update|delete)\b/i.test(call.sql),
		);
		expect(mutations).toHaveLength(1);
		expect(mutations[0]?.sql).toMatch(/update approval_chain_instance/i);
	});

	it("uses each stage's own immutable decision reason and instant", async () => {
		const result = secondStageRejectedResult();
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const requestWrites = harness.calls.filter((call) =>
			/^\s*(?:insert into|update) approval_request/i.test(call.sql),
		);
		expect(requestWrites).toHaveLength(2);
		expect(requestWrites[0]?.params).toEqual(
			expect.arrayContaining([
				"manager approved",
				new Date(firstDecisionAt.toString()),
			]),
		);
		expect(requestWrites[1]?.params).toEqual(
			expect.arrayContaining([
				"HR rejected",
				new Date(secondDecisionAt.toString()),
			]),
		);
		expect(requestWrites[0]?.params).not.toContain("workflow terminal reason");
		expect(requestWrites[0]?.params).not.toContain(
			new Date(occurredAt.toString()),
		);
		const stageWrites = harness.calls.filter((call) =>
			/^\s*update approval_chain_stage_instance/i.test(call.sql),
		);
		expect(stageWrites[0]?.params).toEqual(
			expect.arrayContaining([
				"42000000-0000-4000-8000-000000000001",
				new Date(firstDecisionAt.toString()),
			]),
		);
		expect(stageWrites[1]?.params).toEqual(
			expect.arrayContaining([
				"42000000-0000-4000-8000-000000000002",
				new Date(secondDecisionAt.toString()),
			]),
		);
	});

	it("locks current request and chain-stage state before mutations", async () => {
		const result = canonicalLegacyResult("pending", true);
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const firstMutation = harness.calls.findIndex((call) =>
			/^\s*(?:insert|update|delete)\b/i.test(call.sql),
		);
		const locks = harness.calls.slice(0, firstMutation);
		expect(
			locks.some((call) =>
				/from approval_request[\s\S]*for update/i.test(call.sql),
			),
		).toBe(true);
		expect(
			locks.some((call) =>
				/from approval_chain_stage_instance[\s\S]*for update/i.test(call.sql),
			),
		).toBe(true);
	});

	it("never synthesizes cancellation success for a missing active request", async () => {
		const result = canonicalLegacyResult("cancelled");
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const cancellation = harness.calls.find((call) =>
			/delete from approval_request/i.test(call.sql),
		);
		expect(cancellation?.sql).not.toMatch(/union all|not exists/i);
	});

	it("does not permit an approved chain stage to regress", async () => {
		const result = secondStageRejectedResult();
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const stageWrites = harness.calls.filter((call) =>
			/approval_chain_stage_instance/i.test(call.sql),
		);
		expect(
			stageWrites.some((call) =>
				/status in \('pending', 'approved'/i.test(call.sql),
			),
		).toBe(false);
	});

	it("upserts a direct pending request with exact tenant, source, stable ID, and status predicates", async () => {
		const result = canonicalLegacyResult("pending");
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const statements = harness.calls.map((call) => call.sql).join("\n");
		expect(statements).toMatch(/insert into approval_request/i);
		expect(statements).not.toMatch(/on conflict[\s\S]*do update/i);
		expect(statements).toMatch(
			/organization_id[\s\S]*entity_type[\s\S]*entity_id[\s\S]*status/i,
		);
		expect(statements).not.toMatch(
			/update absence_entry|delete from absence_entry/i,
		);
		expect(harness.calls.flatMap((call) => call.params)).toEqual(
			expect.arrayContaining([
				"org-1",
				source.sourceType,
				source.sourceId,
				harness.mappings[0]?.legacyApprovalRequestId,
				"pending",
			]),
		);
	});

	it("writes a stable multistage chain and ordered stage rows", async () => {
		const result = canonicalLegacyResult("pending", true);
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const chain = harness.calls.filter((call) =>
			/^\s*(?:insert into|update) approval_chain_instance/i.test(call.sql),
		);
		const chainStages = harness.calls.filter((call) =>
			/^\s*(?:insert into|update) approval_chain_stage_instance/i.test(
				call.sql,
			),
		);
		expect(chain).toHaveLength(1);
		expect(chainStages).toHaveLength(2);
		expect(chainStages[0]?.params).toEqual(expect.arrayContaining([1]));
		expect(chainStages[1]?.params).toEqual(expect.arrayContaining([2]));
		expect(chainStages[0]?.params).toEqual(
			expect.arrayContaining([result.snapshot.stages[0]?.id]),
		);
		expect(chainStages[1]?.params).toEqual(
			expect.arrayContaining([result.snapshot.stages[1]?.id]),
		);
	});

	it.each([
		"approved",
		"rejected",
	] as const)("closes the matching request and chain coherently for %s", async (status) => {
		const result = canonicalLegacyResult(status, true);
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const statements = harness.calls.map((call) => call.sql).join("\n");
		expect(statements).toMatch(/approval_request/i);
		expect(statements).toMatch(/approval_chain_instance/i);
		expect(statements).toMatch(/approval_chain_stage_instance/i);
		expect(harness.calls.flatMap((call) => call.params)).toContain(status);
		expect(statements).toMatch(/status[\s\S]*(pending|approved|rejected)/i);
		if (status === "rejected") {
			const siblingMapping = harness.mappings[1];
			if (!siblingMapping) throw new Error("Invalid test fixture");
			const siblingWrite = harness.calls.find(
				(call) =>
					/^\s*(?:insert into|update|delete from) approval_request\b/i.test(
						call.sql,
					) && call.params.includes(siblingMapping.legacyApprovalRequestId),
			);
			expect(siblingWrite).toBeUndefined();
		}
	});

	it("deletes pending requests and marks chain rows cancelled", async () => {
		const result = canonicalLegacyResult("cancelled", true);
		const harness = rowWriterHarness(result);
		await harness.writer.writeLegacyRows({
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		});
		const statements = harness.calls.map((call) => call.sql).join("\n");
		expect(statements).toMatch(
			/delete from approval_request[\s\S]*status\s*=\s*/i,
		);
		const chainCalls = harness.calls.filter((call) =>
			/^\s*(?:insert into|update) approval_chain_(?:stage_)?instance/i.test(
				call.sql,
			),
		);
		expect(chainCalls).toHaveLength(3);
		expect(chainCalls.every((call) => call.params.includes("cancelled"))).toBe(
			true,
		);
	});

	it("produces deterministic SQL plans from the same empty fixture", async () => {
		const result = canonicalLegacyResult("approved", true);
		const harness = rowWriterHarness(result);
		const input = {
			organizationId: "org-1",
			result,
			legacyIds: harness.mappings,
		};
		await harness.writer.writeLegacyRows(input);
		const first = harness.calls.map((call) => ({ ...call }));
		harness.calls.length = 0;
		await harness.writer.writeLegacyRows(input);
		expect(harness.calls).toEqual(first);
	});

	it("fails closed for foreign mappings and affected-row mismatches", async () => {
		const result = canonicalLegacyResult("pending");
		const harness = rowWriterHarness(result);
		const mapping = harness.mappings[0];
		if (!mapping) throw new Error("Invalid test fixture");
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: [{ ...mapping, organizationId: "org-2" }],
			}),
		).rejects.toThrow(/mapping|scope/i);
		expect(harness.calls).toHaveLength(0);

		harness.emptyNextMutation();
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow(/affected|row/i);
	});

	it("propagates transaction-client failures for caller rollback", async () => {
		const result = canonicalLegacyResult("pending");
		const harness = rowWriterHarness(result);
		harness.fail(new Error("caller transaction aborted"));
		await expect(
			harness.writer.writeLegacyRows({
				organizationId: "org-1",
				result,
				legacyIds: harness.mappings,
			}),
		).rejects.toThrow("caller transaction aborted");
	});
});
