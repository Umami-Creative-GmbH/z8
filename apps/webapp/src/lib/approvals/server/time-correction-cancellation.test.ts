import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	employee,
	workPeriod,
} from "@/db/schema";

const ids = {
	organization: "10000000-0000-4000-8000-000000000001",
	employee: "10000000-0000-4000-8000-000000000002",
	workPeriod: "10000000-0000-4000-8000-000000000003",
	workflow: "10000000-0000-4000-8000-000000000004",
};

const state = vi.hoisted(() => ({
	runtime: null as unknown as {
		repository: { withTransaction: ReturnType<typeof vi.fn> };
		transitionEngine: {
			executeInTransactionWithDisposition: ReturnType<typeof vi.fn>;
		};
	},
	captureLegacy: vi.fn(),
	deleteCancelledCorrections: vi.fn(),
	lockSubmissionSource: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: () => state.runtime,
}));
vi.mock("../domain-adapters/time-correction-legacy-state", () => ({
	captureTimeCorrectionLegacyApprovalState: state.captureLegacy,
}));
vi.mock("./time-correction-approvals", () => ({
	deleteCancelledTimeCorrectionsInTransaction: state.deleteCancelledCorrections,
	finalizeTimeCorrectionTerminalInTransaction: vi.fn(),
	lockTimeCorrectionSubmissionSourceInTransaction: state.lockSubmissionSource,
}));

const { cancelPendingTimeCorrection } = await import(
	"./time-correction-cancellation"
);

it("keeps cancellation timestamp comparisons inside the Temporal boundary", () => {
	const source = readFileSync(
		new URL("./time-correction-cancellation.ts", import.meta.url),
		"utf8",
	);

	expect(source).not.toContain(".getTime()");
});

function workflow(status: "pending" | "cancelled" = "pending") {
	return {
		id: ids.workflow,
		organizationId: ids.organization,
		workflowType: "time_correction",
		sourceType: "time_entry",
		sourceId: ids.workPeriod,
		requesterEmployeeId: ids.employee,
		status,
		version: status === "pending" ? 4 : 5,
		contextSnapshot: {
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
			},
		},
	};
}

function createCanonicalHarness(input?: {
	mode?: "canonical" | "complete";
	status?: "pending" | "cancelled";
	disposition?: "executed" | "replayed";
}) {
	const snapshot = workflow(input?.status);
	const gate = vi.fn().mockResolvedValue({
		mode: input?.mode ?? "canonical",
		behavior: {
			serveFrom: "canonical",
			writeLegacy: input?.mode !== "complete",
			writeCanonical: true,
			decideCanonical: true,
			mirror: input?.mode === "complete" ? "none" : "canonical_to_legacy",
		},
	});
	const context = {
		dbService: {
			db: {
				query: {
					employee: {
						findMany: vi.fn().mockResolvedValue([
							{
								id: ids.employee,
								organizationId: ids.organization,
								userId: "user-requester",
								isActive: true,
							},
						]),
					},
					member: {
						findMany: vi.fn().mockResolvedValue([
							{
								organizationId: ids.organization,
								userId: "user-requester",
								status: "approved",
							},
						]),
					},
					workPeriod: {
						findMany: vi.fn().mockResolvedValue([
							{
								id: ids.workPeriod,
								organizationId: ids.organization,
								employeeId: ids.employee,
								approvalWorkflowId: ids.workflow,
							},
						]),
					},
				},
			},
		},
		writeGate: { acquire: gate },
		repository: { loadSnapshot: vi.fn().mockResolvedValue(snapshot) },
		compatibilityWriter: { withWriteGate: vi.fn() },
	};
	const executeInTransactionWithDisposition = vi.fn().mockResolvedValue({
		result: { snapshot: { ...snapshot, status: "cancelled", version: 5 } },
		disposition: input?.disposition ?? "executed",
	});
	const withTransaction = vi.fn(async (operation) => await operation(context));
	state.runtime = {
		repository: { withTransaction },
		transitionEngine: { executeInTransactionWithDisposition },
	};
	return {
		context,
		executeInTransactionWithDisposition,
		gate,
		withTransaction,
	};
}

function legacyState(status: "pending" | "cancelled") {
	return {
		organizationId: ids.organization,
		source: {
			organizationId: ids.organization,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: ids.workPeriod,
		},
		approvalRequest:
			status === "pending"
				? {
						id: "10000000-0000-4000-8000-000000000005",
						organizationId: ids.organization,
						entityType: "time_entry",
						entityId: ids.workPeriod,
						requestedBy: ids.employee,
						approverId: "10000000-0000-4000-8000-000000000006",
						status: "pending",
						reason: null,
						rejectionReason: null,
						approvedAt: null,
						metadata: {
							timeCorrection: {
								action: "edit",
								clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
							},
							submission: {
								key: "submission-1",
								resultKind: "default_created",
								originalStatus: "pending",
							},
						},
						updatedAt: "2026-07-21T08:00:00Z",
					}
				: null,
		chain: null,
		chainRows: [],
		sourceSnapshot: {
			id: ids.workPeriod,
			organizationId: ids.organization,
			employeeId: ids.employee,
			status,
			canonicalRecordId: "10000000-0000-4000-8000-000000000008",
			approvalWorkflowId: null,
			workPeriod: {
				id: ids.workPeriod,
				organizationId: ids.organization,
				employeeId: ids.employee,
				clockInId: "10000000-0000-4000-8000-000000000009",
				clockOutId: null,
				startTime: "2026-07-21T06:00:00Z",
				endTime: null,
				durationMinutes: null,
				isActive: true,
				approvalStatus: "approved",
				pendingChanges: null,
				deletedAt: null,
				canonicalRecordId: "10000000-0000-4000-8000-000000000008",
				approvalWorkflowId: null,
			},
			canonicalRecord: {
				id: "10000000-0000-4000-8000-000000000008",
				organizationId: ids.organization,
				employeeId: ids.employee,
				recordKind: "work",
				startAt: "2026-07-21T06:00:00Z",
				endAt: null,
				durationMinutes: null,
				approvalState: "approved",
			},
			currentEndpoints: {
				clockIn: {
					id: "10000000-0000-4000-8000-000000000009",
					organizationId: ids.organization,
					employeeId: ids.employee,
					type: "clock_in",
					timestamp: "2026-07-21T06:00:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					replacesEntryId: null,
					isSuperseded: false,
					supersededById: null,
					isDeleted: false,
				},
				clockOut: null,
			},
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
			},
			correctionEndpoints: [
				{
					endpointType: "clock_in",
					originalEntryId: "10000000-0000-4000-8000-000000000009",
					correctionEntryId: "10000000-0000-4000-8000-000000000007",
					instant: "2026-07-21T06:05:00Z",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					correction: {
						id: "10000000-0000-4000-8000-000000000007",
						organizationId: ids.organization,
						employeeId: ids.employee,
						type: "correction",
						timestamp: "2026-07-21T06:05:00Z",
						utcOffsetMinutes: 120,
						timezone: "Europe/Berlin",
						timezoneSource: "browser",
						replacesEntryId: "10000000-0000-4000-8000-000000000009",
						isSuperseded: true,
						supersededById: null,
						isDeleted: false,
					},
				},
			],
		},
		displaySnapshot: { status },
		capturedAt: "2026-07-21T08:00:00Z",
	};
}

function mutationBuilder(id: string) {
	const builder = {
		set: vi.fn(),
		where: vi.fn(),
		returning: vi.fn().mockResolvedValue([{ id }]),
	};
	builder.set.mockReturnValue(builder);
	builder.where.mockReturnValue(builder);
	return builder;
}

function keyedLock() {
	let tail = Promise.resolve();
	return async () => {
		const previous = tail;
		let release = () => {};
		tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		return release;
	};
}

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createLegacyHarness(mode: "legacy" | "shadow" | "ready") {
	const requestId = "10000000-0000-4000-8000-000000000005";
	const correctionId = "10000000-0000-4000-8000-000000000007";
	const requestMutation = mutationBuilder(requestId);
	const correctionMutation = mutationBuilder(correctionId);
	const update = vi.fn((table: unknown) => {
		if (table === approvalRequest) return requestMutation;
		if (table === approvalChainInstance)
			return mutationBuilder("10000000-0000-4000-8000-000000000010");
		if (table === approvalChainStageInstance)
			return mutationBuilder("10000000-0000-4000-8000-000000000011");
		return mutationBuilder("unused");
	});
	const lockedPeriod = {
		id: ids.workPeriod,
		organizationId: ids.organization,
		employeeId: ids.employee,
		approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
	};
	const lockTables: unknown[] = [];
	const lockFor = vi.fn(async (table: unknown) => {
		lockTables.push(table);
		if (table === employee) {
			return [
				{
					id: ids.employee,
					organizationId: ids.organization,
					userId: "user-requester",
					isActive: true,
				},
			];
		}
		if (table === workPeriod) return [{ ...lockedPeriod }];
		return [];
	});
	const deleteFrom = vi
		.fn()
		.mockReturnValueOnce(requestMutation)
		.mockReturnValueOnce(correctionMutation);
	const database = {
		query: {
			approvalChainInstance: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			approvalChainStageInstance: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			approvalRequest: {
				findMany: vi.fn().mockResolvedValue([]),
			},
			employee: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: ids.employee,
						organizationId: ids.organization,
						userId: "user-requester",
						isActive: true,
					},
				]),
			},
			member: {
				findMany: vi.fn().mockResolvedValue([
					{
						organizationId: ids.organization,
						userId: "user-requester",
						status: "approved",
					},
				]),
			},
			workPeriod: {
				findMany: vi.fn().mockResolvedValue([
					{
						id: ids.workPeriod,
						organizationId: ids.organization,
						employeeId: ids.employee,
						approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
					},
				]),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn((table: unknown) => ({
				where: vi.fn(() => ({
					for: (mode: string) => lockFor(table, mode),
				})),
			})),
		})),
		update,
		delete: deleteFrom,
	};
	const compatibilityWriter = {
		withWriteGate: vi.fn(function () {
			return this;
		}),
		mirrorLegacyToCanonical: vi.fn().mockResolvedValue({
			snapshot: { id: ids.workflow },
		}),
	};
	const context = {
		dbService: { db: database },
		writeGate: {
			acquire: vi.fn().mockResolvedValue({
				mode,
				behavior: {
					serveFrom: "legacy",
					writeLegacy: true,
					writeCanonical: mode !== "legacy",
					decideCanonical: false,
					mirror: mode === "legacy" ? "none" : "legacy_to_canonical",
				},
			}),
		},
		repository: {
			loadSnapshot: vi.fn().mockResolvedValue(workflow()),
		},
		compatibilityWriter,
	};
	const withTransaction = vi.fn(async (operation) => await operation(context));
	state.runtime = {
		repository: { withTransaction },
		transitionEngine: { executeInTransactionWithDisposition: vi.fn() },
	};
	state.lockSubmissionSource.mockImplementation(async (input) => {
		const employeeRows = await input.dbService.db
			.select({})
			.from(employee)
			.where(undefined)
			.for("update");
		if (employeeRows.length !== 1) throw new Error("employee lock failed");
		const periodRows = await input.dbService.db
			.select({})
			.from(workPeriod)
			.where(undefined)
			.for("update");
		const locked = periodRows[0];
		if (
			periodRows.length !== 1 ||
			locked?.approvalWorkflowId !== input.expectedApprovalWorkflowId
		) {
			throw new Error("period lock failed");
		}
		return locked;
	});
	state.captureLegacy
		.mockResolvedValueOnce({
			...legacyState("pending"),
			sourceSnapshot: {
				...legacyState("pending").sourceSnapshot,
				approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
				workPeriod: {
					...legacyState("pending").sourceSnapshot.workPeriod,
					approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
				},
			},
		})
		.mockResolvedValueOnce({
			...legacyState("cancelled"),
			sourceSnapshot: {
				...legacyState("cancelled").sourceSnapshot,
				approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
				workPeriod: {
					...legacyState("cancelled").sourceSnapshot.workPeriod,
					approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
				},
			},
		});
	return {
		compatibilityWriter,
		context,
		correctionMutation,
		deleteFrom,
		lockedPeriod,
		lockFor,
		lockTables,
		withTransaction,
	};
}

describe("cancelPendingTimeCorrection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.captureLegacy.mockReset();
		state.deleteCancelledCorrections.mockReset();
		state.lockSubmissionSource.mockReset();
		state.lockSubmissionSource.mockResolvedValue({
			id: ids.workPeriod,
			organizationId: ids.organization,
			employeeId: ids.employee,
			approvalWorkflowId: ids.workflow,
		});
	});

	it.each([
		"canonical",
		"complete",
	] as const)("executes requester cancellation through the canonical engine in %s mode", async (mode) => {
		const harness = createCanonicalHarness({ mode });

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: false });

		expect(harness.withTransaction).toHaveBeenCalledOnce();
		expect(harness.gate).toHaveBeenCalledOnce();
		expect(harness.executeInTransactionWithDisposition).toHaveBeenCalledWith(
			expect.objectContaining({ writeGate: expect.any(Object) }),
			expect.objectContaining({
				organizationId: ids.organization,
				workflowId: ids.workflow,
				expectedVersion: 4,
				principal: { kind: "employee", userId: "user-requester" },
				command: { type: "cancel", reason: "requester_cancelled" },
			}),
		);
	});

	it("rejects an old replay when a new legacy submission commits first under READ COMMITTED", async () => {
		const harness = createLegacyHarness("legacy");
		const acquire = keyedLock();
		const submissionLocked = deferred();
		const commitSubmission = deferred();
		let cancellationRelease: (() => void) | null = null;
		let chains = [
			{
				id: "10000000-0000-4000-8000-000000000010",
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
				createdAt: new Date("2026-07-21T08:00:00Z"),
			},
		];
		harness.context.dbService.db.query.approvalChainInstance.findMany.mockImplementation(
			async () => chains,
		);
		state.lockSubmissionSource.mockImplementation(async () => {
			cancellationRelease = await acquire();
			return { ...harness.lockedPeriod };
		});
		harness.withTransaction.mockImplementation(async (operation) => {
			try {
				return await operation(harness.context);
			} finally {
				cancellationRelease?.();
			}
		});
		const submission = (async () => {
			const release = await acquire();
			submissionLocked.resolve();
			await commitSubmission.promise;
			chains = [
				{
					...chains[0],
					id: "10000000-0000-4000-8000-000000000014",
					status: "pending",
					createdAt: new Date("2026-07-21T09:00:00Z"),
				},
				...chains,
			];
			release();
		})();
		await submissionLocked.promise;
		const replay = cancelPendingTimeCorrection({
			organizationId: ids.organization,
			requesterEmployeeId: ids.employee,
			requesterUserId: "user-requester",
			workPeriodId: ids.workPeriod,
		});
		commitSubmission.resolve();
		await submission;

		await expect(replay).rejects.toThrow(
			"Time correction cancellation is unavailable",
		);
		expect(state.captureLegacy).not.toHaveBeenCalled();
	});

	it("finishes old replay before a later legacy submission acquires the keyed lock", async () => {
		const harness = createLegacyHarness("legacy");
		const acquire = keyedLock();
		const replayLocked = deferred();
		const continueReplay = deferred();
		let cancellationRelease: (() => void) | null = null;
		let submissionAcquired = false;
		const chainId = "10000000-0000-4000-8000-000000000010";
		const historicalRequestId = "10000000-0000-4000-8000-000000000013";
		harness.context.dbService.db.query.approvalChainInstance.findMany.mockResolvedValue(
			[
				{
					id: chainId,
					organizationId: ids.organization,
					entityType: "time_entry",
					entityId: ids.workPeriod,
					requesterEmployeeId: ids.employee,
					status: "cancelled",
					createdAt: new Date("2026-07-21T08:00:00Z"),
				},
			],
		);
		harness.context.dbService.db.query.approvalChainStageInstance.findMany.mockResolvedValue(
			[
				{
					id: "10000000-0000-4000-8000-000000000012",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "approved",
					approvalRequestId: historicalRequestId,
				},
				{
					id: "10000000-0000-4000-8000-000000000011",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "cancelled",
					approvalRequestId: null,
				},
			],
		);
		harness.context.dbService.db.query.approvalRequest.findMany.mockResolvedValue(
			[
				{
					id: historicalRequestId,
					organizationId: ids.organization,
					entityType: "time_entry",
					entityId: ids.workPeriod,
					requestedBy: ids.employee,
					status: "approved",
					createdAt: new Date("2026-07-21T08:01:00Z"),
					metadata: {
						timeCorrection: {
							action: "edit",
							clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
						},
					},
				},
			],
		);
		state.captureLegacy.mockReset();
		state.captureLegacy.mockResolvedValue({
			...legacyState("cancelled"),
			approvalRequest: null,
			chain: {
				id: chainId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
			},
			chainRows: [
				{
					id: "10000000-0000-4000-8000-000000000012",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "approved",
					approvalRequestId: historicalRequestId,
				},
				{
					id: "10000000-0000-4000-8000-000000000011",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "cancelled",
					approvalRequestId: null,
				},
			],
		});
		state.lockSubmissionSource.mockImplementation(async () => {
			cancellationRelease = await acquire();
			replayLocked.resolve();
			await continueReplay.promise;
			return { ...harness.lockedPeriod };
		});
		harness.withTransaction.mockImplementation(async (operation) => {
			try {
				return await operation(harness.context);
			} finally {
				cancellationRelease?.();
			}
		});
		const replay = cancelPendingTimeCorrection({
			organizationId: ids.organization,
			requesterEmployeeId: ids.employee,
			requesterUserId: "user-requester",
			workPeriodId: ids.workPeriod,
		});
		await replayLocked.promise;
		const submission = (async () => {
			const release = await acquire();
			submissionAcquired = true;
			release();
		})();
		await Promise.resolve();
		expect(submissionAcquired).toBe(false);
		continueReplay.resolve();

		await expect(replay).resolves.toEqual({ replayed: true });
		await submission;
		expect(submissionAcquired).toBe(true);
	});

	it("locks the requester then exact source before reading replay lifecycle", async () => {
		const harness = createLegacyHarness("legacy");

		await cancelPendingTimeCorrection({
			organizationId: ids.organization,
			requesterEmployeeId: ids.employee,
			requesterUserId: "user-requester",
			workPeriodId: ids.workPeriod,
		});

		expect(harness.lockTables.slice(0, 2)).toEqual([employee, workPeriod]);
		expect(harness.lockFor).toHaveBeenNthCalledWith(1, employee, "update");
		expect(harness.lockFor).toHaveBeenNthCalledWith(2, workPeriod, "update");
		expect(harness.lockFor.mock.invocationCallOrder[1]).toBeLessThan(
			harness.context.dbService.db.query.approvalChainInstance.findMany.mock
				.invocationCallOrder[0],
		);
	});

	it("rejects replay when the source workflow link changes before its lock", async () => {
		const harness = createLegacyHarness("legacy");
		harness.lockedPeriod.approvalWorkflowId = ids.workflow;

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("Time correction cancellation is unavailable");
		expect(
			harness.context.dbService.db.query.approvalChainInstance.findMany,
		).not.toHaveBeenCalled();
	});

	it("returns an exact canonical receipt replay without repeating cancellation", async () => {
		const harness = createCanonicalHarness({
			status: "cancelled",
			disposition: "replayed",
		});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: true });
		expect(harness.executeInTransactionWithDisposition).toHaveBeenCalledOnce();
	});

	it("rejects a manager or administrator that is not the exact requester", async () => {
		const harness = createCanonicalHarness();

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-manager",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow();
		expect(harness.executeInTransactionWithDisposition).not.toHaveBeenCalled();
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("cancels only the pending legacy cycle and inactive corrections in %s mode", async (mode) => {
		const harness = createLegacyHarness(mode);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: false });

		expect(harness.withTransaction).toHaveBeenCalledOnce();
		expect(harness.context.writeGate.acquire).toHaveBeenCalledOnce();
		expect(harness.deleteFrom).not.toHaveBeenCalled();
		expect(harness.context.dbService.db.update).toHaveBeenCalledWith(
			approvalRequest,
		);
		expect(state.deleteCancelledCorrections).toHaveBeenCalledOnce();
		expect(state.deleteCancelledCorrections).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: ids.organization,
				workPeriodId: ids.workPeriod,
				correction: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
				},
				expectedSource: expect.objectContaining({
					employeeId: ids.employee,
					approvalWorkflowId: mode === "legacy" ? null : ids.workflow,
					clockInId: "10000000-0000-4000-8000-000000000009",
				}),
			}),
		);
		if (mode === "legacy") {
			expect(
				harness.compatibilityWriter.mirrorLegacyToCanonical,
			).not.toHaveBeenCalled();
		} else {
			expect(
				harness.compatibilityWriter.mirrorLegacyToCanonical,
			).toHaveBeenCalledOnce();
		}
	});

	it("retains a pure-legacy direct cancellation as requester-owned durable metadata", async () => {
		const harness = createLegacyHarness("legacy");

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: false });

		expect(harness.deleteFrom).not.toHaveBeenCalled();
		expect(harness.context.dbService.db.update).toHaveBeenCalledWith(
			approvalRequest,
		);
		expect(
			harness.context.dbService.db.update.mock.results[0]?.value.set,
		).toHaveBeenCalledWith({
			status: "rejected",
			rejectionReason: null,
			approvedAt: expect.any(Date),
			metadata: {
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
				},
				submission: {
					key: "submission-1",
					resultKind: "default_created",
					originalStatus: "pending",
				},
				cancellation: {
					kind: "requester",
					organizationId: ids.organization,
					requesterEmployeeId: ids.employee,
					requesterUserId: "user-requester",
					workPeriodId: ids.workPeriod,
					chainInstanceId: null,
					cancelledAt: expect.any(String),
				},
			},
		});
	});

	it("retains a pure-legacy chain cancellation as a submission-linked tombstone", async () => {
		const harness = createLegacyHarness("legacy");
		const chainId = "10000000-0000-4000-8000-000000000010";
		const pending = legacyState("pending");
		if (!pending.approvalRequest) throw new Error("missing request fixture");
		const pendingChain = {
			id: chainId,
			organizationId: ids.organization,
			entityType: "time_entry",
			entityId: ids.workPeriod,
			requesterEmployeeId: ids.employee,
			status: "pending",
		};
		const pendingStage = {
			id: "10000000-0000-4000-8000-000000000011",
			organizationId: ids.organization,
			chainInstanceId: chainId,
			status: "pending",
			approvalRequestId: pending.approvalRequest.id,
		};
		state.captureLegacy.mockReset();
		state.captureLegacy
			.mockResolvedValueOnce({
				...pending,
				approvalRequest: {
					...pending.approvalRequest,
					metadata: {
						...pending.approvalRequest.metadata,
						submission: {
							...pending.approvalRequest.metadata.submission,
							resultKind: "chain_created",
						},
					},
				},
				chain: pendingChain,
				chainRows: [pendingStage],
			})
			.mockResolvedValueOnce({
				...legacyState("cancelled"),
				chain: { ...pendingChain, status: "cancelled" },
				chainRows: [
					{ ...pendingStage, status: "cancelled", approvalRequestId: null },
				],
			});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: false });

		expect(harness.deleteFrom).not.toHaveBeenCalled();
		expect(
			harness.context.dbService.db.update.mock.results.at(-1)?.value.set,
		).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "rejected",
				metadata: expect.objectContaining({
					cancellation: expect.objectContaining({ chainInstanceId: chainId }),
				}),
			}),
		);
	});

	it("rejects a pure-legacy direct tombstone without strict submission identity", async () => {
		const harness = createLegacyHarness("legacy");
		const pending = legacyState("pending");
		if (!pending.approvalRequest) throw new Error("missing request fixture");
		state.captureLegacy.mockReset();
		state.captureLegacy.mockResolvedValue({
			...pending,
			approvalRequest: {
				...pending.approvalRequest,
				metadata: {
					timeCorrection: pending.approvalRequest.metadata.timeCorrection,
				},
			},
		});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("Time correction cancellation is unavailable");
		expect(harness.deleteFrom).not.toHaveBeenCalled();
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
	] as const)("rolls back the full %s cancellation when locked source evidence drifts", async (mode) => {
		const harness = createLegacyHarness(mode);
		state.deleteCancelledCorrections.mockRejectedValue(
			new Error("locked cancellation evidence changed"),
		);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("locked cancellation evidence changed");
		expect(harness.deleteFrom).not.toHaveBeenCalled();
		expect(harness.context.dbService.db.update).toHaveBeenCalledWith(
			approvalRequest,
		);
		if (mode !== "legacy") {
			expect(
				harness.compatibilityWriter.mirrorLegacyToCanonical.mock
					.invocationCallOrder[0],
			).toBeLessThan(
				state.deleteCancelledCorrections.mock.invocationCallOrder[0],
			);
		}
	});

	it("replays a missing legacy request only from exact durable cancelled-chain evidence", async () => {
		const harness = createLegacyHarness("legacy");
		const chainId = "10000000-0000-4000-8000-000000000010";
		const historicalRequestId = "10000000-0000-4000-8000-000000000013";
		const database = harness.context.dbService.db;
		database.query.approvalChainInstance.findMany.mockResolvedValue([
			{
				id: chainId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
				createdAt: new Date("2026-07-21T08:00:00Z"),
			},
		]);
		database.query.approvalChainStageInstance.findMany.mockResolvedValue([
			{
				id: "10000000-0000-4000-8000-000000000012",
				organizationId: ids.organization,
				chainInstanceId: chainId,
				status: "approved",
				approvalRequestId: historicalRequestId,
			},
			{
				id: "10000000-0000-4000-8000-000000000011",
				organizationId: ids.organization,
				chainInstanceId: chainId,
				status: "cancelled",
				approvalRequestId: null,
			},
		]);
		database.query.approvalRequest.findMany.mockResolvedValue([
			{
				id: historicalRequestId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requestedBy: ids.employee,
				status: "approved",
				createdAt: new Date("2026-07-21T08:01:00Z"),
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
					},
				},
			},
		]);
		state.captureLegacy.mockReset();
		state.captureLegacy.mockResolvedValue({
			...legacyState("cancelled"),
			approvalRequest: null,
			chain: {
				id: chainId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
			},
			chainRows: [
				{
					id: "10000000-0000-4000-8000-000000000012",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "approved",
					approvalRequestId: historicalRequestId,
				},
				{
					id: "10000000-0000-4000-8000-000000000011",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "cancelled",
					approvalRequestId: null,
				},
			],
		});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: true });
		expect(database.query.approvalChainInstance.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 2, orderBy: expect.any(Array) }),
		);
		expect(database.query.approvalRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 2, orderBy: expect.any(Array) }),
		);
		expect(state.captureLegacy).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedCorrection: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
				},
				expectedLegacyCycle: { chainInstanceId: chainId },
				allowCancelledReplayWithoutCorrectionRows: true,
			}),
		);
		expect(harness.deleteFrom).not.toHaveBeenCalled();
	});

	it("replays a pure-legacy direct cancellation from its exact durable marker", async () => {
		const harness = createLegacyHarness("legacy");
		const cancelledAt = new Date("2026-07-21T08:30:00Z");
		const cancelledRequest = {
			...legacyState("pending").approvalRequest,
			status: "rejected",
			rejectionReason: null,
			approvedAt: cancelledAt,
			createdAt: new Date("2026-07-21T08:00:00Z"),
			metadata: {
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
				},
				submission: {
					key: "submission-1",
					resultKind: "default_created",
					originalStatus: "pending",
				},
				cancellation: {
					kind: "requester",
					organizationId: ids.organization,
					requesterEmployeeId: ids.employee,
					requesterUserId: "user-requester",
					workPeriodId: ids.workPeriod,
					chainInstanceId: null,
					cancelledAt: cancelledAt.toISOString(),
				},
			},
		};
		harness.context.dbService.db.query.approvalRequest.findMany.mockResolvedValue(
			[cancelledRequest],
		);
		state.captureLegacy.mockReset();
		state.captureLegacy.mockResolvedValue({
			...legacyState("cancelled"),
			approvalRequest: cancelledRequest,
		});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: true });
		expect(state.captureLegacy).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedLegacyCycle: {
					approvalRequestId: "10000000-0000-4000-8000-000000000005",
				},
				allowCancelledReplayWithoutCorrectionRows: true,
			}),
		);
		expect(harness.deleteFrom).not.toHaveBeenCalled();
	});

	it("rejects a direct cancellation replay when a later legacy cycle exists", async () => {
		const harness = createLegacyHarness("legacy");
		const cancelledAt = new Date("2026-07-21T08:30:00Z");
		const cancelledRequest = {
			...legacyState("pending").approvalRequest,
			status: "rejected",
			rejectionReason: null,
			approvedAt: cancelledAt,
			createdAt: new Date("2026-07-21T08:00:00Z"),
			metadata: {
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000007",
				},
				submission: {
					key: "submission-1",
					resultKind: "default_created",
					originalStatus: "pending",
				},
				cancellation: {
					kind: "requester",
					organizationId: ids.organization,
					requesterEmployeeId: ids.employee,
					requesterUserId: "user-requester",
					workPeriodId: ids.workPeriod,
					chainInstanceId: null,
					cancelledAt: cancelledAt.toISOString(),
				},
			},
		};
		harness.context.dbService.db.query.approvalRequest.findMany.mockResolvedValue(
			[
				{
					...legacyState("pending").approvalRequest,
					id: "10000000-0000-4000-8000-000000000014",
					createdAt: new Date("2026-07-21T09:00:00Z"),
				},
				cancelledRequest,
			],
		);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("Time correction cancellation is unavailable");
		expect(state.captureLegacy).not.toHaveBeenCalled();
	});

	it("rejects an ambiguous latest cancelled legacy chain", async () => {
		const harness = createLegacyHarness("legacy");
		const createdAt = new Date("2026-07-21T08:00:00Z");
		harness.context.dbService.db.query.approvalChainInstance.findMany.mockResolvedValue(
			[
				{
					id: "10000000-0000-4000-8000-000000000010",
					organizationId: ids.organization,
					entityType: "time_entry",
					entityId: ids.workPeriod,
					requesterEmployeeId: ids.employee,
					status: "cancelled",
					createdAt,
				},
				{
					id: "10000000-0000-4000-8000-000000000014",
					organizationId: ids.organization,
					entityType: "time_entry",
					entityId: ids.workPeriod,
					requesterEmployeeId: ids.employee,
					status: "cancelled",
					createdAt,
				},
			],
		);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("Time correction cancellation is unavailable");
		expect(state.captureLegacy).not.toHaveBeenCalled();
	});

	it.each([
		"pending",
		"rejected",
	] as const)("rejects replay when a later direct legacy cycle is %s", async (status) => {
		const harness = createLegacyHarness("legacy");
		const chainId = "10000000-0000-4000-8000-000000000010";
		const database = harness.context.dbService.db;
		database.query.approvalChainInstance.findMany.mockResolvedValue([
			{
				id: chainId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
				createdAt: new Date("2026-07-21T08:00:00Z"),
			},
		]);
		database.query.approvalChainStageInstance.findMany.mockResolvedValue([
			{
				id: "10000000-0000-4000-8000-000000000011",
				organizationId: ids.organization,
				chainInstanceId: chainId,
				status: "cancelled",
				approvalRequestId: null,
			},
		]);
		database.query.approvalRequest.findMany.mockResolvedValue([
			{
				id: "10000000-0000-4000-8000-000000000014",
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requestedBy: ids.employee,
				status,
				createdAt: new Date("2026-07-21T09:00:00Z"),
				metadata: { timeCorrection: { action: "edit" } },
			},
		]);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("Time correction cancellation is unavailable");
		expect(state.captureLegacy).not.toHaveBeenCalled();
	});

	it.each([
		"shadow",
		"ready",
	] as const)("replays only the exact linked cancelled chain in %s mode", async (mode) => {
		const harness = createLegacyHarness(mode);
		const chainId = "10000000-0000-4000-8000-000000000010";
		const database = harness.context.dbService.db;
		harness.context.repository.loadSnapshot.mockResolvedValue(
			workflow("cancelled"),
		);
		database.query.approvalChainInstance.findMany.mockResolvedValue([
			{
				id: chainId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
				createdAt: new Date("2026-07-21T08:00:00Z"),
			},
		]);
		database.query.approvalChainStageInstance.findMany.mockResolvedValue([
			{
				id: "10000000-0000-4000-8000-000000000011",
				organizationId: ids.organization,
				chainInstanceId: chainId,
				status: "cancelled",
				approvalRequestId: null,
			},
		]);
		state.captureLegacy.mockReset();
		state.captureLegacy.mockResolvedValue({
			...legacyState("cancelled"),
			chain: {
				id: chainId,
				organizationId: ids.organization,
				entityType: "time_entry",
				entityId: ids.workPeriod,
				requesterEmployeeId: ids.employee,
				status: "cancelled",
			},
			chainRows: [
				{
					id: "10000000-0000-4000-8000-000000000011",
					organizationId: ids.organization,
					chainInstanceId: chainId,
					status: "cancelled",
					approvalRequestId: null,
				},
			],
			sourceSnapshot: {
				...legacyState("cancelled").sourceSnapshot,
				approvalWorkflowId: ids.workflow,
				workPeriod: {
					...legacyState("cancelled").sourceSnapshot.workPeriod,
					approvalWorkflowId: ids.workflow,
				},
			},
		});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).resolves.toEqual({ replayed: true });
		expect(state.captureLegacy).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedLegacyCycle: { chainInstanceId: chainId },
				allowCancelledReplayWithoutCorrectionRows: true,
			}),
		);
		expect(harness.deleteFrom).not.toHaveBeenCalled();
	});

	it("rolls back deletion ordering when shadow observation fails", async () => {
		const harness = createLegacyHarness("shadow");
		harness.compatibilityWriter.mirrorLegacyToCanonical.mockRejectedValue(
			new Error("mirror failed"),
		);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("mirror failed");
		expect(harness.deleteFrom).not.toHaveBeenCalled();
	});

	it("rejects stale, active, superseded, or malformed legacy evidence before mutation", async () => {
		const harness = createLegacyHarness("legacy");
		state.captureLegacy.mockReset();
		state.captureLegacy.mockRejectedValue(
			new Error("stale correction evidence"),
		);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("stale correction evidence");
		expect(harness.deleteFrom).not.toHaveBeenCalled();
	});

	it.each([
		"approved",
		"rejected",
		"expired",
	])("rejects a %s canonical workflow without invoking cancellation", async (status) => {
		const harness = createCanonicalHarness();
		vi.mocked(harness.context.repository.loadSnapshot).mockResolvedValue({
			...workflow(),
			status,
		});

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow();
		expect(harness.executeInTransactionWithDisposition).not.toHaveBeenCalled();
	});

	it("models approval winning the race as a cancellation conflict with no second finalization", async () => {
		const harness = createCanonicalHarness();
		harness.executeInTransactionWithDisposition.mockRejectedValue(
			new Error("version_conflict"),
		);

		await expect(
			cancelPendingTimeCorrection({
				organizationId: ids.organization,
				requesterEmployeeId: ids.employee,
				requesterUserId: "user-requester",
				workPeriodId: ids.workPeriod,
			}),
		).rejects.toThrow("version_conflict");
		expect(state.deleteCancelledCorrections).not.toHaveBeenCalled();
	});
});
