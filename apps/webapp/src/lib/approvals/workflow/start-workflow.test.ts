import { Temporal } from "temporal-polyfill";
import { describe, expect, it, vi } from "vitest";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import { createDatabaseStageActivationResolver } from "../routing/stage-activation-resolver";
import type {
	ApprovalWorkflowLifecycleMode,
	ApprovalWorkflowSnapshot,
	StageActivationInput,
} from "./ports";
import { validateInitialApprovalWorkflowPersistenceInput } from "./repository";
import {
	APPROVAL_WORKFLOW_START_POLICY_LIMITS,
	ApprovalWorkflowStartError,
	type StartApprovalWorkflowInput,
	startApprovalWorkflow,
} from "./start-workflow";

const requesterEmployeeId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000002";
const approverEmployeeId = "00000000-0000-4000-8000-000000000003";
const policyId = "00000000-0000-4000-8000-000000000010";
const policyStageId = "00000000-0000-4000-8000-000000000011";
const policyConditionId = "00000000-0000-4000-8000-000000000012";

function matchingPolicy() {
	return {
		id: policyId,
		organizationId: "org-1",
		name: "Absence approvals",
		isActive: true,
		priority: 1,
		conditions: [
			{
				id: policyConditionId,
				organizationId: "org-1",
				policyId,
				conditionType: "approval_type",
				operator: "equals",
				value: "absence",
			},
		],
		stages: [
			{
				id: policyStageId,
				organizationId: "org-1",
				policyId,
				stepOrder: 1,
				label: "Line manager",
				approverType: "direct_manager",
				approverEmployeeId: null,
				fallbackBehavior: "organization_admin",
			},
		],
	};
}

function policyStage(stepOrder: number) {
	return {
		id: `00000000-0000-4000-8000-${String(20 + stepOrder).padStart(12, "0")}`,
		organizationId: "org-1",
		policyId,
		stepOrder,
		label: `Stage ${stepOrder}`,
		approverType: "direct_manager",
		approverEmployeeId: null,
		fallbackBehavior: "fail",
	};
}

function scopedId(value: number) {
	return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function policyCondition(index: number) {
	return {
		id: scopedId(1_000 + index),
		organizationId: "org-1",
		policyId,
		conditionType: "approval_type",
		operator: "equals",
		value: "absence",
	};
}

function input(mode: ApprovalWorkflowLifecycleMode = "canonical") {
	const calls: string[] = [];
	const acquire = vi.fn(async () => {
		calls.push("gate");
		return {
			mode,
			behavior: {
				serveFrom: mode === "complete" ? "canonical" : "legacy",
				writeLegacy: mode !== "complete",
				writeCanonical: mode === "canonical" || mode === "complete",
				decideCanonical: mode === "canonical" || mode === "complete",
				mirror: "none",
			},
		};
	});
	const execute = vi.fn(async () => ({ rows: [{ policies: [] }] }));
	const createInitialWorkflow = vi.fn(
		async (
			initialInput: Parameters<
				typeof validateInitialApprovalWorkflowPersistenceInput
			>[0],
		) => {
			calls.push("persist");
			const validated =
				validateInitialApprovalWorkflowPersistenceInput(initialInput);
			return { kind: "created" as const, snapshot: validated.snapshot };
		},
	);
	const loadSnapshot = vi.fn(async () => {
		throw Object.assign(new Error("not found"), { code: "not_found" });
	});
	const findInitialWorkflow = vi.fn(async () => {
		calls.push("preflight");
		return { kind: "none" as const };
	});
	const resolve = vi.fn(
		async ({ organizationId, workflow, stage }: StageActivationInput) => ({
			organizationId,
			workflowId: workflow.id,
			stageId: stage.id,
			activationMode: "human",
			assignments: [{ approverEmployeeId, metadata: {} }],
		}),
	);
	const projectionWrite = vi.fn(async () => {
		calls.push("projection");
	});
	const outboxWrite = vi.fn(async () => {
		calls.push("outbox");
		return { kind: "inserted" as const, id: "outbox-1" };
	});
	const mirrorCanonicalToLegacy = vi.fn();
	const mirrorLegacyToCanonical = vi.fn();
	const bindSourceWorkflow = vi.fn(async (workflowId: string) => {
		calls.push("bind");
		return {
			organizationId: "org-1",
			sourceType: "absence_entry",
			sourceId,
			workflowId,
			affectedRows: 1,
		};
	});
	const verifySourceWorkflow = vi.fn(async (workflowId: string) => {
		calls.push("verify");
		return {
			organizationId: "org-1",
			sourceType: "absence_entry",
			sourceId,
			workflowId,
			affectedRows: 1,
		};
	});
	return {
		calls,
		acquire,
		execute,
		createInitialWorkflow,
		loadSnapshot,
		findInitialWorkflow,
		resolve,
		projectionWrite,
		outboxWrite,
		mirrorCanonicalToLegacy,
		mirrorLegacyToCanonical,
		bindSourceWorkflow,
		verifySourceWorkflow,
		value: {
			context: {
				dbService: { db: { execute } },
				writeGate: { acquire },
				repository: {
					createInitialWorkflow,
					findInitialWorkflow,
					loadSnapshot,
				},
				activationResolver: { resolve },
				projectionWriter: { write: projectionWrite },
				outboxWriter: { write: outboxWrite },
				compatibilityWriter: {
					withWriteGate() {
						return this;
					},
					mirrorCanonicalToLegacy,
					mirrorLegacyToCanonical,
				},
			} as unknown as ApprovalWorkflowTransactionContext,
			organizationId: "org-1",
			workflowType: "absence" as const,
			sourceIdentity: {
				organizationId: "org-1",
				workflowType: "absence" as const,
				sourceType: "absence_entry",
				sourceId,
			},
			requesterEmployeeId,
			actor: { kind: "system" as const, employeeId: null, userId: null },
			submissionKey: "absence-submit:1",
			defaultApproverEmployeeId: approverEmployeeId,
			routingContext: {
				organizationId: "org-1",
				workflowType: "absence" as const,
				source: { type: "absence_entry", id: sourceId },
				requesterEmployeeId,
				teamIds: [],
				locationId: null,
				absenceCategoryId: null,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
			},
			displayProjection: {
				displayPayload: { title: "Vacation" },
				searchText: "vacation",
			},
			bindSourceWorkflow,
			verifySourceWorkflow,
		},
	};
}

describe("startApprovalWorkflow", () => {
	it("exports the transaction-bound start boundary", () => {
		expect(startApprovalWorkflow).toBeTypeOf("function");
	});

	it("uses the injected submission instant", async () => {
		const fixture = input();
		const submittedAt = Temporal.Instant.from("2026-07-20T12:00:00Z");

		const result = await startApprovalWorkflow({
			...fixture.value,
			nowInstant: () => submittedAt,
		});

		expect(result.snapshot.submittedAt).toEqual(submittedAt);
	});

	it("gives the context finalizer one detached frozen workflow view", async () => {
		const fixture = input();
		let returnedContext: Record<string, unknown> | undefined;
		const finalizeContextSnapshot = vi.fn(
			({
				snapshot,
				contextSnapshot,
			}: {
				snapshot: ApprovalWorkflowSnapshot;
				contextSnapshot: Record<string, unknown>;
			}) => {
				fixture.calls.push("finalize");
				const stage = snapshot.stages[0];
				const assignment = stage?.assignments[0];
				const mutations = [
					() => Object.assign(snapshot, { id: "forged-workflow" }),
					() => Object.assign(snapshot, { organizationId: "org-forged" }),
					() => Object.assign(snapshot, { workflowType: "travel_expense" }),
					() =>
						Object.assign(snapshot, {
							sourceType: "forged_source",
							sourceId: scopedId(999),
						}),
					() => Object.assign(snapshot, { requesterEmployeeId: scopedId(998) }),
					() => Object.assign(snapshot, { policySnapshot: { forged: true } }),
					() => Object.assign(snapshot, { status: "approved", version: 99 }),
					() => snapshot.stages.splice(0),
					() =>
						stage &&
						Object.assign(stage, { id: "forged-stage", status: "approved" }),
					() =>
						assignment &&
						Object.assign(assignment, { id: "forged-assignment" }),
					() =>
						Object.assign(contextSnapshot, { organizationId: "org-forged" }),
				];
				for (const mutate of mutations) expect(mutate).toThrow(TypeError);
				expect(Object.isFrozen(snapshot)).toBe(true);
				expect(Object.isFrozen(snapshot.policySnapshot)).toBe(true);
				expect(Object.isFrozen(snapshot.stages)).toBe(true);
				expect(Object.isFrozen(stage)).toBe(true);
				expect(Object.isFrozen(assignment)).toBe(true);
				expect(Object.isFrozen(contextSnapshot)).toBe(true);
				returnedContext = { ...contextSnapshot, finalized: true };
				return returnedContext;
			},
		);

		const result = await startApprovalWorkflow({
			...fixture.value,
			finalizeContextSnapshot,
		});

		expect(finalizeContextSnapshot).toHaveBeenCalledOnce();
		expect(result.snapshot).toMatchObject({
			organizationId: "org-1",
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId,
			requesterEmployeeId,
			status: "pending",
			version: 1,
			contextSnapshot: expect.objectContaining({ finalized: true }),
		});
		expect(result.snapshot.id).not.toBe("forged-workflow");
		expect(result.snapshot.policySnapshot).not.toEqual({ forged: true });
		expect(result.snapshot.stages).toHaveLength(1);
		expect(result.snapshot.stages[0]?.id).not.toBe("forged-stage");
		expect(result.snapshot.stages[0]?.assignments[0]?.id).not.toBe(
			"forged-assignment",
		);
		expect(Object.isFrozen(result.snapshot.contextSnapshot)).toBe(true);
		if (!returnedContext) throw new Error("Expected finalizer return value");
		expect(() =>
			Object.assign(returnedContext, { finalized: false }),
		).not.toThrow();
		expect(result.snapshot.contextSnapshot.finalized).toBe(true);
		expect(fixture.calls.indexOf("finalize")).toBeLessThan(
			fixture.calls.indexOf("persist"),
		);
	});

	it.each([
		["null", () => null],
		["array", () => []],
		[
			"accessor",
			() =>
				Object.defineProperty({}, "value", {
					enumerable: true,
					get: vi.fn(() => "forged"),
				}),
		],
		[
			"proxy",
			() =>
				new Proxy(
					{},
					{
						ownKeys: () => {
							throw new Error("proxy trap");
						},
					},
				),
		],
		[
			"throw",
			() => {
				throw new Error("hook failure");
			},
		],
	] as const)("rejects a %s context finalizer before every durable write", async (_label, finalizeContextSnapshot) => {
		const fixture = input();

		await expect(
			startApprovalWorkflow({
				...fixture.value,
				finalizeContextSnapshot: finalizeContextSnapshot as never,
			}),
		).rejects.toMatchObject({
			name: "ApprovalWorkflowStartError",
			code: "INVALID_INPUT",
		});

		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
		expect(fixture.projectionWrite).not.toHaveBeenCalled();
		expect(fixture.outboxWrite).not.toHaveBeenCalled();
		expect(fixture.mirrorCanonicalToLegacy).not.toHaveBeenCalled();
		expect(fixture.mirrorLegacyToCanonical).not.toHaveBeenCalled();
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("rejects %s before policy reads or effects", async (mode) => {
		const fixture = input(mode);

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "WRITE_GATE_REJECTED",
		});
		expect(fixture.acquire).toHaveBeenCalledOnce();
		expect(fixture.execute).not.toHaveBeenCalled();
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
	});

	it.each([
		"canonical",
		"complete",
	] as const)("passes the %s gate before reading policy", async (mode) => {
		const fixture = input(mode);

		await expect(startApprovalWorkflow(fixture.value)).resolves.toMatchObject({
			kind: "created",
		});
		expect(fixture.calls[0]).toBe("gate");
		expect(fixture.execute).toHaveBeenCalledOnce();
	});

	it("rejects a canonical label whose behavior is not canonical-complete", async () => {
		const fixture = input();
		fixture.acquire.mockResolvedValue({
			mode: "canonical",
			behavior: {
				serveFrom: "canonical",
				writeLegacy: false,
				writeCanonical: true,
				decideCanonical: false,
				mirror: "none",
			},
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "WRITE_GATE_REJECTED",
		});
		expect(fixture.execute).not.toHaveBeenCalled();
	});

	it.each([
		["organizationId", ""],
		["requesterEmployeeId", ""],
		["submissionKey", ""],
		["defaultApproverEmployeeId", ""],
	] as const)("rejects an invalid %s before acquiring the gate", async (field, value) => {
		const fixture = input();
		const malformed = { ...fixture.value, [field]: value };

		await expect(startApprovalWorkflow(malformed)).rejects.toBeInstanceOf(
			ApprovalWorkflowStartError,
		);
		expect(fixture.acquire).not.toHaveBeenCalled();
	});

	it("rejects mismatched source and routing identities before callbacks", async () => {
		const fixture = input();
		const malformed = {
			...fixture.value,
			routingContext: {
				...fixture.value.routingContext,
				requesterEmployeeId: approverEmployeeId,
			},
		};

		await expect(startApprovalWorkflow(malformed)).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		expect(fixture.acquire).not.toHaveBeenCalled();
	});

	it("rejects malformed display JSON before callbacks", async () => {
		const fixture = input();
		const malformed = {
			...fixture.value,
			displayProjection: {
				...fixture.value.displayProjection,
				displayPayload: { value: Number.NaN },
			},
		};

		await expect(startApprovalWorkflow(malformed)).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		expect(fixture.acquire).not.toHaveBeenCalled();
	});

	it.each([
		["non-object display payload", { displayPayload: [], searchText: "" }],
		[
			"malformed routing amount",
			{ routingContext: { travelExpenseAmount: "100" } },
		],
	] as const)("rejects %s before callbacks", async (_name, override) => {
		const fixture = input();
		const value =
			"displayPayload" in override
				? { ...fixture.value, displayProjection: override }
				: {
						...fixture.value,
						routingContext: {
							...fixture.value.routingContext,
							...override.routingContext,
						},
					};

		await expect(
			startApprovalWorkflow(value as unknown as StartApprovalWorkflowInput),
		).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		expect(fixture.acquire).not.toHaveBeenCalled();
	});

	it("creates a default human route and performs transaction effects in order", async () => {
		const fixture = input();

		const result = await startApprovalWorkflow(fixture.value);

		expect(result.kind).toBe("created");
		expect(result.status).toBe("pending");
		expect(result.terminal).toBe(false);
		expect(result.snapshot.stages).toHaveLength(1);
		expect(result.snapshot.stages[0]).toMatchObject({
			sequence: 1,
			label: "Approval",
			resolverSnapshot: {
				approverType: "specific_employee",
				fallbackBehavior: "fail",
				approverEmployeeId,
			},
			activationMode: "human",
			status: "pending",
		});
		expect(result.snapshot.stages[0]?.assignments[0]).toMatchObject({
			approverEmployeeId,
			status: "pending",
		});
		expect(result.snapshot.displaySnapshot).toEqual({
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
		});
		expect(result.projection).toMatchObject({
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
		});
		expect(result.events.map((event) => event.eventType)).toEqual([
			"assignment.created",
			"stage.activated",
		]);
		expect(fixture.resolve).toHaveBeenCalledWith(
			expect.objectContaining({
				dbService: fixture.value.context.dbService,
				organizationId: "org-1",
				routingContext: fixture.value.routingContext,
				actor: { kind: "system", employeeId: null, userId: null },
			}),
		);
		expect(fixture.calls).toEqual([
			"gate",
			"preflight",
			"persist",
			"bind",
			"projection",
			"outbox",
			"outbox",
		]);
		expect(result.projection.activeInboxStage).toEqual({
			stageId: result.snapshot.stages[0]?.id,
			stageOrder: 1,
		});
		expect(result.outbox).toHaveLength(2);
		expect(result.outbox.every((item) => item.disposition === "observe")).toBe(
			true,
		);
	});

	it("persists a detached private context while routing with strict generic keys", async () => {
		const fixture = input();
		const privateContext = {
			...fixture.value.routingContext,
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: scopedId(9001),
			},
		};

		const result = await startApprovalWorkflow({
			...fixture.value,
			contextSnapshot: privateContext,
		} as StartApprovalWorkflowInput);

		expect(result.snapshot.contextSnapshot).toEqual(privateContext);
		expect(result.snapshot.contextSnapshot).not.toBe(privateContext);
		expect(fixture.resolve).toHaveBeenCalledWith(
			expect.objectContaining({ routingContext: fixture.value.routingContext }),
		);
		expect(
			fixture.resolve.mock.calls[0]?.[0].routingContext,
		).not.toHaveProperty("timeCorrection");
		expect(fixture.findInitialWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({ contextSnapshot: privateContext }),
		);
	});

	it("keeps payload fields that collide with envelope keys isolated from search text", async () => {
		const fixture = input();
		fixture.value.displayProjection = {
			displayPayload: {
				displayPayload: { title: "Payload-owned" },
				searchText: "payload-owned text",
			},
			searchText: "indexed text",
		};

		const result = await startApprovalWorkflow(fixture.value);

		expect(result.snapshot.displaySnapshot).toEqual({
			displayPayload: {
				displayPayload: { title: "Payload-owned" },
				searchText: "payload-owned text",
			},
			searchText: "indexed text",
		});
		expect(result.projection).toMatchObject(fixture.value.displayProjection);
	});

	it("returns a preflight existing workflow before policy or reviewer reads", async () => {
		const seed = await startApprovalWorkflow(input().value);
		const fixture = input();
		fixture.findInitialWorkflow.mockImplementation(async () => {
			fixture.calls.push("preflight");
			return { kind: "existing" as const, snapshot: seed.snapshot };
		});
		fixture.execute.mockRejectedValue(new Error("changed policy"));
		fixture.resolve.mockRejectedValue(new Error("changed directory"));

		const result = await startApprovalWorkflow(fixture.value);

		expect(result).toMatchObject({
			kind: "existing",
			status: seed.status,
			terminal: seed.terminal,
			snapshot: seed.snapshot,
			events: [],
			outbox: [],
			outboxResults: [],
		});
		expect(fixture.calls).toEqual(["gate", "preflight", "verify"]);
		expect(fixture.findInitialWorkflow).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId,
			submissionKey: "absence-submit:1",
			requesterEmployeeId,
			contextSnapshot: fixture.value.routingContext,
			displaySnapshot: fixture.value.displayProjection,
		});
		const preflight = fixture.findInitialWorkflow.mock.calls[0]?.[0];
		expect(preflight?.contextSnapshot).not.toBe(fixture.value.routingContext);
		expect(preflight?.displaySnapshot).not.toBe(
			fixture.value.displayProjection,
		);
		expect(fixture.execute).not.toHaveBeenCalled();
		expect(fixture.resolve).not.toHaveBeenCalled();
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
		expect(fixture.projectionWrite).not.toHaveBeenCalled();
		expect(fixture.outboxWrite).not.toHaveBeenCalled();
	});

	it("replays an exact terminal workflow without planning or rebinding", async () => {
		const seedFixture = input();
		const policy = matchingPolicy();
		policy.stages = [policyStage(1)];
		seedFixture.execute.mockResolvedValue({ rows: [{ policies: [policy] }] });
		seedFixture.resolve.mockImplementation(
			async ({ organizationId, workflow, stage }: StageActivationInput) => ({
				organizationId,
				workflowId: workflow.id,
				stageId: stage.id,
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
		);
		const terminal = await startApprovalWorkflow({
			...seedFixture.value,
			defaultApproverEmployeeId: null,
		});
		const fixture = input();
		fixture.findInitialWorkflow.mockImplementation(async () => {
			fixture.calls.push("preflight");
			return { kind: "existing" as const, snapshot: terminal.snapshot };
		});
		fixture.execute.mockRejectedValue(new Error("policy must not be loaded"));
		fixture.resolve.mockRejectedValue(new Error("route must not be planned"));

		const replay = await startApprovalWorkflow(fixture.value);

		expect(replay).toMatchObject({
			kind: "existing",
			terminal: true,
			status: "approved",
			snapshot: terminal.snapshot,
			events: [],
			outbox: [],
		});
		expect(fixture.calls).toEqual(["gate", "preflight", "verify"]);
		expect(fixture.execute).not.toHaveBeenCalled();
		expect(fixture.resolve).not.toHaveBeenCalled();
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
	});

	it("starts and binds a new cycle after repository terminal history", async () => {
		const fixture = input();
		fixture.value.submissionKey = "absence-submit:later-cycle";

		const result = await startApprovalWorkflow(fixture.value);

		expect(result.kind).toBe("created");
		expect(fixture.findInitialWorkflow).toHaveBeenCalledOnce();
		expect(fixture.bindSourceWorkflow).toHaveBeenCalledWith(result.snapshot.id);
		expect(fixture.verifySourceWorkflow).not.toHaveBeenCalled();
	});

	it("returns source conflict for stale terminal replay after the source link moved", async () => {
		const fixture = input();
		fixture.findInitialWorkflow.mockImplementation(async () => {
			fixture.calls.push("preflight");
			return { kind: "source_conflict" as const };
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "SOURCE_CONFLICT",
		});
		expect(fixture.calls).toEqual(["gate", "preflight"]);
		expect(fixture.verifySourceWorkflow).not.toHaveBeenCalled();
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
	});

	it.each([
		[
			"requester",
			(fixture: ReturnType<typeof input>) => ({
				...fixture.value,
				requesterEmployeeId: "00000000-0000-4000-8000-000000000099",
				routingContext: {
					...fixture.value.routingContext,
					requesterEmployeeId: "00000000-0000-4000-8000-000000000099",
				},
			}),
		],
		[
			"routing context",
			(fixture: ReturnType<typeof input>) => ({
				...fixture.value,
				routingContext: {
					...fixture.value.routingContext,
					overtimeRisk: "warning" as const,
				},
			}),
		],
		[
			"display snapshot",
			(fixture: ReturnType<typeof input>) => ({
				...fixture.value,
				displayProjection: {
					...fixture.value.displayProjection,
					displayPayload: { title: "Changed" },
				},
			}),
		],
	] as const)("passes changed immutable %s evidence to preflight", async (_name, build) => {
		const fixture = input();
		const value = build(fixture);
		let observed:
			| Parameters<
					typeof fixture.value.context.repository.findInitialWorkflow
			  >[0]
			| null = null;
		fixture.findInitialWorkflow.mockImplementation(async (preflight) => {
			fixture.calls.push("preflight");
			observed = preflight;
			return { kind: "source_conflict" as const };
		});

		await expect(startApprovalWorkflow(value)).rejects.toMatchObject({
			code: "SOURCE_CONFLICT",
		});
		expect(observed).toMatchObject({
			requesterEmployeeId: value.requesterEmployeeId,
			contextSnapshot: value.routingContext,
			displaySnapshot: value.displayProjection,
		});
		expect(observed?.contextSnapshot).not.toBe(value.routingContext);
		expect(observed?.displaySnapshot).not.toBe(value.displayProjection);
		expect(fixture.execute).not.toHaveBeenCalled();
	});

	it("returns a typed preflight source conflict before policy planning", async () => {
		const fixture = input();
		fixture.findInitialWorkflow.mockImplementation(async () => {
			fixture.calls.push("preflight");
			return { kind: "source_conflict" as const };
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "SOURCE_CONFLICT",
		});
		expect(fixture.execute).not.toHaveBeenCalled();
		expect(fixture.resolve).not.toHaveBeenCalled();
	});

	it("serializes a concurrent loser onto the winner without replanning changed inputs", async () => {
		const now = vi
			.spyOn(Temporal.Now, "instant")
			.mockReturnValue(Temporal.Instant.from("2026-07-19T09:00:00Z"));
		try {
			const winner = input();
			const loser = input();
			let persistedSnapshot: ApprovalWorkflowSnapshot | undefined;
			let releaseWinner!: () => void;
			let markWinnerEntered!: () => void;
			let markLoserWaiting!: () => void;
			let releasePersisted!: () => void;
			const winnerBarrier = new Promise<void>((resolve) => {
				releaseWinner = resolve;
			});
			const winnerEntered = new Promise<void>((resolve) => {
				markWinnerEntered = resolve;
			});
			const loserWaiting = new Promise<void>((resolve) => {
				markLoserWaiting = resolve;
			});
			const persisted = new Promise<void>((resolve) => {
				releasePersisted = resolve;
			});
			winner.resolve.mockImplementation(
				async (activation: StageActivationInput) => {
					markWinnerEntered();
					await winnerBarrier;
					return {
						organizationId: activation.organizationId,
						workflowId: activation.workflow.id,
						stageId: activation.stage.id,
						activationMode: "human",
						assignments: [{ approverEmployeeId, metadata: {} }],
					};
				},
			);
			winner.createInitialWorkflow.mockImplementation(async (initialInput) => {
				winner.calls.push("persist");
				const validated =
					validateInitialApprovalWorkflowPersistenceInput(initialInput);
				persistedSnapshot = validated.snapshot;
				releasePersisted();
				return { kind: "created" as const, snapshot: validated.snapshot };
			});
			loser.findInitialWorkflow.mockImplementation(async () => {
				loser.calls.push("preflight");
				markLoserWaiting();
				await persisted;
				if (!persistedSnapshot) throw new Error("missing persisted winner");
				return { kind: "existing" as const, snapshot: persistedSnapshot };
			});
			loser.execute.mockRejectedValue(
				new Error("changed policy must not load"),
			);
			loser.resolve.mockRejectedValue(
				new Error("changed directory must not load"),
			);

			const winningStart = startApprovalWorkflow(winner.value);
			await winnerEntered;
			now.mockReturnValue(Temporal.Instant.from("2036-07-19T09:00:00Z"));
			const losingStart = startApprovalWorkflow(loser.value);
			await loserWaiting;
			let loserSettled = false;
			void losingStart.finally(() => {
				loserSettled = true;
			});
			await Promise.resolve();
			expect(loserSettled).toBe(false);

			releaseWinner();
			const [won, lost] = await Promise.all([winningStart, losingStart]);

			expect(won.kind).toBe("created");
			expect(lost).toMatchObject({
				kind: "existing",
				snapshot: won.snapshot,
				events: [],
				outbox: [],
			});
			expect(loser.execute).not.toHaveBeenCalled();
			expect(loser.resolve).not.toHaveBeenCalled();
			expect(loser.createInitialWorkflow).not.toHaveBeenCalled();
			expect(now).toHaveBeenCalledOnce();
		} finally {
			now.mockRestore();
		}
	});

	it("rejects a missing default before activation, persistence, or binding", async () => {
		const fixture = input();
		const value = { ...fixture.value, defaultApproverEmployeeId: null };

		await expect(startApprovalWorkflow(value)).rejects.toMatchObject({
			code: "NO_DEFAULT_APPROVER",
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
	});

	it("uses the active matching policy with exact ordered labels and resolver snapshots", async () => {
		const fixture = input();
		fixture.execute.mockResolvedValue({
			rows: [{ policies: [matchingPolicy()] }],
		});
		const value = { ...fixture.value, defaultApproverEmployeeId: null };

		const result = await startApprovalWorkflow(value);

		expect(result.snapshot.policySnapshot).toMatchObject({
			id: policyId,
			name: "Absence approvals",
		});
		expect(result.snapshot.stages[0]).toMatchObject({
			label: "Line manager",
			resolverSnapshot: {
				approverType: "direct_manager",
				fallbackBehavior: "organization_admin",
			},
		});
		expect(result.snapshot.stages[0]?.resolverSnapshot).not.toHaveProperty(
			"approverEmployeeId",
		);
	});

	it("activates a matched policy through the database resolver with scoped directory data", async () => {
		const fixture = input();
		fixture.execute
			.mockResolvedValueOnce({ rows: [{ policies: [matchingPolicy()] }] })
			.mockResolvedValueOnce({
				rows: [
					{
						employees: [
							{
								id: requesterEmployeeId,
								organizationId: "org-1",
								isActive: true,
								role: "employee",
							},
							{
								id: approverEmployeeId,
								organizationId: "org-1",
								isActive: true,
								role: "manager",
							},
						],
						managerLinks: [
							{
								employeeId: requesterEmployeeId,
								managerId: approverEmployeeId,
								isPrimary: true,
							},
						],
						teamMemberships: [],
						teams: [],
					},
				],
			});
		const value = {
			...fixture.value,
			defaultApproverEmployeeId: null,
			context: {
				...fixture.value.context,
				activationResolver: createDatabaseStageActivationResolver(),
			},
		};

		const result = await startApprovalWorkflow(value);

		expect(result.snapshot.stages[0]?.assignments).toEqual([
			expect.objectContaining({ approverEmployeeId }),
		]);
		expect(fixture.execute).toHaveBeenCalledTimes(2);
	});

	it.each([
		{
			name: "foreign policy",
			mutate: (policy: ReturnType<typeof matchingPolicy>) => ({
				...policy,
				organizationId: "org-2",
			}),
		},
		{
			name: "foreign stage",
			mutate: (policy: ReturnType<typeof matchingPolicy>) => ({
				...policy,
				stages: [{ ...policyStage(1), organizationId: "org-2" }],
			}),
		},
		{
			name: "malformed stage",
			mutate: (policy: ReturnType<typeof matchingPolicy>) => ({
				...policy,
				stages: [{ ...policyStage(1), label: "" }],
			}),
		},
	] as const)("fails closed for a $name row", async ({ mutate }) => {
		const fixture = input();
		fixture.execute.mockResolvedValue({
			rows: [{ policies: [mutate(matchingPolicy())] }],
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
	});

	it("fails closed for duplicate policy rows", async () => {
		const fixture = input();
		fixture.execute.mockResolvedValue({
			rows: [{ policies: [matchingPolicy(), matchingPolicy()] }],
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
	});

	it.each([
		[
			"irrelevant equals values",
			{
				...matchingPolicy().conditions[0],
				values: ["absence"],
			},
		],
		[
			"irrelevant amount field",
			{
				...matchingPolicy().conditions[0],
				amountMin: 1,
			},
		],
		[
			"type/operator conflict",
			{
				...matchingPolicy().conditions[0],
				conditionType: "travel_expense_amount",
				operator: "equals",
			},
		],
	] as const)("rejects condition shape with %s", async (_name, condition) => {
		const fixture = input();
		fixture.execute.mockResolvedValue({
			rows: [
				{
					policies: [{ ...matchingPolicy(), conditions: [condition] }],
				},
			],
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
	});

	it.each([
		[
			"team_lead",
			{
				...policyStage(1),
				approverType: "team_lead",
			},
		],
		[
			"missing specific employee",
			{
				...policyStage(1),
				approverType: "specific_employee",
			},
		],
		[
			"extra employee on canonical resolver",
			{
				...policyStage(1),
				approverEmployeeId,
			},
		],
	] as const)("rejects non-canonical resolver shape: %s", async (_name, stage) => {
		const fixture = input();
		fixture.execute.mockResolvedValue({
			rows: [
				{
					policies: [{ ...matchingPolicy(), stages: [stage] }],
				},
			],
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
	});

	it.each([
		[
			"policies",
			"policies",
			() =>
				Array.from(
					{ length: APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxPolicies + 1 },
					(_, index) => ({
						...matchingPolicy(),
						id: scopedId(2_000 + index),
						priority: index,
						conditions: [],
						stages: [
							{
								...policyStage(1),
								id: scopedId(3_000 + index),
								policyId: scopedId(2_000 + index),
							},
						],
					}),
				),
		],
		[
			"conditions",
			"policy.conditions",
			() => [
				{
					...matchingPolicy(),
					conditions: Array.from(
						{
							length:
								APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxConditionsPerPolicy +
								1,
						},
						(_, index) => policyCondition(index),
					),
				},
			],
		],
		[
			"stages",
			"policy.stages",
			() => [
				{
					...matchingPolicy(),
					stages: Array.from(
						{
							length:
								APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxStagesPerPolicy + 1,
						},
						(_, index) => policyStage(index + 1),
					),
				},
			],
		],
	] as const)("rejects policy input exceeding the %s bound", async (_name, field, policies) => {
		const fixture = input();
		fixture.execute.mockResolvedValue({ rows: [{ policies: policies() }] });

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
			details: { field },
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
	});

	it("rejects policy input exceeding the aggregate decoded-row bound", async () => {
		const fixture = input();
		const rowsPerPolicy =
			APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxConditionsPerPolicy +
			APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxStagesPerPolicy +
			1;
		const policyCount =
			Math.floor(
				APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxAggregateRows / rowsPerPolicy,
			) + 1;
		const policies = Array.from({ length: policyCount }, (_, policyIndex) => {
			const id = scopedId(4_000 + policyIndex);
			return {
				...matchingPolicy(),
				id,
				priority: policyIndex,
				conditions: Array.from(
					{
						length:
							APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxConditionsPerPolicy,
					},
					(_, conditionIndex) => ({
						...policyCondition(policyIndex * 100 + conditionIndex),
						policyId: id,
					}),
				),
				stages: Array.from(
					{ length: APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxStagesPerPolicy },
					(_, stageIndex) => ({
						...policyStage(stageIndex + 1),
						id: scopedId(20_000 + policyIndex * 100 + stageIndex),
						policyId: id,
					}),
				),
			};
		});
		fixture.execute.mockResolvedValue({ rows: [{ policies }] });

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
			details: { field: "policy.aggregate" },
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
	});

	it("rejects a policy JSON envelope exceeding the byte bound", async () => {
		const fixture = input();
		fixture.execute.mockResolvedValue({
			rows: [
				{
					policies: [
						{
							...matchingPolicy(),
							name: "x".repeat(
								APPROVAL_WORKFLOW_START_POLICY_LIMITS.maxJsonBytes + 1,
							),
						},
					],
				},
			],
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "INVALID_POLICY",
			details: { field: "policy.json" },
		});
		expect(fixture.resolve).not.toHaveBeenCalled();
	});

	it("drains consecutive requester-auto stages before activating a human stage", async () => {
		const fixture = input();
		const policy = matchingPolicy();
		policy.stages = [policyStage(1), policyStage(2), policyStage(3)];
		fixture.execute.mockResolvedValue({ rows: [{ policies: [policy] }] });
		fixture.resolve.mockImplementation(
			async ({ organizationId, workflow, stage }: StageActivationInput) => ({
				organizationId,
				workflowId: workflow.id,
				stageId: stage.id,
				activationMode: stage.sequence < 3 ? "requester_auto_approve" : "human",
				assignments:
					stage.sequence < 3 ? [] : [{ approverEmployeeId, metadata: {} }],
			}),
		);

		const result = await startApprovalWorkflow({
			...fixture.value,
			defaultApproverEmployeeId: null,
		});

		expect(result.snapshot.stages.map((stage) => stage.status)).toEqual([
			"approved",
			"approved",
			"pending",
		]);
		expect(result.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"workflow.activation_requested",
			"stage.auto_approved",
			"workflow.activation_requested",
			"assignment.created",
			"stage.activated",
		]);
		expect(fixture.resolve).toHaveBeenCalledTimes(3);
	});

	it("returns terminal approval for an all-auto route without finalizing the source", async () => {
		const fixture = input();
		const policy = matchingPolicy();
		policy.stages = [policyStage(1), policyStage(2)];
		fixture.execute.mockResolvedValue({ rows: [{ policies: [policy] }] });
		fixture.resolve.mockImplementation(
			async ({ organizationId, workflow, stage }: StageActivationInput) => ({
				organizationId,
				workflowId: workflow.id,
				stageId: stage.id,
				activationMode: "requester_auto_approve",
				assignments: [],
			}),
		);

		const result = await startApprovalWorkflow({
			...fixture.value,
			defaultApproverEmployeeId: null,
		});

		expect(result).toMatchObject({ status: "approved", terminal: true });
		expect(result.events.map((event) => event.eventType)).toEqual([
			"stage.auto_approved",
			"workflow.activation_requested",
			"stage.auto_approved",
			"workflow.approved",
		]);
		expect(result.projection.activeInboxStage).toBeNull();
		expect(result.snapshot.completedAt).not.toBeNull();
	});

	it("fails closed when the activation resolver returns foreign scope", async () => {
		const fixture = input();
		fixture.resolve.mockImplementation(
			async ({ workflow, stage }: StageActivationInput) => ({
				organizationId: "org-2",
				workflowId: workflow.id,
				stageId: stage.id,
				activationMode: "human",
				assignments: [{ approverEmployeeId, metadata: {} }],
			}),
		);

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "ACTIVATION_FAILED",
		});
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
	});

	it.each([
		"no_eligible_reviewer",
		"invalid_stage_resolver",
	] as const)("wraps %s resolver failures without raw error data", async (activationCode) => {
		const fixture = input();
		fixture.execute
			.mockResolvedValueOnce({ rows: [{ policies: [matchingPolicy()] }] })
			.mockResolvedValueOnce(
				activationCode === "no_eligible_reviewer"
					? {
							rows: [
								{
									employees: [
										{
											id: requesterEmployeeId,
											organizationId: "org-1",
											isActive: true,
											role: "employee",
										},
									],
									managerLinks: [],
									teamMemberships: [],
									teams: [],
								},
							],
						}
					: { rows: [] },
			);
		const value = {
			...fixture.value,
			defaultApproverEmployeeId: null,
			context: {
				...fixture.value.context,
				activationResolver: createDatabaseStageActivationResolver(),
			},
		};

		const failure = await startApprovalWorkflow(value).catch(
			(error: unknown) => error,
		);

		expect(failure).toBeInstanceOf(ApprovalWorkflowStartError);
		expect(failure).toMatchObject({
			code: "ACTIVATION_FAILED",
			details: { activationCode },
			message: "Approval workflow start: ACTIVATION_FAILED",
		});
		expect((failure as Error).cause).toBeUndefined();
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
	});

	it("wraps activation planning failures without exposing state-machine data", async () => {
		const fixture = input();
		fixture.resolve.mockImplementation(
			async ({ organizationId, workflow, stage }: StageActivationInput) => ({
				organizationId,
				workflowId: workflow.id,
				stageId: stage.id,
				activationMode: "human",
				assignments: [],
			}),
		);

		const failure = await startApprovalWorkflow(fixture.value).catch(
			(error: unknown) => error,
		);

		expect(failure).toMatchObject({
			code: "ACTIVATION_FAILED",
			details: { activationCode: "invalid_activation_plan" },
		});
		expect((failure as Error).cause).toBeUndefined();
	});

	it("passes deeply detached frozen resolver inputs without tainting persistence", async () => {
		const fixture = input();
		const mutationResults: boolean[] = [];
		let resolverWorkflow: ApprovalWorkflowSnapshot | undefined;
		fixture.resolve.mockImplementation(
			async (activation: StageActivationInput) => {
				resolverWorkflow = activation.workflow;
				mutationResults.push(
					Reflect.set(
						activation.workflow,
						"requesterEmployeeId",
						approverEmployeeId,
					),
					Reflect.set(activation.workflow.policySnapshot, "kind", "mutated"),
					Reflect.set(
						activation.workflow.contextSnapshot,
						"organizationId",
						"org-2",
					),
					Reflect.set(activation.workflow.displaySnapshot, "title", "mutated"),
					Reflect.set(activation.stage, "status", "approved"),
					Reflect.set(activation.stage.assignments, "0", {}),
					Reflect.set(activation.workflow.stages, "1", activation.stage),
					Reflect.set(activation.routingContext, "organizationId", "org-2"),
					Reflect.set(
						activation.routingContext.source as Record<string, unknown>,
						"id",
						approverEmployeeId,
					),
					Reflect.set(
						activation.routingContext.teamIds as unknown[],
						"0",
						approverEmployeeId,
					),
				);
				return {
					organizationId: activation.organizationId,
					workflowId: activation.workflow.id,
					stageId: activation.stage.id,
					activationMode: "human",
					assignments: [{ approverEmployeeId, metadata: {} }],
				};
			},
		);

		const result = await startApprovalWorkflow(fixture.value);

		expect(mutationResults).toEqual(Array.from({ length: 10 }, () => false));
		expect(resolverWorkflow).not.toBe(result.snapshot);
		expect(resolverWorkflow?.stages[0]).not.toBe(result.snapshot.stages[0]);
		expect(result.snapshot).toMatchObject({
			requesterEmployeeId,
			policySnapshot: {
				kind: "default",
				defaultApproverEmployeeId: approverEmployeeId,
			},
			contextSnapshot: { organizationId: "org-1" },
			displaySnapshot: {
				displayPayload: { title: "Vacation" },
				searchText: "vacation",
			},
		});
		expect(result.snapshot.stages).toHaveLength(1);
		expect(result.snapshot.stages[0]).toMatchObject({
			status: "pending",
			assignments: [expect.objectContaining({ approverEmployeeId })],
		});
	});

	it("wraps an uncaught resolver mutation without persisting tainted state", async () => {
		const fixture = input();
		fixture.resolve.mockImplementation(
			async (activation: StageActivationInput) => {
				activation.workflow.stages.push(activation.stage);
				return {
					organizationId: activation.organizationId,
					workflowId: activation.workflow.id,
					stageId: activation.stage.id,
					activationMode: "human",
					assignments: [{ approverEmployeeId, metadata: {} }],
				};
			},
		);

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "ACTIVATION_FAILED",
			details: { activationCode: "resolver_failure" },
		});
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
	});

	it("rejects resolver-induced graph growth before it can cycle", async () => {
		const fixture = input();
		fixture.resolve.mockImplementation(
			async (activation: StageActivationInput) => {
				const sequence = activation.stage.sequence + 1;
				activation.workflow.stages.push({
					id: `00000000-0000-4000-8000-${String(100 + sequence).padStart(12, "0")}`,
					organizationId: activation.organizationId,
					workflowId: activation.workflow.id,
					sequence,
					label: `Injected ${sequence}`,
					resolverSnapshot: {
						approverType: "specific_employee",
						fallbackBehavior: "fail",
						approverEmployeeId,
					},
					activationMode: "human",
					status: "waiting",
					activatedAt: null,
					decidedAt: null,
					decisionReason: null,
					legacyApprovalRequestId: null,
					assignments: [],
				});
				return {
					organizationId: activation.organizationId,
					workflowId: activation.workflow.id,
					stageId: activation.stage.id,
					activationMode: "requester_auto_approve",
					assignments: [],
				};
			},
		);

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "ACTIVATION_FAILED",
			details: { activationCode: "resolver_failure" },
		});
		expect(fixture.createInitialWorkflow).not.toHaveBeenCalled();
	});

	it("replays with Task 4 exact timestamps and does not duplicate effects", async () => {
		const fixture = input();
		let stored: ApprovalWorkflowSnapshot | undefined;
		fixture.findInitialWorkflow.mockImplementation(async () => {
			fixture.calls.push("preflight");
			return stored
				? { kind: "existing" as const, snapshot: stored }
				: { kind: "none" as const };
		});
		fixture.createInitialWorkflow.mockImplementation(
			async ({ snapshot }: { snapshot: ApprovalWorkflowSnapshot }) => {
				fixture.calls.push("persist");
				if (!stored) {
					stored = snapshot;
					return { kind: "created", snapshot };
				}
				return { kind: "source_conflict" };
			},
		);
		fixture.loadSnapshot.mockImplementation(async () => {
			if (stored) return stored;
			throw Object.assign(new Error("not found"), { code: "not_found" });
		});

		const first = await startApprovalWorkflow(fixture.value);
		await new Promise((resolve) => setTimeout(resolve, 2));
		const replay = await startApprovalWorkflow(fixture.value);

		expect(first.kind).toBe("created");
		expect(replay.kind).toBe("existing");
		expect(replay.snapshot).toBe(stored);
		expect(first.snapshot.displaySnapshot).toEqual({
			displayPayload: { title: "Vacation" },
			searchText: "vacation",
		});
		expect(replay.snapshot.displaySnapshot).toEqual(
			first.snapshot.displaySnapshot,
		);
		expect(fixture.bindSourceWorkflow).toHaveBeenCalledOnce();
		expect(fixture.verifySourceWorkflow).toHaveBeenCalledOnce();
		expect(fixture.projectionWrite).toHaveBeenCalledOnce();
		expect(fixture.outboxWrite).toHaveBeenCalledTimes(2);
	});

	it("rejects replay when the source link does not match", async () => {
		const fixture = input();
		fixture.createInitialWorkflow.mockImplementation(
			async ({ snapshot }: { snapshot: ApprovalWorkflowSnapshot }) => ({
				kind: "existing",
				snapshot,
			}),
		);
		fixture.verifySourceWorkflow.mockImplementation(async (workflowId) => ({
			organizationId: "org-1",
			sourceType: "absence_entry",
			sourceId,
			workflowId,
			affectedRows: 0,
		}));

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "SOURCE_BINDING_MISMATCH",
		});
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
		expect(fixture.projectionWrite).not.toHaveBeenCalled();
		expect(fixture.outboxWrite).not.toHaveBeenCalled();
	});

	it("turns repository source conflict into a typed start error", async () => {
		const fixture = input();
		fixture.createInitialWorkflow.mockResolvedValue({
			kind: "source_conflict",
		});

		await expect(startApprovalWorkflow(fixture.value)).rejects.toMatchObject({
			code: "SOURCE_CONFLICT",
		});
		expect(fixture.bindSourceWorkflow).not.toHaveBeenCalled();
	});

	it.each([
		[
			"binding",
			(fixture: ReturnType<typeof input>) =>
				fixture.bindSourceWorkflow.mockRejectedValue(new Error("bind")),
		],
		[
			"projection",
			(fixture: ReturnType<typeof input>) =>
				fixture.projectionWrite.mockRejectedValue(new Error("projection")),
		],
		[
			"outbox",
			(fixture: ReturnType<typeof input>) =>
				fixture.outboxWrite.mockRejectedValue(new Error("outbox")),
		],
	] as const)("propagates %s failure for transaction rollback", async (_name, inject) => {
		const fixture = input();
		inject(fixture);

		await expect(startApprovalWorkflow(fixture.value)).rejects.toBeInstanceOf(
			Error,
		);
		expect(fixture.createInitialWorkflow).toHaveBeenCalledOnce();
	});

	it("propagates terminal-link replacement failure before projections or outbox for rollback", async () => {
		const fixture = input();
		const cause = new Error("terminal source link replacement failed");
		fixture.bindSourceWorkflow.mockRejectedValue(cause);

		await expect(startApprovalWorkflow(fixture.value)).rejects.toBe(cause);
		expect(fixture.createInitialWorkflow).toHaveBeenCalledOnce();
		expect(fixture.bindSourceWorkflow).toHaveBeenCalledOnce();
		expect(fixture.projectionWrite).not.toHaveBeenCalled();
		expect(fixture.outboxWrite).not.toHaveBeenCalled();
	});

	it("does not mutate caller-owned routing or display inputs", async () => {
		const fixture = input();
		const before = JSON.stringify({
			sourceIdentity: fixture.value.sourceIdentity,
			routingContext: fixture.value.routingContext,
			displayProjection: fixture.value.displayProjection,
			actor: fixture.value.actor,
		});

		await startApprovalWorkflow(fixture.value);

		expect(
			JSON.stringify({
				sourceIdentity: fixture.value.sourceIdentity,
				routingContext: fixture.value.routingContext,
				displayProjection: fixture.value.displayProjection,
				actor: fixture.value.actor,
			}),
		).toBe(before);
	});

	it("derives deterministic aggregate, event, and outbox identities", async () => {
		const first = await startApprovalWorkflow(input().value);
		const second = await startApprovalWorkflow(input().value);

		expect(second.snapshot.id).toBe(first.snapshot.id);
		expect(second.snapshot.stages.map((stage) => stage.id)).toEqual(
			first.snapshot.stages.map((stage) => stage.id),
		);
		expect(
			second.snapshot.stages.flatMap((stage) =>
				stage.assignments.map((assignment) => assignment.id),
			),
		).toEqual(
			first.snapshot.stages.flatMap((stage) =>
				stage.assignments.map((assignment) => assignment.id),
			),
		);
		expect(second.events.map((event) => event.id)).toEqual(
			first.events.map((event) => event.id),
		);
		expect(second.outbox.map((item) => item.dedupeKey)).toEqual(
			first.outbox.map((item) => item.dedupeKey),
		);
	});
});
