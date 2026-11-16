import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { fingerprintApprovalWorkflowCommand } from "../workflow/transition-engine";
import type { ApprovalDbService } from "./types";

const notificationMocks = vi.hoisted(() => ({
	onClockOutApproved: vi.fn(),
	onClockOutRejected: vi.fn(),
	onManualEntryApproved: vi.fn(),
	onManualEntryRejected: vi.fn(),
}));
const terminalBreakMocks = vi.hoisted(() => ({
	enforce: vi.fn().mockResolvedValue({ kind: "not_required" }),
}));
const legacyCaptureMocks = vi.hoisted(() => ({
	capture: vi.fn(),
	load: vi.fn(),
}));
const chainProgressMocks = vi.hoisted(() => ({
	progress: vi.fn(),
}));
const managerEligibilityMocks = vi.hoisted(() => ({
	isEligible: vi.fn(),
}));
// Evidence reads/writes are covered by the PostgreSQL suite; here they are
// inert unless a test drives the owner's ordering through them.
const workPeriodEvidenceMocks = vi.hoisted(() => ({
	prepare: vi.fn(),
	record: vi.fn(),
}));
const surchargeSnapshot = {
	version: 1,
	evaluatedAt: "2026-07-14T16:00:00Z",
	resolution: { kind: "none" },
} as const;

// The legacy transfer journal and its request lock are verified against
// PostgreSQL (#439, legacy-time-transfer.integration.test.ts); these
// harnesses decide requests escalation never transferred.
const legacyTransferMocks = vi.hoisted(() => ({
	assertDecisionAuthority: vi.fn(async () => undefined),
	wasTransferred: vi.fn(async () => false),
}));

// Deputy decisions read and write the acting-for record; verified against
// PostgreSQL in deputy-decisions.integration.test.ts (#1016).
vi.mock("@/lib/approvals/deputy/deputy-decision-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/approvals/deputy/deputy-decision-store")>()),
	coversCurrentApprover: async () => false,
	loadDeputyActingFor: async () => null,
	recordCanonicalDeputyDecisionOf: async () => null,
	authorizeLegacyDeputyDecision: async () => {
		const { deputyDecisionRefusalError } = await import("@/lib/approvals/deputy/deputy-decision");
		throw deputyDecisionRefusalError("not_covering", {
			actorEmployeeId: "actor",
			resource: "approval_request",
			action: "approve",
		});
	},
}));
vi.mock("../escalation/legacy-transfer-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("../escalation/legacy-transfer-store")>()),
	assertLegacyTransferDecisionAuthority: legacyTransferMocks.assertDecisionAuthority,
	wasLegacyRequestTransferred: legacyTransferMocks.wasTransferred,
}));

vi.mock("@/lib/notifications/triggers", () => notificationMocks);
// Work records decides the approval state on both records (#1227). These
// mock-database harnesses see the change the finalizer asks for, and the fake
// writes its outline (both approval states) through the harness database; a
// write that misses its row comes back as a stale outcome. The real writes,
// record agreement and effects are verified against PostgreSQL
// (work-records/amend.integration.test.ts, clocking.policy-break-split).
const workRecordChanges = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/lib/time-tracking/work-transaction", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/time-tracking/work-transaction")>()),
	holdFinalizerEmployeeLocks: async () => undefined,
}));
vi.mock("@/lib/time-tracking/work-records", async (importOriginal) => {
	const fake = await import("./__tests__/fake-work-records");
	return {
		...(await importOriginal<typeof import("@/lib/time-tracking/work-records")>()),
		workRecordScopeForFinalizer: fake.fakeFinalizerScope,
		applyWorkRecordChange: async (scope: { db: object }, change: never) => {
			workRecordChanges.push(change);
			return fake.fakeApprovalDecision(scope.db, change);
		},
	};
});
vi.mock("@/lib/time-tracking/policy-clock-out-terminal-break", () => ({
	applyPolicyClockOutTerminalBreakInTransaction: terminalBreakMocks.enforce,
}));
// Mock databases cannot model the advisory locks or the decision's observation:
// decisions run the real plan on the work transaction fake (real ledger,
// recorded guards) over the database of the suite's approval context, routed to
// the fixture's target. work-period-decision-transaction.test.ts and the
// PostgreSQL suites prove the observed routing.
const decisionRouting = vi.hoisted(() => ({
	kind: "manual_time_submission" as "manual_time_submission" | "policy_clock_out",
	ownerEmployeeId: "employee-1",
}));
vi.mock("./work-period-decision-transaction", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./work-period-decision-transaction")>();
	const { fakeWorkTransaction } = await import("@/lib/time-tracking/work-transaction/testing");
	return {
		...actual,
		withWorkPeriodDecisionTransaction: (
			...[input, createRuntime, operation]: Parameters<
				typeof actual.withWorkPeriodDecisionTransaction
			>
		) =>
			fakeWorkTransaction({
				recordApprovalGate: true,
				approvalDatabase: (context) => (context as { dbService: { db: object } }).dbService.db,
			}).run(
				{
					...actual.workPeriodDecisionPlan(input, createRuntime),
					route: async () => {
						const target = { ...decisionRouting };
						return {
							users: [input.actorUserId],
							employees: [target.ownerEmployeeId],
							writeTargets: [target.ownerEmployeeId],
							approvalGate: target.kind,
							snapshot: { observation: "unobserved", target },
						};
					},
				},
				operation,
			),
	};
});
vi.mock("../domain-adapters/work-period-legacy-state", () => ({
	captureOrdinaryWorkPeriodLegacyState: legacyCaptureMocks.capture,
	loadOrdinaryWorkPeriodLegacyDecisionEvidence: legacyCaptureMocks.load,
}));
vi.mock("../policies/chain-service", () => ({
	progressApprovalChainIfLinked: chainProgressMocks.progress,
}));
vi.mock("../policies/manager-eligibility-db", () => ({
	isEligibleManagerForApprovalRequest: managerEligibilityMocks.isEligible,
}));
vi.mock("../evidence/work-period-evidence", async (importOriginal) => ({
	...(await importOriginal<typeof import("../evidence/work-period-evidence")>()),
	prepareLegacyWorkPeriodDecisionEvidence: workPeriodEvidenceMocks.prepare,
	recordLegacyWorkPeriodDecisionEvidence: workPeriodEvidenceMocks.record,
}));
// Legacy card decisions and cycle intents (#432):
// legacy-time-bound-approval.integration.test.ts.
vi.mock("../evidence/store", async (importOriginal) => ({
	...(await importOriginal<typeof import("../evidence/store")>()),
	findLegacyDecisionEvidenceByRequest: async () => null,
}));
vi.mock("../delivery/intents", async (importOriginal) => ({
	...(await importOriginal<typeof import("../delivery/intents")>()),
	recordLegacyTimeDecisionIntent: async () => false,
}));
vi.mock("../workflow/state-machine", async (importOriginal) => ({
	...(await importOriginal<typeof import("../workflow/state-machine")>()),
	fingerprintApprovalCommandActor: (actor: unknown) => JSON.stringify(actor),
}));
vi.mock("../workflow/transition-engine", async (importOriginal) => ({
	...(await importOriginal<typeof import("../workflow/transition-engine")>()),
	fingerprintApprovalWorkflowCommand: (command: unknown) =>
		JSON.stringify(command),
}));

beforeEach(() => {
	decisionRouting.kind = "manual_time_submission";
	decisionRouting.ownerEmployeeId = "employee-1";
	workRecordChanges.length = 0;
});

const workPeriodApprovals = await import("./work-period-approvals");
const {
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	finalizeOrdinaryWorkPeriodTerminalInTransaction,
	finalizeAutoCompletedWorkPeriodApprovalEffect,
	requireOrdinaryWorkPeriodFinalizerDbService,
} = workPeriodApprovals;

describe("ordinary stable-target production composition", () => {
	it("reconciles surcharges once after commit; the decision marked the balance in its transaction", async () => {
		const reconcileSurcharges = vi.fn().mockResolvedValue(undefined);
		const markWorkBalanceDirty = vi.fn().mockResolvedValue(undefined);
		const reconcile =
			workPeriodApprovals.reconcileOrdinaryWorkPeriodMaintenanceAfterCommit as unknown as (
				maintenance: unknown,
				dependencies: unknown,
			) => Promise<void>;
		const maintenance = {
			organizationId: "org-1",
			employeeId: "employee-1",
			dirtyFromDate: "2026-07-13",
			decision: "approved",
			surchargePeriodIds: ["period-1", "period-2"],
			staleSurchargePeriodIds: [],
		};

		await reconcile(maintenance, { reconcileSurcharges, markWorkBalanceDirty });

		expect(reconcileSurcharges).toHaveBeenCalledOnce();
		expect(reconcileSurcharges).toHaveBeenCalledWith(maintenance);
		// Work records marks the balance inside the decision's transaction (#1227).
		expect(markWorkBalanceDirty).not.toHaveBeenCalled();
	});

	it("decides both records' approval state through work records", async () => {
		const dbService = createFinalizerDbService();

		await finalize(dbService);

		expect(workRecordChanges).toEqual([
			{
				kind: "amend",
				organizationId: "org-1",
				employeeId: "employee-1",
				expected: {
					workPeriodId: "period-1",
					revision: period.graphRevision,
					clockInId: period.clockInId,
					clockOutId: period.clockOutId,
					startAt: parseInstant(period.startTime.toISOString()),
					endAt: parseInstant(period.endTime.toISOString()),
				},
				approval: "approved",
				actorUserId: "manager-user-1",
			},
		]);
	});

	it.each([
		["dispatch", "approved", 1, 1],
		["observe", "approved", 0, 1],
		["dispatch", "pending", 0, 0],
		[null, null, 0, 0],
	] as const)("handles %s/%s postcommit exactly once", async (disposition, event, notificationCalls, maintenanceCalls) => {
		const complete = (workPeriodApprovals as Record<string, unknown>)
			.completeOrdinaryWorkPeriodDecisionAfterCommit;
		expect(typeof complete).toBe("function");
		const execution = {
			result: { kind: "manual_time_submission" },
			postCommit: disposition
				? {
						disposition,
						event,
						maintenance:
							event === "pending"
								? null
								: {
										organizationId: "org-1",
										employeeId: "employee-1",
										dirtyFromDate: "2026-07-14",
										decision: "approved",
										surchargePeriodIds: ["period-1"],
										staleSurchargePeriodIds: [],
									},
					}
				: null,
		};
		const dispatch = vi.fn().mockResolvedValue(undefined);
		const maintain = vi.fn().mockResolvedValue(undefined);

		const result = await (complete as (input: unknown) => Promise<unknown>)({
			execute: async () => execution,
			dispatch,
			maintain,
			onDispatchError: vi.fn(),
			onMaintenanceError: vi.fn(),
		});

		expect(result).toBe(execution);
		expect(dispatch).toHaveBeenCalledTimes(notificationCalls);
		expect(maintain).toHaveBeenCalledTimes(maintenanceCalls);
	});

	it("preserves the committed result when awaited postcommit work fails", async () => {
		const complete = (workPeriodApprovals as Record<string, unknown>)
			.completeOrdinaryWorkPeriodDecisionAfterCommit as (
			input: unknown,
		) => Promise<unknown>;
		const execution = {
			result: { kind: "manual_time_submission" },
			postCommit: {
				disposition: "dispatch",
				event: "approved",
				maintenance: {
					organizationId: "org-1",
					employeeId: "employee-1",
					dirtyFromDate: "2026-07-14",
					decision: "approved",
					surchargePeriodIds: ["period-1"],
					staleSurchargePeriodIds: [],
				},
			},
		};
		const error = new Error("notification unavailable");
		const onDispatchError = vi.fn();
		const maintain = vi.fn().mockResolvedValue(undefined);

		const result = await complete({
			execute: async () => execution,
			dispatch: vi.fn().mockRejectedValue(error),
			maintain,
			onDispatchError,
			onMaintenanceError: vi.fn(),
		});

		expect(result).toBe(execution);
		expect(onDispatchError).toHaveBeenCalledWith(error);
		expect(maintain).toHaveBeenCalledOnce();
	});

	it("keeps notification delivery independent when maintenance fails", async () => {
		const complete =
			workPeriodApprovals.completeOrdinaryWorkPeriodDecisionAfterCommit;
		const maintenanceError = new Error("maintenance unavailable");
		const dispatch = vi.fn().mockResolvedValue(undefined);
		const onMaintenanceError = vi.fn();
		const execution = {
			result: { kind: "manual_time_submission" },
			postCommit: {
				disposition: "dispatch" as const,
				event: "approved",
				maintenance: {
					organizationId: "org-1",
					employeeId: "employee-1",
					dirtyFromDate: "2026-07-14",
					decision: "approved" as const,
					surchargePeriodIds: ["period-1"],
					staleSurchargePeriodIds: [],
				},
			},
		};

		await expect(
			complete({
				execute: async () => execution,
				dispatch,
				maintain: vi.fn().mockRejectedValue(maintenanceError),
				onDispatchError: vi.fn(),
				onMaintenanceError,
			}),
		).resolves.toBe(execution);
		expect(dispatch).toHaveBeenCalledOnce();
		expect(onMaintenanceError).toHaveBeenCalledWith(maintenanceError);
	});
});

const source = readFileSync(
	"src/lib/approvals/server/work-period-approvals.ts",
	"utf8",
);

it("does not export ordinary decision APIs that accept a caller-supplied kind", () => {
	expect(source).not.toMatch(
		/export function (?:approveWorkPeriodWithCurrentApproverEffect|rejectWorkPeriodWithCurrentApproverEffect|decideWorkPeriodWithCurrentApproverInTransaction)/,
	);
});

const approval = {
	id: "approval-1",
	organizationId: "org-1",
	entityType: "time_entry",
	entityId: "period-1",
	requestedBy: "employee-1",
	approverId: "manager-1",
	status: "pending",
	reason: "Manual time entry: missed punch",
	canonicalRecordId: null,
	approvedAt: null,
	rejectionReason: null,
	metadata: {
		timeRequest: { kind: "manual_time_submission" },
		surchargeSnapshot,
		workflow: { id: "workflow-1", organizationId: "org-1" },
		stage: { id: "stage-1", sequence: 1 },
	},
};

const period = {
	id: "period-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	clockInId: "clock-in-1",
	clockOutId: "clock-out-1",
	canonicalRecordId: "record-1",
	approvalWorkflowId: "workflow-1",
	approvalStatus: "pending",
	pendingChanges: { isManualEntry: true, surchargeSnapshot },
	startTime: new Date("2026-07-14T08:00:00.000Z"),
	endTime: new Date("2026-07-14T16:00:00.000Z"),
	durationMinutes: 480,
	projectId: "project-1",
	workCategoryId: "category-1",
	workLocationType: "home" as const,
	isActive: false,
	deletedAt: null,
};

/** The workflow the legacy write coordinator observes for approval-1 (#475). */
function observedWorkflowSnapshot(overrides: Record<string, unknown> = {}) {
	return {
		id: "workflow-1",
		organizationId: "org-1",
		workflowType: "manual_time_submission",
		sourceType: "time_entry",
		sourceId: "period-1",
		requesterEmployeeId: "employee-1",
		status: "pending",
		version: 2,
		stages: [
			{
				id: "stage-1",
				legacyApprovalRequestId: "approval-1",
				status: "pending",
				assignments: [],
			},
		],
		...overrides,
	};
}

const canonicalRecord = {
	id: "record-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	recordKind: "work",
	startAt: period.startTime,
	endAt: period.endTime,
	durationMinutes: 480,
	approvalState: "pending",
	origin: "clock",
};

const breakPolicySnapshot = {
	version: 1,
	evaluatedAt: "2026-07-14T16:00:00Z",
	resolution: "none",
} as const;
const autoApprovalMetadata = (kind = "manual_time_submission") => ({
	timeRequest: { kind },
	...(kind === "policy_clock_out" ? { breakPolicySnapshot } : {}),
	surchargeSnapshot,
	autoApproval: { reason: "requester_is_approver" },
});

const submissionId = "10000000-0000-4000-8000-000000000099";

const ordinarySubmissionKey = (
	kind:
		| "manual_time_submission"
		| "policy_clock_out" = "manual_time_submission",
) =>
	deriveApprovalWorkflowId({
		organizationId: "org-1",
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: "period-1",
		allocationKey: submissionId,
	});

const ordinarySubmissionMarker = (
	kind:
		| "manual_time_submission"
		| "policy_clock_out" = "manual_time_submission",
) => ({
	key: ordinarySubmissionKey(kind),
	submissionId,
});

type ApprovalFixture = Omit<typeof approval, "metadata"> & {
	metadata: unknown;
};

function createFinalizerDbService(options?: {
	period?: Partial<typeof period>;
	record?: Partial<typeof canonicalRecord>;
	request?: Partial<ApprovalFixture> | null;
	requests?: Array<Partial<ApprovalFixture>>;
	actorOwned?: boolean;
	actorActive?: boolean;
	actor?: { id: string; userId: string };
	cardinality?: {
		periodUpdate?: number;
		recordUpdate?: number;
		decisionInsert?: number;
	};
}) {
	const lockOrder: string[] = [];
	const updateSets: Record<string, unknown>[] = [];
	const insertedValues: Record<string, unknown>[] = [];
	const policyRequest =
		(
			options?.request?.metadata as
				| { timeRequest?: { kind?: unknown } }
				| undefined
		)?.timeRequest?.kind === "policy_clock_out";
	const lockedPeriod = {
		...period,
		...(policyRequest
			? { pendingChanges: { breakPolicySnapshot, surchargeSnapshot } }
			: {}),
		...options?.period,
	};
	const lockedRecord = { ...canonicalRecord, ...options?.record };
	const exactRequest = {
		...approval,
		status: "approved",
		approvedAt: new Date("2026-07-15T10:00:00.000Z"),
		...options?.request,
	};
	const requestRows =
		options?.requests ?? (options?.request === null ? [] : [exactRequest]);
	const returningRows = (id: string, count: number) =>
		Array.from({ length: count }, (_, index) => ({
			id: index === 0 ? id : `${id}-${index}`,
		}));
	let updateIndex = 0;
	const db = {
		execute: vi.fn(),
		query: {
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue(
					options?.request === null
						? null
						: {
								...approval,
								status: "approved",
								approvedAt: new Date("2026-07-15T10:00:00.000Z"),
								...options?.request,
							},
				),
			},
			employee: {
				findFirst: vi.fn().mockResolvedValue(
					options?.actorOwned === false
						? null
						: {
								id: options?.actor?.id ?? "manager-1",
								userId: options?.actor?.userId ?? "manager-user-1",
								isActive: options?.actorActive ?? true,
							},
				),
			},
			timeEntry: {
				findFirst: vi.fn().mockResolvedValue({
					id: "clock-in-1",
					utcOffsetMinutes: 0,
				}),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn((table: Parameters<typeof getTableName>[0]) => {
				const tableName = getTableName(table);
				const rows =
					tableName === "work_period"
						? [lockedPeriod]
						: tableName === "time_record"
							? [lockedRecord]
							: requestRows;
				return {
					where: vi.fn(() => ({
						for: vi.fn((mode: string) => {
							lockOrder.push(`${tableName}:${mode}`);
							return Promise.resolve(rows);
						}),
						limit: vi.fn().mockResolvedValue(rows),
					})),
				};
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => {
				updateSets.push(values);
				const index = updateIndex++;
				return {
					where: vi.fn(() => ({
						returning: vi
							.fn()
							.mockResolvedValue(
								index === 0
									? returningRows(
											"period-1",
											options?.cardinality?.periodUpdate ?? 1,
										)
									: returningRows(
											"record-1",
											options?.cardinality?.recordUpdate ?? 1,
										),
							),
					})),
				};
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: Record<string, unknown>) => {
				insertedValues.push(values);
				return {
					returning: vi
						.fn()
						.mockResolvedValue(
							returningRows(
								"decision-1",
								options?.cardinality?.decisionInsert ?? 1,
							),
						),
				};
			}),
		})),
	};

	return {
		db,
		lockOrder,
		updateSets,
		insertedValues,
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService & {
		lockOrder: string[];
		updateSets: Record<string, unknown>[];
		insertedValues: Record<string, unknown>[];
	};
}

function finalize(
	dbService: ApprovalDbService,
	overrides?: Partial<
		Parameters<typeof finalizeOrdinaryWorkPeriodTerminalInTransaction>[0]
	>,
) {
	return finalizeOrdinaryWorkPeriodTerminalInTransaction({
		dbService,
		organizationId: "org-1",
		workPeriodId: "period-1",
		expectedApprovalWorkflowId: "workflow-1",
		requesterEmployeeId: "employee-1",
		actorEmployeeId: "manager-1",
		actorUserId: "manager-user-1",
		kind: "manual_time_submission",
		evidence: {
			mode: "legacy",
			approvalRequestId: "approval-1",
			requestMode: "manager",
			expectedStatus: "approved",
		},
		transition: { kind: "approve", reason: null },
		finalizedAt: parseInstant("2026-07-15T10:00:00Z"),
		...overrides,
	});
}

function createDecisionDbService(options?: {
	staleWorkPeriod?: boolean;
	autoCompleted?: boolean;
	unlinked?: boolean;
	kind?: "manual_time_submission" | "policy_clock_out";
	autoApprovalRequest?: Partial<ApprovalFixture>;
}) {
	const updateSets: Record<string, unknown>[] = [];
	const insertedValues: Record<string, unknown>[] = [];
	let currentApprovalWorkflowId =
		options?.autoCompleted || options?.unlinked
			? null
			: period.approvalWorkflowId;
	const returningResults = [
		...(options?.autoCompleted ? [] : [[{ id: "approval-1" }]]),
		options?.staleWorkPeriod ? [] : [{ id: "period-1" }],
		[{ id: "record-1" }],
	];
	const terminalApproval = () => {
		const terminalUpdate = updateSets.find((value) => "status" in value);
		return {
			...approval,
			approverId: options?.autoCompleted ? "employee-1" : "manager-1",
			metadata: options?.autoCompleted
				? autoApprovalMetadata(options.kind)
				: {
						timeRequest: { kind: options?.kind ?? "manual_time_submission" },
						ordinarySubmission: ordinarySubmissionMarker(options?.kind),
						...(options?.kind === "policy_clock_out"
							? { breakPolicySnapshot }
							: {}),
						surchargeSnapshot,
						workflow: { id: "workflow-1", organizationId: "org-1" },
						stage: { id: "stage-1", sequence: 1 },
					},
			...(options?.autoCompleted
				? { status: "approved", approvedAt: new Date() }
				: (terminalUpdate ?? {})),
			...options?.autoApprovalRequest,
		};
	};
	const db = {
		// The coordinator's observed-workflow lookup: an unlinked period has none.
		execute: vi.fn(async () => ({
			rows: options?.autoCompleted || options?.unlinked ? [] : [{ id: "workflow-1" }],
		})),
		query: {
			approvalRequest: {
				findFirst: vi
					.fn()
					.mockImplementation(() => Promise.resolve(terminalApproval())),
			},
			approvalChainStageInstance: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			employee: {
				findFirst: vi.fn().mockResolvedValue({
					id: options?.autoCompleted ? "employee-1" : "manager-1",
					userId: options?.autoCompleted ? "employee-user-1" : "manager-user-1",
					isActive: true,
				}),
			},
			workPeriod: {
				findFirst: vi
					.fn()
					.mockImplementation(() =>
						Promise.resolve({ approvalWorkflowId: currentApprovalWorkflowId }),
					),
			},
			timeEntry: {
				findFirst: vi.fn().mockResolvedValue({
					id: "clock-in-1",
					utcOffsetMinutes: 120,
				}),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn((table: Parameters<typeof getTableName>[0]) => ({
				where: vi.fn(() => {
					const tableName = getTableName(table);
					const request = terminalApproval();
					const rows =
						tableName === "work_period"
							? [
									options?.autoCompleted || options?.unlinked
										? {
												...period,
												approvalWorkflowId: currentApprovalWorkflowId,
												...(options?.kind === "policy_clock_out"
													? {
															pendingChanges: {
																breakPolicySnapshot,
																surchargeSnapshot,
															},
														}
													: { pendingChanges: { surchargeSnapshot } }),
											}
										: {
												...period,
												...(options?.kind === "policy_clock_out"
													? {
															pendingChanges: {
																breakPolicySnapshot,
																surchargeSnapshot,
															},
														}
													: { pendingChanges: { surchargeSnapshot } }),
											},
								]
							: tableName === "time_record"
								? [canonicalRecord]
								: options?.autoCompleted && request.requestedBy !== "employee-1"
									? []
									: [request];
					const result = Promise.resolve(rows);
					return Object.assign(result, {
						for: vi.fn().mockResolvedValue(rows),
						limit: vi.fn().mockResolvedValue(rows),
					});
				}),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn((values: Record<string, unknown>) => {
				updateSets.push(values);
				const bindingWorkflowId = values.approvalWorkflowId;
				if (typeof bindingWorkflowId === "string") {
					currentApprovalWorkflowId = bindingWorkflowId;
					return {
						where: vi.fn(() => ({
							returning: vi.fn().mockResolvedValue([
								{
									id: "period-1",
									organizationId: "org-1",
									employeeId: "employee-1",
									canonicalRecordId: "record-1",
									approvalWorkflowId: bindingWorkflowId,
								},
							]),
						})),
					};
				}
				return {
					where: vi.fn(() => ({
						returning: vi
							.fn()
							.mockResolvedValue(returningResults.shift() ?? []),
					})),
				};
			}),
		})),
		insert: vi.fn(() => ({
			values: vi.fn((values: Record<string, unknown>) => {
				insertedValues.push(values);
				return {
					returning: vi.fn().mockResolvedValue([{ id: "decision-1" }]),
				};
			}),
		})),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db)),
	};

	return {
		db,
		updateSets,
		insertedValues,
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService & {
		updateSets: Record<string, unknown>[];
		insertedValues: Record<string, unknown>[];
	};
}

describe("ordinary work-period approval finalizer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		terminalBreakMocks.enforce.mockResolvedValue({ kind: "not_required" });
	});

	it.each([
		[
			"approve",
			{
				decision: "approved",
				surchargePeriodIds: ["period-1"],
				staleSurchargePeriodIds: [],
			},
		],
		[
			"reject",
			{
				decision: "rejected",
				surchargePeriodIds: [],
				staleSurchargePeriodIds: ["period-1"],
			},
		],
	] as const)("uses immutable manual surcharge evidence on terminal %s", async (action, expected) => {
		const dbService = createFinalizerDbService({
			request: null,
			period: { pendingChanges: { surchargeSnapshot } },
		});

		const result = await finalize(dbService, {
			evidence: {
				mode: "canonical",
				workflowId: "workflow-1",
				payload: {
					timeRequest: { kind: "manual_time_submission" },
					surchargeSnapshot,
				},
			},
			transition:
				action === "approve"
					? { kind: "approve", reason: null }
					: { kind: "reject", reason: "No evidence" },
		});

		expect(result.maintenance).toEqual({
			organizationId: "org-1",
			employeeId: "employee-1",
			dirtyFromDate: "2026-07-14",
			...expected,
			surchargeSnapshot,
		});
		expect(terminalBreakMocks.enforce).not.toHaveBeenCalled();
	});

	it("locks work_period before time_record and then records one decision", async () => {
		const dbService = createFinalizerDbService();

		const result = await finalize(dbService);

		expect(dbService.lockOrder).toEqual([
			"work_period:update",
			"time_record:update",
		]);
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
			expect.objectContaining({
				approvalState: "approved",
				updatedBy: "manager-user-1",
			}),
		]);
		expect(dbService.insertedValues).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				recordId: "record-1",
				actorEmployeeId: "manager-1",
				action: "approved",
			}),
		]);
		expect(result).toMatchObject({
			kind: "manual_time_submission",
			action: "approve",
			period: { id: "period-1", canonicalRecordId: "record-1" },
		});
	});

	it("derives no-split dirty date from the audit-critical clock-in offset", async () => {
		const dbService = createFinalizerDbService();
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValue({
			id: "clock-in-1",
			utcOffsetMinutes: -600,
		} as never);

		await expect(finalize(dbService)).resolves.toMatchObject({
			maintenance: { dirtyFromDate: "2026-07-13" },
		});
	});

	it("rejects a finalizer database without the required time-entry query", () => {
		expect(() =>
			requireOrdinaryWorkPeriodFinalizerDbService({
				db: {
					execute: vi.fn(),
					select: vi.fn(),
					update: vi.fn(),
					insert: vi.fn(),
					query: { employee: { findFirst: vi.fn() } },
				},
			} as never),
		).toThrow("Ordinary work-period finalization conflict");
	});

	it.each([
		["approve", "missing"],
		["reject", "missing"],
		["approve", "pending"],
		["reject", "pending"],
	] as const)("finalizes canonical %s with a %s approval request row", async (action, legacyRequest) => {
		const dbService = createFinalizerDbService({
			request:
				legacyRequest === "missing"
					? null
					: { status: "pending", approvedAt: null },
		});
		await expect(
			finalize(dbService, {
				evidence: {
					mode: "canonical",
					workflowId: "workflow-1",
					payload: {
						timeRequest: { kind: "manual_time_submission" },
						surchargeSnapshot,
					},
				},
				transition:
					action === "approve"
						? { kind: "approve", reason: null }
						: { kind: "reject", reason: "policy conflict" },
			}),
		).resolves.toMatchObject({ action });
		expect(dbService.updateSets).toHaveLength(2);
	});

	it.each([
		[
			"workflow",
			{
				mode: "canonical",
				workflowId: "workflow-2",
				payload: {
					timeRequest: { kind: "manual_time_submission" },
					surchargeSnapshot,
				},
			},
		],
		[
			"payload",
			{
				mode: "canonical",
				workflowId: "workflow-1",
				payload: { timeRequest: { kind: "policy_clock_out" } },
			},
		],
	] as const)("rejects malformed canonical %s evidence before source mutation", async (_name, evidence) => {
		const dbService = createFinalizerDbService({ request: null });
		await expect(finalize(dbService, { evidence } as never)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
		expect(dbService.insertedValues).toHaveLength(0);
	});

	it("rejects an execute-only workflow client before source mutation", async () => {
		const execute = vi.fn();
		await expect(
			finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction({
				dbService: { db: { execute } },
				organizationId: "org-1",
				workPeriodId: "period-1",
				expectedApprovalWorkflowId: "workflow-1",
				requesterEmployeeId: "employee-1",
				actorEmployeeId: "manager-1",
				actorUserId: "manager-user-1",
				kind: "manual_time_submission",
				evidence: {
					mode: "canonical",
					workflowId: "workflow-1",
					payload: {
						timeRequest: { kind: "manual_time_submission" },
						surchargeSnapshot,
					},
				},
				transition: { kind: "approve", reason: null },
				finalizedAt: parseInstant("2026-07-15T10:00:00Z"),
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(execute).not.toHaveBeenCalled();
	});

	it("accepts a full transaction client through the workflow bridge", async () => {
		const dbService = createFinalizerDbService({ request: null });
		await expect(
			finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction({
				...({
					dbService,
					organizationId: "org-1",
					workPeriodId: "period-1",
					expectedApprovalWorkflowId: "workflow-1",
					requesterEmployeeId: "employee-1",
					actorEmployeeId: "manager-1",
					actorUserId: "manager-user-1",
					kind: "manual_time_submission",
					evidence: {
						mode: "canonical",
						workflowId: "workflow-1",
						payload: {
							timeRequest: { kind: "manual_time_submission" },
							surchargeSnapshot,
						},
					},
					transition: { kind: "approve", reason: null },
					finalizedAt: parseInstant("2026-07-15T10:00:00Z"),
				} as never),
			}),
		).resolves.toMatchObject({ action: "approve" });
	});

	it("rejects without mutating source or canonical time facts", async () => {
		const dbService = createFinalizerDbService({
			request: {
				status: "rejected",
				approvedAt: null,
				rejectionReason: "Outside scheduled hours",
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					breakPolicySnapshot,
					surchargeSnapshot,
					workflow: { id: "workflow-1", organizationId: "org-1" },
					stage: { id: "stage-1", sequence: 1 },
				},
			},
		});

		const result = await finalize(dbService, {
			kind: "policy_clock_out",
			evidence: {
				mode: "legacy",
				approvalRequestId: "approval-1",
				requestMode: "manager",
				expectedStatus: "rejected",
			},
			transition: { kind: "reject", reason: "Outside scheduled hours" },
		});

		for (const update of dbService.updateSets) {
			expect(update).not.toHaveProperty("clockInId");
			expect(update).not.toHaveProperty("clockOutId");
			expect(update).not.toHaveProperty("startTime");
			expect(update).not.toHaveProperty("endTime");
			expect(update).not.toHaveProperty("startAt");
			expect(update).not.toHaveProperty("endAt");
			expect(update).not.toHaveProperty("durationMinutes");
		}
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({
				approvalStatus: "rejected",
				pendingChanges: null,
			}),
			expect.objectContaining({ approvalState: "rejected" }),
		]);
		expect(terminalBreakMocks.enforce).not.toHaveBeenCalled();
		expect(result.maintenance).toEqual({
			organizationId: "org-1",
			employeeId: "employee-1",
			dirtyFromDate: "2026-07-14",
			decision: "rejected",
			surchargePeriodIds: [],
			staleSurchargePeriodIds: ["period-1"],
			surchargeSnapshot,
		});
	});

	it.each([
		["approve", false],
		["approve", true],
		["reject", true],
	] as const)("preserves an unmarked historical policy %s with auto-adjusted=%s", async (action, wasAutoAdjusted) => {
		const dbService = createFinalizerDbService({
			period: {
				approvalWorkflowId: null,
				pendingChanges: {
					isNewClockOut: true,
					wasAutoAdjusted,
					originalEndTime: wasAutoAdjusted ? "2026-07-14T16:05:00Z" : null,
				},
			},
			request: {
				status: action === "approve" ? "approved" : "rejected",
				approvedAt:
					action === "approve" ? new Date("2026-07-15T10:00:00Z") : null,
				rejectionReason: action === "reject" ? "Policy conflict" : null,
				metadata: { timeRequest: { kind: "policy_clock_out" } },
			},
		});

		await expect(
			finalize(dbService, {
				kind: "policy_clock_out",
				expectedApprovalWorkflowId: null,
				evidence: {
					mode: "legacy",
					approvalRequestId: "approval-1",
					requestMode: "manager",
					expectedStatus: action === "approve" ? "approved" : "rejected",
				},
				transition:
					action === "approve"
						? { kind: "approve", reason: null }
						: { kind: "reject", reason: "Policy conflict" },
			}),
		).resolves.toMatchObject({
			kind: "policy_clock_out",
			action,
			period: {
				startTime: period.startTime,
				endTime: period.endTime,
			},
		});
		const status = action === "approve" ? "approved" : "rejected";
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({ approvalStatus: status }),
			expect.objectContaining({ approvalState: status }),
		]);
		for (const update of dbService.updateSets) {
			expect(update).not.toHaveProperty("startTime");
			expect(update).not.toHaveProperty("endTime");
			expect(update).not.toHaveProperty("startAt");
			expect(update).not.toHaveProperty("endAt");
			expect(update).not.toHaveProperty("durationMinutes");
		}
		expect(dbService.insertedValues).toHaveLength(1);
		expect(terminalBreakMocks.enforce).not.toHaveBeenCalled();
	});

	it("rejects a marked policy submission without snapshot evidence", async () => {
		const markerKey = deriveApprovalWorkflowId({
			organizationId: "org-1",
			workflowType: "policy_clock_out",
			sourceType: "time_entry",
			sourceId: "period-1",
			allocationKey: submissionId,
		});
		const dbService = createFinalizerDbService({
			period: {
				approvalWorkflowId: null,
				pendingChanges: { isNewClockOut: true },
			},
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					ordinarySubmission: { key: markerKey, submissionId },
				},
			},
		});

		await expect(
			finalize(dbService, {
				kind: "policy_clock_out",
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(dbService.updateSets).toHaveLength(0);
		expect(terminalBreakMocks.enforce).not.toHaveBeenCalled();
	});

	it("does not depend on the live break-policy resolver", () => {
		expect(source).not.toContain(
			"resolvePolicyClockOutBreakSnapshotInTransaction",
		);
	});

	it("enforces a policy clock-out once after source approval and preserves submitted evidence", async () => {
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					breakPolicySnapshot,
					surchargeSnapshot,
					workflow: { id: "workflow-1", organizationId: "org-1" },
					stage: { id: "stage-1", sequence: 1 },
				},
			},
		});

		const result = await finalize(dbService, {
			kind: "policy_clock_out",
		});

		expect(terminalBreakMocks.enforce).toHaveBeenCalledOnce();
		expect(terminalBreakMocks.enforce).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				actorUserId: "manager-user-1",
				actorEmployeeId: "manager-1",
				// The exact lifecycle the finalizer verified, never a generic flag.
				lifecycle: {
					authority: "legacy",
					approvalRequestId: "approval-1",
					observedWorkflowId: "workflow-1",
				},
				decisionRecordId: "decision-1",
				// The work exactly as the finalizer verified it, named as work records' expected state.
				period: {
					id: "period-1",
					clockInId: "clock-in-1",
					clockOutId: "clock-out-1",
					startTime: period.startTime,
					endTime: period.endTime,
				},
				breakPolicySnapshot,
			}),
		);
		expect(result.period).toMatchObject({
			startTime: period.startTime,
			endTime: period.endTime,
		});
		expect(result.maintenance).toEqual({
			organizationId: "org-1",
			employeeId: "employee-1",
			dirtyFromDate: "2026-07-14",
			decision: "approved",
			surchargePeriodIds: ["period-1"],
			staleSurchargePeriodIds: [],
			surchargeSnapshot,
		});
		// The decision is recorded on the originating record before the split, so
		// the generated segment's lineage can name it (#303).
		expect(
			vi.mocked(dbService.db.update).mock.invocationCallOrder[1],
		).toBeLessThan(vi.mocked(dbService.db.insert).mock.invocationCallOrder[0]);
		expect(vi.mocked(dbService.db.insert).mock.invocationCallOrder[0]).toBeLessThan(
			terminalBreakMocks.enforce.mock.invocationCallOrder[0],
		);
	});

	it("keeps the surcharges of both halves when the terminal break divides the work", async () => {
		terminalBreakMocks.enforce.mockResolvedValueOnce({
			kind: "adjusted",
			breakMinutes: 30,
			secondPeriodId: "period-2",
		});
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					breakPolicySnapshot,
					surchargeSnapshot,
					workflow: { id: "workflow-1", organizationId: "org-1" },
					stage: { id: "stage-1", sequence: 1 },
				},
			},
		});

		const result = await finalize(dbService, { kind: "policy_clock_out" });

		expect(result.outcome).toEqual({
			status: "approved",
			adjustment: { kind: "break_enforced", breakMinutes: 30 },
			resultPeriodIds: ["period-1", "period-2"],
		});
		expect(result.maintenance).toMatchObject({ surchargePeriodIds: ["period-1", "period-2"] });
	});

	it("refuses a terminal break in a closed month as such, not as a finalization conflict", async () => {
		// The database refusal (Z8M01, ADR 0004) behind a write of the division.
		terminalBreakMocks.enforce.mockRejectedValueOnce(
			Object.assign(new Error("month closed"), { code: "Z8M01", detail: "2026-07" }),
		);
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					breakPolicySnapshot,
					surchargeSnapshot,
					workflow: { id: "workflow-1", organizationId: "org-1" },
					stage: { id: "stage-1", sequence: 1 },
				},
			},
		});

		await expect(finalize(dbService, { kind: "policy_clock_out" })).rejects.toMatchObject({
			_tag: "MonthClosedError",
			month: "2026-07",
		});
	});

	it("rejects terminal approval when transactional break enforcement fails", async () => {
		terminalBreakMocks.enforce.mockRejectedValueOnce(
			new Error("private split failure"),
		);
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					breakPolicySnapshot,
					surchargeSnapshot,
					workflow: { id: "workflow-1", organizationId: "org-1" },
					stage: { id: "stage-1", sequence: 1 },
				},
			},
		});

		await expect(
			finalize(dbService, { kind: "policy_clock_out" }),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(terminalBreakMocks.enforce).toHaveBeenCalledOnce();
		// The failure propagates, so the transaction rolls the decision row back.
		expect(dbService.insertedValues).toHaveLength(1);
	});

	it.each([
		["employee", { period: { employeeId: "employee-2" } }],
		["workflow link", { period: { approvalWorkflowId: "workflow-2" } }],
		["deleted period", { period: { deletedAt: new Date() } }],
		["period status", { period: { approvalStatus: "approved" } }],
		["period endpoint", { period: { clockOutId: null } }],
		["period end", { period: { endTime: null } }],
		["period duration", { period: { durationMinutes: null } }],
		["record kind", { record: { recordKind: "absence" } }],
		["record employee", { record: { employeeId: "employee-2" } }],
		["record start", { record: { startAt: new Date("2026-07-14T08:01:00Z") } }],
		["record end", { record: { endAt: new Date("2026-07-14T16:01:00Z") } }],
		["record duration", { record: { durationMinutes: 479 } }],
		["record status", { record: { approvalState: "approved" } }],
	] as const)("rejects mismatched %s parity", async (_name, options) => {
		const dbService = createFinalizerDbService(options);

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("rejects an active period as incomplete", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null, isActive: true },
			request: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("rejects a foreign actor", async () => {
		const dbService = createFinalizerDbService({ actorOwned: false });

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("rejects an inactive actor at terminal finalization time", async () => {
		const dbService = createFinalizerDbService({ actorActive: false });

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("derives immutable kind from exact scoped request metadata", async () => {
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					workflow: { id: "workflow-1", organizationId: "org-1" },
				},
			},
		});

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("allows an unlinked source only with explicit legacy evidence", async () => {
		const denied = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
		});
		await expect(
			finalize(denied, {
				expectedApprovalWorkflowId: null,
				evidence: {
					mode: "canonical",
					workflowId: "workflow-1",
					payload: {
						timeRequest: { kind: "manual_time_submission" },
						surchargeSnapshot,
					},
				},
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");

		const allowed = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
		});
		await expect(
			finalize(allowed, {
				expectedApprovalWorkflowId: null,
			}),
		).resolves.toMatchObject({ action: "approve" });
	});

	it("does not infer unlinked requester auto-approval in the general finalizer", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: "employee-1",
				metadata: autoApprovalMetadata(),
			},
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
	});

	it("does not infer linked requester auto-approval in the general finalizer", async () => {
		const dbService = createFinalizerDbService({
			request: {
				approverId: "employee-1",
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					workflow: { id: "workflow-1", organizationId: "org-1" },
					autoApproval: { reason: "requester_is_approver" },
				},
			},
		});

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
	});

	it("accepts an explicit approval of a legacy self-assigned request", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: "employee-1",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
			actor: { id: "employee-1", userId: "employee-user-1" },
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
				actorEmployeeId: "employee-1",
				actorUserId: "employee-user-1",
			}),
		).resolves.toMatchObject({ action: "approve" });
	});

	it("rejects absent autoApproval on a claimed requester auto path", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: "employee-1",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
			actor: { id: "employee-1", userId: "employee-user-1" },
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
				actorEmployeeId: "employee-1",
				actorUserId: "employee-user-1",
				evidence: {
					mode: "legacy",
					approvalRequestId: "approval-1",
					requestMode: "requester_auto_completed",
					expectedStatus: "approved",
				},
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
	});

	it.each([
		["wrong reason", { reason: "different" }],
		["extra key", { reason: "requester_is_approver", extra: true }],
		["array", ["requester_is_approver"]],
		[
			"custom prototype",
			Object.assign(Object.create({}), { reason: "requester_is_approver" }),
		],
	] as const)("rejects %s autoApproval evidence", async (_name, autoApproval) => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: "employee-1",
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					autoApproval,
				},
			},
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
	});

	it("rejects autoApproval accessors without invoking them", async () => {
		const reasonGetter = vi.fn(() => "requester_is_approver");
		const autoApproval = {};
		Object.defineProperty(autoApproval, "reason", {
			enumerable: true,
			get: reasonGetter,
		});
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: "employee-1",
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					autoApproval,
				},
			},
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(reasonGetter).not.toHaveBeenCalled();
	});

	it("rejects autoApproval on an ordinary manager approval path", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: { metadata: autoApprovalMetadata() },
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
	});

	it.each([
		false,
		true,
	])("accepts exact stable marker metadata on requester auto=%s", async (autoCompleted) => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: autoCompleted ? "employee-1" : "manager-1",
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					surchargeSnapshot,
					ordinarySubmission: { key: ordinarySubmissionKey(), submissionId },
					...(autoCompleted
						? {
								autoApproval: {
									reason: "requester_is_approver",
								},
							}
						: {}),
				},
			},
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
				evidence: {
					mode: "legacy",
					approvalRequestId: "approval-1",
					requestMode: autoCompleted ? "requester_auto_completed" : "manager",
					expectedStatus: "approved",
				},
			}),
		).resolves.toMatchObject({ action: "approve" });
	});

	it.each([
		["wrong key", { ...ordinarySubmissionMarker(), key: "wrong" }],
		["extra key", { ...ordinarySubmissionMarker(), extra: true }],
		[
			"custom prototype",
			Object.assign(Object.create({}), ordinarySubmissionMarker()),
		],
	] as const)("rejects ordinary marker with %s", async (_label, marker) => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					ordinarySubmission: marker,
				},
			},
		});

		await expect(
			finalize(dbService, { expectedApprovalWorkflowId: null }),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("rejects ordinary marker accessors without invoking them", async () => {
		const keyGetter = vi.fn(() => ordinarySubmissionKey());
		const marker = ordinarySubmissionMarker();
		Object.defineProperty(marker, "key", {
			enumerable: true,
			get: keyGetter,
		});
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					ordinarySubmission: marker,
				},
			},
		});

		await expect(
			finalize(dbService, { expectedApprovalWorkflowId: null }),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(keyGetter).not.toHaveBeenCalled();
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("uses the exact request instead of stale historical metadata", async () => {
		const dbService = createFinalizerDbService({
			request: {
				id: "approval-stale",
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					workflow: { id: "workflow-stale", organizationId: "org-1" },
				},
			},
			requests: [{ ...approval, status: "approved", approvedAt: new Date() }],
		});

		await expect(finalize(dbService)).resolves.toMatchObject({
			kind: "manual_time_submission",
		});
	});

	it("rejects multiple rows for the exact approval request", async () => {
		const dbService = createFinalizerDbService({
			requests: [
				{ ...approval, status: "approved", approvedAt: new Date() },
				{ ...approval, status: "approved", approvedAt: new Date() },
			],
		});

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("rejects a foreign request returned for the exact request id", async () => {
		const dbService = createFinalizerDbService({
			requests: [
				{
					...approval,
					id: "approval-foreign",
					status: "approved",
					approvedAt: new Date(),
				},
			],
		});

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it.each([
		["workflow id", { id: "workflow-2", organizationId: "org-1" }],
		["workflow organization", { id: "workflow-1", organizationId: "org-2" }],
	] as const)("rejects linked metadata with a foreign %s", async (_name, workflow) => {
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					workflow,
				},
			},
		});

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
		expect(dbService.updateSets).toHaveLength(0);
	});

	it("rejects an unlinked legacy source without exact scoped request evidence", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: null,
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
			}),
		).rejects.toThrow("Ordinary work-period finalization conflict");
	});

	it.each([
		["zero period updates", { periodUpdate: 0 }],
		["two period updates", { periodUpdate: 2 }],
		["zero record updates", { recordUpdate: 0 }],
		["two record updates", { recordUpdate: 2 }],
		["zero decision inserts", { decisionInsert: 0 }],
		["two decision inserts", { decisionInsert: 2 }],
	] as const)("fails on %s", async (_name, cardinality) => {
		const dbService = createFinalizerDbService({ cardinality });

		await expect(finalize(dbService)).rejects.toThrow(
			"Ordinary work-period finalization conflict",
		);
	});

	it("finalizes an already approved auto-completed request without creating a pending row", async () => {
		const dbService = createDecisionDbService({ autoCompleted: true });

		const result = await Effect.runPromise(
			finalizeAutoCompletedWorkPeriodApprovalEffect(dbService, {
				approvalRequestId: "approval-1",
				organizationId: "org-1",
				requesterEmployeeId: "employee-1",
				requesterUserId: "employee-user-1",
				requesterName: "Avery Employee",
				kind: "manual_time_submission",
			}),
		);

		expect(result).toMatchObject({
			action: "approve",
			kind: "manual_time_submission",
		});
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
			expect.objectContaining({
				approvalState: "approved",
				updatedBy: "employee-user-1",
			}),
		]);
		expect(dbService.insertedValues).toContainEqual(
			expect.objectContaining({
				recordId: "record-1",
				actorEmployeeId: "employee-1",
				action: "approved",
			}),
		);
		expect(notificationMocks.onManualEntryApproved).not.toHaveBeenCalled();
		expect(terminalBreakMocks.enforce).not.toHaveBeenCalled();
	});

	it("auto-completes a policy clock-out with approved source state and a system decision", async () => {
		const dbService = createDecisionDbService({
			autoCompleted: true,
			kind: "policy_clock_out",
		});

		const result = await Effect.runPromise(
			finalizeAutoCompletedWorkPeriodApprovalEffect(dbService, {
				approvalRequestId: "approval-1",
				organizationId: "org-1",
				requesterEmployeeId: "employee-1",
				requesterUserId: "employee-user-1",
				requesterName: "Avery Employee",
				kind: "policy_clock_out",
			}),
		);

		expect(result).toMatchObject({
			action: "approve",
			kind: "policy_clock_out",
		});
		expect(dbService.updateSets).toEqual([
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
			expect.objectContaining({
				approvalState: "approved",
				updatedBy: "employee-user-1",
			}),
		]);
		expect(dbService.insertedValues).toContainEqual(
			expect.objectContaining({
				organizationId: "org-1",
				recordId: "record-1",
				actorEmployeeId: "employee-1",
				action: "approved",
				reason: "requester_is_approver",
			}),
		);
		expect(notificationMocks.onClockOutApproved).not.toHaveBeenCalled();
		expect(notificationMocks.onClockOutRejected).not.toHaveBeenCalled();
		expect(terminalBreakMocks.enforce).toHaveBeenCalledOnce();
	});

	it.each([
		[
			"different approver",
			{
				approverId: "manager-1",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
		],
		["null approvedAt", { approvedAt: null }],
		["malformed approvedAt", { approvedAt: new Date(Number.NaN) }],
		[
			"missing autoApproval",
			{ metadata: { timeRequest: { kind: "manual_time_submission" } } },
		],
		[
			"wrong autoApproval reason",
			{
				metadata: {
					timeRequest: { kind: "manual_time_submission" },
					autoApproval: { reason: "different" },
				},
			},
		],
		["mismatched requester", { requestedBy: "employee-2" }],
	] as const)("rejects auto-completion with %s", async (_name, autoApprovalRequest) => {
		const dbService = createDecisionDbService({
			autoCompleted: true,
			autoApprovalRequest,
		});

		await expect(
			Effect.runPromise(
				finalizeAutoCompletedWorkPeriodApprovalEffect(dbService, {
					approvalRequestId: "approval-1",
					organizationId: "org-1",
					requesterEmployeeId: "employee-1",
					requesterUserId: "employee-user-1",
					requesterName: "Avery Employee",
					kind: "manual_time_submission",
				}),
			),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(dbService.updateSets).toHaveLength(0);
		expect(dbService.insertedValues).toHaveLength(0);
	});

	it("keeps every source read organization and employee scoped", () => {
		expect(source).toContain(
			"eq(workPeriod.organizationId, approval.organizationId)",
		);
		expect(source).toContain("eq(workPeriod.employeeId, requestedBy)");
		expect(source).toContain(
			"eq(timeRecord.organizationId, input.organizationId)",
		);
		expect(source).toContain('eq(timeRecord.recordKind, "work")');
	});

	it("never locates or mutates correction entries", () => {
		expect(source).not.toContain("correctionEntry");
	});
});
