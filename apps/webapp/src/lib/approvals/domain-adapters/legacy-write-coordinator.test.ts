import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalCompatibilityWriter } from "../workflow/compatibility-writer";
import { getCutoverBehavior } from "../workflow/cutover";
import type {
	ApprovalEventActorIdentity,
	ApprovalSourceIdentity,
	ApprovalWorkflowLifecycleMode,
	ApprovalWriteGate,
	ObservedLegacyTransitionResult,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { APPROVAL_WORKFLOW_TYPES } from "../workflow/types";
import {
	createLegacyApprovalWriteCoordinator,
	LegacyApprovalWriteBoundaryError,
} from "./legacy-write-coordinator";

const sourceIdentity = {
	organizationId: "org-1",
	workflowType: "absence" as const,
	sourceType: "absence_entry",
	sourceId: "source-1",
} satisfies ApprovalSourceIdentity;

const actor = {
	kind: "legacy_unknown" as const,
	employeeId: null,
	userId: null,
} satisfies ApprovalEventActorIdentity;

const capturedAt = parseInstant("2026-07-18T10:00:00Z");

function state(status: string): VerifiedLegacyApprovalState {
	return {
		organizationId: sourceIdentity.organizationId,
		source: sourceIdentity,
		approvalRequest: null,
		chain: null,
		chainRows: [],
		sourceSnapshot: { status },
		capturedAt,
	};
}

function harness(mode: ApprovalWorkflowLifecycleMode) {
	const timeline: string[] = [];
	let captureCount = 0;
	const gateInputs: unknown[] = [];
	const mirrorInputs: unknown[] = [];
	const mirrorResult = {
		snapshot: { id: "workflow-1", organizationId: "org-1" },
	} as ObservedLegacyTransitionResult;
	const writeGate: ApprovalWriteGate = {
		acquire: async (input) => {
			timeline.push("gate");
			gateInputs.push(input);
			return { mode, behavior: getCutoverBehavior(mode) };
		},
	};
	const compatibilityWriter = {
		withWriteGate: () => compatibilityWriter,
		mirrorLegacyToCanonical: async (input: unknown) => {
			timeline.push("mirror");
			mirrorInputs.push(input);
			return mirrorResult;
		},
		mirrorCanonicalToLegacy: async () => undefined,
	} as ApprovalCompatibilityWriter;
	const coordinator = createLegacyApprovalWriteCoordinator({
		writeGate,
		compatibilityWriter,
	});
	const captureState = async () => {
		captureCount += 1;
		timeline.push(captureCount === 1 ? "capture-before" : "capture-after");
		return state(captureCount === 1 ? "before" : "after");
	};
	const mutate = async () => {
		timeline.push("mutate");
		return { mutation: "result" };
	};
	return {
		coordinator,
		timeline,
		gateInputs,
		mirrorInputs,
		mirrorResult,
		input: {
			organizationId: sourceIdentity.organizationId,
			workflowType: sourceIdentity.workflowType,
			sourceIdentity,
			actor: actor as ApprovalEventActorIdentity,
			idempotencyKey: "legacy-decision:source-1",
			expectedVersion: 4,
			captureState,
			mutate,
		},
	};
}

describe("legacy approval write coordinator", () => {
	it.each([
		["empty organization", { organizationId: "" }],
		[
			"foreign source organization",
			{
				sourceIdentity: { ...sourceIdentity, organizationId: "org-2" },
			},
		],
		[
			"foreign source workflow type",
			{
				sourceIdentity: {
					...sourceIdentity,
					workflowType: "travel_expense" as const,
				},
			},
		],
		[
			"empty source type",
			{
				sourceIdentity: { ...sourceIdentity, sourceType: "" },
			},
		],
		[
			"empty source ID",
			{
				sourceIdentity: { ...sourceIdentity, sourceId: "" },
			},
		],
		["empty idempotency key", { idempotencyKey: "" }],
		["negative expected version", { expectedVersion: -1 }],
		["fractional expected version", { expectedVersion: 1.5 }],
	] as const)("rejects %s before acquiring the gate", async (_name, override) => {
		const test = harness("legacy");
		const input = { ...test.input, ...override };

		await expect(test.coordinator.execute(input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "invalid_source_identity",
		});
		expect(test.timeline).toEqual([]);
	});

	it.each([
		"time_entry",
		"forged_workflow",
	])("rejects unsupported matching workflow type %s before the gate or callbacks", async (workflowType) => {
		const test = harness("shadow");
		const forgedWorkflowType =
			workflowType as ApprovalSourceIdentity["workflowType"];
		const input = {
			...test.input,
			workflowType: forgedWorkflowType,
			sourceIdentity: {
				...test.input.sourceIdentity,
				workflowType: forgedWorkflowType,
			},
		};

		await expect(test.coordinator.execute(input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "invalid_source_identity",
		});
		expect(test.timeline).toEqual([]);
		expect(test.mirrorInputs).toEqual([]);
	});

	it.each(
		APPROVAL_WORKFLOW_TYPES,
	)("preserves legacy execution for canonical workflow type %s", async (workflowType) => {
		const test = harness("legacy");
		const input = {
			...test.input,
			workflowType,
			sourceIdentity: { ...test.input.sourceIdentity, workflowType },
		};

		await expect(test.coordinator.execute(input)).resolves.toEqual({
			mutation: "result",
		});
		expect(test.timeline).toEqual(["gate", "mutate"]);
	});

	it("executes only the legacy mutation in legacy mode", async () => {
		const test = harness("legacy");

		await expect(test.coordinator.execute(test.input)).resolves.toEqual({
			mutation: "result",
		});
		expect(test.timeline).toEqual(["gate", "mutate"]);
		expect(test.mirrorInputs).toEqual([]);
	});

	it("ignores a forged authority snapshot and enforces the acquired gate", async () => {
		const test = harness("canonical");
		const forgedInput = {
			...test.input,
			authoritySnapshot: {
				mode: "legacy",
				behavior: getCutoverBehavior("legacy"),
			},
		};

		await expect(test.coordinator.execute(forgedInput)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "canonical_authority",
		});
		expect(test.timeline).toEqual(["gate"]);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("observes and mirrors around the mutation in %s mode", async (mode) => {
		const test = harness(mode);

		await expect(test.coordinator.execute(test.input)).resolves.toEqual({
			mutation: "result",
		});
		expect(test.timeline).toEqual([
			"gate",
			"capture-before",
			"mutate",
			"capture-after",
			"mirror",
		]);
	});

	it("passes exact trusted arguments to the gate and mirror and returns the mutation result", async () => {
		const test = harness("shadow");
		const result = { mutation: "exact-result" };
		test.input.mutate = async () => {
			test.timeline.push("mutate");
			return result;
		};

		await expect(test.coordinator.execute(test.input)).resolves.toBe(result);
		expect(test.gateInputs).toEqual([
			{
				organizationId: sourceIdentity.organizationId,
				workflowType: sourceIdentity.workflowType,
			},
		]);
		expect(test.mirrorInputs).toHaveLength(1);
		expect(test.mirrorInputs[0]).toEqual({
			before: state("before"),
			after: state("after"),
			actor,
			idempotencyKey: "legacy-decision:source-1",
			expectedVersion: 4,
		});
	});

	it.each([
		"shadow",
		"ready",
	] as const)("runs the successful observation callback after mirror in %s mode", async (mode) => {
		const test = harness(mode);
		let observed: ObservedLegacyTransitionResult | undefined;
		test.input.afterMirror = async (result) => {
			test.timeline.push("after-mirror");
			observed = result;
		};

		await test.coordinator.execute(test.input);

		expect(observed).toBe(test.mirrorResult);
		expect(test.timeline).toEqual([
			"gate",
			"capture-before",
			"mutate",
			"capture-after",
			"mirror",
			"after-mirror",
		]);
	});

	it("propagates a post-mirror callback failure before returning", async () => {
		const test = harness("shadow");
		const failure = new Error("source binding failed");
		test.input.afterMirror = async () => {
			test.timeline.push("after-mirror");
			throw failure;
		};

		await expect(test.coordinator.execute(test.input)).rejects.toBe(failure);
		expect(test.timeline).toEqual([
			"gate",
			"capture-before",
			"mutate",
			"capture-after",
			"mirror",
			"after-mirror",
		]);
	});

	it("mirrors the trusted entry-time actor when callbacks mutate the input actor", async () => {
		const test = harness("shadow");
		const mutableActor: ApprovalEventActorIdentity = {
			kind: "employee",
			employeeId: "employee-1",
			userId: "user-1",
		};
		test.input.actor = mutableActor;
		test.input.mutate = async () => {
			test.timeline.push("mutate");
			mutableActor.employeeId = "employee-2";
			mutableActor.userId = "user-2";
			return { mutation: "result" };
		};

		await test.coordinator.execute(test.input);

		const mirroredActor = (
			test.mirrorInputs[0] as { actor: ApprovalEventActorIdentity }
		).actor;
		expect(mirroredActor).toEqual({
			kind: "employee",
			employeeId: "employee-1",
			userId: "user-1",
		});
		expect(mirroredActor).not.toBe(mutableActor);
	});

	it.each([
		["persistence organization", { organizationId: "org-2" }],
		[
			"source organization",
			{
				source: { ...sourceIdentity, organizationId: "org-2" },
			},
		],
		[
			"workflow type",
			{
				source: { ...sourceIdentity, workflowType: "travel_expense" as const },
			},
		],
		[
			"source type",
			{
				source: { ...sourceIdentity, sourceType: "travel_expense_claim" },
			},
		],
		[
			"source ID",
			{
				source: { ...sourceIdentity, sourceId: "source-2" },
			},
		],
	] as const)("rejects a foreign %s in the before capture before mutation", async (_name, override) => {
		const test = harness("shadow");
		test.input.captureState = async () => {
			test.timeline.push("capture-before");
			return { ...state("before"), ...override };
		};

		await expect(test.coordinator.execute(test.input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "observation_scope",
		});
		expect(test.timeline).toEqual(["gate", "capture-before"]);
	});

	it.each([
		["persistence organization", { organizationId: "org-2" }],
		[
			"source organization",
			{
				source: { ...sourceIdentity, organizationId: "org-2" },
			},
		],
		[
			"workflow type",
			{
				source: { ...sourceIdentity, workflowType: "travel_expense" as const },
			},
		],
		[
			"source type",
			{
				source: { ...sourceIdentity, sourceType: "travel_expense_claim" },
			},
		],
		[
			"source ID",
			{
				source: { ...sourceIdentity, sourceId: "source-2" },
			},
		],
	] as const)("rejects a foreign %s in the after capture before mirroring", async (_name, override) => {
		const test = harness("shadow");
		let captureCount = 0;
		test.input.captureState = async () => {
			captureCount += 1;
			test.timeline.push(
				captureCount === 1 ? "capture-before" : "capture-after",
			);
			return captureCount === 1
				? state("before")
				: { ...state("after"), ...override };
		};

		await expect(test.coordinator.execute(test.input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "observation_scope",
		});
		expect(test.timeline).toEqual([
			"gate",
			"capture-before",
			"mutate",
			"capture-after",
		]);
	});

	it("does not allow a capture callback to redefine the trusted source identity", async () => {
		const test = harness("shadow");
		const trustedSource = { ...sourceIdentity };
		test.input.sourceIdentity = trustedSource;
		test.input.captureState = async () => {
			test.timeline.push("capture-before");
			trustedSource.sourceId = "source-2";
			return {
				...state("before"),
				source: { ...trustedSource },
			};
		};

		await expect(test.coordinator.execute(test.input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "observation_scope",
		});
		expect(test.timeline).toEqual(["gate", "capture-before"]);
	});

	it("isolates the validated before-capture scope from later mutation", async () => {
		const test = harness("shadow");
		const before = state("before");
		test.input.captureState = async () => {
			test.timeline.push(
				test.timeline.includes("mutate") ? "capture-after" : "capture-before",
			);
			return test.timeline.includes("mutate") ? state("after") : before;
		};
		test.input.mutate = async () => {
			test.timeline.push("mutate");
			before.source = { ...before.source, sourceId: "source-2" };
			return { mutation: "result" };
		};

		await expect(test.coordinator.execute(test.input)).resolves.toEqual({
			mutation: "result",
		});
		expect(test.timeline).toEqual([
			"gate",
			"capture-before",
			"mutate",
			"capture-after",
			"mirror",
		]);
		expect(
			(test.mirrorInputs[0] as { before: VerifiedLegacyApprovalState }).before
				.source,
		).toEqual(sourceIdentity);
	});

	it("mirrors an immutable entry-time snapshot of all before-state evidence", async () => {
		const test = harness("shadow");
		const changedAt = parseInstant("2026-07-18T11:00:00Z");
		const before: VerifiedLegacyApprovalState = {
			...state("before"),
			approvalRequest: {
				id: "request-1",
				organizationId: sourceIdentity.organizationId,
				entityType: sourceIdentity.sourceType,
				entityId: sourceIdentity.sourceId,
				requestedBy: "employee-1",
				approverId: "employee-2",
				status: "pending",
				reason: "entry reason",
				rejectionReason: null,
				approvedAt: null,
				metadata: { nested: { value: "entry metadata" } },
				updatedAt: capturedAt,
			},
			chain: {
				id: "chain-1",
				organizationId: sourceIdentity.organizationId,
				policyId: "policy-1",
				policyNameSnapshot: "Entry policy",
				entityType: sourceIdentity.sourceType,
				entityId: sourceIdentity.sourceId,
				requesterEmployeeId: "employee-1",
				currentStageOrder: 1,
				status: "pending",
				createdAt: capturedAt,
				updatedAt: capturedAt,
				completedAt: null,
			},
			chainRows: [
				{
					id: "chain-row-1",
					organizationId: sourceIdentity.organizationId,
					chainInstanceId: "chain-1",
					policyStageId: "policy-stage-1",
					stepOrder: 1,
					labelSnapshot: "Entry stage",
					approverTypeSnapshot: "manager",
					resolvedApproverEmployeeId: "employee-2",
					approvalRequestId: "request-1",
					status: "pending",
					decidedBy: null,
					decidedAt: null,
					createdAt: capturedAt,
					updatedAt: capturedAt,
				},
			],
			sourceSnapshot: {
				status: "before",
				nested: { value: "entry source" },
				items: [{ value: "entry item" }],
			},
		};
		let captureCount = 0;
		test.input.captureState = async () => {
			captureCount += 1;
			test.timeline.push(
				captureCount === 1 ? "capture-before" : "capture-after",
			);
			return captureCount === 1 ? before : state("after");
		};
		test.input.mutate = async () => {
			test.timeline.push("mutate");
			const request = before.approvalRequest;
			const chain = before.chain;
			const chainRow = before.chainRows[0];
			if (!request || !chain || !chainRow) {
				throw new Error("Legacy state fixture is incomplete");
			}
			request.reason = "mutated reason";
			request.metadata = {
				nested: { value: "mutated metadata" },
			};
			request.updatedAt = changedAt;
			chain.policyNameSnapshot = "Mutated policy";
			chain.updatedAt = changedAt;
			chainRow.labelSnapshot = "Mutated stage";
			chainRow.updatedAt = changedAt;
			before.sourceSnapshot = {
				status: "mutated",
				nested: { value: "mutated source" },
				items: [{ value: "mutated item" }],
			};
			before.capturedAt = changedAt;
			return { mutation: "result" };
		};

		await test.coordinator.execute(test.input);

		const mirroredBefore = (
			test.mirrorInputs[0] as { before: VerifiedLegacyApprovalState }
		).before;
		expect(mirroredBefore.approvalRequest).toMatchObject({
			reason: "entry reason",
			metadata: { nested: { value: "entry metadata" } },
			updatedAt: capturedAt,
		});
		expect(mirroredBefore.chain).toMatchObject({
			policyNameSnapshot: "Entry policy",
			updatedAt: capturedAt,
		});
		expect(mirroredBefore.chainRows).toMatchObject([
			{ labelSnapshot: "Entry stage", updatedAt: capturedAt },
		]);
		expect(mirroredBefore.sourceSnapshot).toEqual({
			status: "before",
			nested: { value: "entry source" },
			items: [{ value: "entry item" }],
		});
		expect(mirroredBefore.approvalRequest?.updatedAt).toBe(capturedAt);
		expect(mirroredBefore.chain?.updatedAt).toBe(capturedAt);
		expect(mirroredBefore.chainRows[0]?.updatedAt).toBe(capturedAt);
		expect(mirroredBefore.capturedAt).toBe(capturedAt);
		expect(Object.isFrozen(mirroredBefore)).toBe(true);
		expect(Object.isFrozen(mirroredBefore.sourceSnapshot)).toBe(true);
		expect(Object.isFrozen(mirroredBefore.chainRows)).toBe(true);
	});

	it("rejects an unavailable observation after mirroring", async () => {
		const test = harness("shadow");
		const compatibilityWriter = {
			withWriteGate() {
				return this;
			},
			mirrorLegacyToCanonical: async () => {
				test.timeline.push("mirror");
				return null;
			},
			mirrorCanonicalToLegacy: async () => undefined,
		} satisfies ApprovalCompatibilityWriter;
		const coordinator = createLegacyApprovalWriteCoordinator({
			writeGate: {
				acquire: async () => {
					test.timeline.push("gate");
					return { mode: "shadow", behavior: getCutoverBehavior("shadow") };
				},
			},
			compatibilityWriter,
		});
		test.timeline.length = 0;

		await expect(coordinator.execute(test.input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "observation_unavailable",
		});
		expect(test.timeline).toEqual([
			"gate",
			"capture-before",
			"mutate",
			"capture-after",
			"mirror",
		]);
	});

	it.each([
		["gate", ["gate"]],
		["capture-before", ["gate", "capture-before"]],
		["mutate", ["gate", "capture-before", "mutate"]],
		["capture-after", ["gate", "capture-before", "mutate", "capture-after"]],
		["mirror", ["gate", "capture-before", "mutate", "capture-after", "mirror"]],
	] as const)("propagates the %s exception unchanged and stops the transaction sequence", async (failureAt, expectedTimeline) => {
		const failure = new Error(`${failureAt} failed`);
		const timeline: string[] = [];
		let captureCount = 0;
		const coordinator = createLegacyApprovalWriteCoordinator({
			writeGate: {
				acquire: async () => {
					timeline.push("gate");
					if (failureAt === "gate") throw failure;
					return {
						mode: "shadow",
						behavior: getCutoverBehavior("shadow"),
					};
				},
			},
			compatibilityWriter: {
				withWriteGate() {
					return this;
				},
				mirrorLegacyToCanonical: async () => {
					timeline.push("mirror");
					if (failureAt === "mirror") throw failure;
					return {} as never;
				},
				mirrorCanonicalToLegacy: async () => undefined,
			},
		});
		const captureState = async () => {
			captureCount += 1;
			const step = captureCount === 1 ? "capture-before" : "capture-after";
			timeline.push(step);
			if (failureAt === step) throw failure;
			return state(captureCount === 1 ? "before" : "after");
		};
		const mutate = async () => {
			timeline.push("mutate");
			if (failureAt === "mutate") throw failure;
			return "result";
		};

		await expect(
			coordinator.execute({
				organizationId: sourceIdentity.organizationId,
				workflowType: sourceIdentity.workflowType,
				sourceIdentity,
				actor,
				idempotencyKey: "legacy-decision:source-1",
				expectedVersion: null,
				captureState,
				mutate,
			}),
		).rejects.toBe(failure);
		expect(timeline).toEqual(expectedTimeline);
	});

	it.each([
		"canonical",
		"complete",
	] as const)("rejects legacy mutation after the gate in %s mode", async (mode) => {
		const test = harness(mode);

		await expect(test.coordinator.execute(test.input)).rejects.toMatchObject({
			name: "LegacyApprovalWriteBoundaryError",
			code: "canonical_authority",
		});
		expect(test.timeline).toEqual(["gate"]);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("requires observation before mutation in %s mode", async (mode) => {
		const test = harness(mode);
		const { captureState: _captureState, ...input } = test.input;

		await expect(test.coordinator.execute(input)).rejects.toEqual(
			expect.objectContaining({
				name: LegacyApprovalWriteBoundaryError.name,
				code: "observation_required",
			}),
		);
		expect(test.timeline).toEqual(["gate"]);
	});
});
