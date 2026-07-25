import { getTableName } from "drizzle-orm";
import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
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
	useRealResolver: false,
	resolverError: null as unknown,
	originError: null as unknown,
}));
const terminalBreakMocks = vi.hoisted(() => ({
	apply: vi.fn().mockResolvedValue({
		kind: "not_required",
		maintenance: {
			organizationId: "org-1",
			employeeId: "20000000-0000-4000-8000-000000000001",
			dirtyFromDate: "2026-07-22",
			decision: "approved",
			surchargePeriodIds: ["10000000-0000-4000-8000-000000000001"],
			staleSurchargePeriodIds: [],
		},
	}),
}));

vi.mock("@/lib/time-tracking/policy-clock-out-terminal-break", () => ({
	applyPolicyClockOutTerminalBreakInTransaction: terminalBreakMocks.apply,
}));

vi.mock("../policies/chain-service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../policies/chain-service")>();
	return {
		...actual,
		resolvePolicyAndCreateApproval: (db: never, input: never) =>
			state.useRealResolver
				? actual.resolvePolicyAndCreateApproval(db, input)
				: Effect.tryPromise({
						try: async () => {
							state.calls.push(`legacy:${JSON.stringify(input)}`);
							if (state.resolverError) throw state.resolverError;
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
		if (state.failure === "start")
			throw state.originError ?? new Error("private-start-evidence");
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

import { deriveApprovalWorkflowId } from "../workflow/identity";
import {
	type ExecuteOrdinaryWorkPeriodSubmissionInput,
	executeOrdinaryWorkPeriodSubmissionInTransaction,
	OrdinaryWorkPeriodSubmissionError,
} from "./work-period-submission";

const organizationId = "org-1";
const workPeriodId = "10000000-0000-4000-8000-000000000001";
const submissionId = "10000000-0000-4000-8000-000000000099";
const requesterEmployeeId = "20000000-0000-4000-8000-000000000001";
const requesterUserId = "user-1";
const approverId = "20000000-0000-4000-8000-000000000002";
const startTime = new Date("2026-07-22T08:00:00.000Z");
const endTime = new Date("2026-07-22T16:00:00.000Z");
const breakPolicySnapshot = {
	version: 1,
	evaluatedAt: "2026-07-22T16:00:00Z",
	resolution: "none",
} as const;
const surchargeSnapshot = {
	version: 1,
	evaluatedAt: "2026-07-22T16:00:00Z",
	resolution: { kind: "none" },
} as const;
const terminalPolicySnapshot = {
	version: 1,
	evaluatedAt: "2026-07-22T16:00:00Z",
	resolution: "work_policy",
	teamId: null,
	assignment: {
		id: "80000000-0000-4000-8000-000000000001",
		type: "organization",
	},
	policy: {
		id: "80000000-0000-4000-8000-000000000002",
		name: "Original policy",
	},
	regulationEnabled: false,
	regulation: {
		id: null,
		name: null,
		maxUninterruptedMinutes: null,
	},
	breakRules: [],
} as const;

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
		sourceSnapshot: {
			timeRequest: { kind: "manual_time_submission" },
			surchargeSnapshot,
		},
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
		pendingChanges: {
			ordinarySubmission: { submissionId, kind: state.kind },
			surchargeSnapshot,
			...(state.kind === "policy_clock_out"
				? {
						breakPolicySnapshot: {
							version: 1,
							evaluatedAt: "2026-07-22T16:00:00Z",
							resolution: "none",
						},
					}
				: {}),
		},
		isActive: false,
		startTime,
		endTime,
		wasAutoAdjusted: false,
		originalEndTime: null,
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
		terminalCanonicalReceipts: [],
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
		employees?: Record<string, unknown>[];
		managerLinks?: Record<string, unknown>[];
		sourceFromQuery?: (query: {
			sql: string;
			params: unknown[];
		}) => Record<string, unknown>;
		compatibilityRequests?: Record<string, unknown>[];
		workflowSnapshot?: Record<string, unknown>;
		differentDb?: boolean;
	} = {},
) {
	const calls: string[] = [];
	const queries: Array<{ sql: string; params: unknown[] }> = [];
	const dialect = new PgDialect();
	const row = source(options.source) as Record<string, unknown>;
	let finalizerUpdateIndex = 0;
	const db = {
		execute: vi.fn(async (query: SQL) => {
			const compiled = dialect.sqlToQuery(query);
			const text = compiled.sql;
			calls.push(text);
			queries.push(compiled);
			if (text.includes("pg_advisory_xact_lock"))
				return { rows: [{ locked: null }] };
			if (text.includes("update work_period")) {
				state.calls.push("binding");
				if (state.failure === "binding")
					throw new Error("private-binding-evidence");
				row.approvalWorkflowId = compiled.params[0];
				return { rows: [{ id: workPeriodId, organizationId }] };
			}
			if (state.failure === "source")
				throw state.originError ?? new Error("private-source-evidence");
			if (text.includes('as "terminalCanonicalWorkflows"')) {
				return {
					rows: [
						source(
							options.sourceFromQuery?.(compiled) ??
								options.replaySource ??
								options.source,
						),
					],
				};
			}
			if (text.includes('select id, organization_id as "organizationId"')) {
				return { rows: [{ id: workPeriodId, organizationId }] };
			}
			return { rows: [row] };
		}),
		query: {
			approvalPolicy: { findMany: vi.fn().mockResolvedValue([]) },
			employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
			employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
			employee: {
				findFirst: vi.fn().mockResolvedValue({
					id: requesterEmployeeId,
					userId: requesterUserId,
					isActive: true,
				}),
				findMany: vi.fn().mockResolvedValue(
					options.employees ?? [
						{
							id: requesterEmployeeId,
							organizationId,
							userId: requesterUserId,
							isActive: true,
						},
					],
				),
			},
			timeEntry: {
				findFirst: vi.fn().mockResolvedValue({
					id: "30000000-0000-4000-8000-000000000001",
					utcOffsetMinutes: 0,
				}),
			},
			employeeManagers: {
				findMany: vi.fn().mockResolvedValue(options.managerLinks ?? []),
			},
			teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
			team: { findMany: vi.fn().mockResolvedValue([]) },
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
		select: vi.fn(() => ({
			from: vi.fn((table: Parameters<typeof getTableName>[0]) => {
				const tableName = getTableName(table);
				const rows =
					tableName === "work_period"
						? [
								{
									...row,
									projectId: null,
									workCategoryId: null,
									workLocationType: null,
									approvalStatus: "pending",
								},
							]
						: tableName === "time_record"
							? [
									{
										id: row.canonicalRecordId,
										organizationId,
										employeeId: requesterEmployeeId,
										recordKind: "work",
										startAt: startTime,
										endAt: endTime,
										durationMinutes: 480,
										approvalState: "pending",
										origin: "clock",
									},
								]
							: [
									{
										id: state.result.approvalRequestId,
										organizationId,
										entityType: "time_entry",
										entityId: workPeriodId,
										requestedBy: requesterEmployeeId,
										approverId: requesterEmployeeId,
										status: "approved",
										approvedAt: new Date("2026-07-22T10:00:00Z"),
										canonicalRecordId: row.canonicalRecordId,
										rejectionReason: null,
										metadata: {
											timeRequest: { kind: state.kind },
											surchargeSnapshot,
											...(state.kind === "policy_clock_out"
												? {
														breakPolicySnapshot: {
															version: 1,
															evaluatedAt: "2026-07-22T16:00:00Z",
															resolution: "none",
														},
													}
												: {}),
											ordinarySubmission: {
												key: ordinarySubmissionKey(state.kind),
												submissionId,
											},
											autoApproval: { reason: "requester_is_approver" },
										},
									},
								];
				return {
					where: vi.fn(() => ({
						for: vi.fn().mockResolvedValue(rows),
						limit: vi.fn().mockResolvedValue(rows),
					})),
				};
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn().mockImplementation(async () => {
						const index = finalizerUpdateIndex++;
						if (index === 0) state.calls.push("finalize:source");
						if (state.failure === "finalization" && index === 0) return [];
						return [
							{
								id: index === 0 ? workPeriodId : row.canonicalRecordId,
							},
						];
					}),
				})),
			})),
		})),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn().mockResolvedValue([{ id: "decision-1" }]),
			})),
		})),
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
				throw state.originError ?? new Error("private-compatibility-evidence");
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
				workflowType: state.kind,
				sourceType: "time_entry",
				sourceId: workPeriodId,
				requesterEmployeeId,
				status: "approved",
				currentStageOrder: 1,
				version: 1,
				contextSnapshot: {
					timeRequest: { kind: state.kind },
					surchargeSnapshot,
					...(state.kind === "policy_clock_out" ? { breakPolicySnapshot } : {}),
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
				...options.workflowSnapshot,
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
	return { calls, queries, compatibilityWriter, input };
}

beforeEach(() => {
	state.mode = "legacy";
	state.failure = null;
	state.calls = [];
	state.startKind = "created";
	state.workflowId = expectedWorkflowId("manual_time_submission");
	state.kind = "manual_time_submission";
	state.useRealResolver = false;
	state.resolverError = null;
	state.originError = null;
	terminalBreakMocks.apply.mockClear();
	terminalBreakMocks.apply.mockResolvedValue({ kind: "not_required" });
	state.result = {
		kind: "default_created",
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
	};
});

it("preserves the exact real resolver no-manager validation error", async () => {
	state.useRealResolver = true;
	const fake = fixture();
	fake.input.defaultApproverId = null;

	const rejected = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	).catch((error: unknown) => error);

	expect(rejected).toBeInstanceOf(ValidationError);
	expect(rejected).toMatchObject({
		_tag: "ValidationError",
		field: "managerId",
		message: "No manager assigned to approve time changes",
	});
});

it("localizes resolver no-manager validation error provenance", async () => {
	const expected = new ValidationError({
		field: "managerId",
		message: "No manager assigned to approve time changes",
	});
	state.resolverError = expected;
	const fake = fixture();

	const rejected = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	).catch((error: unknown) => error);

	expect(rejected).toBeInstanceOf(ValidationError);
	expect(rejected).not.toBe(expected);
	expect(rejected).toMatchObject({
		field: "managerId",
		message: "No manager assigned to approve time changes",
	});
});

it.each([
	"source",
	"start",
	"compatibility",
	"finalization",
])("redacts an exact-looking manager validation error from %s", async (origin) => {
	state.failure = origin;
	state.originError = new ValidationError({
		field: "managerId",
		message: "No manager assigned to approve time changes",
	});
	if (origin !== "source") state.mode = "canonical";
	if (origin === "finalization") {
		state.result = {
			kind: "auto_completed",
			chainInstanceId: null,
			approvalRequestId: "40000000-0000-4000-8000-000000000001",
			reason: "requester_is_approver",
		};
	}
	const fake = fixture();

	const rejected = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	).catch((error: unknown) => error);

	expect(rejected).toBeInstanceOf(OrdinaryWorkPeriodSubmissionError);
	expect(rejected).not.toBe(state.originError);
});

it.each([
	{
		field: "managerId",
		message: "private policy stage resolution detail",
	},
	{
		field: "approvalPolicyStage.approverType",
		message: "No manager assigned to approve time changes",
	},
])("redacts non-allowlisted resolver validation errors %#", async (error) => {
	state.resolverError = new ValidationError(error);
	const fake = fixture();

	const rejected = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	).catch((caught: unknown) => caught);

	expect(rejected).toBeInstanceOf(OrdinaryWorkPeriodSubmissionError);
	expect(rejected).not.toBeInstanceOf(ValidationError);
	expect(String(rejected)).not.toContain(error.message);
});

it.each([
	{
		_tag: "ValidationError",
		field: "managerId",
		message: "No manager assigned to approve time changes",
		privateDetail: "dependency-owned evidence",
	},
	Object.assign(Object.create(ValidationError.prototype), {
		field: "managerId",
		message: "No manager assigned to approve time changes",
		privateDetail: "prototype-spoofed evidence",
	}),
])("redacts spoofed manager validation errors %#", async (spoofed) => {
	state.resolverError = spoofed;
	const fake = fixture();

	const rejected = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	).catch((error: unknown) => error);

	expect(rejected === spoofed).toBe(false);
	expect(rejected).toBeInstanceOf(OrdinaryWorkPeriodSubmissionError);
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

function markerIdentityPredicate(query: { sql: string; params: unknown[] }) {
	const match = query.sql.match(
		/request\.metadata -> 'ordinarySubmission' ->> 'key' is distinct from \$(\d+)\s+(or|and)\s+request\.metadata -> 'ordinarySubmission' ->> 'submissionId' is distinct from \$(\d+)/i,
	);
	if (!match) return null;
	return {
		connector: match[2].toLowerCase() as "or" | "and",
		key: query.params[Number(match[1]) - 1],
		submissionId: query.params[Number(match[3]) - 1],
	};
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
				surchargeSnapshot,
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
			surchargeSnapshot,
			...(kind === "policy_clock_out" ? { breakPolicySnapshot } : {}),
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
			maintenance: null,
		});
		if (mode === "legacy") expect(state.calls).not.toContain("observation");
		if (mode === "shadow" || mode === "ready") {
			expect(state.calls).toContain("capture:before");
			expect(state.calls).toContain("capture:after:pending");
			expect(state.calls).toContain("observation");
		}
		if (mode === "canonical" || mode === "complete") {
			expect(state.calls).toContain(
				`context:${JSON.stringify({
					timeRequest: { kind },
					...(kind === "policy_clock_out"
						? {
								breakPolicySnapshot: {
									version: 1,
									evaluatedAt: "2026-07-22T16:00:00Z",
									resolution: "none",
								},
							}
						: {}),
					surchargeSnapshot,
				})}`,
			);
		}
	});
});

it("resolves the current fallback manager inside the submission transaction", async () => {
	const currentApproverId = "20000000-0000-4000-8000-000000000003";
	const fake = fixture({
		employees: [
			{
				id: requesterEmployeeId,
				organizationId,
				userId: requesterUserId,
				isActive: true,
				role: "employee",
			},
			{
				id: currentApproverId,
				organizationId,
				userId: "user-current-manager",
				isActive: true,
				role: "manager",
			},
		],
		managerLinks: [
			{
				employeeId: requesterEmployeeId,
				managerId: currentApproverId,
				isPrimary: true,
			},
		],
	});
	fake.input.defaultApproverId = approverId;

	await executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input);

	const resolverCall = state.calls.find((call) => call.startsWith("legacy:"));
	expect(JSON.parse(resolverCall?.slice("legacy:".length) ?? "")).toMatchObject(
		{
			defaultApproverId: currentApproverId,
		},
	);
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
		surchargeSnapshot,
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
		surchargeSnapshot,
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

it("rejects a pending policy clock-out replay with changed normalized break evidence", async () => {
	state.kind = "policy_clock_out";
	const request = pendingLegacyRequest({
		timeRequest: { kind: "policy_clock_out" },
		breakPolicySnapshot: {
			version: 1,
			evaluatedAt: "2026-07-22T16:00:00Z",
			resolution: "work_policy",
			teamId: null,
			assignment: {
				id: "31000000-0000-4000-8000-000000000001",
				type: "employee",
			},
			policy: {
				id: "32000000-0000-4000-8000-000000000001",
				name: "Changed",
			},
			regulationEnabled: true,
			regulation: {
				id: "33000000-0000-4000-8000-000000000001",
				name: "Changed",
				maxUninterruptedMinutes: null,
			},
			breakRules: [],
		},
		ordinarySubmission: { key: ordinarySubmissionKey(), submissionId },
	});
	const fake = fixture({ source: { pendingLegacyRequests: [request] } });
	fake.input.kind = "policy_clock_out";

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	expect(fake.calls.some((query) => query.includes("update work_period"))).toBe(
		false,
	);
});

it("preserves exact historical pending metadata replay", async () => {
	const request = pendingLegacyRequest({
		timeRequest: { kind: "manual_time_submission" },
	});
	const fake = fixture({
		source: { pendingChanges: null, pendingLegacyRequests: [request] },
	});

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
						surchargeSnapshot,
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
	state.kind = kind;
	state.workflowId = expectedWorkflowId(kind);
	const fake = fixture();
	fake.input.kind = kind;

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(state.calls.indexOf("finalize:source")).toBeLessThan(
		state.calls.indexOf("compatibility"),
	);
	expect(submitted.postCommit).toMatchObject({
		event: "approved",
		disposition: "observe",
		approverEmployeeId: requesterEmployeeId,
	});
});

it.each([
	"legacy",
	"shadow",
	"ready",
	"canonical",
	"complete",
] as const)("finalizes policy requester auto-completion exactly once in %s", async (mode) => {
	state.mode = mode;
	state.result = {
		kind: "auto_completed",
		chainInstanceId: null,
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
		reason: "requester_is_approver",
	};
	state.kind = "policy_clock_out";
	state.workflowId = expectedWorkflowId("policy_clock_out");
	const fake = fixture();
	fake.input.kind = "policy_clock_out";

	await executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input);

	expect(state.calls.filter((call) => call === "finalize:source")).toEqual([
		"finalize:source",
	]);
	expect(terminalBreakMocks.apply).toHaveBeenCalledOnce();
});

it.each([
	"legacy",
	"shadow",
	"ready",
	"canonical",
	"complete",
] as const)("does not apply policy breaks to manual requester auto-completion in %s", async (mode) => {
	state.mode = mode;
	state.result = {
		kind: "auto_completed",
		chainInstanceId: null,
		approvalRequestId: "40000000-0000-4000-8000-000000000001",
		reason: "requester_is_approver",
	};
	state.kind = "manual_time_submission";
	state.workflowId = expectedWorkflowId("manual_time_submission");
	const fake = fixture();

	await executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input);

	expect(terminalBreakMocks.apply).not.toHaveBeenCalled();
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
	expect(state.calls.indexOf("finalize:source")).toBeLessThan(
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
						surchargeSnapshot,
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

it.each([
	"approved",
	"rejected",
] as const)("replays an exact terminal legacy policy %s submission before pending snapshot validation", async (status) => {
	state.mode = "legacy";
	state.kind = "policy_clock_out";
	const approvalRequestId = "40000000-0000-4000-8000-000000000077";
	const terminalRequest = {
		id: approvalRequestId,
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId,
		status,
		approvedAt: status === "approved" ? new Date("2026-07-22T17:00:00Z") : null,
		metadata: {
			timeRequest: { kind: "policy_clock_out" },
			breakPolicySnapshot,
			surchargeSnapshot,
			ordinarySubmission: {
				key: ordinarySubmissionKey("policy_clock_out"),
				submissionId,
			},
		},
		chainInstanceId: null,
		stageId: null,
		stepOrder: null,
	};
	const terminalSource = {
		approvalStatus: status,
		canonicalApprovalState: status,
		pendingChanges: null,
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [terminalRequest],
		historicalLegacyAutoRequests: [],
	};
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
	});
	fake.input.kind = "policy_clock_out";

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted).toEqual({
		result: { kind: "default_created", approvalRequestId },
		disposition: "replayed",
		postCommit: null,
	});
	expect(state.calls.some((call) => call.startsWith("legacy:"))).toBe(false);
	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
	expect(state.calls).not.toContain("finalize:source");
});

it.each([
	...(["legacy", "shadow", "ready", "canonical", "complete"] as const).flatMap(
		(mode) => [
			{
				mode,
				status: "approved" as const,
				split: false,
				chain: false,
				evidence: "exact",
			},
			{
				mode,
				status: "rejected" as const,
				split: false,
				chain: false,
				evidence: "exact",
			},
			{
				mode,
				status: "approved" as const,
				split: true,
				chain: false,
				evidence: "exact",
			},
			{
				mode,
				status: "approved" as const,
				split: false,
				chain: true,
				evidence: "exact",
			},
		],
	),
	...(["canonical", "complete"] as const).flatMap((mode) => [
		{
			mode,
			status: "approved" as const,
			split: false,
			chain: false,
			evidence: "missing",
		},
		{
			mode,
			status: "approved" as const,
			split: false,
			chain: false,
			evidence: "mismatch",
		},
	]),
])("handles $evidence terminal policy submission evidence in $mode after $status with split=$split chain=$chain", async ({
	mode,
	status,
	split,
	chain,
	evidence,
}) => {
	state.mode = mode;
	state.kind = "policy_clock_out";
	const workflowId = expectedWorkflowId("policy_clock_out");
	state.workflowId = workflowId;
	const approvalRequestId = "40000000-0000-4000-8000-000000000077";
	const contextSnapshot = {
		timeRequest: { kind: "policy_clock_out" },
		breakPolicySnapshot: terminalPolicySnapshot,
		surchargeSnapshot,
	};
	const chainInstanceId = chain ? "40000000-0000-4000-8000-000000000088" : null;
	const terminalRequest = {
		id: approvalRequestId,
		organizationId,
		entityType: "time_entry",
		entityId: workPeriodId,
		requestedBy: requesterEmployeeId,
		approverId,
		status,
		approvedAt: status === "approved" ? new Date("2026-07-22T17:00:00Z") : null,
		metadata: {
			...contextSnapshot,
			ordinarySubmission: {
				key: ordinarySubmissionKey("policy_clock_out"),
				submissionId,
			},
		},
		chainInstanceId,
		stageId: chain ? state.stageId : null,
		stepOrder: chain ? 1 : null,
		...(chain
			? {
					chainOrganizationId: organizationId,
					chainEntityType: "time_entry",
					chainEntityId: workPeriodId,
					chainRequesterEmployeeId: requesterEmployeeId,
					chainStatus: status,
					chainCurrentStageOrder: 2,
					chainCompletedAt: new Date("2026-07-22T17:00:00Z"),
					chainStageCount: 2,
					stageStatus: "approved",
					stageApprovalRequestId: approvalRequestId,
					stageDecidedBy: approverId,
					stageDecidedAt: new Date("2026-07-22T16:30:00Z"),
				}
			: {}),
	};
	const secondRequest = {
		...terminalRequest,
		id: "40000000-0000-4000-8000-000000000078",
		stageId: "40000000-0000-4000-8000-000000000079",
		stepOrder: 2,
		stageApprovalRequestId: "40000000-0000-4000-8000-000000000078",
		stageDecidedAt: new Date("2026-07-22T17:00:00Z"),
	};
	const terminalWorkflow = {
		id: workflowId,
		organizationId,
		workflowType: "policy_clock_out",
		sourceType: "time_entry",
		sourceId: workPeriodId,
		requesterEmployeeId,
		status,
		contextSnapshot,
	};
	const receipt = {
		organizationId,
		workflowId,
		idempotencyKey: ordinarySubmissionKey("policy_clock_out"),
		version: 1,
		eventIndex: 0,
	};
	const terminalSource = {
		approvalStatus: status,
		canonicalApprovalState: status,
		pendingChanges: null,
		...(split
			? {
					endTime: new Date("2026-07-22T15:30:00Z"),
					canonicalEndAt: new Date("2026-07-22T15:30:00Z"),
					durationMinutes: 450,
					canonicalDurationMinutes: 450,
					wasAutoAdjusted: true,
					originalEndTime: endTime,
				}
			: {}),
		approvalWorkflowId: mode === "legacy" ? null : workflowId,
		terminalCanonicalWorkflows: mode === "legacy" ? [] : [terminalWorkflow],
		terminalCanonicalReceipts:
			mode === "legacy" || evidence === "missing"
				? []
				: [
						evidence === "mismatch"
							? {
									...receipt,
									workflowId: "40000000-0000-4000-8000-000000000099",
								}
							: receipt,
					],
		terminalLegacyMarkedRequests:
			mode === "legacy" || mode === "shadow" || mode === "ready"
				? chain
					? [terminalRequest, secondRequest]
					: [terminalRequest]
				: [],
		historicalLegacyAutoRequests: [],
	};
	const compatibility = compatibilityRequest("policy_clock_out", {
		id: approvalRequestId,
		status,
		metadata: {
			workflow: { id: workflowId, organizationId },
			stage: { id: state.stageId, sequence: 1 },
			...contextSnapshot,
		},
	});
	const fake = fixture({
		source: terminalSource,
		replaySource: terminalSource,
		compatibilityRequests: mode === "canonical" ? [compatibility] : [],
		workflowSnapshot: {
			status,
			contextSnapshot,
			completedAt: parseInstant("2026-07-22T17:00:00Z"),
			stages: [
				{
					id: state.stageId,
					sequence: 1,
					activationMode: "human",
					status,
					assignments: [
						{
							id: state.assignmentId,
							status,
							approverEmployeeId: approverId,
						},
					],
				},
				...(chain
					? [
							{
								id: "40000000-0000-4000-8000-000000000079",
								sequence: 2,
								activationMode: "human" as const,
								status,
								assignments: [
									{
										id: "40000000-0000-4000-8000-000000000078",
										status,
										approverEmployeeId: approverId,
									},
								],
							},
						]
					: []),
			],
		},
	});
	fake.input.kind = "policy_clock_out";
	fake.input.teamId = "90000000-0000-4000-8000-000000000099";

	const execute = () =>
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input);
	if (evidence !== "exact") {
		await expect(execute()).rejects.toThrow(OrdinaryWorkPeriodSubmissionError);
		expect(state.calls.some((call) => call.startsWith("legacy:"))).toBe(false);
		expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
		expect(state.calls).not.toContain("finalize:source");
		return;
	}
	const submitted = await execute();

	expect(submitted).toEqual({
		result: chain
			? {
					kind: "chain_created",
					chainInstanceId:
						mode === "canonical" || mode === "complete"
							? workflowId
							: chainInstanceId,
					approvalRequestId:
						mode === "complete" ? state.assignmentId : approvalRequestId,
				}
			: {
					kind: "default_created",
					approvalRequestId:
						mode === "complete" ? state.assignmentId : approvalRequestId,
				},
		disposition: "replayed",
		postCommit: null,
	});
	expect(state.calls.some((call) => call.startsWith("legacy:"))).toBe(false);
	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
	expect(state.calls).not.toContain("finalize:source");
	expect(
		fake.queries.filter(({ sql }) => /\bwork_policy(?:_|\b)/.test(sql)),
	).toEqual([]);
});

it.each([
	"manual_time_submission",
	"policy_clock_out",
] as const)("replays an exact terminal canonical %s auto-completion without finalization or binding", async (kind) => {
	state.mode = "canonical";
	state.kind = kind;
	const workflowId = expectedWorkflowId(kind);
	state.workflowId = workflowId;
	const compatibility = compatibilityRequest(kind, {
		status: "approved",
		approverId: requesterEmployeeId,
	});
	const otherCompatibility = compatibilityRequest(kind, {
		id: "40000000-0000-4000-8000-000000000098",
		status: "approved",
		approverId: requesterEmployeeId,
		metadata: {
			workflow: { id: workflowId, organizationId },
			stage: {
				id: "50000000-0000-4000-8000-000000000098",
				sequence: 2,
			},
			timeRequest: { kind },
			surchargeSnapshot,
			...(kind === "policy_clock_out" ? { breakPolicySnapshot } : {}),
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
				workflowType: kind,
				sourceType: "time_entry",
				sourceId: workPeriodId,
				requesterEmployeeId,
				status: "approved",
				contextSnapshot: {
					timeRequest: { kind },
					surchargeSnapshot,
					...(kind === "policy_clock_out" ? { breakPolicySnapshot } : {}),
				},
			},
		],
		terminalCanonicalReceipts: [
			{
				organizationId,
				workflowId,
				idempotencyKey: ordinarySubmissionKey(kind),
				version: 1,
				eventIndex: 0,
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
	fake.input.kind = kind;

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result).toMatchObject({
		kind: "auto_completed",
		approvalRequestId: state.stageId,
	});
	expect(submitted).toMatchObject({
		disposition: "replayed",
		postCommit: null,
	});
	expect(state.calls).not.toContain("finalize:source");
	expect(state.calls).not.toContain("binding");
	expect(state.calls.some((call) => call.startsWith("start:"))).toBe(false);
});

it.each([
	"manual_time_submission",
	"policy_clock_out",
] as const)("replays exact approved legacy %s auto evidence without finalization or mutation", async (kind) => {
	state.mode = "legacy";
	state.kind = kind;
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
			timeRequest: { kind },
			...(kind === "policy_clock_out"
				? { breakPolicySnapshot, surchargeSnapshot }
				: {}),
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
	fake.input.kind = kind;

	const submitted = await executeOrdinaryWorkPeriodSubmissionInTransaction(
		fake.input,
	);

	expect(submitted.result).toMatchObject({
		kind: "auto_completed",
		approvalRequestId: approvedRequest.id,
	});
	expect(state.calls).not.toContain("finalize:source");
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
	expect(state.calls).not.toContain("finalize:source");
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
	expect(state.calls).not.toContain("finalize:source");
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

it.each([
	["wrong key", { ...ordinarySubmissionMarker(), key: "wrong-submission-key" }],
	[
		"wrong submission token",
		{
			...ordinarySubmissionMarker(),
			submissionId: "20000000-0000-4000-8000-000000000099",
		},
	],
] as const)("rejects a well-shaped marked row with %s before historical auto fallback", async (_label, marker) => {
	const historicalAuto = markedAutoRequest({
		id: "40000000-0000-4000-8000-000000000081",
		chainInstanceId: null,
		stepOrder: null,
		metadata: {
			timeRequest: { kind: "manual_time_submission" },
			autoApproval: { reason: "requester_is_approver" },
		},
	});
	const terminalSource = {
		approvalStatus: "approved",
		canonicalApprovalState: "approved",
		terminalCanonicalWorkflows: [],
		terminalLegacyMarkedRequests: [],
		historicalLegacyAutoRequests: [historicalAuto],
	};
	const fake = fixture({
		sourceFromQuery: (query) => {
			const predicate = markerIdentityPredicate(query);
			const keyMismatch = marker.key !== predicate?.key;
			const tokenMismatch = marker.submissionId !== predicate?.submissionId;
			return {
				...terminalSource,
				hasMalformedLegacyMarker:
					predicate?.connector === "or"
						? keyMismatch || tokenMismatch
						: predicate?.connector === "and"
							? keyMismatch && tokenMismatch
							: false,
			};
		},
	});

	await expect(
		executeOrdinaryWorkPeriodSubmissionInTransaction(fake.input),
	).rejects.toThrow("Ordinary work-period submission failed");
	const sourceQuery = fake.queries.find(({ sql }) =>
		sql.includes('as "hasMalformedLegacyMarker"'),
	);
	expect(sourceQuery && markerIdentityPredicate(sourceQuery)).toEqual({
		connector: "or",
		key: ordinarySubmissionKey(),
		submissionId,
	});
	expect(sourceQuery?.sql).not.toContain(ordinarySubmissionKey());
	expect(sourceQuery?.sql).not.toContain(submissionId);
	expect(state.calls).not.toContain("finalize:source");
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
		terminalCanonicalReceipts: [
			{
				organizationId,
				workflowId: observedWorkflowId,
				idempotencyKey: ordinarySubmissionKey(),
				version: 1,
				eventIndex: 0,
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
	expect(state.calls).not.toContain("finalize:source");
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
	expect(state.calls).not.toContain("finalize:source");
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
