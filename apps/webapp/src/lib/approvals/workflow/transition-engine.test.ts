import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type AbsenceApprovalSource,
	createAbsenceApprovalAdapter,
} from "../domain-adapters/absence.adapter";
import type {
	ApprovalDomainAdapter,
	ApprovalTerminalAdapterInput,
} from "../domain-adapters/types";
import { createOrdinaryWorkPeriodApprovalAdapter } from "../domain-adapters/work-period.adapter";
import type { OrdinaryWorkPeriodApprovalSource } from "../domain-adapters/work-period-contract";
import { getCutoverBehavior } from "./cutover";
import type {
	ApprovalCommandActorResolver,
	ApprovalCommandResult,
	ApprovalCutoverBehavior,
	ApprovalEngineClock,
	ApprovalMaterializedTransitionPlan,
	ApprovalTransitionResultBuilder,
	ApprovalWorkflowAuthorization,
	ApprovalWorkflowCommandRequest,
	ApprovalWorkflowLifecycleMode,
	ApprovalWorkflowPrincipal,
	ApprovalWorkflowSnapshot,
	ResolvedStage,
	StageActivationInput,
} from "./ports";
import type { ApprovalWorkflowCommand } from "./state-machine";

const stateMachineMocks = vi.hoisted(() => ({
	materializeApprovalTransitionPlan: vi.fn(),
	planStageActivation: vi.fn(),
}));

vi.mock("./state-machine", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./state-machine")>();
	return {
		...actual,
		materializeApprovalTransitionPlan:
			stateMachineMocks.materializeApprovalTransitionPlan,
		planStageActivation: stateMachineMocks.planStageActivation,
	};
});

beforeEach(async () => {
	const actual =
		await vi.importActual<typeof import("./state-machine")>("./state-machine");
	stateMachineMocks.materializeApprovalTransitionPlan.mockImplementation(
		actual.materializeApprovalTransitionPlan,
	);
	stateMachineMocks.planStageActivation.mockImplementation(
		actual.planStageActivation,
	);
});

import {
	ApprovalTransitionEngineError,
	createApprovalTransitionEngine,
	fingerprintApprovalWorkflowCommand,
} from "./transition-engine";

const ids = {
	stage: "10000000-0000-4000-8000-000000000001",
	assignment: "20000000-0000-4000-8000-000000000001",
	fromEmployee: "30000000-0000-4000-8000-000000000001",
	toEmployee: "40000000-0000-4000-8000-000000000001",
	otherEmployee: "50000000-0000-4000-8000-000000000001",
} as const;

const commands = [
	{
		type: "approve",
		stageId: ids.stage,
		assignmentId: ids.assignment,
		reason: "approved after review",
	},
	{
		type: "reject",
		stageId: ids.stage,
		assignmentId: ids.assignment,
		reason: "policy conflict",
	},
	{ type: "cancel", reason: "request withdrawn" },
	{ type: "expire", reason: "approval deadline elapsed" },
	{
		type: "reassign",
		stageId: ids.stage,
		fromEmployeeId: ids.fromEmployee,
		toEmployeeId: ids.toEmployee,
	},
	{
		type: "escalate",
		stageId: ids.stage,
		fromEmployeeId: ids.fromEmployee,
		toEmployeeId: ids.toEmployee,
	},
] satisfies ApprovalWorkflowCommand[];

function expectMalformedCommand(input: unknown): void {
	let thrown: unknown;
	try {
		fingerprintApprovalWorkflowCommand(input as ApprovalWorkflowCommand);
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(ApprovalTransitionEngineError);
	expect(thrown).toMatchObject({ code: "malformed_command" });
}

describe("approval transition engine contracts", () => {
	it("accepts only a trusted employee user or named system principal", () => {
		expectTypeOf<ApprovalWorkflowPrincipal>().toEqualTypeOf<
			| { kind: "employee"; userId: string }
			| {
					kind: "system";
					systemId: "approval-expiry" | "approval-activation";
			  }
		>();
		expectTypeOf<ApprovalWorkflowCommandRequest>().not.toHaveProperty(
			"employeeId",
		);
		expectTypeOf<ApprovalWorkflowCommandRequest>().not.toHaveProperty("userId");
	});

	it("exposes actor resolution, deferred authorization, result building, and an Instant clock", () => {
		expectTypeOf<ApprovalCommandActorResolver>().toHaveProperty("resolve");
		expectTypeOf<
			ApprovalWorkflowAuthorization["authorize"]
		>().returns.toEqualTypeOf<
			Promise<"active_assignment" | "manage_approval" | "system">
		>();
		expectTypeOf<
			ApprovalTransitionResultBuilder["build"]
		>().returns.toEqualTypeOf<ApprovalCommandResult>();
		expectTypeOf<ApprovalEngineClock>().toHaveProperty("nowInstant");
	});
});

describe("fingerprintApprovalWorkflowCommand", () => {
	it.each(commands)("fingerprints the $type command", (command) => {
		expect(fingerprintApprovalWorkflowCommand(command)).toBeTypeOf("string");
	});

	it("distinguishes every state-machine command discriminant", () => {
		const fingerprints = commands.map(fingerprintApprovalWorkflowCommand);
		expect(new Set(fingerprints)).toHaveLength(commands.length);
	});

	it("includes decision reasons and targets", () => {
		const approved = commands[0];
		const reassigned = commands[4];
		if (!approved || !reassigned) throw new Error("missing command fixture");

		expect(fingerprintApprovalWorkflowCommand(approved)).not.toBe(
			fingerprintApprovalWorkflowCommand({
				...approved,
				reason: "approved after correction",
			}),
		);
		expect(fingerprintApprovalWorkflowCommand(reassigned)).not.toBe(
			fingerprintApprovalWorkflowCommand({
				...reassigned,
				toEmployeeId: ids.otherEmployee,
			}),
		);
	});

	it("normalizes equivalent command property orders", () => {
		const ordered: ApprovalWorkflowCommand = {
			type: "approve",
			stageId: ids.stage,
			assignmentId: ids.assignment,
			reason: "approved after review",
		};
		const reordered: ApprovalWorkflowCommand = {
			reason: "approved after review",
			assignmentId: ids.assignment,
			type: "approve",
			stageId: ids.stage,
		};

		expect(fingerprintApprovalWorkflowCommand(reordered)).toBe(
			fingerprintApprovalWorkflowCommand(ordered),
		);
	});

	it("uses null for an omitted optional approval reason", () => {
		expect(
			fingerprintApprovalWorkflowCommand({
				type: "approve",
				stageId: ids.stage,
				assignmentId: ids.assignment,
			}),
		).toBe(
			JSON.stringify({
				type: "approve",
				stageId: ids.stage,
				assignmentId: ids.assignment,
				reason: null,
			}),
		);
	});

	it("rejects an explicitly undefined optional approval reason", () => {
		const command = {
			type: "approve",
			stageId: ids.stage,
			assignmentId: ids.assignment,
			reason: undefined,
		};

		expect(() =>
			fingerprintApprovalWorkflowCommand(command as ApprovalWorkflowCommand),
		).toThrow(ApprovalTransitionEngineError);
		try {
			fingerprintApprovalWorkflowCommand(command as ApprovalWorkflowCommand);
		} catch (error) {
			expect(error).toMatchObject({ code: "malformed_command" });
		}
	});

	it("fails closed when a hostile command proxy breaks validation and error classification", () => {
		const classificationFailure = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw new Error("raw classification failure");
				},
			},
		);
		const command = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw classificationFailure;
				},
			},
		);

		expectMalformedCommand(command);
	});

	it("fails closed when a hostile command proxy spoofs the engine error prototype", () => {
		const spoofedError = new Proxy(
			{},
			{
				getPrototypeOf() {
					return ApprovalTransitionEngineError.prototype;
				},
			},
		);
		const command = new Proxy(
			{},
			{
				getPrototypeOf() {
					throw spoofedError;
				},
			},
		);

		expectMalformedCommand(command);
	});

	it("accepts equivalent null-prototype command records", () => {
		const command = Object.assign(Object.create(null), {
			type: "approve",
			stageId: ids.stage,
			assignmentId: ids.assignment,
		});

		expect(
			fingerprintApprovalWorkflowCommand(command as ApprovalWorkflowCommand),
		).toBe(
			fingerprintApprovalWorkflowCommand({
				type: "approve",
				stageId: ids.stage,
				assignmentId: ids.assignment,
			}),
		);
	});

	it.each([
		{
			description: "accessor properties",
			input: {
				get type() {
					return "approve";
				},
				stageId: ids.stage,
				assignmentId: ids.assignment,
			},
		},
		{
			description: "symbol keys",
			input: {
				type: "approve",
				stageId: ids.stage,
				assignmentId: ids.assignment,
				[Symbol("extra")]: true,
			},
		},
		{
			description: "non-enumerable optional properties",
			input: Object.defineProperty(
				{
					type: "approve",
					stageId: ids.stage,
					assignmentId: ids.assignment,
				},
				"reason",
				{ value: "approved", enumerable: false },
			),
		},
	])("rejects $description", ({ input }) => {
		expectMalformedCommand(input);
	});

	it.each([
		{
			input: {
				type: "approve",
				stageId: ids.stage,
				assignmentId: ids.assignment,
				reason: "approved",
				actorId: ids.fromEmployee,
			},
			description: "extra actor identity",
		},
		{
			input: {
				type: "approve",
				stageId: ids.stage.replace("100", "ABC"),
				assignmentId: ids.assignment,
			},
			description: "noncanonical stage UUID",
		},
		{
			input: {
				type: "reject",
				stageId: ids.stage,
				assignmentId: ids.assignment,
			},
			description: "missing required reason",
		},
		{
			input: {
				type: "escalate",
				stageId: ids.stage,
				fromEmployeeId: ids.fromEmployee,
			},
			description: "missing target employee",
		},
		{
			input: {
				type: "Approve",
				stageId: ids.stage,
				assignmentId: ids.assignment,
			},
			description: "unknown discriminant",
		},
	])("rejects a $description", ({ input }) => {
		expect(() =>
			fingerprintApprovalWorkflowCommand(input as ApprovalWorkflowCommand),
		).toThrow(ApprovalTransitionEngineError);
		try {
			fingerprintApprovalWorkflowCommand(input as ApprovalWorkflowCommand);
		} catch (error) {
			expect(error).toMatchObject({ code: "malformed_command" });
		}
	});
});

describe("approval transition engine receipt replay", () => {
	it("returns a completed receipt after actor resolution, scoped loading, and the gate without source work", async () => {
		const calls: string[] = [];
		const snapshot = engineSnapshot();
		const result: ApprovalCommandResult = {
			snapshot,
			events: [],
			projection: {
				organizationId: snapshot.organizationId,
				workflowId: snapshot.id,
				workflowType: snapshot.workflowType,
				sourceType: snapshot.sourceType,
				sourceId: snapshot.sourceId,
				status: snapshot.status,
				currentStageOrder: snapshot.currentStageOrder,
				requesterEmployeeId: snapshot.requesterEmployeeId,
				displayPayload: {},
				searchText: "",
				activeInboxStage: null,
				updatedAt: engineNow,
			},
			outbox: [],
		};
		const engine = createApprovalTransitionEngine({
			actorResolver: {
				resolve: async () => {
					calls.push("resolveActor");
					return {
						kind: "employee" as const,
						employeeId: ids.fromEmployee,
						userId: ids.toEmployee,
					};
				},
			},
			repository: {
				withTransaction: async (operation) =>
					operation({
						writeGate: {
							acquire: async () => {
								calls.push("acquireGate");
								return {
									mode: "canonical",
									behavior: getCutoverBehavior("canonical"),
								};
							},
						},
						repository: {
							loadSnapshot: async () => {
								calls.push("loadSnapshot");
								return snapshot;
							},
							claimCommand: async () => {
								calls.push("claimCommand");
								return { kind: "completed" as const, result };
							},
						},
					} as never),
			},
		} as never);

		await expect(
			engine.execute({
				organizationId: "org-1",
				workflowId: engineIds.workflow,
				expectedVersion: 7,
				idempotencyKey: "idempotency-key",
				principal: { kind: "employee", userId: ids.toEmployee },
				command: {
					type: "approve",
					stageId: ids.stage,
					assignmentId: ids.assignment,
				},
			}),
		).resolves.toBe(result);
		expect(calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
			"claimCommand",
		]);
	});
});

const engineIds = {
	workflow: "60000000-0000-4000-8000-000000000001",
	stage: "70000000-0000-4000-8000-000000000001",
	nextStage: "70000000-0000-4000-8000-000000000002",
	assignment: "80000000-0000-4000-8000-000000000001",
	source: "90000000-0000-4000-8000-000000000001",
	event: "a0000000-0000-4000-8000-000000000001",
} as const;
const engineNow = parseInstant("2026-07-17T14:00:00Z");
const engineSubmittedAt = parseInstant("2026-07-17T09:00:00Z");
const engineAssignedAt = parseInstant("2026-07-17T10:00:00Z");

function engineSnapshot(
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
): ApprovalWorkflowSnapshot {
	return {
		id: engineIds.workflow,
		organizationId: "org-1",
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: engineIds.source,
		requesterEmployeeId: ids.fromEmployee,
		status: "pending",
		currentStageOrder: 1,
		version: 7,
		policySnapshot: {},
		contextSnapshot: {},
		displaySnapshot: {},
		submittedAt: engineSubmittedAt,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: engineIds.stage,
				organizationId: "org-1",
				workflowId: engineIds.workflow,
				sequence: 1,
				label: "Review",
				resolverSnapshot: {},
				activationMode: "human",
				status: "pending",
				activatedAt: engineAssignedAt,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [
					{
						id: engineIds.assignment,
						organizationId: "org-1",
						workflowId: engineIds.workflow,
						stageId: engineIds.stage,
						sequence: 1,
						approverEmployeeId: ids.fromEmployee,
						status: "pending",
						assignedAt: engineAssignedAt,
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

function engineRequest(
	overrides: Partial<ApprovalWorkflowCommandRequest> = {},
): ApprovalWorkflowCommandRequest {
	return {
		organizationId: "org-1",
		workflowId: engineIds.workflow,
		expectedVersion: 7,
		idempotencyKey: "receipt-key",
		principal: { kind: "employee", userId: ids.toEmployee },
		command: {
			type: "approve",
			stageId: engineIds.stage,
			assignmentId: engineIds.assignment,
		},
		...overrides,
	};
}

function activationSnapshot(
	activationMode: "human" | "requester_auto_approve" = "human",
): ApprovalWorkflowSnapshot {
	const snapshot = engineSnapshot();
	return {
		...snapshot,
		stages: [
			...snapshot.stages,
			{
				id: engineIds.nextStage,
				organizationId: snapshot.organizationId,
				workflowId: snapshot.id,
				sequence: 2,
				label: "Final review",
				resolverSnapshot: {},
				activationMode,
				status: "waiting",
				activatedAt: null,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: null,
				assignments: [],
			},
		],
	};
}

function resolvedActivation(
	overrides: Partial<ResolvedStage> = {},
): ResolvedStage {
	return {
		organizationId: "org-1",
		workflowId: engineIds.workflow,
		stageId: engineIds.nextStage,
		activationMode: "human",
		assignments: [{ approverEmployeeId: ids.otherEmployee, metadata: {} }],
		...overrides,
	};
}

function receiptResult(
	snapshot: ApprovalWorkflowSnapshot,
): ApprovalCommandResult {
	return {
		snapshot,
		events: [],
		projection: {
			organizationId: snapshot.organizationId,
			workflowId: snapshot.id,
			workflowType: snapshot.workflowType,
			sourceType: snapshot.sourceType,
			sourceId: snapshot.sourceId,
			status: snapshot.status,
			currentStageOrder: snapshot.currentStageOrder,
			requesterEmployeeId: snapshot.requesterEmployeeId,
			displayPayload: {},
			searchText: "",
			activeInboxStage: null,
			updatedAt: engineNow,
		},
		outbox: [],
	};
}

function engineFixture(
	options: {
		claim?: "reserved" | "mismatch" | "completed";
		claimSequence?: Array<"reserved" | "mismatch" | "completed">;
		completedResult?: ApprovalCommandResult;
		authorization?:
			| "active_assignment"
			| "requester"
			| "manage_approval"
			| "system";
		actor?:
			| { kind: "employee"; employeeId: string; userId: string }
			| { kind: "system"; employeeId: null; userId: null };
		cas?: "advanced" | "conflict";
		mode?: ApprovalWorkflowLifecycleMode;
		writeLegacy?: boolean;
		writeCanonical?: boolean;
		decideCanonical?: boolean;
		mirror?: ApprovalCutoverBehavior["mirror"];
		finalizerError?: Error;
		transactionBoundFinalizer?: boolean;
		projectionError?: Error;
		outboxError?: Error;
		resultScope?: "valid" | "foreign" | "foreign-stage" | "foreign-assignment";
		snapshot?: ApprovalWorkflowSnapshot;
		resultBuilderMutation?:
			| "first-pass-snapshot"
			| "omit-event"
			| "reorder-events"
			| "mutate-event"
			| "mutate-batch"
			| "omit-outbox";
		activationResolutions?: Array<ResolvedStage | Error>;
		adapter?: ApprovalDomainAdapter<unknown>;
		source?: unknown;
	} = {},
) {
	const calls: string[] = [];
	const state = {
		committed: false,
		rolledBack: false,
		reservation: "none" as "none" | "reserved",
		rootVersion: 7,
		rootStatus: "pending" as string,
		materialized: false,
		sourceFinalized: false,
		projectionRows: [] as string[],
		outboxRows: [] as string[],
		receiptCompleted: false,
		appliedVersions: [] as number[],
	};
	const transactionState = () => ({
		reservation: state.reservation,
		rootVersion: state.rootVersion,
		rootStatus: state.rootStatus,
		materialized: state.materialized,
		sourceFinalized: state.sourceFinalized,
		projectionRows: [...state.projectionRows],
		outboxRows: [...state.outboxRows],
		receiptCompleted: state.receiptCompleted,
		appliedVersions: [...state.appliedVersions],
	});
	const restoreTransactionState = (
		snapshot: ReturnType<typeof transactionState>,
	) => {
		state.reservation = snapshot.reservation;
		state.rootVersion = snapshot.rootVersion;
		state.rootStatus = snapshot.rootStatus;
		state.materialized = snapshot.materialized;
		state.sourceFinalized = snapshot.sourceFinalized;
		state.projectionRows = [...snapshot.projectionRows];
		state.outboxRows = [...snapshot.outboxRows];
		state.receiptCompleted = snapshot.receiptCompleted;
		state.appliedVersions = [...snapshot.appliedVersions];
	};
	let insideTransaction = false;
	let receipt: unknown;
	let completedCommandResult: ApprovalCommandResult | undefined;
	let claimIndex = 0;
	const resultBuilderInputs: Array<{
		materializedBatch: readonly [
			ApprovalMaterializedTransitionPlan,
			...ApprovalMaterializedTransitionPlan[],
		];
		finalization: unknown;
	}> = [];
	let builtFinalization: unknown;
	let finalizerDbService: unknown;
	let terminalPreflightDbService: unknown;
	let terminalPreflightWorkflowStatus: unknown;
	let finalizerWorkflowStatus: unknown;
	let projectionDbService: unknown;
	const activationInputs: unknown[] = [];
	const appliedPlans: ApprovalMaterializedTransitionPlan[] = [];
	let activationResolutionIndex = 0;
	let transactionCalls = 0;
	let actorResolverDbService: unknown;
	let authorizationDbService: unknown;
	let sourceLoaderDbService: unknown;
	function assertInsideTransaction(): void {
		if (!insideTransaction) throw new Error("write escaped the transaction");
	}

	// The source marker is mutable only through the transaction-bound db service.
	const dbService = {
		db: {
			execute: async (_query: unknown) => {
				assertInsideTransaction();
				state.sourceFinalized = true;
				return {};
			},
		},
	};

	const actor = options.actor ?? {
		kind: "employee" as const,
		employeeId: ids.fromEmployee,
		userId: ids.toEmployee,
	};
	const defaultAdapter = {
		workflowType: "absence",
		sourceType: "absence_entry",
		loadSource: async () => {
			throw new Error("engine must use ApprovalWorkflowSourceLoader");
		},
		getTrustedCapabilities: async () => {
			calls.push("capabilities");
			return { canCancelAfterApproval: true };
		},
		produceRoutingContext: async () => {
			calls.push("produceRoutingContext");
			return {};
		},
		preflightCommand: async () => {
			calls.push("preflightCommand");
		},
		preflightTerminal: async (input: ApprovalTerminalAdapterInput<unknown>) => {
			calls.push("preflightTerminal");
			terminalPreflightDbService = input.dbService;
			terminalPreflightWorkflowStatus = input.workflow.status;
		},
		finalizeTerminal: async (input: ApprovalTerminalAdapterInput<unknown>) => {
			calls.push("finalizeTerminal");
			finalizerWorkflowStatus = input.workflow.status;
			if (options.transactionBoundFinalizer) {
				finalizerDbService = input.dbService;
				if (!input.dbService) {
					throw new Error("missing transaction db service");
				}
				await input.dbService.db.execute(undefined as never);
			}
			if (options.finalizerError) throw options.finalizerError;
			return {
				organizationId: "org-1",
				workflowId: engineIds.workflow,
				sourceIdentity: engineSnapshot(),
				transitionKind: "approve",
				terminalStatus: "approved",
				sourceSnapshot: {},
				eventPayload: {},
				compatibilityPayload: {},
				finalizedAt: engineNow,
			};
		},
		projectDisplay: async () => ({ displayPayload: {}, searchText: "" }),
	};
	const adapter = options.adapter ?? defaultAdapter;
	const repository = {
		withTransaction: async (
			operation: (context: unknown) => Promise<unknown>,
		) => {
			transactionCalls += 1;
			const before = transactionState();
			insideTransaction = true;
			try {
				const result = await operation(context);
				if (state.reservation === "reserved" && !state.receiptCompleted) {
					throw new Error("leftover receipt reservation");
				}
				state.committed = true;
				return result;
			} catch (error) {
				restoreTransactionState(before);
				state.rolledBack = true;
				throw error;
			} finally {
				insideTransaction = false;
			}
		},
	};
	const context = {
		dbService,
		writeGate: {
			acquire: async () => {
				calls.push("acquireGate");
				const mode = options.mode ?? "canonical";
				const behavior = getCutoverBehavior(mode);
				return {
					mode,
					behavior: {
						...behavior,
						writeLegacy: options.writeLegacy ?? behavior.writeLegacy,
						writeCanonical: options.writeCanonical ?? behavior.writeCanonical,
						decideCanonical:
							options.decideCanonical ?? behavior.decideCanonical,
						mirror: options.mirror ?? behavior.mirror,
					},
				};
			},
		},
		repository: {
			loadSnapshot: async () => {
				calls.push("loadSnapshot");
				return options.snapshot ?? engineSnapshot();
			},
			claimCommand: async (input: unknown) => {
				assertInsideTransaction();
				calls.push("claimCommand");
				receipt = input;
				const claim = options.claimSequence?.[claimIndex++] ?? options.claim;
				if (claim === "mismatch")
					return { kind: "fingerprint_mismatch" as const };
				if (claim === "completed") {
					return {
						kind: "completed" as const,
						result:
							completedCommandResult ??
							options.completedResult ??
							receiptResult(options.snapshot ?? engineSnapshot()),
					};
				}
				state.reservation = "reserved";
				return { kind: "reserved" as const };
			},
			allocateTransitionIdentities: async (input: {
				identityAllocations: Array<{
					allocationKey: string;
					entityKind: "assignment" | "event";
				}>;
			}) => {
				assertInsideTransaction();
				calls.push("allocate");
				return input.identityAllocations.map((allocation, index) => ({
					...allocation,
					id: `${engineIds.event.slice(0, -1)}${index + 1}`,
				}));
			},
			tryAdvanceVersion: async (input: { expectedVersion: number }) => {
				assertInsideTransaction();
				calls.push("tryAdvanceVersion");
				if (options.cas === "conflict") {
					return { kind: "conflict" as const, version: 8 };
				}
				state.rootVersion = input.expectedVersion + 1;
				return { kind: "advanced" as const, version: state.rootVersion };
			},
			applyMaterializedTransition: async (materialized: {
				resultingSnapshot: { status: string; version: number };
			}) => {
				assertInsideTransaction();
				calls.push("applyMaterializedTransition");
				state.materialized = true;
				state.rootStatus = materialized.resultingSnapshot.status;
				state.appliedVersions.push(materialized.resultingSnapshot.version);
				appliedPlans.push(materialized as ApprovalMaterializedTransitionPlan);
			},
			completeCommand: async (input: { result: ApprovalCommandResult }) => {
				assertInsideTransaction();
				calls.push("completeCommand");
				completedCommandResult = input.result;
				state.receiptCompleted = true;
			},
		},
		adapterRegistry: {
			get: () => adapter,
			authorizeApprovedCancellation: async () => {
				calls.push("authorizeApprovedCancellation");
				return {};
			},
		},
		activationResolver: {
			resolve: async (input: unknown) => {
				calls.push("resolveActivation");
				activationInputs.push(input);
				const resolution =
					options.activationResolutions?.[activationResolutionIndex++];
				if (resolution instanceof Error) throw resolution;
				if (resolution) return resolution;
				throw new Error("missing activation resolution");
			},
		},
		compatibilityWriter: {
			withWriteGate() {
				return this;
			},
			mirrorCanonicalToLegacy: async () => {
				assertInsideTransaction();
				calls.push("compatibility");
			},
		},
		projectionWriter: {
			write: async (input: { workflowId: string }) => {
				assertInsideTransaction();
				calls.push("projection");
				projectionDbService = dbService;
				state.projectionRows.push(input.workflowId);
				if (options.projectionError) throw options.projectionError;
			},
		},
		outboxWriter: {
			write: async (input: { dedupeKey: string }) => {
				assertInsideTransaction();
				calls.push("outbox");
				state.outboxRows.push(input.dedupeKey);
				if (options.outboxError) throw options.outboxError;
				return { kind: "inserted" as const, id: engineIds.event };
			},
		},
	};
	const engine = createApprovalTransitionEngine({
		repository: repository as never,
		actorResolver: {
			resolve: async (input: { dbService: unknown }) => {
				calls.push("resolveActor");
				actorResolverDbService = input.dbService;
				return actor;
			},
		},
		authorization: {
			authorize: async (input: { dbService: unknown }) => {
				calls.push("authorize");
				authorizationDbService = input.dbService;
				return options.authorization ?? "active_assignment";
			},
		},
		sourceLoader: {
			load: async (input: { dbService: unknown }) => {
				calls.push("loadSource");
				sourceLoaderDbService = input.dbService;
				return options.source ?? {};
			},
		},
		resultBuilder: {
			build: ({
				materializedBatch,
				finalization,
			}: {
				materializedBatch: readonly [
					ApprovalMaterializedTransitionPlan,
					...ApprovalMaterializedTransitionPlan[],
				];
				finalization: unknown;
			}) => {
				calls.push("buildResult");
				resultBuilderInputs.push({ materializedBatch, finalization });
				builtFinalization = finalization;
				const lastMaterialized = materializedBatch.at(-1);
				if (!lastMaterialized) throw new Error("missing materialized pass");
				if (options.resultBuilderMutation === "mutate-batch") {
					lastMaterialized.resultingSnapshot.version = 99;
					const firstEvent = materializedBatch[0].events[0];
					if (!firstEvent) throw new Error("missing batch event to mutate");
					firstEvent.reason = "forged batch reason";
				}
				const materializedSnapshot =
					options.resultBuilderMutation === "first-pass-snapshot"
						? materializedBatch[0].resultingSnapshot
						: lastMaterialized.resultingSnapshot;
				let snapshot =
					options.resultScope === "foreign"
						? { ...materializedSnapshot, organizationId: "org-2" }
						: materializedSnapshot;
				const stage = snapshot.stages[0];
				if (options.resultScope === "foreign-stage" && stage) {
					snapshot = {
						...snapshot,
						stages: [{ ...stage, organizationId: "org-2" }],
					};
				}
				if (options.resultScope === "foreign-assignment" && stage) {
					const assignment = stage.assignments[0];
					if (assignment) {
						snapshot = {
							...snapshot,
							stages: [
								{
									...stage,
									assignments: [
										{
											...assignment,
											organizationId: "org-2",
											workflowId: engineIds.source,
											stageId: ids.otherEmployee,
										},
									],
								},
							],
						};
					}
				}
				const batchEvents = materializedBatch.flatMap((pass) =>
					pass.events.map(
						({ persistenceMetadata: _persistenceMetadata, ...event }) => event,
					),
				);
				let events = batchEvents;
				if (options.resultBuilderMutation === "omit-event") {
					events = batchEvents.slice(0, -1);
				}
				if (options.resultBuilderMutation === "reorder-events") {
					const first = batchEvents[0];
					const second = batchEvents[1];
					if (!first || !second) throw new Error("missing events to reorder");
					events = [second, first, ...batchEvents.slice(2)];
				}
				if (options.resultBuilderMutation === "mutate-event") {
					const first = batchEvents[0];
					if (!first) throw new Error("missing event to mutate");
					events = [
						{ ...first, reason: "forged reason" },
						...batchEvents.slice(1),
					];
				}
				const outboxEvents =
					options.resultBuilderMutation === "omit-outbox"
						? batchEvents.slice(0, -1)
						: batchEvents;
				return {
					snapshot,
					events,
					projection: {
						organizationId: snapshot.organizationId,
						workflowId: snapshot.id,
						workflowType: snapshot.workflowType,
						sourceType: snapshot.sourceType,
						sourceId: snapshot.sourceId,
						status: snapshot.status,
						currentStageOrder: snapshot.currentStageOrder,
						requesterEmployeeId: snapshot.requesterEmployeeId,
						displayPayload: {},
						searchText: "",
						activeInboxStage: null,
						updatedAt: engineNow,
					},
					outbox: outboxEvents.map((event, index) => ({
						organizationId: snapshot.organizationId,
						workflowId: snapshot.id,
						eventId: event.id,
						eventType: event.eventType,
						dedupeKey: `outbox-${index}`,
						payload: {},
						disposition: "emit" as const,
						createdAt: engineNow,
					})),
				};
			},
		},
		clock: { nowInstant: () => engineNow },
		postCommitHandler: {
			describePostCommitEvents: async () => {
				calls.push("postCommit");
				return [];
			},
		},
	} as never);
	return {
		engine,
		calls,
		state,
		dbService,
		finalizerDbService: () => finalizerDbService,
		terminalPreflightDbService: () => terminalPreflightDbService,
		terminalPreflightWorkflowStatus: () => terminalPreflightWorkflowStatus,
		finalizerWorkflowStatus: () => finalizerWorkflowStatus,
		projectionDbService: () => projectionDbService,
		activationInputs: () => activationInputs,
		appliedPlans,
		resultBuilderInputs,
		builtFinalization: () => builtFinalization,
		transactionState,
		context,
		withCallerTransaction: async <T>(operation: () => Promise<T>) => {
			insideTransaction = true;
			try {
				return await operation();
			} finally {
				insideTransaction = false;
			}
		},
		transactionCalls: () => transactionCalls,
		actorResolverDbService: () => actorResolverDbService,
		authorizationDbService: () => authorizationDbService,
		sourceLoaderDbService: () => sourceLoaderDbService,
		receipt: () => receipt,
	};
}

describe("approval transition engine atomic orchestration", () => {
	it("reuses one transaction service for actor, authorization, and source dependencies", async () => {
		const fixture = engineFixture();

		await fixture.engine.execute(engineRequest());

		expect(fixture.transactionCalls()).toBe(1);
		expect(fixture.actorResolverDbService()).toBe(fixture.dbService);
		expect(fixture.authorizationDbService()).toBe(fixture.dbService);
		expect(fixture.sourceLoaderDbService()).toBe(fixture.dbService);
	});

	it("executes in a caller transaction without opening a nested transaction", async () => {
		const fixture = engineFixture();

		await fixture.withCallerTransaction(() =>
			fixture.engine.executeInTransaction(
				fixture.context as never,
				engineRequest(),
			),
		);

		expect(fixture.transactionCalls()).toBe(0);
		expect(fixture.actorResolverDbService()).toBe(fixture.dbService);
		expect(fixture.authorizationDbService()).toBe(fixture.dbService);
		expect(fixture.sourceLoaderDbService()).toBe(fixture.dbService);
	});

	it("passes the materialized post-transition workflow to direct terminal preflight and finalization", async () => {
		const fixture = engineFixture();

		await fixture.engine.execute(engineRequest());

		expect(fixture.terminalPreflightWorkflowStatus()).toBe("approved");
		expect(fixture.finalizerWorkflowStatus()).toBe("approved");
	});

	it("composes the concrete absence adapter with a pending source and resulting approved workflow", async () => {
		const finalizeAbsenceTerminal = vi.fn().mockResolvedValue({});
		const adapter = createAbsenceApprovalAdapter({
			clock: { nowInstant: () => engineNow },
			finalizeAbsenceTerminal,
			deleteCancelledAbsence: vi.fn().mockResolvedValue(undefined),
		});
		const source = {
			id: engineIds.source,
			organizationId: "org-1",
			employeeId: ids.fromEmployee,
			requesterUserId: "requester-user-1",
			categoryId: "40000000-0000-4000-8000-000000000001",
			canonicalRecordId: "50000000-0000-4000-8000-000000000001",
			approvalWorkflowId: engineIds.workflow,
			startDate: "2026-07-20",
			startPeriod: "full_day",
			endDate: "2026-07-21",
			endPeriod: "full_day",
			status: "pending",
			notes: null,
			approvedBy: null,
			rejectionReason: null,
			requesterName: "Requester",
			teamId: null,
			categoryName: "Vacation",
			categoryType: "vacation",
			categoryColor: null,
			organizationTimezone: "Europe/Berlin",
		} satisfies AbsenceApprovalSource;
		const fixture = engineFixture({ adapter, source });

		await fixture.engine.execute(engineRequest());

		expect(finalizeAbsenceTerminal).toHaveBeenCalledOnce();
		expect(finalizeAbsenceTerminal).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedApprovalWorkflowId: engineIds.workflow,
				expectedCanonicalRecordId: source.canonicalRecordId,
				transition: { kind: "approve" },
			}),
		);
	});

	it.each([
		["canonical", "approve"],
		["canonical", "reject"],
		["complete", "approve"],
		["complete", "reject"],
	] as const)("finalizes an ordinary %s %s before compatibility without legacy request evidence", async (mode, action) => {
		const surchargeSnapshot = {
			version: 1,
			evaluatedAt: "2026-07-17T16:00:00Z",
			resolution: { kind: "none" },
		} as const;
		let fixture: ReturnType<typeof engineFixture>;
		const finalizeTerminal = vi.fn(async (input) => {
			expect(fixture.calls).not.toContain("compatibility");
			expect(input.evidence).toEqual({
				mode: "canonical",
				workflowId: engineIds.workflow,
				payload: {
					timeRequest: { kind: "manual_time_submission" },
					surchargeSnapshot,
				},
			});
			return {
				kind: "manual_time_submission" as const,
				action,
				reason: action === "reject" ? "policy conflict" : null,
				period: {
					id: engineIds.source,
					organizationId: "org-1",
					employeeId: ids.fromEmployee,
					canonicalRecordId: "record-1",
					startTime: new Date("2026-07-17T08:00:00Z"),
					endTime: new Date("2026-07-17T16:00:00Z"),
				},
			};
		});
		const adapter = createOrdinaryWorkPeriodApprovalAdapter(
			"manual_time_submission",
			{ finalizeTerminal },
		);
		const snapshot = engineSnapshot({
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			contextSnapshot: {
				timeRequest: { kind: "manual_time_submission" },
				surchargeSnapshot,
			},
		});
		const source = {
			id: engineIds.source,
			organizationId: "org-1",
			employeeId: ids.fromEmployee,
			canonicalRecordId: "record-1",
			approvalWorkflowId: engineIds.workflow,
			approvalStatus: "pending",
			startTime: "2026-07-17T08:00:00Z",
			endTime: "2026-07-17T16:00:00Z",
			durationMinutes: 480,
			payload: {
				timeRequest: { kind: "manual_time_submission" },
				surchargeSnapshot,
			},
		} satisfies OrdinaryWorkPeriodApprovalSource;
		fixture = engineFixture({ mode, adapter, snapshot, source });

		await fixture.engine.execute(
			engineRequest({
				command:
					action === "approve"
						? {
								type: "approve",
								stageId: engineIds.stage,
								assignmentId: engineIds.assignment,
							}
						: {
								type: "reject",
								stageId: engineIds.stage,
								assignmentId: engineIds.assignment,
								reason: "policy conflict",
							},
			}),
		);

		expect(finalizeTerminal).toHaveBeenCalledOnce();
		if (mode === "canonical") {
			expect(fixture.calls).toContain("compatibility");
		} else {
			expect(fixture.calls).not.toContain("compatibility");
		}
	});

	it("deletes a cancelled source exactly once and does not repeat finalization on receipt replay", async () => {
		const deleteCancelledAbsence = vi.fn().mockResolvedValue(undefined);
		const baseAdapter = createAbsenceApprovalAdapter({
			clock: { nowInstant: () => engineNow },
			finalizeAbsenceTerminal: vi.fn().mockResolvedValue({}),
			deleteCancelledAbsence,
		});
		const finalizeTerminal = vi.fn((input) =>
			baseAdapter.finalizeTerminal(input),
		);
		const adapter = { ...baseAdapter, finalizeTerminal };
		const source = {
			id: engineIds.source,
			organizationId: "org-1",
			employeeId: ids.fromEmployee,
			requesterUserId: "requester-user-1",
			categoryId: "40000000-0000-4000-8000-000000000001",
			canonicalRecordId: "50000000-0000-4000-8000-000000000001",
			approvalWorkflowId: engineIds.workflow,
			startDate: "2026-07-20",
			startPeriod: "full_day",
			endDate: "2026-07-21",
			endPeriod: "full_day",
			status: "pending",
			notes: null,
			approvedBy: null,
			rejectionReason: null,
			requesterName: "Requester",
			teamId: null,
			categoryName: "Vacation",
			categoryType: "vacation",
			categoryColor: null,
			organizationTimezone: "Europe/Berlin",
		} satisfies AbsenceApprovalSource;
		const fixture = engineFixture({
			adapter,
			source,
			authorization: "requester",
			claimSequence: ["reserved", "completed"],
		});
		const request = engineRequest({
			command: { type: "cancel", reason: "withdrawn" },
		});

		const first = await fixture.withCallerTransaction(() =>
			fixture.engine.executeInTransactionWithDisposition(
				fixture.context as never,
				request,
			),
		);
		const replay = await fixture.withCallerTransaction(() =>
			fixture.engine.executeInTransactionWithDisposition(
				fixture.context as never,
				request,
			),
		);

		expect(first).toEqual({
			result: expect.any(Object),
			disposition: "executed",
			finalization: expect.any(Object),
		});
		expect(replay).toEqual({
			result: first.result,
			disposition: "replayed",
			finalization: null,
		});
		expect(deleteCancelledAbsence).toHaveBeenCalledOnce();
		expect(finalizeTerminal).toHaveBeenCalledOnce();
	});

	it("rejects a mismatched receipt before source loading or authorization", async () => {
		const fixture = engineFixture({ claim: "mismatch" });
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "idempotency_mismatch",
			},
		);
		expect(fixture.calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
			"claimCommand",
		]);
	});

	it("rejects a completed receipt with a cross-organization result before source or writes", async () => {
		const snapshot = engineSnapshot({ organizationId: "org-2" });
		const fixture = engineFixture({
			claim: "completed",
			completedResult: {
				snapshot,
				events: [],
				projection: {
					organizationId: "org-2",
					workflowId: snapshot.id,
					workflowType: snapshot.workflowType,
					sourceType: snapshot.sourceType,
					sourceId: snapshot.sourceId,
					status: snapshot.status,
					currentStageOrder: snapshot.currentStageOrder,
					requesterEmployeeId: snapshot.requesterEmployeeId,
					displayPayload: {},
					searchText: "",
					activeInboxStage: null,
					updatedAt: engineNow,
				},
				outbox: [],
			},
		});
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "result_scope",
			},
		);
		expect(fixture.calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
			"claimCommand",
		]);
	});

	it("rejects an employee principal resolved for a different user before loading the workflow", async () => {
		const fixture = engineFixture({
			actor: {
				kind: "employee",
				employeeId: ids.otherEmployee,
				userId: ids.fromEmployee,
			},
		});
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "forbidden",
			},
		);
		expect(fixture.calls).toEqual(["resolveActor"]);
	});

	it("accepts an employee principal resolved for the same user", async () => {
		const fixture = engineFixture({ claim: "mismatch" });
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "idempotency_mismatch",
			},
		);
		expect(fixture.calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
			"claimCommand",
		]);
	});

	it("orders source preflight, planning, CAS, materialization, terminal finalization, and durable writes", async () => {
		const fixture = engineFixture({
			writeLegacy: true,
			mirror: "canonical_to_legacy",
		});
		await fixture.engine.execute(engineRequest());
		expect(fixture.calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
			"claimCommand",
			"authorize",
			"loadSource",
			"capabilities",
			"preflightCommand",
			"allocate",
			"tryAdvanceVersion",
			"applyMaterializedTransition",
			"preflightTerminal",
			"finalizeTerminal",
			"buildResult",
			"compatibility",
			"projection",
			"outbox",
			"outbox",
			"outbox",
			"completeCommand",
		]);
		expect(fixture.state).toMatchObject({ committed: true, rolledBack: false });
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("rejects %s before canonical authority claims or writes", async (mode) => {
		const fixture = engineFixture({ mode });

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "forbidden",
				details: { field: "canonical_authority", mode },
			},
		);
		expect(fixture.calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
		]);
		expect(fixture.calls).not.toContain("claimCommand");
		expect(fixture.calls).not.toContain("preflightCommand");
		expect(fixture.calls).not.toContain("tryAdvanceVersion");
		expect(fixture.calls).not.toContain("applyMaterializedTransition");
		expect(fixture.calls).not.toContain("finalizeTerminal");
		expect(fixture.calls).not.toContain("projection");
		expect(fixture.calls).not.toContain("outbox");
		expect(fixture.calls).not.toContain("compatibility");
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it.each([
		{ writeCanonical: false, decideCanonical: true },
		{ writeCanonical: true, decideCanonical: false },
	] as const)("fails closed before receipt claim when authority behavior is $writeCanonical/$decideCanonical", async ({
		writeCanonical,
		decideCanonical,
	}) => {
		const fixture = engineFixture({
			mode: "canonical",
			writeCanonical,
			decideCanonical,
		});

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "forbidden",
				details: { field: "canonical_authority", mode: "canonical" },
			},
		);
		expect(fixture.calls).toEqual([
			"resolveActor",
			"loadSnapshot",
			"acquireGate",
		]);
	});

	it("executes canonical authority and mirrors canonical to legacy exactly once", async () => {
		const fixture = engineFixture({ mode: "canonical" });

		await fixture.engine.execute(engineRequest());

		expect(
			fixture.calls.filter((call) => call === "compatibility"),
		).toHaveLength(1);
		expect(
			fixture.calls.filter((call) => call === "tryAdvanceVersion"),
		).toHaveLength(1);
		expect(
			fixture.calls.filter((call) => call === "applyMaterializedTransition"),
		).toHaveLength(1);
	});

	it("executes complete authority without legacy mirroring", async () => {
		const fixture = engineFixture({ mode: "complete" });

		await fixture.engine.execute(engineRequest());

		expect(fixture.calls).not.toContain("compatibility");
		expect(
			fixture.calls.filter((call) => call === "tryAdvanceVersion"),
		).toHaveLength(1);
		expect(
			fixture.calls.filter((call) => call === "applyMaterializedTransition"),
		).toHaveLength(1);
	});

	it("does not invoke compatibility writes when the cutover gate disables mirroring", async () => {
		const fixture = engineFixture({ writeLegacy: true, mirror: "none" });

		await fixture.engine.execute(engineRequest());

		expect(fixture.calls).not.toContain("compatibility");
	});

	it("does not materialize, finalize, or write when CAS conflicts", async () => {
		const fixture = engineFixture({ cas: "conflict" });
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "version_conflict",
			},
		);
		expect(fixture.calls).not.toContain("applyMaterializedTransition");
		expect(fixture.calls).not.toContain("finalizeTerminal");
		expect(fixture.calls).not.toContain("projection");
		expect(fixture.state).toMatchObject({ committed: false, rolledBack: true });
	});

	it("passes the transaction dbService to terminal preflight and finalization", async () => {
		const fixture = engineFixture({ transactionBoundFinalizer: true });
		await fixture.engine.execute(engineRequest());
		expect(fixture.terminalPreflightDbService()).toBe(fixture.dbService);
		expect(fixture.finalizerDbService()).toBe(fixture.dbService);
		expect(fixture.projectionDbService()).toBe(fixture.dbService);
		expect(fixture.transactionState()).toMatchObject({
			rootVersion: 8,
			rootStatus: "approved",
			materialized: true,
			sourceFinalized: true,
			projectionRows: [engineIds.workflow],
			receiptCompleted: true,
		});
	});

	it("rolls back a reserved receipt and canonical CAS when terminal finalization fails", async () => {
		const fixture = engineFixture({
			transactionBoundFinalizer: true,
			finalizerError: new Error("finalizer failure"),
		});
		const before = fixture.transactionState();
		await expect(fixture.engine.execute(engineRequest())).rejects.toThrow(
			"finalizer failure",
		);
		expect(fixture.state).toMatchObject({ committed: false, rolledBack: true });
		expect(fixture.transactionState()).toEqual(before);
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it("rejects a forged result scope before compatibility, projection, outbox, or receipt completion", async () => {
		const fixture = engineFixture({ resultScope: "foreign" });
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "result_scope",
			},
		);
		expect(fixture.calls).not.toContain("compatibility");
		expect(fixture.calls).not.toContain("projection");
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it.each([
		{ description: "a foreign stage", resultScope: "foreign-stage" as const },
		{
			description: "a foreign assignment relation",
			resultScope: "foreign-assignment" as const,
		},
	])("rejects a result containing $description before durable writes", async ({
		resultScope,
	}) => {
		const fixture = engineFixture({ resultScope, writeLegacy: true });
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "result_scope",
			},
		);
		expect(fixture.calls).not.toContain("compatibility");
		expect(fixture.calls).not.toContain("projection");
		expect(fixture.calls).not.toContain("outbox");
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it.each([
		{
			description: "a requester grant for approval",
			authorization: "requester" as const,
			request: engineRequest(),
		},
		{
			description: "an assignment grant for cancellation",
			authorization: "active_assignment" as const,
			request: engineRequest({
				command: { type: "cancel", reason: "withdrawn" },
			}),
		},
		{
			description: "a management grant for expiry",
			authorization: "manage_approval" as const,
			request: engineRequest({
				principal: { kind: "system", systemId: "approval-expiry" },
				command: { type: "expire", reason: "deadline" },
			}),
		},
		{
			description: "a system grant for approval",
			authorization: "system" as const,
			request: engineRequest(),
		},
		{
			description: "the reserved activation system principal",
			authorization: "system" as const,
			request: engineRequest({
				principal: { kind: "system", systemId: "approval-activation" },
				command: { type: "expire", reason: "deadline" },
			}),
		},
	])("forbids $description", async ({ authorization, request }) => {
		const fixture = engineFixture({ authorization });
		await expect(fixture.engine.execute(request)).rejects.toMatchObject({
			code: "forbidden",
		});
		expect(fixture.calls).not.toContain("loadSource");
		expect(fixture.state).toMatchObject({ committed: false, rolledBack: true });
	});

	it("allows a requester grant only for cancellation", async () => {
		const fixture = engineFixture({ authorization: "requester" });
		await expect(
			fixture.engine.execute(
				engineRequest({ command: { type: "cancel", reason: "withdrawn" } }),
			),
		).resolves.toBeDefined();
	});

	it("allows expiry only for the approval-expiry system principal", async () => {
		const fixture = engineFixture({
			authorization: "system",
			actor: { kind: "system", employeeId: null, userId: null },
		});
		await expect(
			fixture.engine.execute(
				engineRequest({
					principal: { kind: "system", systemId: "approval-expiry" },
					command: { type: "expire", reason: "deadline" },
				}),
			),
		).resolves.toBeDefined();
		expect(fixture.calls).not.toContain("preflightCommand");
	});

	it.each([
		{
			systemId: "approval-expiry" as const,
			authorization: "active_assignment" as const,
			command: {
				type: "approve" as const,
				stageId: engineIds.stage,
				assignmentId: engineIds.assignment,
			},
		},
		{
			systemId: "approval-expiry" as const,
			authorization: "manage_approval" as const,
			command: { type: "cancel" as const, reason: "forged management" },
		},
		{
			systemId: "approval-activation" as const,
			authorization: "active_assignment" as const,
			command: {
				type: "approve" as const,
				stageId: engineIds.stage,
				assignmentId: engineIds.assignment,
			},
		},
		{
			systemId: "approval-activation" as const,
			authorization: "manage_approval" as const,
			command: { type: "cancel" as const, reason: "forged management" },
		},
	])("forbids $systemId from using a forged $authorization grant", async ({
		systemId,
		authorization,
		command,
	}) => {
		const fixture = engineFixture({
			authorization,
			actor: { kind: "system", employeeId: null, userId: null },
		});
		await expect(
			fixture.engine.execute(
				engineRequest({
					principal: { kind: "system", systemId },
					command,
				}),
			),
		).rejects.toMatchObject({ code: "forbidden" });
		expect(fixture.calls).not.toContain("loadSource");
	});

	it("rejects a system principal resolved as an employee actor", async () => {
		const fixture = engineFixture({ authorization: "system" });
		await expect(
			fixture.engine.execute(
				engineRequest({
					principal: { kind: "system", systemId: "approval-expiry" },
					command: { type: "expire", reason: "deadline" },
				}),
			),
		).rejects.toMatchObject({ code: "forbidden" });
		expect(fixture.calls).not.toContain("loadSource");
	});

	it("rejects a cross-organization scoped snapshot before gate acquisition", async () => {
		const fixture = engineFixture({
			snapshot: engineSnapshot({ organizationId: "org-2" }),
		});
		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "forbidden",
			},
		);
		expect(fixture.calls).toEqual(["resolveActor", "loadSnapshot"]);
	});

	it("does not accept a caller-supplied approved-cancellation authorization", async () => {
		const fixture = engineFixture();
		await expect(
			fixture.engine.execute(
				engineRequest({
					command: {
						type: "cancel",
						reason: "withdrawn",
						authorization: {},
					} as unknown as ApprovalWorkflowCommand,
				}),
			),
		).rejects.toMatchObject({ code: "malformed_command" });
		expect(fixture.calls).not.toContain("claimCommand");
	});

	it("does not preflight or finalize a non-terminal reassignment", async () => {
		const fixture = engineFixture({ authorization: "manage_approval" });
		await fixture.engine.execute(
			engineRequest({
				command: {
					type: "reassign",
					stageId: engineIds.stage,
					fromEmployeeId: ids.fromEmployee,
					toEmployeeId: ids.toEmployee,
				},
			}),
		);
		expect(fixture.calls).not.toContain("preflightCommand");
		expect(fixture.calls).not.toContain("preflightTerminal");
		expect(fixture.calls).not.toContain("finalizeTerminal");
	});

	it.each([
		{
			description: "projection",
			options: { projectionError: new Error("projection failure") },
		},
		{
			description: "outbox",
			options: { outboxError: new Error("outbox failure") },
		},
	])("rolls back reservation and CAS when $description persistence fails", async ({
		options,
	}) => {
		const fixture = engineFixture(options);
		const before = fixture.transactionState();
		await expect(fixture.engine.execute(engineRequest())).rejects.toThrow(
			options.projectionError?.message ?? options.outboxError?.message,
		);
		expect(fixture.state).toMatchObject({ committed: false, rolledBack: true });
		expect(fixture.transactionState()).toEqual(before);
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it("writes every outbox record sequentially before completing the receipt", async () => {
		const fixture = engineFixture();
		await fixture.engine.execute(engineRequest());
		const projection = fixture.calls.indexOf("projection");
		const firstOutbox = fixture.calls.indexOf("outbox");
		const completion = fixture.calls.indexOf("completeCommand");
		expect(firstOutbox).toBeGreaterThan(projection);
		expect(fixture.calls.filter((call) => call === "outbox")).toHaveLength(3);
		expect(completion).toBeGreaterThan(firstOutbox);
	});

	it("does not invoke a post-commit handler", async () => {
		const fixture = engineFixture();
		await fixture.engine.execute(engineRequest());
		expect(fixture.calls).not.toContain("postCommit");
	});

	it("binds each receipt to the command fingerprint so a semantic change mismatches", async () => {
		const initial = engineFixture();
		await initial.engine.execute(engineRequest());
		expect(initial.receipt()).toMatchObject({
			commandFingerprint: fingerprintApprovalWorkflowCommand(
				engineRequest().command,
			),
		});
		const retry = engineFixture({ claim: "mismatch" });
		await expect(
			retry.engine.execute(
				engineRequest({
					command: {
						type: "approve",
						stageId: engineIds.stage,
						assignmentId: engineIds.assignment,
						reason: "changed rationale",
					},
				}),
			),
		).rejects.toMatchObject({ code: "idempotency_mismatch" });
	});

	it("drains a requested activation through materialization before building the final result", async () => {
		const actual =
			await vi.importActual<typeof import("./state-machine")>(
				"./state-machine",
			);
		const bindings: unknown[] = [];
		stateMachineMocks.materializeApprovalTransitionPlan.mockImplementation(
			(plan, identities, binding) => {
				bindings.push(binding);
				return actual.materializeApprovalTransitionPlan(
					plan,
					identities,
					binding,
				);
			},
		);
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation()],
		});

		const result = await fixture.engine.execute(engineRequest());
		const finalStage = result.snapshot.stages.find(
			(stage) => stage.id === engineIds.nextStage,
		);

		expect(
			fixture.calls.filter((call) => call === "resolveActivation"),
		).toHaveLength(1);
		expect(fixture.calls.filter((call) => call === "allocate")).toHaveLength(2);
		expect(
			fixture.calls.filter((call) => call === "tryAdvanceVersion"),
		).toHaveLength(2);
		expect(
			fixture.calls.filter((call) => call === "applyMaterializedTransition"),
		).toHaveLength(2);
		const [activationInput] = fixture.activationInputs();
		expect(activationInput).toMatchObject(
			expect.objectContaining({
				organizationId: "org-1",
				workflow: expect.objectContaining({ version: 8 }),
				stage: expect.objectContaining({ id: engineIds.nextStage }),
				actor: { kind: "system", employeeId: null, userId: null },
				routingContext: {},
			}),
		);
		expect((activationInput as StageActivationInput).dbService).toBe(
			fixture.dbService,
		);
		expect(finalStage).toMatchObject({
			status: "pending",
			assignments: [expect.any(Object)],
		});
		expect(result.snapshot.version).toBe(9);
		expect(
			fixture.resultBuilderInputs[0]?.materializedBatch.map(
				(pass) => pass.resultingSnapshot.version,
			),
		).toEqual([8, 9]);
		expect(fixture.builtFinalization()).toBeNull();
		expect(bindings[1]).toMatchObject({
			receipt: fixture.receipt(),
			actor: { kind: "system", employeeId: null, userId: null },
			receiptActor: {
				kind: "employee",
				employeeId: ids.fromEmployee,
				userId: ids.toEmployee,
			},
		});
	});

	it("retains every activation pass with original event indexes and all outbox records", async () => {
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation()],
		});

		const result = await fixture.engine.execute(engineRequest());

		expect(
			fixture.resultBuilderInputs[0]?.materializedBatch.map(
				(pass) => pass.resultingSnapshot.version,
			),
		).toEqual([8, 9]);
		expect(
			result.events.map((event) => [event.version, event.eventIndex]),
		).toEqual([
			[8, 0],
			[8, 1],
			[8, 2],
			[9, 0],
			[9, 1],
		]);
		expect(result.events.map((event) => event.eventType)).toEqual([
			"assignment.approved",
			"stage.approved",
			"workflow.activation_requested",
			"assignment.created",
			"stage.activated",
		]);
		expect(result.outbox.map((outbox) => outbox.eventType)).toEqual(
			result.events.map((event) => event.eventType),
		);
		expect(result.outbox.map((outbox) => outbox.eventId)).toEqual(
			result.events.map((event) => event.id),
		);
		expect(fixture.state.outboxRows).toHaveLength(result.events.length);
	});

	it.each([
		{
			description: "the first pass snapshot",
			resultBuilderMutation: "first-pass-snapshot" as const,
		},
		{
			description: "an omitted batch event",
			resultBuilderMutation: "omit-event" as const,
		},
		{
			description: "reordered batch events",
			resultBuilderMutation: "reorder-events" as const,
		},
		{
			description: "a semantically mutated batch event",
			resultBuilderMutation: "mutate-event" as const,
		},
		{
			description: "an omitted event outbox record",
			resultBuilderMutation: "omit-outbox" as const,
		},
	])("rejects a result builder returning $description", async ({
		resultBuilderMutation,
	}) => {
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation()],
			resultBuilderMutation,
		});

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "invariant",
				details: { field: "result_builder" },
			},
		);
		expect(fixture.calls).not.toContain("compatibility");
		expect(fixture.calls).not.toContain("projection");
		expect(fixture.calls).not.toContain("outbox");
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it("rejects a builder that mutates its batch without mutating persisted plans", async () => {
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation()],
			resultBuilderMutation: "mutate-batch",
		});

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "invariant",
				details: { field: "result_builder" },
			},
		);
		expect(
			fixture.appliedPlans.map((plan) => plan.resultingSnapshot.version),
		).toEqual([8, 9]);
		expect(
			fixture.appliedPlans.flatMap((plan) =>
				plan.events.map((event) => event.reason),
			),
		).not.toContain("forged batch reason");
	});

	it("finalizes only the terminal activation plan after it is applied", async () => {
		const fixture = engineFixture({
			snapshot: activationSnapshot("requester_auto_approve"),
			activationResolutions: [
				resolvedActivation({
					activationMode: "requester_auto_approve",
					assignments: [],
				}),
			],
		});

		await fixture.engine.execute(engineRequest());

		expect(
			fixture.calls.filter((call) => call === "finalizeTerminal"),
		).toHaveLength(1);
		expect(
			fixture.calls.lastIndexOf("applyMaterializedTransition"),
		).toBeLessThan(fixture.calls.indexOf("preflightTerminal"));
		expect(fixture.calls.indexOf("preflightTerminal")).toBeLessThan(
			fixture.calls.indexOf("finalizeTerminal"),
		);
		expect(fixture.builtFinalization()).not.toBeNull();
	});

	it("finalizes requester-auto terminal absence approval as the trusted requester while retaining the system workflow actor", async () => {
		const finalizeAbsenceTerminal = vi.fn().mockResolvedValue({});
		const adapter = createAbsenceApprovalAdapter({
			clock: { nowInstant: () => engineNow },
			finalizeAbsenceTerminal,
			deleteCancelledAbsence: vi.fn().mockResolvedValue(undefined),
		});
		const source = {
			id: engineIds.source,
			organizationId: "org-1",
			employeeId: ids.fromEmployee,
			requesterUserId: "requester-user-1",
			categoryId: "40000000-0000-4000-8000-000000000001",
			canonicalRecordId: "50000000-0000-4000-8000-000000000001",
			approvalWorkflowId: engineIds.workflow,
			startDate: "2026-07-20",
			startPeriod: "full_day",
			endDate: "2026-07-21",
			endPeriod: "full_day",
			status: "pending",
			notes: null,
			approvedBy: null,
			rejectionReason: null,
			requesterName: "Requester",
			teamId: null,
			categoryName: "Vacation",
			categoryType: "vacation",
			categoryColor: null,
			organizationTimezone: "Europe/Berlin",
		} as AbsenceApprovalSource;
		const fixture = engineFixture({
			adapter,
			source,
			snapshot: activationSnapshot("requester_auto_approve"),
			activationResolutions: [
				resolvedActivation({
					activationMode: "requester_auto_approve",
					assignments: [],
				}),
			],
		});

		const result = await fixture.engine.execute(engineRequest());

		expect(finalizeAbsenceTerminal).toHaveBeenCalledOnce();
		expect(finalizeAbsenceTerminal).toHaveBeenCalledWith(
			expect.objectContaining({
				actorEmployeeId: ids.fromEmployee,
				actorUserId: "requester-user-1",
				transition: { kind: "approve" },
			}),
		);
		expect(result.snapshot.status).toBe("approved");
		expect(result.events.at(-1)).toMatchObject({
			eventType: "workflow.approved",
			actor: { kind: "system", employeeId: null, userId: null },
		});
	});

	it("never resolves activation for an initial terminal plan, receipt replay, or CAS conflict", async () => {
		const terminal = engineFixture();
		await terminal.engine.execute(engineRequest());
		expect(terminal.calls).not.toContain("resolveActivation");

		const replay = engineFixture({ claim: "completed" });
		await replay.engine.execute(engineRequest());
		expect(replay.calls).not.toContain("resolveActivation");

		const conflict = engineFixture({
			cas: "conflict",
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation()],
		});
		await expect(
			conflict.engine.execute(engineRequest()),
		).rejects.toMatchObject({
			code: "version_conflict",
		});
		expect(conflict.calls).not.toContain("resolveActivation");
	});

	it("rolls back the reserved receipt when the activation result escapes workflow scope", async () => {
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation({ organizationId: "org-2" })],
		});
		const before = fixture.transactionState();

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "invariant",
			},
		);
		expect(fixture.transactionState()).toEqual(before);
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it("rolls back the reserved receipt when a materialized activation names no stage", async () => {
		stateMachineMocks.materializeApprovalTransitionPlan.mockReturnValue({
			expectedVersion: 7,
			resultingSnapshot: activationSnapshot(),
			changes: { root: {}, stages: [], assignments: [] },
			events: [],
			nextAction: {
				kind: "needs_activation",
				stageId: ids.otherEmployee,
				stageOrder: 3,
			},
		});
		const fixture = engineFixture({ snapshot: activationSnapshot() });
		const before = fixture.transactionState();

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "invariant",
			},
		);
		expect(fixture.transactionState()).toEqual(before);
		expect(fixture.calls).not.toContain("resolveActivation");
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it("caps repeated activation plans and rolls back the complete recorder state", async () => {
		const recurringSnapshot = (version: number): ApprovalWorkflowSnapshot => {
			const snapshot = activationSnapshot();
			const firstStage = snapshot.stages[0];
			if (!firstStage) throw new Error("missing initial stage");
			const assignment = firstStage.assignments[0];
			if (!assignment) throw new Error("missing initial assignment");
			return {
				...snapshot,
				version,
				currentStageOrder: 2,
				stages: [
					{
						...firstStage,
						status: "approved",
						decidedAt: engineNow,
						assignments: [
							{
								...assignment,
								status: "approved",
								resolvedAt: engineNow,
								resolvedBy: { kind: "system", employeeId: null, userId: null },
							},
						],
					},
					snapshot.stages[1] as ApprovalWorkflowSnapshot["stages"][number],
				],
			};
		};
		stateMachineMocks.materializeApprovalTransitionPlan.mockImplementation(
			(plan: { expectedVersion: number }) => ({
				expectedVersion: plan.expectedVersion,
				resultingSnapshot: recurringSnapshot(plan.expectedVersion + 1),
				changes: { root: {}, stages: [], assignments: [] },
				events: [],
				nextAction: {
					kind: "needs_activation",
					stageId: engineIds.nextStage,
					stageOrder: 2,
				},
			}),
		);
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: Array.from({ length: 4 }, () =>
				resolvedActivation(),
			),
		});
		const before = fixture.transactionState();

		await expect(fixture.engine.execute(engineRequest())).rejects.toMatchObject(
			{
				code: "activation_cycle",
			},
		);
		expect(fixture.transactionState()).toEqual(before);
		expect(fixture.calls).not.toContain("completeCommand");
	});

	it("completes the outgoing receipt once after all drained writes", async () => {
		const fixture = engineFixture({
			snapshot: activationSnapshot(),
			activationResolutions: [resolvedActivation()],
		});

		await fixture.engine.execute(engineRequest());

		expect(
			fixture.calls.filter((call) => call === "completeCommand"),
		).toHaveLength(1);
		expect(fixture.calls.indexOf("completeCommand")).toBeGreaterThan(
			fixture.calls.lastIndexOf("applyMaterializedTransition"),
		);
		expect(fixture.calls.indexOf("completeCommand")).toBeGreaterThan(
			fixture.calls.lastIndexOf("outbox"),
		);
	});
});
