import { readFileSync } from "node:fs";
import { getTableName } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ApprovalAuditLogger } from "../infrastructure/audit-logger";
import { deriveApprovalWorkflowId } from "../workflow/identity";
import type { ApprovalDbService, CurrentApprover } from "./types";

const notificationMocks = vi.hoisted(() => ({
	onClockOutApproved: vi.fn(),
	onClockOutRejected: vi.fn(),
	onManualEntryApproved: vi.fn(),
	onManualEntryRejected: vi.fn(),
}));
const terminalBreakMocks = vi.hoisted(() => ({
	enforce: vi.fn().mockResolvedValue({ kind: "not_required" }),
}));

vi.mock("@/lib/notifications/triggers", () => notificationMocks);
vi.mock("@/lib/time-tracking/policy-clock-out-terminal-break", () => ({
	enforcePolicyClockOutTerminalBreakInTransaction: terminalBreakMocks.enforce,
}));

const {
	approveWorkPeriodWithCurrentApproverEffect,
	finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
	finalizeOrdinaryWorkPeriodTerminalInTransaction,
	finalizeAutoCompletedWorkPeriodApprovalEffect,
	rejectWorkPeriodWithCurrentApproverEffect,
} = await import("./work-period-approvals");

const source = readFileSync(
	"src/lib/approvals/server/work-period-approvals.ts",
	"utf8",
);

const currentApprover: CurrentApprover = {
	id: "manager-1",
	userId: "manager-user-1",
	organizationId: "org-1",
	role: "manager",
	user: {
		id: "manager-user-1",
		name: "Morgan Manager",
		email: "manager@example.com",
		image: null,
	},
};

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
		workflow: { id: "workflow-1", organizationId: "org-1" },
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
	pendingChanges: { isManualEntry: true },
	startTime: new Date("2026-07-14T08:00:00.000Z"),
	endTime: new Date("2026-07-14T16:00:00.000Z"),
	durationMinutes: 480,
	projectId: "project-1",
	workCategoryId: "category-1",
	workLocationType: "home" as const,
	isActive: false,
	deletedAt: null,
};

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

const autoApprovalMetadata = (kind = "manual_time_submission") => ({
	timeRequest: { kind },
	autoApproval: { reason: "requester_is_approver" },
});

const submissionId = "10000000-0000-4000-8000-000000000099";

const ordinarySubmissionKey = () =>
	deriveApprovalWorkflowId({
		organizationId: "org-1",
		workflowType: "manual_time_submission",
		sourceType: "time_entry",
		sourceId: "period-1",
		allocationKey: submissionId,
	});

const ordinarySubmissionMarker = () => ({
	key: ordinarySubmissionKey(),
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
	cardinality?: {
		periodUpdate?: number;
		recordUpdate?: number;
		decisionInsert?: number;
	};
}) {
	const lockOrder: string[] = [];
	const updateSets: Record<string, unknown>[] = [];
	const insertedValues: Record<string, unknown>[] = [];
	const lockedPeriod = { ...period, ...options?.period };
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
				findFirst: vi
					.fn()
					.mockResolvedValue(
						options?.actorOwned === false
							? null
							: { id: "manager-1", userId: "manager-user-1" },
					),
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
	kind?: "manual_time_submission" | "policy_clock_out";
	autoApprovalRequest?: Partial<ApprovalFixture>;
}) {
	const updateSets: Record<string, unknown>[] = [];
	const insertedValues: Record<string, unknown>[] = [];
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
						workflow: { id: "workflow-1", organizationId: "org-1" },
					},
			...(options?.autoCompleted
				? { status: "approved", approvedAt: new Date() }
				: (terminalUpdate ?? {})),
			...options?.autoApprovalRequest,
		};
	};
	const db = {
		execute: vi.fn(),
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
				}),
			},
			workPeriod: {
				findFirst: vi.fn().mockResolvedValue({
					approvalWorkflowId: options?.autoCompleted
						? null
						: period.approvalWorkflowId,
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
									options?.autoCompleted
										? { ...period, approvalWorkflowId: null }
										: period,
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

function runDecision(effect: Effect.Effect<unknown, unknown, unknown>) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(ApprovalAuditLogger, {
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	);
}

describe("ordinary work-period approval finalizer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		terminalBreakMocks.enforce.mockResolvedValue({ kind: "not_required" });
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
					payload: { timeRequest: { kind: "manual_time_submission" } },
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
				payload: { timeRequest: { kind: "manual_time_submission" } },
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
					payload: { timeRequest: { kind: "manual_time_submission" } },
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
						payload: { timeRequest: { kind: "manual_time_submission" } },
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
					workflow: { id: "workflow-1", organizationId: "org-1" },
				},
			},
		});

		await finalize(dbService, {
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
	});

	it("enforces a policy clock-out once after source approval and preserves submitted evidence", async () => {
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					workflow: { id: "workflow-1", organizationId: "org-1" },
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
				period: expect.objectContaining({
					id: "period-1",
					clockOutId: "clock-out-1",
					canonicalRecordId: "record-1",
					projectId: "project-1",
				}),
			}),
		);
		expect(result.period).toMatchObject({
			startTime: period.startTime,
			endTime: period.endTime,
		});
		expect(
			vi.mocked(dbService.db.update).mock.invocationCallOrder[1],
		).toBeLessThan(terminalBreakMocks.enforce.mock.invocationCallOrder[0]);
		expect(terminalBreakMocks.enforce.mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(dbService.db.insert).mock.invocationCallOrder[0],
		);
	});

	it("rejects terminal approval when transactional break enforcement fails", async () => {
		terminalBreakMocks.enforce.mockRejectedValueOnce(
			new Error("private split failure"),
		);
		const dbService = createFinalizerDbService({
			request: {
				metadata: {
					timeRequest: { kind: "policy_clock_out" },
					workflow: { id: "workflow-1", organizationId: "org-1" },
				},
			},
		});

		await expect(
			finalize(dbService, { kind: "policy_clock_out" }),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(terminalBreakMocks.enforce).toHaveBeenCalledOnce();
		expect(dbService.insertedValues).toHaveLength(0);
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("enforces one policy break for a terminal %s decision", async (mode) => {
		terminalBreakMocks.enforce.mockClear();
		const canonicalAuthority = mode === "canonical" || mode === "complete";
		const dbService = createFinalizerDbService({
			request: canonicalAuthority
				? null
				: {
						metadata: {
							timeRequest: { kind: "policy_clock_out" },
							workflow: { id: "workflow-1", organizationId: "org-1" },
						},
					},
		});

		await finalize(dbService, {
			kind: "policy_clock_out",
			...(canonicalAuthority
				? {
						evidence: {
							mode: "canonical" as const,
							workflowId: "workflow-1",
							payload: { timeRequest: { kind: "policy_clock_out" as const } },
						},
					}
				: {}),
		});

		expect(terminalBreakMocks.enforce).toHaveBeenCalledOnce();
		expect(dbService.insertedValues).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				recordId: "record-1",
				action: "approved",
			}),
		]);
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
					payload: { timeRequest: { kind: "manual_time_submission" } },
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

	it("rejects absent autoApproval on an approved requester auto path", async () => {
		const dbService = createFinalizerDbService({
			period: { approvalWorkflowId: null },
			request: {
				approverId: "employee-1",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			},
		});

		await expect(
			finalize(dbService, {
				expectedApprovalWorkflowId: null,
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

	it("approves the source period and canonical record and records one decision", async () => {
		const dbService = createDecisionDbService();

		await runDecision(
			approveWorkPeriodWithCurrentApproverEffect(
				dbService,
				currentApprover,
				"period-1",
				"manual_time_submission",
				{ approvalRequestId: "approval-1" },
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ status: "approved" }),
				expect.objectContaining({
					approvalStatus: "approved",
					pendingChanges: null,
				}),
				expect.objectContaining({
					approvalState: "approved",
					updatedBy: "manager-user-1",
				}),
			]),
		);
		expect(dbService.insertedValues).toContainEqual(
			expect.objectContaining({
				organizationId: "org-1",
				recordId: "record-1",
				actorEmployeeId: "manager-1",
				action: "approved",
			}),
		);
		expect(notificationMocks.onManualEntryApproved).toHaveBeenCalledOnce();
		expect(notificationMocks.onClockOutApproved).not.toHaveBeenCalled();
		expect(
			vi.mocked(dbService.db.transaction).mock.invocationCallOrder[0],
		).toBeLessThan(
			notificationMocks.onManualEntryApproved.mock.invocationCallOrder[0],
		);
	});

	it("rejects the source period and canonical record with the decision reason", async () => {
		const dbService = createDecisionDbService({ kind: "policy_clock_out" });

		await runDecision(
			rejectWorkPeriodWithCurrentApproverEffect(
				dbService,
				currentApprover,
				"period-1",
				"policy_clock_out",
				"Outside scheduled hours",
				{ approvalRequestId: "approval-1" },
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					status: "rejected",
					rejectionReason: "Outside scheduled hours",
				}),
				expect.objectContaining({
					approvalStatus: "rejected",
					pendingChanges: null,
				}),
				expect.objectContaining({
					approvalState: "rejected",
					updatedBy: "manager-user-1",
				}),
			]),
		);
		expect(dbService.insertedValues[0]).toMatchObject({
			action: "rejected",
			reason: "Outside scheduled hours",
		});
		expect(notificationMocks.onClockOutRejected).toHaveBeenCalledOnce();
		expect(notificationMocks.onManualEntryRejected).not.toHaveBeenCalled();
	});

	it("fails a stale work-period transition before touching the canonical record", async () => {
		const dbService = createDecisionDbService({ staleWorkPeriod: true });

		await expect(
			runDecision(
				approveWorkPeriodWithCurrentApproverEffect(
					dbService,
					currentApprover,
					"period-1",
					"manual_time_submission",
					{ approvalRequestId: "approval-1" },
				),
			),
		).rejects.toThrow("Ordinary work-period finalization conflict");
		expect(dbService.updateSets).toHaveLength(2);
		expect(dbService.insertedValues).not.toContainEqual(
			expect.objectContaining({ recordId: "record-1" }),
		);
		expect(notificationMocks.onManualEntryApproved).not.toHaveBeenCalled();
		expect(terminalBreakMocks.enforce).not.toHaveBeenCalled();
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

	it("keeps every source and canonical mutation organization and employee scoped", () => {
		expect(source).toContain(
			"eq(workPeriod.organizationId, approval.organizationId)",
		);
		expect(source).toContain("eq(workPeriod.employeeId, requestedBy)");
		expect(source).toContain("eq(workPeriod.isActive, false)");
		expect(source).toContain(
			"eq(timeRecord.organizationId, input.organizationId)",
		);
		expect(source).toContain("eq(timeRecord.employeeId, record.employeeId)");
		expect(source).toContain('eq(timeRecord.recordKind, "work")');
	});

	it("never locates or mutates correction entries", () => {
		expect(source).not.toContain("timeEntry");
		expect(source).not.toContain("correctionEntry");
	});
});
