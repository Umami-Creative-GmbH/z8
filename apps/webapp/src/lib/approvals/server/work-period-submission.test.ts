import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import type { ResolvePolicyAndCreateApprovalResult } from "../policies/chain-service";
import type { ApprovalRolloutMode } from "../workflow/ports";

const state = vi.hoisted(() => ({
	mode: "legacy" as ApprovalRolloutMode,
	failure: null as string | null,
	result: {
		kind: "default_created",
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
	} as ResolvePolicyAndCreateApprovalResult,
	calls: [] as string[],
	startKind: "created" as "created" | "existing",
	workflowId: "70000000-0000-4000-8000-000000000001",
	stageId: "50000000-0000-4000-8000-000000000001",
	assignmentId: "60000000-0000-4000-8000-000000000001",
	kind: "manual_time_submission" as
		| "manual_time_submission"
		| "policy_clock_out",
}));

vi.mock("../policies/chain-service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../policies/chain-service")>();
	return {
		...actual,
		resolvePolicyAndCreateApproval: (_db: unknown, input: unknown) =>
			Effect.tryPromise({
				try: async () => {
					state.calls.push(`legacy:${JSON.stringify(input)}`);
					if (state.failure === "legacy")
						throw new Error("private-legacy-evidence");
					return state.result;
				},
				catch: (error) => error as Error,
			}),
	};
});

vi.mock("../domain-adapters/work-period-legacy-state", () => ({
	captureOrdinaryWorkPeriodLegacyPreSubmissionState: async () => {
		state.calls.push("capture:before");
		if (state.failure === "capture-before")
			throw new Error("private-capture-before-evidence");
		return verifiedState(null);
	},
	captureOrdinaryWorkPeriodLegacyState: async (input: {
		expectedRequestStatus: string;
	}) => {
		state.calls.push(`capture:after:${input.expectedRequestStatus}`);
		if (state.failure === "capture-after")
			throw new Error("private-capture-after-evidence");
		return verifiedState({ status: input.expectedRequestStatus });
	},
}));

vi.mock("../domain-adapters/legacy-write-coordinator", () => ({
	createLegacyApprovalWriteCoordinator: () => ({
		execute: async (input: {
			captureState: () => Promise<unknown>;
			mutate: () => Promise<unknown>;
			afterMirror: (result: { snapshot: { id: string } }) => Promise<void>;
		}) => {
			if (state.mode === "shadow" || state.mode === "ready") {
				await input.captureState();
			}
			const result = await input.mutate();
			if (state.mode === "shadow" || state.mode === "ready") {
				await input.captureState();
				state.calls.push("observation");
				if (state.failure === "observation")
					throw new Error("private-observation-evidence");
				await input.afterMirror({
					snapshot: { id: "70000000-0000-4000-8000-000000000001" },
				});
			}
			return result;
		},
	}),
}));

vi.mock("../workflow/start-workflow", () => ({
	startApprovalWorkflow: async (input: {
		contextSnapshot: unknown;
		submissionKey: string;
		bindSourceWorkflow: (workflowId: string) => Promise<unknown>;
		verifySourceWorkflow: (workflowId: string) => Promise<unknown>;
	}) => {
		state.calls.push(`start:${input.submissionKey}`);
		state.calls.push(`context:${JSON.stringify(input.contextSnapshot)}`);
		if (state.failure === "start") throw new Error("private-start-evidence");
		const id = state.workflowId;
		if (state.startKind === "created") await input.bindSourceWorkflow(id);
		else await input.verifySourceWorkflow(id);
		if (state.failure === "projection")
			throw new Error("private-projection-evidence");
		if (state.failure === "outbox") throw new Error("private-outbox-evidence");
		const auto = state.result.kind === "auto_completed";
		return {
			kind: state.startKind,
			status: auto ? ("approved" as const) : ("pending" as const),
			terminal: auto,
			snapshot: {
				id,
				status: auto ? "approved" : "pending",
				completedAt: auto ? parseInstant("2026-07-22T10:00:00Z") : null,
				stages: auto
					? [
							{
								id: state.stageId,
								sequence: 1,
								activationMode: "requester_auto_approve",
								assignments: [],
							},
						]
					: [
							{
								id: state.stageId,
								sequence: 1,
								activationMode: "human",
								assignments: [
									{
										id: state.assignmentId,
										status: "pending",
										approverEmployeeId: "20000000-0000-4000-8000-000000000002",
									},
								],
							},
						],
			},
			events: [],
			projection: {},
			outbox: [],
		};
	},
}));

vi.mock("./work-period-approvals", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("./work-period-approvals")>();
	const finalize = async (input: { evidence: { mode: string } }) => {
		state.calls.push(`finalize:${input.evidence.mode}`);
		if (state.failure === "finalization")
			throw new Error("private-finalization-evidence");
		return {};
	};
	return {
		...actual,
		finalizeOrdinaryWorkPeriodTerminalInTransaction: finalize,
		finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction: finalize,
	};
});

import { deriveApprovalWorkflowId } from "../workflow/identity";
import {
	type ExecuteOrdinaryWorkPeriodSubmissionInput,
	executeOrdinaryWorkPeriodSubmissionInTransaction,
} from "./work-period-submission";

const organizationId = "org-1";
const workPeriodId = "10000000-0000-4000-8000-000000000001";
const submissionId = "10000000-0000-4000-8000-000000000099";
const requesterEmployeeId = "20000000-0000-4000-8000-000000000001";
const requesterUserId = "user-1";
const approverId = "20000000-0000-4000-8000-000000000002";
const startTime = new Date("2026-07-22T08:00:00.000Z");
const endTime = new Date("2026-07-22T16:00:00.000Z");

function verifiedState(request: null | { status: string }) {
	return {
		organizationId,
		source: {
			organizationId,
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			sourceId: workPeriodId,
		},
		approvalRequest: request,
		chain: null,
		chainRows: [],
		sourceSnapshot: { timeRequest: { kind: "manual_time_submission" } },
		capturedAt: parseInstant("2026-07-22T10:00:00Z"),
	};
}

function source(overrides: Record<string, unknown> = {}) {
	return {
		id: workPeriodId,
		organizationId,
		employeeId: requesterEmployeeId,
		requesterUserId,
		clockInId: "30000000-0000-4000-8000-000000000001",
		clockOutId: "30000000-0000-4000-8000-000000000002",
		canonicalRecordId: "30000000-0000-4000-8000-000000000003",
		approvalWorkflowId: null,
		approvalStatus: "pending",
		pendingChanges: null,
		isActive: false,
		startTime,
		endTime,
		durationMinutes: 480,
		deletedAt: null,
		canonicalId: "30000000-0000-4000-8000-000000000003",
		canonicalOrganizationId: organizationId,
		canonicalEmployeeId: requesterEmployeeId,
		canonicalRecordKind: "work",
		canonicalStartAt: startTime,
		canonicalEndAt: endTime,
		canonicalDurationMinutes: 480,
		canonicalApprovalState: "pending",
		pendingLegacyRequests: [],
		pendingCanonicalWorkflows: [],
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [],
		historicalLegacyAutoRequests: [],
		hasMalformedLegacyMarker: false,
		...overrides,
	};
}

function fixture(
	options: {
		source?: Record<string, unknown>;
		replaySource?: Record<string, unknown>;
		compatibilityRequests?: Record<string, unknown>[];
		differentDb?: boolean;
	} = {},
) {
	const calls: string[] = [];
	const dialect = new PgDialect();
	const row = source(options.source);
	const db = {
		execute: vi.fn(async (query: SQL) => {
			const text = dialect.sqlToQuery(query).sql;
			calls.push(text);
			if (text.includes("pg_advisory_xact_lock"))
				return { rows: [{ locked: null }] };
			if (text.includes("update work_period")) {
				state.calls.push("binding");
				if (state.failure === "binding")
					throw new Error("private-binding-evidence");
				return { rows: [{ id: workPeriodId, organizationId }] };
			}
			if (state.failure === "source")
				throw new Error("private-source-evidence");
			if (text.includes('as "terminalCanonicalWorkflows"')) {
				return { rows: [source(options.replaySource ?? options.source)] };
			}
			if (text.includes('select id, organization_id as "organizationId"')) {
				return { rows: [{ id: workPeriodId, organizationId }] };
			}
			return { rows: [row] };
		}),
		query: {
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue({
					id: "40000000-0000-4000-8000-000000000001",
					approverId,
				}),
				findMany: vi.fn().mockImplementation(
					async () =>
						options.compatibilityRequests ?? [
							compatibilityRequest(state.kind, {
								status:
									state.result.kind === "auto_completed"
										? "approved"
										: "pending",
								approverId:
									state.result.kind === "auto_completed"
										? requesterEmployeeId
										: approverId,
							}),
						],
				),
			},
		},
	};
	const writeGate = {
		acquire: vi.fn(async () => {
			state.calls.push("routing");
			if (state.failure === "routing")
				throw new Error("private-routing-evidence");
			return {
				mode: state.mode,
				behavior: {
					writeLegacy: state.mode !== "complete",
					writeCanonical: state.mode !== "legacy",
					decideCanonical:
						state.mode === "canonical" || state.mode === "complete",
					observation:
						state.mode === "shadow" || state.mode === "ready"
							? "legacy_to_canonical"
							: state.mode === "canonical"
								? "canonical_to_legacy"
								: "none",
				},
			};
		}),
	};
	const compatibilityWriter = {
		withWriteGate: vi.fn(function () {
			return this;
		}),
		mirrorCanonicalToLegacy: vi.fn(async () => {
			state.calls.push("compatibility");
			if (state.failure === "compatibility")
				throw new Error("private-compatibility-evidence");
		}),
	};
	const context = {
		dbService: { db: options.differentDb ? {} : db },
		writeGate,
		compatibilityWriter,
		repository: {
			loadSnapshot: vi.fn().mockImplementation(async () => ({
				id: state.workflowId,
				organizationId,
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: workPeriodId,
				requesterEmployeeId,
				status: "approved",
				currentStageOrder: 1,
				version: 1,
				contextSnapshot: {
					timeRequest: { kind: "manual_time_submission" },
				},
				completedAt: parseInstant("2026-07-22T10:00:00Z"),
				stages: [
					{
						id: state.stageId,
						sequence: 1,
						activationMode: "requester_auto_approve",
						status: "approved",
						assignments: [],
					},
				],
			})),
		},
		adapterRegistry: {},
		activationResolver: {},
		projectionWriter: {},
		outboxWriter: {},
	} as unknown as ApprovalWorkflowTransactionContext;
	const input = {
		dbService: {
			db,
			query: <T>(_name: string, operation: () => Promise<T>) =>
				Effect.promise(operation),
		},
		context,
		organizationId,
		workPeriodId,
		submissionId,
		requesterEmployeeId,
		requesterUserId,
		teamId: null,
		defaultApproverId: approverId,
		reason: "Needs approval",
		overtimeRisk: "warning" as const,
		kind: "manual_time_submission" as const,
		metadata: {
			source: "calendar",
			timeRequest: { imported: true, kind: "wrong" },
			diagnostics: "discard",
		},
	} satisfies ExecuteOrdinaryWorkPeriodSubmissionInput;
	return { calls, compatibilityWriter, input };
}

beforeEach(() => {
	state.mode = "legacy";
	state.failure = null;
	state.calls = [];
	state.startKind = "created";
	state.workflowId = expectedWorkflowId("manual_time_submission");
	state.kind = "manual_time_submission";
	state.result = {
		kind: "default_created",
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
	};
});

function expectedWorkflowId(
	kind: "manual_time_submission" | "policy_clock_out",
) {
	const submissionKey = deriveApprovalWorkflowId({
		organizationId,
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: workPeriodId,
		allocationKey: submissionId,
	});
	return deriveApprovalWorkflowId({
		organizationId,
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: workPeriodId,
		allocationKey: submissionKey,
	});
}

function ordinarySubmissionKey(
	kind:
		| "manual_time_submission"
		| "policy_clock_out" = "manual_time_submission",
) {
	return deriveApprovalWorkflowId({
		organizationId,
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: workPeriodId,
		allocationKey: submissionId,
	});
}

function ordinarySubmissionMarker() {
	return { key: ordinarySubmissionKey(), submissionId };
}

function markedAutoRequest(input: {
	id: string;
	chainInstanceId: string | null;
	stepOrder: number | null;
	key?: string;
	metadata?: unknown;
}) {
	const decidedAt = new Date("2026-07-22T10:00:00Z");
	return {
		id: input.id,
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId: requesterEmployeeId,
		status: "approved",
		approvedAt: decidedAt,
		metadata:
			input.metadata ??
			({
				timeRequest: { kind: "manual_time_submission" },
				ordinarySubmission: {
					key: input.key ?? ordinarySubmissionKey(),
					submissionId,
				},
				autoApproval: { reason: "requester_is_approver" },
			} as const),
		chainInstanceId: input.chainInstanceId,
		stageId:
			input.stepOrder === null
				? null
				: `50000000-0000-4000-8000-${String(input.stepOrder).padStart(12, "0")}`,
		stepOrder: input.stepOrder,
		stageStatus: input.stepOrder === null ? null : "approved",
		stageApprovalRequestId: input.stepOrder === null ? null : input.id,
		stageDecidedBy: input.stepOrder === null ? null : requesterEmployeeId,
		stageDecidedAt: input.stepOrder === null ? null : decidedAt,
		chainOrganizationId: input.chainInstanceId ? organizationId : null,
		chainEntityType: input.chainInstanceId ? "time_entry" : null,
		chainEntityId: input.chainInstanceId ? workPeriodId : null,
		chainRequesterEmployeeId: input.chainInstanceId
			? requesterEmployeeId
			: null,
		chainStatus: input.chainInstanceId ? "approved" : null,
		chainCurrentStageOrder: input.chainInstanceId ? 2 : null,
		chainCompletedAt: input.chainInstanceId ? decidedAt : null,
		chainStageCount: input.chainInstanceId ? 2 : null,
	};
}

function compatibilityRequest(
	kind: "manual_time_submission" | "policy_clock_out",
	overrides: Record<string, unknown> = {},
) {
	return {
		id: "40000000-0000-4000-8000-000000000099",
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId,
		status: "pending",
		metadata: {
			workflow: { id: expectedWorkflowId(kind), organizationId },
			stage: { id: state.stageId, sequence: 1 },
			timeRequest: { kind },
		},
		...overrides,
	};
}

function pendingLegacyRequest(
	metadata: unknown,
	overrides: Record<string, unknown> = {},
) {
	return {
		id: "40000000-0000-4000-8000-000000000001",
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId,
		status: "pending",
		reason: "Needs approval",
		metadata,
		chainInstanceId: null,
		...overrides,
	};
}

describe.each([
	"manual_time_submission",
	"policy_clock_out",
] as const)("%s submission", (kind) => {
	it.each([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("routes %s with exact evidence and detached post-commit data", async (mode) => {
		state.mode = mode;
		const fake = fixture();
		fake.input.kind = kind;
		state.kind = kind;
		state.workflowId = expectedWorkflowId(kind);

		const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
			fake.input,
		);

		expect(state.calls[0]).toBe("routing");
		expect(
			fake.calls.filter((sql) => sql.includes("pg_advisory_xact_lock")),
		).toHaveLength(2);
		expect(
			fake.calls.some((sql) =>
				sql.includes("for update of period, requester, canonical"),
			),
		).toBe(true);
		expect(submitted.result.kind).toBe("default_created");
		expect(submitted.disposition).toBe("executed");
		expect(submitted.postCommit).toEqual({
			disposition:
				mode === "canonical" || mode === "complete" ? "observe" : "dispatch",
			dedupeKey: expect.any(String),
			event: "pending",
			organizationId,
			workPeriodId,
			requesterEmployeeId,
			approverEmployeeId: approverId,
			kind,
			startTime: "2026-07-22T08:00:00Z",
			endTime: "2026-07-22T16:00:00Z",
			durationMinutes: 480,
			reason: "Needs approval",
		});
		if (mode === "legacy") expect(state.calls).not.toContain("observation");
		if (mode === "shadow" || mode === "ready") {
			expect(state.calls).toContain("capture:before");
			expect(state.calls).toContain("capture:after:pending");
			expect(state.calls).toContain("observation");
		}
		if (mode === "canonical" || mode === "complete") {
			expect(state.calls).toContain(
				`context:${JSON.stringify({ timeRequest: { kind } })}`,
			);
		}
	});
});

it.each([
	"legacy",
	"shadow",
	"ready",
] as const)("persists the private stable ordinary marker in %s policy metadata", async (mode) => {
	state.mode = mode;
	const fake = fixture();

	await executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input);

	const legacyCall = state.calls.find((call) => call.startsWith("legacy:"));
	expect(legacyCall).toBeDefined();
	const resolverInput = JSON.parse(legacyCall?.slice("legacy:".length) ?? "");
	expect(resolverInput.metadata).toEqual({
		timeRequest: { kind: "manual_time_submission" },
		ordinarySubmission: { key: ordinarySubmissionKey(), submissionId },
	});
	expect(JSON.stringify(resolverInput.metadata)).not.toContain(
		"Needs approval",
	);
});

it.each([
	"legacy",
	"shadow",
	"ready",
] as const)("replays exact marked pending approval in %s without writes or side effects", async (mode) => {
	state.mode = mode;
	const request = pendingLegacyRequest({
		timeRequest: { kind: "manual_time_submission" },
		ordinarySubmission: { key: ordinarySubmissionKey(), submissionId },
	});
	const fake = fixture({ source: { pendingLegacyRequests: [request] } });

	const first = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);
	const second = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(first.result).toEqual({
		kind: "default_created",
		approvalRequestId: request.id,
	});
	expect(second.result).toEqual(first.result);
	expect(first).toMatchObject({ disposition: "replayed", postCommit: null });
	expect(second).toMatchObject({ disposition: "replayed", postCommit: null });
	expect(state.calls).toEqual(["routing", "routing"]);
	expect(fake.calls.some((sql) => sql.includes("update work_period"))).toBe(
		false,
	);
	expect(
		fake.compatibilityWriter.mirrorCanonicalToLegacy,
	).not.toHaveBeenCalled();
});

it("preserves exact historical pending metadata replay", async () => {
	const request = pendingLegacyRequest({
		timeRequest: { kind: "manual_time_submission" },
	});
	const fake = fixture({ source: { pendingLegacyRequests: [request] } });

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result).toEqual({
		kind: "default_created",
		approvalRequestId: request.id,
	});
	expect(state.calls).toEqual(["routing"]);
});

it.each([
	[
		"wrong marker key",
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: { ...ordinarySubmissionMarker(), key: "wrong" },
		},
	],
	[
		"opposite embedded kind",
		{
			timeRequest: { kind: "policy_clock_out" },
			ordinarySubmission: ordinarySubmissionMarker(),
		},
	],
	[
		"extra root key",
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: ordinarySubmissionMarker(),
			extra: true,
		},
	],
	[
		"extra marker key",
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: { ...ordinarySubmissionMarker(), extra: true },
		},
	],
	["array root", [{ timeRequest: { kind: "manual_time_submission" } }]],
	[
		"array marker",
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: [ordinarySubmissionKey()],
		},
	],
	[
		"array time request",
		{
			timeRequest: ["manual_time_submission"],
			ordinarySubmission: ordinarySubmissionMarker(),
		},
	],
	[
		"custom root prototype",
		Object.assign(Object.create({ inherited: true }), {
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: ordinarySubmissionMarker(),
		}),
	],
	[
		"custom marker prototype",
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: Object.assign(
				Object.create({ inherited: true }),
				ordinarySubmissionMarker(),
			),
		},
	],
	[
		"custom time-request prototype",
		{
			timeRequest: Object.assign(Object.create({ inherited: true }), {
				kind: "manual_time_submission",
			}),
			ordinarySubmission: ordinarySubmissionMarker(),
		},
	],
	[
		"root symbol",
		Object.assign(
			{
				timeRequest: { kind: "manual_time_submission" },
				ordinarySubmission: ordinarySubmissionMarker(),
			},
			{ [Symbol("extra")]: true },
		),
	],
	[
		"marker symbol",
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: Object.assign(ordinarySubmissionMarker(), {
				[Symbol("extra")]: true,
			}),
		},
	],
	[
		"time-request symbol",
		{
			timeRequest: Object.assign(
				{ kind: "manual_time_submission" },
				{ [Symbol("extra")]: true },
			),
			ordinarySubmission: ordinarySubmissionMarker(),
		},
	],
] as const)("rejects marked pending metadata with %s despite a synthetic kind", async (_label, metadata) => {
	const request = pendingLegacyRequest(metadata, {
		kind: "manual_time_submission",
	});
	const fake = fixture({ source: { pendingLegacyRequests: [request] } });

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls).toEqual(["routing"]);
});

it("rejects marked pending accessors without invoking them", async () => {
	const rootGetter = vi.fn(() => ordinarySubmissionMarker());
	const markerGetter = vi.fn(() => ordinarySubmissionKey());
	const rootAccessor = { timeRequest: { kind: "manual_time_submission" } };
	Object.defineProperty(rootAccessor, "ordinarySubmission", {
		enumerable: true,
		get: rootGetter,
	});
	const markerAccessor = ordinarySubmissionMarker();
	Object.defineProperty(markerAccessor, "key", {
		enumerable: true,
		get: markerGetter,
	});

	for (const metadata of [
		rootAccessor,
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: markerAccessor,
		},
	]) {
		const request = pendingLegacyRequest(metadata, {
			kind: "manual_time_submission",
		});
		const fake = fixture({ source: { pendingLegacyRequests: [request] } });
		await expect(
			executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
		).rejects.toThrow("Ordinary work-period submission failed");
	}
	expect(rootGetter).not.toHaveBeenCalled();
	expect(markerGetter).not.toHaveBeenCalled();
});

it("rejects non-enumerable marked pending descriptors", async () => {
	const root = { timeRequest: { kind: "manual_time_submission" } };
	Object.defineProperty(root, "ordinarySubmission", {
		enumerable: false,
		value: ordinarySubmissionMarker(),
	});
	const marker = ordinarySubmissionMarker();
	Object.defineProperty(marker, "key", {
		enumerable: false,
		value: ordinarySubmissionKey(),
	});
	const timeRequest = {};
	Object.defineProperty(timeRequest, "kind", {
		enumerable: false,
		value: "manual_time_submission",
	});

	for (const metadata of [
		root,
		{
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission: marker,
		},
		{
			timeRequest,
			ordinarySubmission: ordinarySubmissionMarker(),
		},
	]) {
		const request = pendingLegacyRequest(metadata, {
			kind: "manual_time_submission",
		});
		const fake = fixture({ source: { pendingLegacyRequests: [request] } });
		await expect(
			executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
		).rejects.toThrow("Ordinary work-period submission failed");
	}
});

it("does not accept marked metadata as canonical compatibility metadata", async () => {
	state.mode = "canonical";
	const workflowId = expectedWorkflowId("manual_time_submission");
	state.workflowId = workflowId;
	const request = pendingLegacyRequest({
		timeRequest: { kind: "manual_time_submission" },
		ordinarySubmission: ordinarySubmissionMarker(),
	});
	const fake = fixture({
		source: {
			approvalWorkflowId: workflowId,
			pendingLegacyRequests: [request],
			pendingCanonicalWorkflows: [
				{
					id: workflowId,
					workflowType: "manual_time_submission",
					requesterEmployeeId,
					contextSnapshot: {
						timeRequest: { kind: "manual_time_submission" },
					},
				},
			],
		},
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls).toEqual(["routing"]);
});

it("rejects a mismatched transaction context before acquiring rollout authority", async () => {
	const fake = fixture({ differentDb: true });
	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls).toEqual([]);
});

it.each([
	"manual_time_submission",
	"policy_clock_out",
] as const)("finalizes %s requester auto-approval before compatibility mirroring", async (kind) => {
	state.mode = "canonical";
	state.result = {
		kind: "auto_completed",
		chainInstanceId: null,
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
		reason: "requester_is_approver",
	};
	const fake = fixture();
	fake.input.kind = kind;
	state.kind = kind;
	state.workflowId = expectedWorkflowId(kind);

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(state.calls.indexOf("finalize:canonical")).toBeLessThan(
		state.calls.indexOf("compatibility"),
	);
	expect(submitted.postCommit).toMatchObject({
		event: "approved",
		disposition: "observe",
		approverEmployeeId: requesterEmployeeId,
	});
});

it("uses exact approved legacy capture and finalization evidence for requester auto-approval", async () => {
	state.mode = "shadow";
	state.result = {
		kind: "auto_completed",
		chainInstanceId: null,
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
		reason: "requester_is_approver",
	};
	const fake = fixture();

	await executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input);

	expect(state.calls).toContain("capture:after:approved");
	expect(state.calls.indexOf("finalize:legacy")).toBeLessThan(
		state.calls.indexOf("capture:after:approved"),
	);
});

it.each([
	[
		"opposite legacy kind",
		{ pendingLegacyRequests: [{ id: "request-1", kind: "policy_clock_out" }] },
	],
	[
		"opposite canonical kind",
		{
			pendingCanonicalWorkflows: [
				{ id: "workflow-1", workflowType: "policy_clock_out" },
			],
		},
	],
	["canonical parity", { canonicalDurationMinutes: 1 }],
	["pending changes", { pendingChanges: { isNewClockOut: true } }],
] as const)("rejects %s before approval writes", async (_label, sourceOverrides) => {
	const fake = fixture({ source: sourceOverrides });
	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls.some((call) => call.startsWith("legacy:"))).toBe(false);
	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
});

it("uses a stable key for exact same-kind retries", async () => {
	state.mode = "canonical";
	const first = fixture();
	await executeOrdinaryWorkPeriodSubmissionInTransaction(first.input);
	const firstKey = state.calls.find((call) => call.startsWith("start:"));
	state.calls = [];
	const second = fixture();
	second.input.reason = "Changed presentation reason";
	await executeOrdinaryWorkPeriodSubmissionInTransaction(second.input);
	expect(state.calls.find((call) => call.startsWith("start:"))).toBe(firstKey);
});

it("keeps canonical replay authoritative when a pending compatibility row exists", async () => {
	state.mode = "canonical";
	state.startKind = "existing";
	const workflowId = expectedWorkflowId("manual_time_submission");
	state.workflowId = workflowId;
	const compatibility = compatibilityRequest("manual_time_submission");
	const fake = fixture({
		source: {
			approvalWorkflowId: workflowId,
			pendingLegacyRequests: [compatibility],
			pendingCanonicalWorkflows: [
				{
					id: workflowId,
					workflowType: "manual_time_submission",
					requesterEmployeeId,
					contextSnapshot: {
						timeRequest: { kind: "manual_time_submission" },
					},
				},
			],
		},
		compatibilityRequests: [compatibility],
	});

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(true);
	expect(submitted.result).toMatchObject({
		kind: "default_created",
		approvalRequestId: compatibility.id,
	});
});

it("rejects malformed canonical compatibility metadata without parsing it as canonical context", async () => {
	state.mode = "canonical";
	const workflowId = expectedWorkflowId("manual_time_submission");
	const compatibility = compatibilityRequest("manual_time_submission", {
		metadata: {
			workflow: { id: "foreign-workflow", organizationId },
			stage: { id: state.stageId, sequence: 1 },
			timeRequest: { kind: "manual_time_submission" },
		},
	});
	const fake = fixture({
		source: {
			approvalWorkflowId: workflowId,
			pendingLegacyRequests: [compatibility],
			pendingCanonicalWorkflows: [
				{
					id: workflowId,
					workflowType: "manual_time_submission",
					requesterEmployeeId,
					contextSnapshot: {
						timeRequest: { kind: "manual_time_submission" },
					},
				},
			],
		},
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
});

it("returns the actual canonical compatibility request ID instead of assignment or workflow IDs", async () => {
	state.mode = "canonical";
	const compatibility = compatibilityRequest("manual_time_submission");
	const fake = fixture({ compatibilityRequests: [compatibility] });

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(compatibility.id).not.toBe(state.assignmentId);
	expect(compatibility.id).not.toBe(state.workflowId);
	expect(submitted.result.approvalRequestId).toBe(compatibility.id);
});

it("replays an exact terminal canonical auto-completion without finalization or binding", async () => {
	state.mode = "canonical";
	const workflowId = expectedWorkflowId("manual_time_submission");
	state.workflowId = workflowId;
	const compatibility = compatibilityRequest("manual_time_submission", {
		status: "approved",
		approverId: requesterEmployeeId,
	});
	const otherCompatibility = compatibilityRequest("manual_time_submission", {
		id: "40000000-0000-4000-8000-000000000098",
		status: "approved",
		approverId: requesterEmployeeId,
		metadata: {
			workflow: { id: workflowId, organizationId },
			stage: {
				id: "50000000-0000-4000-8000-000000000098",
				sequence: 2,
			},
			timeRequest: { kind: "manual_time_submission" },
		},
	});
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		approvalWorkflowId: workflowId,
		terminalCanonicalWorkflows: [
			{
				id: workflowId,
				organizationId,
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: workPeriodId,
				requesterEmployeeId,
				status: "approved",
				contextSnapshot: {
					timeRequest: { kind: "manual_time_submission" },
				},
			},
		],
		terminalLegacyMarkedRequests: [compatibility, otherCompatibility],
		hasMalformedLegacyMarker: true,
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
		compatibilityRequests: [compatibility],
	});

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result).toMatchObject({
		kind: "auto_completed",
		approvalRequestId: compatibility.id,
	});
	expect(submitted).toMatchObject({
		disposition: "replayed",
		postCommit: null,
	});
	expect(state.calls.some((call) => call.startsWith("finalize:"))).toBe(false);
	expect(state.calls).not.toContain("binding");
	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
});

it("replays exact approved legacy auto evidence without finalization or mutation", async () => {
	state.mode = "legacy";
	const approvedRequest = {
		id: "40000000-0000-4000-8000-000000000088",
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId: requesterEmployeeId,
		status: "approved",
		approvedAt: new Date("2026-07-22T10:00:00Z"),
		metadata: {
			timeRequest: { kind: "manual_time_submission" },
			autoApproval: { reason: "requester_is_approver" },
		},
	};
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		historicalLegacyAutoRequests: [approvedRequest],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result).toMatchObject({
		kind: "auto_completed",
		approvalRequestId: approvedRequest.id,
	});
	expect(state.calls.some((call) => call.startsWith("finalize:"))).toBe(false);
	expect(state.calls.some((call) => call.startsWith("legacy:"))).toBe(false);
	expect(state.calls).not.toContain("binding");
});

it.each([
	"legacy",
	"shadow",
	"ready",
] as const)("replays one marked multistage auto cycle in %s despite unrelated history", async (mode) => {
	state.mode = mode;
	const chainInstanceId = "70000000-0000-4000-8000-000000000088";
	const first = markedAutoRequest({
		id: "40000000-0000-4000-8000-000000000081",
		chainInstanceId,
		stepOrder: 1,
	});
	const final = markedAutoRequest({
		id: "40000000-0000-4000-8000-000000000082",
		chainInstanceId,
		stepOrder: 2,
	});
	const unrelated = markedAutoRequest({
		id: "40000000-0000-4000-8000-000000000070",
		chainInstanceId: null,
		stepOrder: null,
		key: ordinarySubmissionKey("policy_clock_out"),
	});
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [unrelated, first, final],
		historicalLegacyAutoRequests: [
			{
				id: "historical-unrelated",
				metadata: { diagnostics: true },
			},
			{
				id: "historical-unrelated-2",
				metadata: { diagnostics: true },
			},
		],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result).toMatchObject({
		kind: "auto_completed",
		chainInstanceId,
		approvalRequestId: final.id,
	});
	expect(state.calls.some((call) => call.startsWith("finalize:"))).toBe(false);
	expect(state.calls).not.toContain("binding");
	expect(JSON.stringify(submitted.postCommit)).not.toContain(
		"ordinarySubmission",
	);
});

it("rejects duplicate same-key marked chain cycles", async () => {
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [
			markedAutoRequest({
				id: "40000000-0000-4000-8000-000000000081",
				chainInstanceId: "70000000-0000-4000-8000-000000000081",
				stepOrder: 1,
			}),
			markedAutoRequest({
				id: "40000000-0000-4000-8000-000000000082",
				chainInstanceId: "70000000-0000-4000-8000-000000000082",
				stepOrder: 1,
			}),
		],
		historicalLegacyAutoRequests: [],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls.some((call) => call.startsWith("finalize:"))).toBe(false);
});

it("rejects malformed ordinary submission markers without invoking accessors", async () => {
	const keyGetter = vi.fn(() => ordinarySubmissionKey());
	const ordinarySubmission = ordinarySubmissionMarker();
	Object.defineProperty(ordinarySubmission, "key", {
		enumerable: true,
		get: keyGetter,
	});
	const malformed = markedAutoRequest({
		id: "40000000-0000-4000-8000-000000000081",
		chainInstanceId: null,
		stepOrder: null,
		metadata: {
			timeRequest: { kind: "manual_time_submission" },
			ordinarySubmission,
			autoApproval: { reason: "requester_is_approver" },
		},
	});
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [malformed],
		historicalLegacyAutoRequests: [],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(keyGetter).not.toHaveBeenCalled();
});

it("rejects ambiguous historical unmarked auto rows rather than ordering them", async () => {
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [],
		historicalLegacyAutoRequests: [
			markedAutoRequest({
				id: "40000000-0000-4000-8000-000000000081",
				chainInstanceId: null,
				stepOrder: null,
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					autoApproval: { reason: "requester_is_approver" },
				},
			}),
			markedAutoRequest({
				id: "40000000-0000-4000-8000-000000000082",
				chainInstanceId: null,
				stepOrder: null,
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					autoApproval: { reason: "requester_is_approver" },
				},
			}),
		],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
});

it("replays authoritative shadow legacy auto evidence without treating its observation as deterministic canonical evidence", async () => {
	state.mode = "shadow";
	const observedWorkflowId = "70000000-0000-4000-8000-000000000099";
	const approvedRequest = {
		id: "40000000-0000-4000-8000-000000000088",
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId: requesterEmployeeId,
		status: "approved",
		approvedAt: new Date("2026-07-22T10:00:00Z"),
		metadata: {
			timeRequest: { kind: "manual_time_submission" },
			autoApproval: { reason: "requester_is_approver" },
		},
	};
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		approvalWorkflowId: observedWorkflowId,
		terminalCanonicalWorkflows: [
			{
				id: observedWorkflowId,
				organizationId,
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
				sourceId: workPeriodId,
				requesterEmployeeId,
				status: "approved",
				contextSnapshot: {
					timeRequest: { kind: "manual_time_submission" },
				},
			},
		],
		historicalLegacyAutoRequests: [approvedRequest],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result.approvalRequestId).toBe(approvedRequest.id);
	expect(state.calls.some((call) => call.startsWith("finalize:"))).toBe(false);
	expect(state.calls).not.toContain("binding");
});

it("does not fall back to legacy terminal evidence under canonical authority", async () => {
	state.mode = "canonical";
	const approvedRequest = {
		id: "40000000-0000-4000-8000-000000000088",
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId: requesterEmployeeId,
		status: "approved",
		approvedAt: new Date("2026-07-22T10:00:00Z"),
		metadata: {
			timeRequest: { kind: "manual_time_submission" },
			autoApproval: { reason: "requester_is_approver" },
		},
	};
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		historicalLegacyAutoRequests: [approvedRequest],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls.some((call) => call.startsWith("finalize:"))).toBe(false);
});

it("rejects inverted work-period endpoints before legacy mutation", async () => {
	const invertedEnd = new Date("2026-07-22T07:59:59Z");
	const fake = fixture({
		source: { endTime: invertedEnd, canonicalEndAt: invertedEnd },
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(state.calls.some((call) => call.startsWith("legacy:"))).toBe(false);
});

it.each([
	"routing",
	"source",
	"legacy",
	"capture-before",
	"capture-after",
	"observation",
	"start",
	"binding",
	"projection",
	"outbox",
	"compatibility",
	"finalization",
] as const)("propagates %s failure for caller rollback", async (failure) => {
	state.mode = [
		"start",
		"binding",
		"projection",
		"outbox",
		"compatibility",
	].includes(failure)
		? "canonical"
		: failure.startsWith("capture") || failure === "observation"
			? "shadow"
			: "legacy";
	state.failure = failure;
	if (failure === "finalization") {
		state.result = {
			kind: "auto_completed",
			chainInstanceId: null,
			approvalRequestId: "40000000-0000-4000-8000-000000000001",
			reason: "requester_is_approver",
		};
	}
	const fake = fixture();
	const privateMessage = `private-${failure}-evidence`;
	const rejected = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	).catch((error: unknown) => error);
	expect(rejected).toBeInstanceOf(Error);
	expect(String(rejected)).toContain("Ordinary work-period submission failed");
	expect(String(rejected)).not.toContain(privateMessage);
});
