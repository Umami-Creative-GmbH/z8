import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalWorkflowTransactionContext } from "@/lib/approvals/domain-adapters/types";
import type { ApprovalCompatibilityWriter } from "@/lib/approvals/workflow/compatibility-writer";
import type { ApprovalWriteGate } from "@/lib/approvals/workflow/ports";
import {
	ApprovalWorkflowStartError,
	type StartApprovalWorkflowInput,
} from "@/lib/approvals/workflow/start-workflow";
import { isInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";

const markEmployeeWorkBalanceDirtyMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);
const loggerErrorMock = vi.hoisted(() => vi.fn());
const addCalendarSyncJobMock = vi.hoisted(() => vi.fn());
const callerMocks = vi.hoisted(() => ({
	absenceCategoryFindFirst: vi.fn(),
	absenceEntryFindMany: vi.fn(),
	createAbsenceApprovalWorkflow: vi.fn(),
	employeeFindFirst: vi.fn(),
	getPrimaryEligibleManagerIdForRequester: vi.fn(),
	onAbsenceRequestPendingApproval: vi.fn(),
	onAbsenceRequestSubmitted: vi.fn(),
	renderAbsenceRequestPendingApproval: vi.fn(),
	renderAbsenceRequestSubmitted: vi.fn(),
	runAutoCompletedAbsenceMaintenance: vi.fn(),
	sendEmail: vi.fn(),
	syncCanonicalAbsenceApprovalState: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			absenceCategory: { findFirst: callerMocks.absenceCategoryFindFirst },
			absenceEntry: { findMany: callerMocks.absenceEntryFindMany },
			employee: { findFirst: callerMocks.employeeFindFirst },
		},
		transaction: callerMocks.transaction,
		update: vi.fn(() => ({
			set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
		})),
	},
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester:
		callerMocks.getPrimaryEligibleManagerIdForRequester,
}));

vi.mock("@/lib/approvals/server/absence-approvals", () => ({
	createAbsenceApprovalWorkflow: callerMocks.createAbsenceApprovalWorkflow,
	runAutoCompletedAbsenceMaintenance:
		callerMocks.runAutoCompletedAbsenceMaintenance,
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: vi.fn().mockResolvedValue("https://example.com"),
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: callerMocks.sendEmail,
}));

vi.mock("@/lib/email/render", () => ({
	renderAbsenceRequestPendingApproval:
		callerMocks.renderAbsenceRequestPendingApproval,
	renderAbsenceRequestSubmitted: callerMocks.renderAbsenceRequestSubmitted,
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onAbsenceRequestPendingApproval: callerMocks.onAbsenceRequestPendingApproval,
	onAbsenceRequestSubmitted: callerMocks.onAbsenceRequestSubmitted,
}));

vi.mock("./actions.canonical", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./actions.canonical")>();
	return {
		...actual,
		syncCanonicalAbsenceApprovalState:
			callerMocks.syncCanonicalAbsenceApprovalState,
	};
});

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: markEmployeeWorkBalanceDirtyMock,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => ({
		error: loggerErrorMock,
		info: vi.fn(),
	})),
}));

import {
	createRequestedAbsenceRecordsInTransaction,
	requestAbsenceForEmployeeEffect,
} from "./request-absence-effect";
import {
	createSickDetailValidationError,
	enqueueVacationOverrideCalendarSyncJobs,
	markAutoApprovedAbsenceWorkBalanceDirtyBestEffort,
	shouldApplySickVacationOverrideImmediately,
	validateAbsenceSickDetail,
} from "./request-absence-effect-helpers";

function createInsertBuilder(result?: unknown[]) {
	return {
		values: vi.fn(() => ({
			returning: vi.fn().mockResolvedValue(result ?? []),
		})),
	};
}

function createVoidInsertBuilder() {
	return {
		values: vi.fn().mockResolvedValue(undefined),
	};
}

function createUpdateBuilder() {
	return {
		set: vi.fn(() => ({
			where: vi.fn().mockResolvedValue(undefined),
		})),
	};
}

function createCompatibilityWriterFixture(input?: {
	mirrorLegacyToCanonical?: ReturnType<typeof vi.fn>;
	mirrorCanonicalToLegacy?: ReturnType<typeof vi.fn>;
}) {
	const withWriteGate = vi.fn();
	const writer = {
		withWriteGate,
		mirrorLegacyToCanonical: input?.mirrorLegacyToCanonical ?? vi.fn(),
		mirrorCanonicalToLegacy: input?.mirrorCanonicalToLegacy ?? vi.fn(),
	} satisfies ApprovalCompatibilityWriter;
	withWriteGate.mockImplementation((_writeGate: ApprovalWriteGate) => writer);
	return writer;
}

function createLegacyApprovalLifecycle(
	transaction: (
		callback: (tx: unknown) => Promise<unknown>,
	) => Promise<unknown>,
) {
	return {
		withApprovalTransaction: (
			operation: (
				context: ApprovalWorkflowTransactionContext,
			) => Promise<unknown>,
		) =>
			transaction((tx) =>
				operation({
					dbService: { db: tx },
					writeGate: {
						acquire: vi.fn().mockResolvedValue({
							mode: "legacy",
							behavior: {
								serveFrom: "legacy",
								writeLegacy: true,
								writeCanonical: false,
								decideCanonical: false,
								mirror: "none",
							},
						}),
					},
					compatibilityWriter: createCompatibilityWriterFixture(),
				} as unknown as ApprovalWorkflowTransactionContext),
			),
		captureLegacyState: vi.fn(),
		startCanonicalWorkflow: vi.fn(),
		nowInstant: vi.fn(() => ({ toString: () => "2026-07-19T10:00:00Z" })),
	};
}

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

vi.mock("@/lib/queue", () => ({
	addCalendarSyncJob: addCalendarSyncJobMock,
}));

beforeEach(() => {
	vi.clearAllMocks();
	addCalendarSyncJobMock.mockClear();
	markEmployeeWorkBalanceDirtyMock.mockClear();
	markEmployeeWorkBalanceDirtyMock.mockResolvedValue(undefined);
	loggerErrorMock.mockClear();
	callerMocks.absenceCategoryFindFirst.mockResolvedValue({
		id: "category-1",
		name: "Vacation",
		type: "vacation",
		countsAgainstVacation: true,
		requiresApproval: true,
	});
	callerMocks.absenceEntryFindMany.mockResolvedValue([]);
	callerMocks.getPrimaryEligibleManagerIdForRequester.mockResolvedValue(
		"manager-1",
	);
	callerMocks.sendEmail.mockResolvedValue({
		success: true,
		messageId: "message-1",
	});
	callerMocks.renderAbsenceRequestPendingApproval.mockResolvedValue(
		"manager email",
	);
	callerMocks.renderAbsenceRequestSubmitted.mockResolvedValue("employee email");
	callerMocks.runAutoCompletedAbsenceMaintenance.mockResolvedValue(undefined);
	callerMocks.syncCanonicalAbsenceApprovalState.mockResolvedValue(undefined);
	callerMocks.createAbsenceApprovalWorkflow.mockReturnValue(
		Effect.succeed({
			kind: "default_created",
			approvalRequestId: "approval-1",
		}),
	);
});

function configureAbsenceCallerTransaction() {
	callerMocks.transaction.mockImplementation(async (callback) => {
		const insert = vi
			.fn()
			.mockReturnValueOnce(
				createInsertBuilder([
					{
						id: "absence-1",
						employeeId: "employee-1",
						organizationId: "org-1",
						status: "pending",
					},
				]),
			)
			.mockReturnValueOnce(createInsertBuilder([{ id: "canonical-1" }]))
			.mockReturnValueOnce(createVoidInsertBuilder());
		return callback({ insert, update: vi.fn(() => createUpdateBuilder()) });
	});
	return createLegacyApprovalLifecycle(callerMocks.transaction);
}

const absenceRequest = {
	categoryId: "category-1",
	startDate: "2026-05-11",
	startPeriod: "full_day" as const,
	endDate: "2026-05-12",
	endPeriod: "full_day" as const,
	notes: "Vacation",
	durationKind: "full_day" as const,
	sickDetail: null,
};

describe("requestAbsenceForEmployeeEffect approval presentation", () => {
	it("does not send pending notifications or enter no-manager handling after auto-completion", async () => {
		const approvalLifecycle = configureAbsenceCallerTransaction();
		callerMocks.employeeFindFirst
			.mockResolvedValueOnce({
				id: "manager-1",
				userId: "manager-user-1",
				organizationId: "org-1",
				user: { name: "Morgan Manager", email: "manager@example.com" },
			})
			.mockResolvedValueOnce({
				id: "employee-1",
				userId: "user-1",
				organizationId: "org-1",
				user: { name: "Avery Employee", email: "avery@example.com" },
			});
		callerMocks.createAbsenceApprovalWorkflow.mockReturnValue(
			Effect.succeed({
				kind: "auto_completed",
				chainInstanceId: null,
				approvalRequestId: "approval-1",
				reason: "requester_is_approver",
				autoCompletion: {
					absence: { id: "absence-1", status: "approved" },
					vacationOverrideSummary: {
						updatedAbsenceIds: [],
						createdAbsenceIds: [],
						deletedAbsenceIds: [],
					},
				},
			}),
		);

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			approvalLifecycle as never,
		);

		expect(result).toEqual({ success: true, data: { absenceId: "absence-1" } });
		expect(callerMocks.sendEmail).not.toHaveBeenCalled();
		expect(callerMocks.onAbsenceRequestPendingApproval).not.toHaveBeenCalled();
		expect(
			callerMocks.syncCanonicalAbsenceApprovalState,
		).not.toHaveBeenCalled();
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).toHaveBeenCalledOnce();
	});

	it("sends the existing pending notifications for a human approval", async () => {
		const approvalLifecycle = configureAbsenceCallerTransaction();
		callerMocks.createAbsenceApprovalWorkflow.mockReturnValue(
			Effect.succeed({
				kind: "default_created",
				approvalRequestId: "approval-1",
			}),
		);
		callerMocks.employeeFindFirst
			.mockResolvedValueOnce({
				id: "manager-1",
				userId: "manager-user-1",
				organizationId: "org-1",
				user: { name: "Morgan Manager", email: "manager@example.com" },
			})
			.mockResolvedValueOnce({
				id: "employee-1",
				userId: "user-1",
				organizationId: "org-1",
				user: { name: "Avery Employee", email: "avery@example.com" },
			});

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			approvalLifecycle as never,
		);

		expect(result).toEqual({ success: true, data: { absenceId: "absence-1" } });
		expect(callerMocks.sendEmail).toHaveBeenCalledTimes(2);
		expect(callerMocks.onAbsenceRequestPendingApproval).toHaveBeenCalledOnce();
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
	});
});

describe("validateAbsenceSickDetail", () => {
	it("requires sick detail for sick requests", () => {
		expect(
			validateAbsenceSickDetail({
				categoryType: "sick",
				sickDetail: undefined,
			}),
		).toBe("Sick detail is required for sick absences");
	});

	it("rejects sick detail for vacation requests", () => {
		expect(
			validateAbsenceSickDetail({
				categoryType: "vacation",
				sickDetail: "child_sick",
			}),
		).toBe("Sick detail can only be used for sick absences");
	});

	it("accepts sick detail for sick requests", () => {
		expect(
			validateAbsenceSickDetail({
				categoryType: "sick",
				sickDetail: "without_certificate",
			}),
		).toBeNull();
	});
});

describe("createSickDetailValidationError", () => {
	it("does not expose the submitted sick detail as the validation value", () => {
		const error = createSickDetailValidationError(
			"Sick detail can only be used for sick absences",
		);

		expect(error.field).toBe("sickDetail");
		expect(error.value).toBe("[redacted]");
	});
});

describe("enqueueVacationOverrideCalendarSyncJobs", () => {
	it("queues calendar sync for updated, created, and deleted vacation overrides", () => {
		enqueueVacationOverrideCalendarSyncJobs({
			employeeId: "employee-1",
			organizationId: "org-1",
			summary: {
				updatedAbsenceIds: ["updated-1"],
				createdAbsenceIds: ["created-1"],
				deletedAbsenceIds: ["deleted-1"],
			},
		});

		expect(addCalendarSyncJobMock).toHaveBeenCalledTimes(3);
		expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(1, {
			absenceId: "updated-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			action: "update",
		});
		expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(2, {
			absenceId: "created-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			action: "create",
		});
		expect(addCalendarSyncJobMock).toHaveBeenNthCalledWith(3, {
			absenceId: "deleted-1",
			employeeId: "employee-1",
			organizationId: "org-1",
			action: "delete",
		});
	});
});

describe("shouldApplySickVacationOverrideImmediately", () => {
	it("defers approval-required employee sick overrides until approval", () => {
		expect(
			shouldApplySickVacationOverrideImmediately({
				categoryType: "sick",
				startPeriod: "full_day",
				endPeriod: "full_day",
				requiresApproval: true,
				hasManagerApprovalWorkflow: true,
			}),
		).toBe(false);
	});

	it("applies auto-approved sick overrides immediately", () => {
		expect(
			shouldApplySickVacationOverrideImmediately({
				categoryType: "sick",
				startPeriod: "full_day",
				endPeriod: "full_day",
				requiresApproval: false,
				hasManagerApprovalWorkflow: false,
			}),
		).toBe(true);
	});
});

describe("createRequestedAbsenceRecordsInTransaction", () => {
	type TransactionalState = {
		absences: Record<string, unknown>[];
		timeRecords: Record<string, unknown>[];
		absenceDetails: Record<string, unknown>[];
		sourceLinks: Record<string, unknown>[];
		workflows: Record<string, unknown>[];
		stages: Record<string, unknown>[];
		events: Record<string, unknown>[];
		projections: Record<string, unknown>[];
		outbox: Record<string, unknown>[];
		legacyRequests: Record<string, unknown>[];
		legacyChains: Record<string, unknown>[];
	};

	function emptyTransactionalState(): TransactionalState {
		return {
			absences: [],
			timeRecords: [],
			absenceDetails: [],
			sourceLinks: [],
			workflows: [],
			stages: [],
			events: [],
			projections: [],
			outbox: [],
			legacyRequests: [],
			legacyChains: [],
		};
	}

	function cloneTransactionalState(
		state: TransactionalState,
	): TransactionalState {
		return structuredClone(state);
	}

	function expectTransactionalStateEmpty(state: TransactionalState) {
		for (const collection of Object.values(state))
			expect(collection).toEqual([]);
	}

	function expectPostCommitCallbacksZero() {
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expect(callerMocks.sendEmail).not.toHaveBeenCalled();
		expect(callerMocks.onAbsenceRequestSubmitted).not.toHaveBeenCalled();
		expect(callerMocks.onAbsenceRequestPendingApproval).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
		expect(markEmployeeWorkBalanceDirtyMock).not.toHaveBeenCalled();
	}

	function createModeRoutingHarness(
		mode: "legacy" | "shadow" | "ready" | "canonical" | "complete",
	) {
		const calls: string[] = [];
		const plainTransaction = vi.fn();
		let insertIndex = 0;
		let updateIndex = 0;
		let committedState = emptyTransactionalState();
		let activeState: TransactionalState | null = null;
		let allAuto = false;
		let sourceFinalizationCount = 0;
		const currentState = () => {
			if (!activeState) throw new Error("No active approval transaction");
			return activeState;
		};
		let bindRows = [
			{
				id: "absence-1",
				organizationId: "org-1",
				approvalWorkflowId: "workflow-1",
			},
		];
		const tx = {
			insert: vi.fn(() => {
				insertIndex += 1;
				if (insertIndex === 1) {
					calls.push("source");
					return {
						values: vi.fn((values: Record<string, unknown>) => ({
							returning: vi.fn(async () => {
								currentState().absences.push({
									...values,
									id: "absence-1",
									status: "pending",
								});
								return [{ id: "absence-1", status: "pending" }];
							}),
						})),
					};
				}
				if (insertIndex === 2) {
					calls.push("canonical");
					return {
						values: vi.fn((values: Record<string, unknown>) => ({
							returning: vi.fn(async () => {
								currentState().timeRecords.push({
									...values,
									id: "canonical-1",
								});
								return [{ id: "canonical-1" }];
							}),
						})),
					};
				}
				return {
					values: vi.fn(async (values: Record<string, unknown>) => {
						currentState().absenceDetails.push(values);
					}),
				};
			}),
			update: vi.fn(() => {
				const currentUpdateIndex = ++updateIndex;
				if (currentUpdateIndex === 2) calls.push("bind");
				return {
					set: vi.fn((values: Record<string, unknown>) => ({
						where: vi.fn(() => {
							if (currentUpdateIndex === 1) {
								Object.assign(currentState().absences[0] ?? {}, values);
							}
							return {
								returning: vi.fn(async () => {
									if (currentUpdateIndex === 2 && bindRows.length === 1) {
										currentState().sourceLinks.push({
											absenceId: "absence-1",
											organizationId: "org-1",
											...values,
										});
										Object.assign(currentState().absences[0] ?? {}, values);
									}
									return currentUpdateIndex === 2
										? bindRows
										: [{ id: "absence-1" }];
								}),
							};
						}),
					})),
				};
			}),
			query: {
				absenceEntry: {
					findFirst: vi.fn().mockResolvedValue({
						id: "absence-1",
						organizationId: "org-1",
						approvalWorkflowId: "workflow-1",
					}),
				},
			},
		};
		const gateResult = {
			mode,
			behavior: {
				serveFrom:
					mode === "canonical" || mode === "complete" ? "canonical" : "legacy",
				writeLegacy: mode !== "complete",
				writeCanonical: mode !== "legacy",
				decideCanonical: mode === "canonical" || mode === "complete",
				mirror:
					mode === "shadow" || mode === "ready"
						? "legacy_to_canonical"
						: mode === "canonical"
							? "canonical_to_legacy"
							: "none",
			},
		};
		const compatibilityWriter = createCompatibilityWriterFixture({
			mirrorLegacyToCanonical: vi.fn(async () => {
				calls.push("mirror");
				currentState().workflows.push({
					id: "workflow-1",
					status: allAuto ? "approved" : "pending",
				});
				currentState().stages.push({
					id: "stage-1",
					status: allAuto ? "approved" : "pending",
				});
				currentState().events.push({
					id: "event-1",
					type: "legacy.observed",
				});
				currentState().projections.push({ workflowId: "workflow-1" });
				currentState().outbox.push({ workflowId: "workflow-1" });
				return {
					snapshot: {
						id: "workflow-1",
						organizationId: "org-1",
						workflowType: "absence",
						sourceType: "absence_entry",
						sourceId: "absence-1",
						status: allAuto ? "approved" : "pending",
					},
				} as never;
			}),
			mirrorCanonicalToLegacy: vi.fn(async () => {
				calls.push("canonical-mirror");
				currentState().legacyRequests.push({
					id: "approval-1",
					status: allAuto ? "approved" : "pending",
				});
				currentState().legacyChains.push({
					id: "chain-1",
					status: allAuto ? "approved" : "pending",
				});
			}),
		});
		const context = {
			dbService: { db: tx },
			writeGate: {
				acquire: vi.fn(async () => {
					calls.push("gate");
					return gateResult;
				}),
			},
			compatibilityWriter,
		};
		let captureCount = 0;
		const transactionState = { committed: false };
		const startCanonicalWorkflow = vi.fn(
			async (input: StartApprovalWorkflowInput) => {
				calls.push("start");
				await input.context.writeGate.acquire({
					organizationId: input.organizationId,
					workflowType: input.workflowType,
				});
				currentState().workflows.push({
					id: "workflow-1",
					status: allAuto ? "approved" : "pending",
				});
				currentState().stages.push({
					id: "stage-1",
					status: allAuto ? "approved" : "pending",
				});
				currentState().events.push({
					id: "event-1",
					type: "workflow.submitted",
				});
				await input.bindSourceWorkflow("workflow-1");
				currentState().projections.push({ workflowId: "workflow-1" });
				currentState().outbox.push({ workflowId: "workflow-1" });
				return {
					kind: "created",
					status: allAuto ? "approved" : "pending",
					terminal: allAuto,
					snapshot: {
						id: "workflow-1",
						status: allAuto ? "approved" : "pending",
						completedAt: allAuto ? parseInstant("2026-07-19T10:00:00Z") : null,
						stages: [],
					},
					events: [],
					projection: {},
					outbox: [],
					outboxResults: [],
				};
			},
		);
		const approvalLifecycle = {
			withApprovalTransaction: vi.fn(
				async (operation: (value: unknown) => Promise<unknown>) => {
					calls.push("transaction");
					activeState = cloneTransactionalState(committedState);
					try {
						const result = await operation(context);
						committedState = cloneTransactionalState(currentState());
						transactionState.committed = true;
						return result;
					} finally {
						activeState = null;
					}
				},
			),
			captureLegacyState: vi.fn(async () => {
				captureCount += 1;
				calls.push(captureCount === 1 ? "capture-before" : "capture-after");
				return {
					organizationId: "org-1",
					source: {
						organizationId: "org-1",
						workflowType: "absence",
						sourceType: "absence_entry",
						sourceId: "absence-1",
					},
				};
			}),
			startCanonicalWorkflow,
			finalizeCanonicalAutoCompletion: vi.fn(async () => {
				calls.push("auto-finalizer");
				sourceFinalizationCount += 1;
				Object.assign(currentState().absences[0] ?? {}, {
					status: "approved",
					approvedBy: "employee-1",
				});
				Object.assign(currentState().timeRecords[0] ?? {}, {
					approvalState: "approved",
				});
				return {
					absence: { id: "absence-1", status: "approved" },
					vacationOverrideSummary: {
						updatedAbsenceIds: [],
						createdAbsenceIds: [],
						deletedAbsenceIds: [],
					},
				};
			}),
			nowInstant: vi.fn(() => parseInstant("2026-07-19T10:00:00Z")),
		};
		const create = vi.fn(() => {
			calls.push("legacy-create");
			currentState().legacyRequests.push({
				id: "approval-1",
				status: allAuto ? "approved" : "pending",
			});
			currentState().legacyChains.push({
				id: "chain-1",
				status: allAuto ? "approved" : "pending",
			});
			if (allAuto) {
				calls.push("legacy-finalize");
				sourceFinalizationCount += 1;
				Object.assign(currentState().absences[0] ?? {}, {
					status: "approved",
					approvedBy: "employee-1",
				});
				Object.assign(currentState().timeRecords[0] ?? {}, {
					approvalState: "approved",
				});
				return Effect.succeed({
					kind: "auto_completed" as const,
					chainInstanceId: "chain-1",
					approvalRequestId: "approval-1",
					reason: "requester_is_approver" as const,
					autoCompletion: {
						absence: { id: "absence-1", status: "approved" },
						vacationOverrideSummary: {
							updatedAbsenceIds: [],
							createdAbsenceIds: [],
							deletedAbsenceIds: [],
						},
					},
				});
			}
			return Effect.succeed({
				kind: "default_created" as const,
				approvalRequestId: "approval-1",
			});
		});
		const dbService = {
			db: { transaction: plainTransaction },
			query: vi.fn((_name, run) =>
				Effect.tryPromise({ try: run, catch: (error) => error }),
			),
		};

		return {
			approvalLifecycle,
			calls,
			context,
			create,
			dbService,
			plainTransaction,
			currentState,
			snapshot: () => cloneTransactionalState(committedState),
			setBindRows: (rows: typeof bindRows) => {
				bindRows = rows;
			},
			setAllAuto: (value: boolean) => {
				allAuto = value;
			},
			sourceFinalizationCount: () => sourceFinalizationCount,
			startCanonicalWorkflow,
			transactionState,
		};
	}

	function submitModeRoutingHarness(
		harness: ReturnType<typeof createModeRoutingHarness>,
		approverId = "manager-1",
	) {
		return Effect.runPromise(
			createRequestedAbsenceRecordsInTransaction({
				dbService: harness.dbService as never,
				currentEmployee: {
					id: "employee-1",
					organizationId: "org-1",
					teamId: "team-1",
				},
				data: {
					categoryId: "category-1",
					startDate: "2026-05-11",
					startPeriod: "full_day",
					endDate: "2026-05-12",
					endPeriod: "full_day",
					notes: "private note",
					durationKind: "full_day",
					sickDetail: null,
				},
				category: {
					name: "Vacation",
					countsAgainstVacation: true,
					requiresApproval: true,
					type: "vacation",
				},
				createdBy: "user-1",
				hasManagerApprovalWorkflow: true,
				approvalWorkflow: {
					categoryId: "category-1",
					approverId,
					create: harness.create,
				},
				approvalLifecycle: harness.approvalLifecycle as never,
			}),
		);
	}

	it.each([
		["legacy", ["transaction", "source", "canonical", "gate", "legacy-create"]],
		[
			"shadow",
			[
				"transaction",
				"source",
				"canonical",
				"gate",
				"capture-before",
				"legacy-create",
				"capture-after",
				"mirror",
				"bind",
			],
		],
		[
			"ready",
			[
				"transaction",
				"source",
				"canonical",
				"gate",
				"capture-before",
				"legacy-create",
				"capture-after",
				"mirror",
				"bind",
			],
		],
		[
			"canonical",
			[
				"transaction",
				"source",
				"canonical",
				"gate",
				"start",
				"bind",
				"canonical-mirror",
			],
		],
		[
			"complete",
			["transaction", "source", "canonical", "gate", "start", "bind"],
		],
	] as const)("routes %s submissions in one approval-owned transaction", async (mode, expected) => {
		const harness = createModeRoutingHarness(mode);

		const result = await Effect.runPromise(
			createRequestedAbsenceRecordsInTransaction({
				dbService: harness.dbService as never,
				currentEmployee: {
					id: "employee-1",
					organizationId: "org-1",
					teamId: "team-1",
				},
				data: {
					categoryId: "category-1",
					startDate: "2026-05-11",
					startPeriod: "full_day",
					endDate: "2026-05-12",
					endPeriod: "full_day",
					notes: "private note",
					durationKind: "full_day",
					sickDetail: null,
				},
				category: {
					name: "Vacation",
					countsAgainstVacation: true,
					requiresApproval: true,
					type: "vacation",
				},
				createdBy: "user-1",
				hasManagerApprovalWorkflow: true,
				approvalWorkflow: {
					categoryId: "category-1",
					approverId: "manager-1",
					create: harness.create,
				},
				approvalLifecycle: harness.approvalLifecycle as never,
			}),
		);

		expect(result).toMatchObject({
			id: "absence-1",
			canonicalRecordId: "canonical-1",
		});
		expect(harness.calls).toEqual(expected);
		expect(
			harness.approvalLifecycle.withApprovalTransaction,
		).toHaveBeenCalledOnce();
		expect(harness.plainTransaction).not.toHaveBeenCalled();
		expect(harness.create).toHaveBeenCalledTimes(
			mode === "legacy" || mode === "shadow" || mode === "ready" ? 1 : 0,
		);
		expect(harness.startCanonicalWorkflow).toHaveBeenCalledTimes(
			mode === "canonical" || mode === "complete" ? 1 : 0,
		);
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("routes a managerless policy submission in %s without notifying a default manager", async (mode) => {
		const harness = createModeRoutingHarness(mode);
		callerMocks.getPrimaryEligibleManagerIdForRequester.mockResolvedValueOnce(
			null,
		);
		callerMocks.createAbsenceApprovalWorkflow.mockReturnValue(
			Effect.succeed({
				kind: "chain_created",
				chainInstanceId: "chain-1",
				approvalRequestId: "approval-1",
			}),
		);

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			harness.approvalLifecycle as never,
		);

		expect(result).toEqual({ success: true, data: { absenceId: "absence-1" } });
		expect(harness.transactionState.committed).toBe(true);
		expect(callerMocks.sendEmail).not.toHaveBeenCalled();
		expect(callerMocks.onAbsenceRequestPendingApproval).not.toHaveBeenCalled();
		if (mode === "legacy" || mode === "shadow" || mode === "ready") {
			expect(callerMocks.createAbsenceApprovalWorkflow).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ defaultApproverId: null }),
			);
		} else {
			expect(harness.startCanonicalWorkflow).toHaveBeenCalledWith(
				expect.objectContaining({ defaultApproverEmployeeId: null }),
			);
		}
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("rolls back a managerless %s submission when no policy matches", async (mode) => {
		const harness = createModeRoutingHarness(mode);
		const failure = new ValidationError({
			message: "No manager assigned to approve absence requests",
			field: "managerId",
		});
		callerMocks.getPrimaryEligibleManagerIdForRequester.mockResolvedValueOnce(
			null,
		);
		callerMocks.createAbsenceApprovalWorkflow.mockReturnValue(
			Effect.fail(failure),
		);
		harness.startCanonicalWorkflow.mockRejectedValueOnce(
			new ApprovalWorkflowStartError("NO_DEFAULT_APPROVER"),
		);

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			harness.approvalLifecycle as never,
		);

		expect(result).toEqual({
			success: false,
			error: "No manager assigned to approve absence requests",
			code: "ValidationError",
		});
		expect(
			harness.approvalLifecycle.withApprovalTransaction,
		).toHaveBeenCalledOnce();
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expectPostCommitCallbacksZero();
	});

	it("passes exact trusted absence identity and a non-sensitive projection to canonical start", async () => {
		const harness = createModeRoutingHarness("canonical");

		await Effect.runPromise(
			createRequestedAbsenceRecordsInTransaction({
				dbService: harness.dbService as never,
				currentEmployee: {
					id: "employee-1",
					organizationId: "org-1",
					teamId: "team-1",
				},
				data: {
					categoryId: "category-1",
					startDate: "2026-05-11",
					startPeriod: "full_day",
					endDate: "2026-05-12",
					endPeriod: "full_day",
					notes: "private note",
					durationKind: "full_day",
					sickDetail: null,
				},
				category: {
					name: "Vacation",
					countsAgainstVacation: true,
					requiresApproval: true,
					type: "vacation",
				},
				createdBy: "user-1",
				hasManagerApprovalWorkflow: true,
				approvalWorkflow: {
					categoryId: "category-1",
					approverId: "manager-1",
					create: harness.create,
				},
				approvalLifecycle: harness.approvalLifecycle as never,
			}),
		);

		expect(harness.startCanonicalWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				workflowType: "absence",
				sourceIdentity: {
					organizationId: "org-1",
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: "absence-1",
				},
				requesterEmployeeId: "employee-1",
				actor: { kind: "employee", employeeId: "employee-1", userId: "user-1" },
				submissionKey: "absence:absence-1:submission",
				defaultApproverEmployeeId: "manager-1",
				routingContext: {
					organizationId: "org-1",
					workflowType: "absence",
					source: { type: "absence_entry", id: "absence-1" },
					requesterEmployeeId: "employee-1",
					teamIds: ["team-1"],
					locationId: null,
					absenceCategoryId: "category-1",
					travelExpenseAmount: null,
					overtimeRisk: null,
					employeeGroupIds: [],
				},
				displayProjection: {
					displayPayload: {
						absenceId: "absence-1",
						employeeId: "employee-1",
						categoryName: "Vacation",
						startDate: "2026-05-11",
						endDate: "2026-05-12",
					},
					searchText: "Vacation 2026-05-11 2026-05-12",
				},
			}),
		);
		const startInput = harness.startCanonicalWorkflow.mock.calls[0]?.[0];
		expect(startInput.displayProjection.displayPayload).not.toHaveProperty(
			"notes",
		);
		expect(startInput.displayProjection.displayPayload).not.toHaveProperty(
			"sickDetail",
		);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("captures exact transaction-scoped evidence and mirror identity in %s mode", async (mode) => {
		const harness = createModeRoutingHarness(mode);

		await submitModeRoutingHarness(harness);

		expect(harness.approvalLifecycle.captureLegacyState).toHaveBeenCalledTimes(
			2,
		);
		for (const [captureInput] of harness.approvalLifecycle.captureLegacyState
			.mock.calls) {
			expect(captureInput).toEqual({
				dbService: harness.context.dbService,
				organizationId: "org-1",
				absenceId: "absence-1",
				capturedAt: captureInput.capturedAt,
			});
			expect(isInstant(captureInput.capturedAt)).toBe(true);
		}
		expect(
			harness.approvalLifecycle.captureLegacyState.mock.calls[0]?.[0].dbService,
		).toBe(harness.context.dbService);
		expect(
			harness.approvalLifecycle.captureLegacyState.mock.calls[1]?.[0].dbService,
		).toBe(harness.context.dbService);
		expect(
			harness.context.compatibilityWriter.mirrorLegacyToCanonical,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				actor: {
					kind: "employee",
					employeeId: "employee-1",
					userId: "user-1",
				},
				idempotencyKey: "absence:absence-1:submission",
				expectedVersion: null,
				before: expect.any(Object),
				after: expect.any(Object),
			}),
		);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("rebinds the compatibility writer to one exact-scope fixed gate in %s mode", async (mode) => {
		const harness = createModeRoutingHarness(mode);

		await submitModeRoutingHarness(harness);

		const withWriteGate = (
			harness.context.compatibilityWriter as {
				withWriteGate: ReturnType<typeof vi.fn>;
			}
		).withWriteGate;
		expect(withWriteGate).toHaveBeenCalledOnce();
		const fixedGate = withWriteGate.mock.calls[0]?.[0] as ApprovalWriteGate;
		await expect(
			fixedGate.acquire({ organizationId: "org-1", workflowType: "absence" }),
		).resolves.toMatchObject({ mode });
		await expect(
			fixedGate.acquire({ organizationId: "org-2", workflowType: "absence" }),
		).rejects.toMatchObject({ code: "invalid_source_identity" });
		expect(harness.context.writeGate.acquire).toHaveBeenCalledOnce();
	});

	it.each([
		"shadow",
		"ready",
	] as const)("binds the exact observed workflow before committing %s submission", async (mode) => {
		const harness = createModeRoutingHarness(mode);

		await submitModeRoutingHarness(harness);

		expect(harness.calls.indexOf("mirror")).toBeLessThan(
			harness.calls.indexOf("bind"),
		);
		expect(harness.snapshot().absences[0]).toMatchObject({
			id: "absence-1",
			organizationId: "org-1",
			approvalWorkflowId: "workflow-1",
		});
		expect(harness.snapshot().sourceLinks).toEqual([
			{
				absenceId: "absence-1",
				organizationId: "org-1",
				approvalWorkflowId: "workflow-1",
			},
		]);
	});

	it.each([
		"shadow",
		"ready",
	] as const)("rolls back %s submission when observed workflow binding loses its CAS", async (mode) => {
		const harness = createModeRoutingHarness(mode);
		harness.setBindRows([]);

		await expect(submitModeRoutingHarness(harness)).rejects.toThrow(
			/ workflow binding affected an unexpected row count/i,
		);
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expectPostCommitCallbacksZero();
	});

	it.each([
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("finalizes all-auto %s submission parity exactly once before commit", async (mode) => {
		const harness = createModeRoutingHarness(mode);
		harness.setAllAuto(true);

		const result = await submitModeRoutingHarness(harness, "employee-1");
		const state = harness.snapshot();

		expect(result).toMatchObject({ id: "absence-1", status: "approved" });
		expect(state.absences).toHaveLength(1);
		expect(state.absences[0]).toMatchObject({
			id: "absence-1",
			status: "approved",
			approvedBy: "employee-1",
		});
		expect(state.timeRecords).toHaveLength(1);
		expect(state.timeRecords[0]).toMatchObject({
			id: "canonical-1",
			approvalState: "approved",
		});
		expect(harness.sourceFinalizationCount()).toBe(1);
		if (mode === "shadow" || mode === "ready") {
			expect(harness.calls.indexOf("legacy-finalize")).toBeLessThan(
				harness.calls.indexOf("mirror"),
			);
			expect(state.workflows).toHaveLength(1);
		}
		if (mode === "canonical") {
			expect(harness.calls.indexOf("auto-finalizer")).toBeLessThan(
				harness.calls.indexOf("canonical-mirror"),
			);
			expect(state.legacyRequests).toHaveLength(1);
		}
		if (mode === "complete") {
			expect(
				harness.context.compatibilityWriter.mirrorCanonicalToLegacy,
			).not.toHaveBeenCalled();
			expect(state.legacyRequests).toEqual([]);
			expect(state.legacyChains).toEqual([]);
		}
	});

	it.each([
		"canonical",
		"complete",
	] as const)("returns the stable public result and runs all-auto maintenance once after %s commit", async (mode) => {
		const harness = createModeRoutingHarness(mode);
		harness.setAllAuto(true);
		callerMocks.runAutoCompletedAbsenceMaintenance.mockImplementationOnce(
			async () => {
				expect(harness.transactionState.committed).toBe(true);
				expect(harness.snapshot().absences[0]).toMatchObject({
					status: "approved",
				});
			},
		);

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			harness.approvalLifecycle as never,
		);

		expect(result).toEqual({ success: true, data: { absenceId: "absence-1" } });
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).toHaveBeenCalledOnce();
		expect(callerMocks.sendEmail).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
	});

	it.each([
		["legacy", true],
		["shadow", true],
		["ready", true],
		["canonical", false],
		["complete", false],
	] as const)("routes direct pending submission delivery in %s mode", async (mode, expectsLegacyDelivery) => {
		const harness = createModeRoutingHarness(mode);
		callerMocks.employeeFindFirst
			.mockResolvedValueOnce({
				id: "manager-1",
				userId: "manager-user-1",
				organizationId: "org-1",
				user: { name: "Default Manager", email: "manager@example.com" },
			})
			.mockResolvedValueOnce({
				id: "employee-1",
				userId: "user-1",
				organizationId: "org-1",
				user: { name: "Avery Employee", email: "avery@example.com" },
			});

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			harness.approvalLifecycle as never,
		);

		expect(result).toEqual({ success: true, data: { absenceId: "absence-1" } });
		expect(callerMocks.sendEmail).toHaveBeenCalledTimes(
			expectsLegacyDelivery ? 2 : 0,
		);
		expect(callerMocks.onAbsenceRequestSubmitted).toHaveBeenCalledTimes(
			expectsLegacyDelivery ? 1 : 0,
		);
		expect(callerMocks.onAbsenceRequestPendingApproval).toHaveBeenCalledTimes(
			expectsLegacyDelivery ? 1 : 0,
		);
		if (!expectsLegacyDelivery) {
			expect(callerMocks.employeeFindFirst).not.toHaveBeenCalled();
		}
	});

	it.each([
		"render",
		"email",
		"notification",
	] as const)("keeps committed legacy submission successful when post-commit %s delivery fails", async (failure) => {
		const harness = createModeRoutingHarness("legacy");
		callerMocks.employeeFindFirst
			.mockResolvedValueOnce({
				id: "manager-1",
				userId: "manager-user-1",
				organizationId: "org-1",
				user: { name: "Default Manager", email: "manager@example.com" },
			})
			.mockResolvedValueOnce({
				id: "employee-1",
				userId: "user-1",
				organizationId: "org-1",
				user: { name: "Avery Employee", email: "avery@example.com" },
			});
		if (failure === "render") {
			callerMocks.renderAbsenceRequestPendingApproval.mockRejectedValueOnce(
				new Error("render failed"),
			);
		} else if (failure === "email") {
			callerMocks.sendEmail.mockRejectedValue(new Error("email failed"));
		} else {
			callerMocks.onAbsenceRequestSubmitted.mockImplementationOnce(() => {
				throw new Error("notification failed");
			});
		}

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			harness.approvalLifecycle as never,
		);
		const committed = harness.snapshot();

		expect(result).toEqual({ success: true, data: { absenceId: "absence-1" } });
		expect(
			harness.approvalLifecycle.withApprovalTransaction,
		).toHaveBeenCalledOnce();
		expect(committed.absences).toHaveLength(1);
		expect(committed.timeRecords).toHaveLength(1);
		expect(committed.absenceDetails).toHaveLength(1);
		expect(harness.calls.filter((call) => call === "source")).toHaveLength(1);
		expect(loggerErrorMock).toHaveBeenCalledWith(
			expect.objectContaining({
				absenceId: "absence-1",
				error: expect.anything(),
			}),
			"Failed to deliver absence submission notifications after commit",
		);
	});

	it.each([
		"canonical",
		"complete",
	] as const)("suppresses post-commit work and rolls back public %s auto-finalizer failure", async (mode) => {
		const harness = createModeRoutingHarness(mode);
		harness.setAllAuto(true);
		harness.approvalLifecycle.finalizeCanonicalAutoCompletion.mockImplementationOnce(
			async () => {
				Object.assign(harness.currentState().absences[0] ?? {}, {
					status: "approved",
				});
				Object.assign(harness.currentState().timeRecords[0] ?? {}, {
					approvalState: "approved",
				});
				throw new Error("auto-finalizer failed");
			},
		);

		const result = await requestAbsenceForEmployeeEffect(
			absenceRequest,
			{ id: "employee-1", organizationId: "org-1", teamId: "team-1" },
			"user-1",
			harness.approvalLifecycle as never,
		);

		expect(result).toMatchObject({ success: false });
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expect(callerMocks.sendEmail).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it("finalizes a canonical all-auto workflow once before its compatibility mirror", async () => {
		const harness = createModeRoutingHarness("canonical");
		const completedAt = { toString: () => "2026-07-19T10:00:00Z" };
		harness.startCanonicalWorkflow.mockImplementationOnce(
			async (input: StartApprovalWorkflowInput) => {
				harness.calls.push("start");
				await input.context.writeGate.acquire({
					organizationId: input.organizationId,
					workflowType: input.workflowType,
				});
				await input.bindSourceWorkflow("workflow-1");
				return {
					kind: "created",
					status: "approved",
					terminal: true,
					snapshot: {
						id: "workflow-1",
						status: "approved",
						completedAt,
						stages: [],
					},
					events: [],
					projection: {},
					outbox: [],
					outboxResults: [],
				};
			},
		);

		const result = await Effect.runPromise(
			createRequestedAbsenceRecordsInTransaction({
				dbService: harness.dbService as never,
				currentEmployee: {
					id: "employee-1",
					organizationId: "org-1",
					teamId: "team-1",
				},
				data: {
					categoryId: "category-1",
					startDate: "2026-05-11",
					startPeriod: "full_day",
					endDate: "2026-05-12",
					endPeriod: "full_day",
					notes: "private note",
					durationKind: "full_day",
					sickDetail: null,
				},
				category: {
					name: "Vacation",
					countsAgainstVacation: true,
					requiresApproval: true,
					type: "vacation",
				},
				createdBy: "user-1",
				hasManagerApprovalWorkflow: true,
				approvalWorkflow: {
					categoryId: "category-1",
					approverId: "employee-1",
					create: harness.create,
				},
				approvalLifecycle: harness.approvalLifecycle as never,
			}),
		);

		expect(harness.calls).toEqual([
			"transaction",
			"source",
			"canonical",
			"gate",
			"start",
			"bind",
			"auto-finalizer",
			"canonical-mirror",
		]);
		expect(
			harness.approvalLifecycle.finalizeCanonicalAutoCompletion,
		).toHaveBeenCalledOnce();
		expect(
			harness.approvalLifecycle.finalizeCanonicalAutoCompletion,
		).toHaveBeenCalledWith({
			dbService: expect.objectContaining({ db: harness.context.dbService.db }),
			organizationId: "org-1",
			absenceId: "absence-1",
			expectedApprovalWorkflowId: "workflow-1",
			expectedCanonicalRecordId: "canonical-1",
			actorEmployeeId: "employee-1",
			actorUserId: "user-1",
			transition: { kind: "approve" },
			finalizedAt: completedAt,
		});
		expect(result).toMatchObject({
			status: "approved",
			autoCompletion: { absence: { id: "absence-1", status: "approved" } },
		});
	});

	it.each([
		"capture-after",
		"legacy-mirror",
	] as const)("does not commit or run post-commit work when shadow %s fails", async (failure) => {
		const harness = createModeRoutingHarness("shadow");
		if (failure === "capture-after") {
			harness.approvalLifecycle.captureLegacyState
				.mockResolvedValueOnce({
					organizationId: "org-1",
					source: {
						organizationId: "org-1",
						workflowType: "absence",
						sourceType: "absence_entry",
						sourceId: "absence-1",
					},
				} as never)
				.mockRejectedValueOnce(new Error("capture-after failed"));
		} else {
			harness.context.compatibilityWriter.mirrorLegacyToCanonical.mockImplementationOnce(
				async () => {
					harness.currentState().workflows.push({ id: "workflow-1" });
					harness.currentState().stages.push({ id: "stage-1" });
					harness.currentState().events.push({ id: "event-1" });
					harness.currentState().projections.push({ workflowId: "workflow-1" });
					harness.currentState().outbox.push({ workflowId: "workflow-1" });
					throw new Error("legacy mirror failed");
				},
			);
		}

		await expect(submitModeRoutingHarness(harness)).rejects.toThrow(/failed/);
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
		expect(callerMocks.sendEmail).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it("rolls back source and canonical rows when capture-before fails", async () => {
		const harness = createModeRoutingHarness("shadow");
		harness.approvalLifecycle.captureLegacyState.mockRejectedValueOnce(
			new Error("capture-before failed"),
		);

		await expect(submitModeRoutingHarness(harness)).rejects.toThrow(
			"capture-before failed",
		);
		expect(harness.create).not.toHaveBeenCalled();
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it.each([
		"start persistence",
		"projection",
		"outbox",
	] as const)("does not commit when canonical %s fails", async (failure) => {
		const harness = createModeRoutingHarness("canonical");
		harness.startCanonicalWorkflow.mockImplementationOnce(async (input) => {
			harness.calls.push("start");
			harness.currentState().workflows.push({ id: "workflow-1" });
			harness.currentState().stages.push({ id: "stage-1" });
			harness.currentState().events.push({ id: "event-1" });
			if (failure !== "start persistence") {
				await input.bindSourceWorkflow("workflow-1");
				harness.currentState().projections.push({ workflowId: "workflow-1" });
			}
			if (failure === "outbox") {
				harness.currentState().outbox.push({ workflowId: "workflow-1" });
			}
			throw new Error(`${failure} failed`);
		});

		await expect(submitModeRoutingHarness(harness)).rejects.toThrow(
			`${failure} failed`,
		);
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			harness.context.compatibilityWriter.mirrorCanonicalToLegacy,
		).not.toHaveBeenCalled();
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it("does not commit when canonical compatibility mirroring fails", async () => {
		const harness = createModeRoutingHarness("canonical");
		harness.context.compatibilityWriter.mirrorCanonicalToLegacy.mockImplementationOnce(
			async () => {
				harness.calls.push("canonical-mirror");
				harness.currentState().legacyRequests.push({ id: "approval-1" });
				harness.currentState().legacyChains.push({ id: "chain-1" });
				throw new Error("canonical mirror failed");
			},
		);

		await expect(submitModeRoutingHarness(harness)).rejects.toThrow(
			"canonical mirror failed",
		);
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it("does not commit when the organization-scoped source bind affects no row", async () => {
		const harness = createModeRoutingHarness("canonical");
		harness.setBindRows([]);

		await expect(submitModeRoutingHarness(harness)).rejects.toThrow(
			/binding.*row count/i,
		);
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			harness.context.compatibilityWriter.mirrorCanonicalToLegacy,
		).not.toHaveBeenCalled();
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it("does not commit or mirror when canonical auto-finalization fails", async () => {
		const harness = createModeRoutingHarness("canonical");
		harness.setAllAuto(true);
		harness.approvalLifecycle.finalizeCanonicalAutoCompletion.mockImplementationOnce(
			async () => {
				harness.calls.push("auto-finalizer");
				Object.assign(harness.currentState().absences[0] ?? {}, {
					status: "approved",
				});
				Object.assign(harness.currentState().timeRecords[0] ?? {}, {
					approvalState: "approved",
				});
				throw new Error("auto-finalizer failed");
			},
		);

		await expect(
			submitModeRoutingHarness(harness, "employee-1"),
		).rejects.toThrow("auto-finalizer failed");
		expect(harness.transactionState.committed).toBe(false);
		expectTransactionalStateEmpty(harness.snapshot());
		expect(
			harness.context.compatibilityWriter.mirrorCanonicalToLegacy,
		).not.toHaveBeenCalled();
		expect(
			callerMocks.runAutoCompletedAbsenceMaintenance,
		).not.toHaveBeenCalled();
		expect(addCalendarSyncJobMock).not.toHaveBeenCalled();
		expectPostCommitCallbacksZero();
	});

	it("creates approval-required absences and approval workflow in the same transaction", async () => {
		const transaction = vi.fn(async (callback) => callback(tx));
		const insert = vi
			.fn()
			.mockReturnValueOnce(createInsertBuilder([{ id: "absence-1" }]))
			.mockReturnValueOnce(createInsertBuilder([{ id: "canonical-1" }]))
			.mockReturnValueOnce(createVoidInsertBuilder());
		const tx = {
			insert,
			update: vi.fn(() => createUpdateBuilder()),
		};
		const dbService = {
			db: { transaction },
			query: vi.fn((_name, run) =>
				Effect.tryPromise({ try: run, catch: (error) => error }),
			),
		};
		const createApprovalWorkflow = vi.fn(() =>
			Effect.fail(new Error("approval failed")),
		);
		const approvalLifecycle = createLegacyApprovalLifecycle(transaction);

		await expect(
			Effect.runPromise(
				createRequestedAbsenceRecordsInTransaction({
					dbService: dbService as never,
					currentEmployee: {
						id: "employee-1",
						organizationId: "org-1",
						teamId: "team-1",
					},
					data: {
						categoryId: "category-1",
						startDate: "2026-05-11",
						startPeriod: "full_day",
						endDate: "2026-05-12",
						endPeriod: "full_day",
						notes: "Vacation",
						durationKind: "full_day",
						sickDetail: null,
					},
					category: {
						name: "Vacation",
						countsAgainstVacation: true,
						requiresApproval: true,
						type: "vacation",
					},
					createdBy: "user-1",
					hasManagerApprovalWorkflow: true,
					approvalWorkflow: {
						categoryId: "category-1",
						approverId: "manager-1",
						create: createApprovalWorkflow,
					},
					approvalLifecycle: approvalLifecycle as never,
				}),
			),
		).rejects.toThrow("approval failed");

		expect(transaction).toHaveBeenCalledTimes(1);
		expect(createApprovalWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({ db: tx }),
			expect.objectContaining({
				id: "employee-1",
				organizationId: "org-1",
				teamId: "team-1",
			}),
			"absence-1",
			"category-1",
			"manager-1",
		);
	});

	it("returns an auto-completed approval result to the post-commit caller", async () => {
		const transaction = vi.fn(async (callback) => callback(tx));
		const insert = vi
			.fn()
			.mockReturnValueOnce(
				createInsertBuilder([{ id: "absence-1", status: "pending" }]),
			)
			.mockReturnValueOnce(createInsertBuilder([{ id: "canonical-1" }]))
			.mockReturnValueOnce(createVoidInsertBuilder());
		const tx = {
			insert,
			update: vi.fn(() => createUpdateBuilder()),
		};
		const dbService = {
			db: { transaction },
			query: vi.fn((_name, run) =>
				Effect.tryPromise({ try: run, catch: (error) => error }),
			),
		};
		const autoCompletion = {
			absence: { id: "absence-1", status: "approved" },
			vacationOverrideSummary: {
				updatedAbsenceIds: [],
				createdAbsenceIds: [],
				deletedAbsenceIds: [],
			},
		};
		const createApprovalWorkflow = vi.fn(() =>
			Effect.succeed({
				kind: "auto_completed" as const,
				chainInstanceId: null,
				approvalRequestId: "approval-1",
				reason: "requester_is_approver" as const,
				autoCompletion,
			}),
		);
		const approvalLifecycle = createLegacyApprovalLifecycle(transaction);

		const result = await Effect.runPromise(
			createRequestedAbsenceRecordsInTransaction({
				dbService: dbService as never,
				currentEmployee: {
					id: "employee-1",
					organizationId: "org-1",
					teamId: "team-1",
				},
				data: {
					categoryId: "category-1",
					startDate: "2026-05-11",
					startPeriod: "full_day",
					endDate: "2026-05-12",
					endPeriod: "full_day",
					notes: "Vacation",
					durationKind: "full_day",
					sickDetail: null,
				},
				category: {
					name: "Vacation",
					countsAgainstVacation: true,
					requiresApproval: true,
					type: "vacation",
				},
				createdBy: "user-1",
				hasManagerApprovalWorkflow: true,
				approvalWorkflow: {
					categoryId: "category-1",
					approverId: "employee-1",
					create: createApprovalWorkflow as never,
				},
				approvalLifecycle: approvalLifecycle as never,
			}),
		);

		expect(result).toMatchObject({
			status: "approved",
			approvalWorkflowResult: { kind: "auto_completed", autoCompletion },
		});
	});
});

describe("markAutoApprovedAbsenceWorkBalanceDirtyBestEffort", () => {
	it("marks the employee work balance dirty from the absence start date", async () => {
		await markAutoApprovedAbsenceWorkBalanceDirtyBestEffort({
			employeeId: "employee-1",
			organizationId: "org-1",
			absenceId: "absence-1",
			startDate: "2026-05-11",
		});

		expect(markEmployeeWorkBalanceDirtyMock).toHaveBeenCalledWith({
			employeeId: "employee-1",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-11",
		});
	});

	it("keeps auto-approval successful when dirty marking fails", async () => {
		const error = new Error("dirty marker failed");
		markEmployeeWorkBalanceDirtyMock.mockRejectedValueOnce(error);

		await expect(
			markAutoApprovedAbsenceWorkBalanceDirtyBestEffort({
				employeeId: "employee-1",
				organizationId: "org-1",
				absenceId: "absence-1",
				startDate: "2026-05-11",
			}),
		).resolves.toBeUndefined();

		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				error,
				employeeId: "employee-1",
				organizationId: "org-1",
				absenceId: "absence-1",
			},
			"Failed to mark work balance dirty after auto-approved absence",
		);
	});
});
