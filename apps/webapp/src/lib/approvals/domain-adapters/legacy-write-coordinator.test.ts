import { describe, expect, it } from "vitest";
import { approvalWriteGateResult } from "@/lib/approvals/authority";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalCompatibilityWriter } from "../workflow/compatibility-writer";
import type {
	ApprovalEventActorIdentity,
	ApprovalSourceIdentity,
	ApprovalWorkflowLifecycleMode,
	ApprovalWorkflowSnapshot,
	ObservedLegacyTransitionResult,
	VerifiedLegacyApprovalState,
} from "../workflow/ports";
import { APPROVAL_WORKFLOW_TYPES } from "../workflow/types";
import {
	createLegacyApprovalWriteCoordinator,
	LegacyApprovalWriteBoundaryError,
	type ObservedWorkflowReader,
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

function workflow(overrides: Partial<ApprovalWorkflowSnapshot> = {}): ApprovalWorkflowSnapshot {
	return {
		...sourceIdentity,
		id: "workflow-1",
		requesterEmployeeId: "requester-1",
		status: "pending",
		currentStageOrder: 1,
		version: 4,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {},
		submittedAt: capturedAt,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: "stage-1",
				organizationId: sourceIdentity.organizationId,
				workflowId: "workflow-1",
				sequence: 1,
				label: "Stage",
				resolverSnapshot: {},
				activationMode: "human",
				status: "pending",
				activatedAt: capturedAt,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: "request-1",
				assignments: [],
			},
		],
		...overrides,
	};
}

function mirrorResult(snapshot: ApprovalWorkflowSnapshot) {
	return { snapshot } as ObservedLegacyTransitionResult;
}

function harness(
	mode: ApprovalWorkflowLifecycleMode,
	options: {
		observed?: ApprovalWorkflowSnapshot | null;
		mirrorResults?: Array<ObservedLegacyTransitionResult | null>;
	} = {},
) {
	const timeline: string[] = [];
	let captureCount = 0;
	const lookups: unknown[] = [];
	const mirrorInputs: Array<Record<string, unknown>> = [];
	const mirrorResults = options.mirrorResults ?? [mirrorResult(workflow({ version: 5 }))];
	const observedWorkflows: ObservedWorkflowReader = {
		findByLegacyRequest: async (input) => {
			timeline.push("lookup");
			lookups.push(input);
			return options.observed === undefined ? workflow() : options.observed;
		},
	};
	const compatibilityWriter = {
		withWriteGate: () => compatibilityWriter,
		mirrorLegacyToCanonical: async (input: Record<string, unknown>) => {
			timeline.push(
				String(input.idempotencyKey).startsWith("late-mirror:") ? "late-mirror" : "mirror",
			);
			mirrorInputs.push(input);
			const result = mirrorResults.shift();
			if (result === undefined) throw new Error("unexpected mirror");
			return result;
		},
		mirrorCanonicalToLegacy: async () => undefined,
	} as unknown as ApprovalCompatibilityWriter;
	const coordinator = createLegacyApprovalWriteCoordinator({
		compatibilityWriter,
		observedWorkflows,
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
	const observeInput = {
		gate: approvalWriteGateResult(mode),
		sourceIdentity,
		requesterEmployeeId: "requester-1",
		legacyApprovalRequestId: "request-1" as string | null,
	};
	return {
		coordinator,
		timeline,
		lookups,
		mirrorInputs,
		observeInput,
		observe: () => coordinator.observe(observeInput),
		writeInput: {
			actor: actor as ApprovalEventActorIdentity,
			idempotencyKey: "legacy-decision:source-1",
			captureState: captureState as (() => Promise<VerifiedLegacyApprovalState>) | undefined,
			mutate,
			afterMirror: undefined as
				| ((result: ObservedLegacyTransitionResult) => Promise<void>)
				| undefined,
		},
	};
}

describe("legacy approval write coordinator", () => {
	describe("observe", () => {
		it.each([
			["empty source organization", { sourceIdentity: { ...sourceIdentity, organizationId: "" } }],
			["empty source type", { sourceIdentity: { ...sourceIdentity, sourceType: "" } }],
			["empty source ID", { sourceIdentity: { ...sourceIdentity, sourceId: "" } }],
			[
				"unsupported workflow type",
				{
					sourceIdentity: {
						...sourceIdentity,
						workflowType: "time_entry" as ApprovalSourceIdentity["workflowType"],
					},
				},
			],
			["empty requester", { requesterEmployeeId: "" }],
			["empty legacy request", { legacyApprovalRequestId: " " }],
		] as const)("rejects %s before any lookup", async (_name, override) => {
			const test = harness("shadow");

			await expect(
				test.coordinator.observe({ ...test.observeInput, ...override }),
			).rejects.toMatchObject({
				name: "LegacyApprovalWriteBoundaryError",
				code: "invalid_source_identity",
			});
			expect(test.timeline).toEqual([]);
		});

		it.each(["legacy", "canonical", "complete"] as const)(
			"looks nothing up and agrees vacuously without shadow mirroring (%s)",
			async (mode) => {
				const test = harness(mode);

				const observation = await test.observe();

				expect(observation.workflow).toBeNull();
				expect(observation.agrees(() => false)).toBe(true);
				expect(test.lookups).toEqual([]);
			},
		);

		it.each(["shadow", "ready"] as const)(
			"loads the observed workflow of the legacy request in %s mode",
			async (mode) => {
				const test = harness(mode);

				const observation = await test.observe();

				expect(test.lookups).toEqual([
					{ source: sourceIdentity, legacyApprovalRequestId: "request-1" },
				]);
				expect(observation.workflow).toEqual(workflow());
				expect(observation.agrees((observed) => observed.version === 4)).toBe(true);
				expect(observation.agrees((observed) => observed.status === "approved")).toBe(false);
			},
		);

		it("disagrees under shadow mirroring when there is no observed workflow", async () => {
			const test = harness("shadow", { observed: null });

			const observation = await test.observe();

			expect(observation.workflow).toBeNull();
			expect(observation.agrees(() => true)).toBe(false);
		});

		it("observes nothing for a submission", async () => {
			const test = harness("shadow");

			const observation = await test.coordinator.observe({
				...test.observeInput,
				legacyApprovalRequestId: null,
			});

			expect(observation.workflow).toBeNull();
			expect(test.lookups).toEqual([]);
		});

		it.each([
			["organization", { organizationId: "org-2" }],
			["workflow type", { workflowType: "time_correction" as const }],
			["source type", { sourceType: "time_entry" }],
			["source ID", { sourceId: "source-2" }],
			["requester", { requesterEmployeeId: "requester-2" }],
			["legacy request", { stages: [] }],
		] as const)("refuses an observed workflow with another %s", async (_name, override) => {
			const test = harness("shadow", { observed: workflow(override) });

			await expect(test.observe()).rejects.toMatchObject({
				name: "LegacyApprovalWriteBoundaryError",
				code: "observation_scope",
			});
		});
	});

	describe("execute", () => {
		it("refuses an observation it did not make", async () => {
			const test = harness("legacy");
			const other = harness("legacy");
			const forged = {
				...(await test.observe()),
			};

			await expect(
				test.coordinator.execute({ ...test.writeInput, observation: forged }),
			).rejects.toMatchObject({ code: "invalid_source_identity" });
			await expect(
				test.coordinator.execute({
					...test.writeInput,
					observation: await other.observe(),
				}),
			).rejects.toMatchObject({ code: "invalid_source_identity" });
			expect(test.timeline).toEqual([]);
		});

		it("rejects an empty idempotency key before any callback", async () => {
			const test = harness("shadow");
			const observation = await test.observe();

			await expect(
				test.coordinator.execute({ ...test.writeInput, observation, idempotencyKey: "" }),
			).rejects.toMatchObject({ code: "invalid_source_identity" });
			expect(test.timeline).toEqual(["lookup"]);
		});

		it.each(APPROVAL_WORKFLOW_TYPES)(
			"runs only the legacy mutation under legacy authority for %s",
			async (workflowType) => {
				const test = harness("legacy");
				const observation = await test.coordinator.observe({
					...test.observeInput,
					sourceIdentity: { ...sourceIdentity, workflowType },
				});

				await expect(
					test.coordinator.execute({ ...test.writeInput, observation }),
				).resolves.toEqual({ mutation: "result" });
				expect(test.timeline).toEqual(["mutate"]);
				expect(test.mirrorInputs).toEqual([]);
			},
		);

		it.each(["canonical", "complete"] as const)(
			"refuses a legacy write under canonical authority (%s)",
			async (mode) => {
				const test = harness(mode);
				const observation = await test.observe();

				await expect(
					test.coordinator.execute({ ...test.writeInput, observation }),
				).rejects.toMatchObject({
					name: "LegacyApprovalWriteBoundaryError",
					code: "canonical_authority",
				});
				expect(test.timeline).toEqual([]);
			},
		);

		it.each(["shadow", "ready"] as const)(
			"requires captured state while shadow mirroring (%s)",
			async (mode) => {
				const test = harness(mode);
				const observation = await test.observe();

				await expect(
					test.coordinator.execute({
						...test.writeInput,
						captureState: undefined,
						observation,
					}),
				).rejects.toEqual(
					expect.objectContaining({
						name: LegacyApprovalWriteBoundaryError.name,
						code: "observation_required",
					}),
				);
				expect(test.timeline).toEqual(["lookup"]);
			},
		);

		it.each(["shadow", "ready"] as const)(
			"mirrors around the mutation at the observed version in %s mode",
			async (mode) => {
				const test = harness(mode);
				const observation = await test.observe();
				let observed: ObservedLegacyTransitionResult | undefined;
				const result = { mutation: "exact-result" };

				await expect(
					test.coordinator.execute({
						...test.writeInput,
						observation,
						mutate: async () => {
							test.timeline.push("mutate");
							return result;
						},
						afterMirror: async (mirrored) => {
							test.timeline.push("after-mirror");
							observed = mirrored;
						},
					}),
				).resolves.toBe(result);
				expect(test.timeline).toEqual([
					"lookup",
					"capture-before",
					"mutate",
					"capture-after",
					"mirror",
					"after-mirror",
				]);
				expect(test.mirrorInputs).toEqual([
					{
						before: state("before"),
						after: state("after"),
						actor,
						idempotencyKey: "legacy-decision:source-1",
						expectedVersion: 4,
					},
				]);
				expect(observed?.snapshot.version).toBe(5);
			},
		);

		it("mirrors a submission as the initial version without late mirroring", async () => {
			const test = harness("shadow");
			const observation = await test.coordinator.observe({
				...test.observeInput,
				legacyApprovalRequestId: null,
			});

			await test.coordinator.execute({ ...test.writeInput, observation });

			expect(test.timeline).toEqual(["capture-before", "mutate", "capture-after", "mirror"]);
			expect(test.mirrorInputs[0]?.expectedVersion).toBeNull();
		});

		it("late-mirrors a legacy request without an observed workflow, then mirrors the action", async () => {
			const lateMirrored = workflow({ version: 1 });
			const decided = workflow({ version: 2, status: "approved" });
			const test = harness("shadow", {
				observed: null,
				mirrorResults: [mirrorResult(lateMirrored), mirrorResult(decided)],
			});
			const observation = await test.observe();
			let observed: ObservedLegacyTransitionResult | undefined;

			await test.coordinator.execute({
				...test.writeInput,
				observation,
				afterMirror: async (mirrored) => {
					observed = mirrored;
				},
			});

			expect(test.timeline).toEqual([
				"lookup",
				"capture-before",
				"late-mirror",
				"mutate",
				"capture-after",
				"mirror",
			]);
			expect(test.mirrorInputs).toEqual([
				{
					before: { ...state("before"), approvalRequest: null, chain: null, chainRows: [] },
					after: state("before"),
					actor,
					idempotencyKey: "late-mirror:org-1:absence:absence_entry:source-1:request-1",
					expectedVersion: null,
				},
				{
					before: state("before"),
					after: state("after"),
					actor,
					idempotencyKey: "legacy-decision:source-1",
					expectedVersion: 1,
				},
			]);
			expect(observed?.snapshot).toBe(decided);
		});

		it.each([
			["a decided workflow", { status: "approved" as const, version: 1 }],
			["a later version", { version: 2 }],
			["another source", { sourceId: "source-2", version: 1 }],
			["another requester", { requesterEmployeeId: "requester-2", version: 1 }],
			["no stage for the request", { stages: [], version: 1 }],
		] as const)(
			"refuses a late mirror that produced %s before mutation",
			async (_name, override) => {
				const test = harness("shadow", {
					observed: null,
					mirrorResults: [mirrorResult(workflow(override))],
				});
				const observation = await test.observe();

				await expect(
					test.coordinator.execute({ ...test.writeInput, observation }),
				).rejects.toMatchObject({ code: "observation_scope" });
				expect(test.timeline).toEqual(["lookup", "capture-before", "late-mirror"]);
			},
		);

		it("refuses an action mirrored into another workflow than the observed one", async () => {
			const test = harness("shadow", {
				mirrorResults: [mirrorResult(workflow({ id: "workflow-2", version: 5 }))],
			});
			const observation = await test.observe();
			let afterMirror = false;

			await expect(
				test.coordinator.execute({
					...test.writeInput,
					observation,
					afterMirror: async () => {
						afterMirror = true;
					},
				}),
			).rejects.toMatchObject({ code: "observation_scope" });
			expect(afterMirror).toBe(false);
		});

		it("rejects an unavailable observation after mirroring", async () => {
			const test = harness("shadow", { mirrorResults: [null] });
			const observation = await test.observe();

			await expect(
				test.coordinator.execute({ ...test.writeInput, observation }),
			).rejects.toMatchObject({
				name: "LegacyApprovalWriteBoundaryError",
				code: "observation_unavailable",
			});
			expect(test.timeline).toEqual([
				"lookup",
				"capture-before",
				"mutate",
				"capture-after",
				"mirror",
			]);
		});

		it("propagates a post-mirror callback failure", async () => {
			const test = harness("shadow");
			const observation = await test.observe();
			const failure = new Error("source binding failed");

			await expect(
				test.coordinator.execute({
					...test.writeInput,
					observation,
					afterMirror: async () => {
						throw failure;
					},
				}),
			).rejects.toBe(failure);
		});

		it("mirrors the trusted entry-time actor when callbacks mutate the input actor", async () => {
			const test = harness("shadow");
			const observation = await test.observe();
			const mutableActor: ApprovalEventActorIdentity = {
				kind: "employee",
				employeeId: "employee-1",
				userId: "user-1",
			};

			await test.coordinator.execute({
				...test.writeInput,
				observation,
				actor: mutableActor,
				mutate: async () => {
					mutableActor.employeeId = "employee-2";
					mutableActor.userId = "user-2";
					return { mutation: "result" };
				},
			});

			const mirroredActor = test.mirrorInputs[0]?.actor;
			expect(mirroredActor).toEqual({
				kind: "employee",
				employeeId: "employee-1",
				userId: "user-1",
			});
			expect(mirroredActor).not.toBe(mutableActor);
		});

		it.each([
			["persistence organization", { organizationId: "org-2" }],
			["source organization", { source: { ...sourceIdentity, organizationId: "org-2" } }],
			["workflow type", { source: { ...sourceIdentity, workflowType: "travel_expense" as const } }],
			["source type", { source: { ...sourceIdentity, sourceType: "travel_expense_claim" } }],
			["source ID", { source: { ...sourceIdentity, sourceId: "source-2" } }],
		] as const)("rejects a foreign %s in either capture", async (_name, override) => {
			for (const foreignCapture of [1, 2]) {
				const test = harness("shadow");
				const observation = await test.observe();
				let captureCount = 0;

				await expect(
					test.coordinator.execute({
						...test.writeInput,
						observation,
						captureState: async () => {
							captureCount += 1;
							const captured = state(captureCount === 1 ? "before" : "after");
							return captureCount === foreignCapture ? { ...captured, ...override } : captured;
						},
					}),
				).rejects.toMatchObject({
					name: "LegacyApprovalWriteBoundaryError",
					code: "observation_scope",
				});
				expect(test.mirrorInputs).toEqual([]);
			}
		});

		it("mirrors an immutable entry-time snapshot of the before state", async () => {
			const test = harness("shadow");
			const observation = await test.observe();
			const changedAt = parseInstant("2026-07-18T11:00:00Z");
			const before: VerifiedLegacyApprovalState = {
				...state("before"),
				sourceSnapshot: { status: "before", nested: { value: "entry source" } },
			};
			let captureCount = 0;

			await test.coordinator.execute({
				...test.writeInput,
				observation,
				captureState: async () => {
					captureCount += 1;
					return captureCount === 1 ? before : state("after");
				},
				mutate: async () => {
					before.source = { ...before.source, sourceId: "source-2" };
					before.sourceSnapshot = { status: "mutated", nested: { value: "mutated" } };
					before.capturedAt = changedAt;
					return { mutation: "result" };
				},
			});

			const mirroredBefore = test.mirrorInputs[0]?.before as VerifiedLegacyApprovalState;
			expect(mirroredBefore.source).toEqual(sourceIdentity);
			expect(mirroredBefore.sourceSnapshot).toEqual({
				status: "before",
				nested: { value: "entry source" },
			});
			expect(mirroredBefore.capturedAt).toBe(capturedAt);
			expect(Object.isFrozen(mirroredBefore)).toBe(true);
			expect(Object.isFrozen(mirroredBefore.sourceSnapshot)).toBe(true);
		});

		it.each([
			["capture-before", ["lookup", "capture-before"]],
			["mutate", ["lookup", "capture-before", "mutate"]],
			["capture-after", ["lookup", "capture-before", "mutate", "capture-after"]],
			["mirror", ["lookup", "capture-before", "mutate", "capture-after", "mirror"]],
		] as const)(
			"propagates the %s exception unchanged and stops the sequence",
			async (failureAt, expectedTimeline) => {
				const failure = new Error(`${failureAt} failed`);
				const test = harness("shadow");
				const observation = await test.observe();
				let captureCount = 0;
				const writer = {
					withWriteGate: () => writer,
					mirrorLegacyToCanonical: async () => {
						test.timeline.push("mirror");
						throw failure;
					},
					mirrorCanonicalToLegacy: async () => undefined,
				} as unknown as ApprovalCompatibilityWriter;
				const coordinator =
					failureAt === "mirror"
						? createLegacyApprovalWriteCoordinator({
								compatibilityWriter: writer,
								observedWorkflows: {
									findByLegacyRequest: async () => {
										test.timeline.push("lookup");
										return workflow();
									},
								},
							})
						: test.coordinator;
				if (failureAt === "mirror") test.timeline.length = 0;
				const trusted =
					failureAt === "mirror" ? await coordinator.observe(test.observeInput) : observation;

				await expect(
					coordinator.execute({
						...test.writeInput,
						observation: trusted,
						captureState: async () => {
							captureCount += 1;
							const step = captureCount === 1 ? "capture-before" : "capture-after";
							test.timeline.push(step);
							if (failureAt === step) throw failure;
							return state(captureCount === 1 ? "before" : "after");
						},
						mutate: async () => {
							test.timeline.push("mutate");
							if (failureAt === "mutate") throw failure;
							return "result";
						},
					}),
				).rejects.toBe(failure);
				expect(test.timeline).toEqual(expectedTimeline);
			},
		);
	});
});
