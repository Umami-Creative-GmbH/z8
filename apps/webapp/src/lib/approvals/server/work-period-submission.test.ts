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
					if (state.failure === "legacy") throw new Error("legacy");
					return state.result;
				},
				catch: (error) => error as Error,
			}),
	};
});

vi.mock("../domain-adapters/work-period-legacy-state", () => ({
	captureOrdinaryWorkPeriodLegacyPreSubmissionState: async () => {
		state.calls.push("capture:before");
		if (state.failure === "capture-before") throw new Error("capture-before");
		return verifiedState(null);
	},
	captureOrdinaryWorkPeriodLegacyState: async (input: {
		expectedRequestStatus: string;
	}) => {
		state.calls.push(`capture:after:${input.expectedRequestStatus}`);
		if (state.failure === "capture-after") throw new Error("capture-after");
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
				if (state.failure === "observation") throw new Error("observation");
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
	}) => {
		state.calls.push(`start:${input.submissionKey}`);
		state.calls.push(`context:${JSON.stringify(input.contextSnapshot)}`);
		if (state.failure === "start") throw new Error("start");
		const id = "70000000-0000-4000-8000-000000000001";
		await input.bindSourceWorkflow(id);
		if (state.failure === "projection") throw new Error("projection");
		if (state.failure === "outbox") throw new Error("outbox");
		const auto = state.result.kind === "auto_completed";
		return {
			kind: "created" as const,
			status: auto ? ("approved" as const) : ("pending" as const),
			terminal: auto,
			snapshot: {
				id,
				status: auto ? "approved" : "pending",
				completedAt: auto ? parseInstant("2026-07-22T10:00:00Z") : null,
				stages: auto
					? [{ activationMode: "requester_auto_approve", assignments: [] }]
					: [
							{
								activationMode: "human",
								assignments: [
									{
										id: "60000000-0000-4000-8000-000000000001",
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
		if (state.failure === "finalization") throw new Error("finalization");
		return {};
	};
	return {
		...actual,
		finalizeOrdinaryWorkPeriodTerminalInTransaction: finalize,
		finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction: finalize,
	};
});

import {
	type ExecuteOrdinaryWorkPeriodSubmissionInput,
	executeOrdinaryWorkPeriodSubmissionInTransaction,
} from "./work-period-submission";

const organizationId = "org-1";
const workPeriodId = "10000000-0000-4000-8000-000000000001";
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
		...overrides,
	};
}

function fixture(
	options: { source?: Record<string, unknown>; differentDb?: boolean } = {},
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
				if (state.failure === "binding") throw new Error("binding");
				return { rows: [{ id: workPeriodId, organizationId }] };
			}
			if (state.failure === "source") throw new Error("source");
			return { rows: [row] };
		}),
		query: {
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue({
					id: "40000000-0000-4000-8000-000000000001",
					approverId,
				}),
			},
		},
	};
	const writeGate = {
		acquire: vi.fn(async () => {
			state.calls.push("routing");
			if (state.failure === "routing") throw new Error("routing");
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
			if (state.failure === "compatibility") throw new Error("compatibility");
		}),
	};
	const context = {
		dbService: { db: options.differentDb ? {} : db },
		writeGate,
		compatibilityWriter,
		repository: {},
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
	state.result = {
		kind: "default_created",
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
	};
});

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
	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow(failure);
});
