import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	absenceEntry,
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
} from "@/db/schema";
import type { ApprovalCompatibilityWriter } from "@/lib/approvals/workflow/compatibility-writer";
import { parseInstant } from "@/lib/datetime/temporal-core";

function collectSqlColumnNames(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(collectSqlColumnNames);
	if (!value || typeof value !== "object") return [];
	const candidate = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	return [
		...(typeof candidate.config?.name === "string"
			? [candidate.config.name]
			: []),
		...(candidate.queryChunks?.flatMap(collectSqlColumnNames) ?? []),
	];
}

function collectSqlBoundValues(value: unknown): unknown[] {
	if (Array.isArray(value)) return value.flatMap(collectSqlBoundValues);
	if (!value || typeof value !== "object") return [];
	const candidate = value as { value?: unknown; queryChunks?: unknown[] };
	return [
		...("value" in candidate ? [candidate.value] : []),
		...(candidate.queryChunks?.flatMap(collectSqlBoundValues) ?? []),
	];
}

const mockState = vi.hoisted(() => ({
	addCalendarSyncJob: vi.fn(),
	captureLegacyState: vi.fn(),
	createRuntime: vi.fn(),
	findManagerLinks: vi.fn(),
	getCurrentEmployee: vi.fn(),
	isBillingMutationAllowed: vi.fn(),
	nowInstant: vi.fn(),
	notifyManager: vi.fn(),
	removeCanonicalInTransaction: vi.fn(),
	requireBillingForMutation: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employeeManagers: { findMany: mockState.findManagerLinks },
		},
	},
}));

vi.mock("@/lib/queue", () => ({
	addCalendarSyncJob: mockState.addCalendarSyncJob,
}));

vi.mock("@/lib/billing/guard", () => ({
	isBillingMutationAllowed: mockState.isBillingMutationAllowed,
	requireBillingForMutation: mockState.requireBillingForMutation,
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onApprovedAbsenceCancelledByEmployee: mockState.notifyManager,
}));

vi.mock("./actions.canonical", () => ({
	removeCanonicalAbsenceRecordInTransaction:
		mockState.removeCanonicalInTransaction,
}));

vi.mock("./current-employee", () => ({
	getCurrentEmployee: mockState.getCurrentEmployee,
}));

vi.mock("@/lib/approvals/domain-adapters/absence-legacy-state", () => ({
	captureAbsenceLegacyApprovalState: mockState.captureLegacyState,
}));

vi.mock("@/lib/approvals/workflow/runtime", () => ({
	createProductionApprovalWorkflowRuntime: mockState.createRuntime,
}));

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...original,
		systemClock: { nowInstant: mockState.nowInstant },
	};
});

const mutations = await import("./mutations");

type Mode = "legacy" | "shadow" | "ready" | "canonical" | "complete";

const organizationId = "org-1";
const absenceId = "20000000-0000-4000-8000-000000000001";
const employeeId = "30000000-0000-4000-8000-000000000001";
const actorId = "30000000-0000-4000-8000-000000000002";
const categoryId = "40000000-0000-4000-8000-000000000001";
const canonicalRecordId = "50000000-0000-4000-8000-000000000001";
const workflowId = "60000000-0000-4000-8000-000000000001";
const requestId = "70000000-0000-4000-8000-000000000001";
const secondRequestId = "70000000-0000-4000-8000-000000000002";
const chainId = "80000000-0000-4000-8000-000000000001";

function twoPendingStageRows() {
	return {
		requests: [
			{
				id: requestId,
				organizationId,
				entityType: "absence_entry",
				entityId: absenceId,
				status: "pending",
			},
			{
				id: secondRequestId,
				organizationId,
				entityType: "absence_entry",
				entityId: absenceId,
				status: "pending",
			},
		],
		chains: [
			{
				id: chainId,
				organizationId,
				entityType: "absence_entry",
				entityId: absenceId,
				requesterEmployeeId: employeeId,
				status: "pending",
				stages: [
					{
						id: "stage-1",
						organizationId,
						chainInstanceId: chainId,
						approvalRequestId: requestId,
						status: "pending",
					},
					{
						id: "stage-2",
						organizationId,
						chainInstanceId: chainId,
						approvalRequestId: secondRequestId,
						status: "pending",
					},
				],
			},
		],
	};
}

function source(overrides: Record<string, unknown> = {}) {
	return {
		id: absenceId,
		organizationId,
		employeeId,
		categoryId,
		canonicalRecordId,
		approvalWorkflowId: workflowId,
		status: "pending",
		startDate: "2026-07-21",
		endDate: "2026-07-22",
		startPeriod: "full_day",
		endPeriod: "full_day",
		notes: null,
		approvedBy: null,
		rejectionReason: null,
		category: {
			id: categoryId,
			organizationId,
			name: "Vacation",
			type: "vacation",
			color: "#123456",
		},
		employee: {
			id: employeeId,
			organizationId,
			userId: "owner-user",
			user: { id: "owner-user", name: "Avery Employee" },
		},
		...overrides,
	};
}

function workflow(status: "pending" | "approved" = "pending") {
	return {
		id: workflowId,
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: absenceId,
		requesterEmployeeId: employeeId,
		status,
		version: 3,
		stages: [],
	};
}

function capture(status: "pending" | "cancelled" = "pending") {
	return {
		organizationId,
		source: {
			organizationId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: absenceId,
		},
		approvalRequest:
			status === "pending" ? { id: requestId, status: "pending" } : null,
		chain: { id: chainId, status },
		chainRows: [],
		sourceSnapshot: { id: absenceId, status: "pending" },
		capturedAt: parseInstant("2026-07-19T10:00:00Z"),
	};
}

function approvedChainCapture(chainStatus: "approved" | "cancelled") {
	return {
		...capture("pending"),
		approvalRequest: {
			id: requestId,
			status: "approved",
		},
		chain: { id: chainId, status: chainStatus },
		chainRows: [
			{ id: "stage-1", status: "approved", approvalRequestId: requestId },
		],
		sourceSnapshot: { id: absenceId, status: "approved" },
	};
}

function approvedDirectCapture(requestPresent: boolean) {
	return {
		...capture("pending"),
		approvalRequest: requestPresent
			? { id: requestId, status: "approved" }
			: null,
		chain: null,
		chainRows: [],
		sourceSnapshot: { id: absenceId, status: "approved" },
	};
}

function harness(
	input: {
		mode?: Mode;
		absence?: ReturnType<typeof source>;
		actor?: Record<string, unknown>;
		organization?: Record<string, unknown> | null;
		canonical?: Record<string, unknown> | null;
		workflowRow?: Record<string, unknown> | null;
		requests?: Record<string, unknown>[];
		chains?: Record<string, unknown>[];
		returnedStageIds?: string[];
		returnedChainIds?: string[];
		returnedRequestIds?: string[];
	} = {},
) {
	const mode = input.mode ?? "legacy";
	const events: string[] = [];
	let committed = false;
	const initialState = {
		absencePresent: true,
		canonicalPresent: true,
		legacyStatus: "pending",
		workflowStatus: "pending",
	};
	let committedState = { ...initialState };
	let transactionState = { ...committedState };
	const actor = {
		id: employeeId,
		organizationId,
		userId: "owner-user",
		isActive: true,
		role: "employee",
		user: { id: "owner-user" },
		...input.actor,
	};
	mockState.getCurrentEmployee.mockResolvedValue({
		id: actor.id,
		organizationId: actor.organizationId,
		userId: actor.userId,
	});
	const absence = input.absence ?? source();
	const organization =
		input.organization === undefined
			? { id: organizationId, timezone: "Europe/Berlin" }
			: input.organization;
	const canonical =
		input.canonical === undefined
			? {
					id: canonicalRecordId,
					organizationId,
					employeeId,
					recordKind: "absence",
					approvalState: absence.status,
				}
			: input.canonical;
	const workflowRow =
		input.workflowRow === undefined
			? {
					id: workflowId,
					organizationId,
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: absenceId,
					status: absence.status,
					version: 3,
				}
			: input.workflowRow;
	const requests = input.requests ?? [
		{
			id: requestId,
			organizationId,
			entityType: "absence_entry",
			entityId: absenceId,
			status: "pending",
		},
	];
	const requestRows = requests.map((request) => ({ ...request }));
	const chains = input.chains ?? [
		{
			id: chainId,
			organizationId,
			entityType: "absence_entry",
			entityId: absenceId,
			requesterEmployeeId: employeeId,
			status: "pending",
			stages: [
				{
					id: "stage-1",
					organizationId,
					chainInstanceId: chainId,
					approvalRequestId: requestId,
					status: "pending",
				},
			],
		},
	];
	const expectedStageIds = chains.flatMap((chain) =>
		((chain.stages as Record<string, unknown>[] | undefined) ?? []).flatMap(
			(stage) => (stage.status === "pending" ? [stage.id as string] : []),
		),
	);
	const expectedChainIds = chains.map((chain) => chain.id as string);
	const activeRequestIds = new Set(
		chains.flatMap((chain) =>
			((chain.stages as Record<string, unknown>[] | undefined) ?? []).flatMap(
				(stage) =>
					stage.status === "pending" && stage.approvalRequestId
						? [stage.approvalRequestId as string]
						: [],
			),
		),
	);
	const expectedRequestIds = (
		chains.length === 0
			? requests
			: requests.filter((request) => activeRequestIds.has(request.id as string))
	).map((request) => request.id as string);

	const deleteReturning = vi.fn().mockImplementation(async () => [
		{
			id: absenceId,
			organizationId,
			employeeId: absence.employeeId,
			status: absence.status,
			approvalWorkflowId: absence.approvalWorkflowId,
			canonicalRecordId: absence.canonicalRecordId,
		},
	]);
	const requestDeleteReturning = vi.fn();
	const txDelete = vi.fn().mockImplementation((table) => {
		if (table === absenceEntry) {
			events.push("source-delete");
			return {
				where: vi.fn().mockReturnValue({
					returning: vi.fn(async (...args) => {
						const rows = await deleteReturning(...args);
						if (rows.length === 1) transactionState.absencePresent = false;
						return rows;
					}),
				}),
			};
		}
		if (table === approvalRequest) {
			return {
				where: vi.fn((predicate) => ({
					returning: requestDeleteReturning.mockImplementation(async () => {
						const columns = collectSqlColumnNames(predicate);
						const values = collectSqlBoundValues(predicate);
						const requiredColumns = [
							"id",
							"organization_id",
							"entity_type",
							"entity_id",
							"status",
						];
						if (!requiredColumns.every((column) => columns.includes(column))) {
							return [];
						}
						const returnedIds = input.returnedRequestIds ?? expectedRequestIds;
						events.push(`request-delete:${returnedIds.join(",")}`);
						for (const id of new Set(returnedIds)) {
							const index = requestRows.findIndex(
								(request) =>
									request.id === id &&
									values.includes(request.id) &&
									values.includes(request.organizationId) &&
									values.includes(request.entityType) &&
									values.includes(request.entityId) &&
									values.includes(request.status),
							);
							if (index >= 0) requestRows.splice(index, 1);
						}
						return returnedIds.map((id) => ({ id }));
					}),
				})),
			};
		}
		throw new Error("Unexpected cancellation delete table");
	});
	const stageUpdateReturning = vi.fn().mockImplementation(async () => {
		const returnedIds = input.returnedStageIds ?? expectedStageIds;
		events.push(`stage-update:${returnedIds.join(",")}`);
		return returnedIds.map((id) => ({ id }));
	});
	const chainUpdateReturning = vi.fn().mockImplementation(async () => {
		const returnedIds = input.returnedChainIds ?? expectedChainIds;
		events.push(`chain-update:${returnedIds.join(",")}`);
		return returnedIds.map((id) => ({ id }));
	});
	let recordedLegacyMutation = false;
	const txUpdate = vi.fn().mockImplementation((table) => {
		if (
			!recordedLegacyMutation &&
			(table === approvalChainInstance || table === approvalChainStageInstance)
		) {
			recordedLegacyMutation = true;
			events.push("legacy-mutation");
			transactionState.legacyStatus = "cancelled";
		}
		const returning =
			table === approvalChainStageInstance
				? stageUpdateReturning
				: table === approvalChainInstance
					? chainUpdateReturning
					: undefined;
		if (!returning) throw new Error("Unexpected cancellation update table");
		return {
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({ returning }),
			}),
		};
	});
	const transactionDb = {
		query: {
			employee: { findMany: vi.fn().mockResolvedValue([actor]) },
			absenceEntry: { findFirst: vi.fn().mockResolvedValue(absence) },
			organization: { findFirst: vi.fn().mockResolvedValue(organization) },
			timeRecord: { findFirst: vi.fn().mockResolvedValue(canonical) },
			approvalWorkflow: { findFirst: vi.fn().mockResolvedValue(workflowRow) },
			approvalRequest: {
				findMany: vi
					.fn()
					.mockImplementation(async () =>
						requestRows.map((request) => ({ ...request })),
					),
			},
			approvalChainInstance: { findMany: vi.fn().mockResolvedValue(chains) },
		},
		delete: txDelete,
		update: txUpdate,
	};
	const mirrorLegacyToCanonical = vi.fn().mockImplementation(async () => {
		events.push("mirror");
		transactionState.workflowStatus = "cancelled";
		return {
			snapshot: {
				id: workflowId,
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: absenceId,
				status: "cancelled",
			},
		};
	});
	const withWriteGate = vi.fn();
	const compatibilityWriter = {
		withWriteGate,
		mirrorLegacyToCanonical,
		mirrorCanonicalToLegacy: vi.fn(),
	} satisfies ApprovalCompatibilityWriter;
	withWriteGate.mockImplementation(() => compatibilityWriter);
	const context = {
		dbService: { db: transactionDb },
		writeGate: {
			acquire: vi.fn().mockImplementation(async () => {
				events.push("gate");
				return {
					mode,
					behavior: {
						serveFrom:
							mode === "canonical" || mode === "complete"
								? "canonical"
								: "legacy",
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
			}),
		},
		repository: {
			loadSnapshot: vi
				.fn()
				.mockResolvedValue(
					workflow(absence.status === "approved" ? "approved" : "pending"),
				),
		},
		compatibilityWriter,
	};
	let adapterDelete:
		| ((input: Record<string, unknown>) => Promise<void>)
		| undefined;
	const executeInTransaction = vi.fn().mockImplementation(async (txContext) => {
		events.push("workflow-cancel");
		transactionState.workflowStatus = "cancelled";
		if (!adapterDelete)
			throw new Error("Cancellation adapter was not registered");
		await adapterDelete({
			dbService: txContext.dbService,
			organizationId,
			absenceId,
			expectedEmployeeId: absence.employeeId,
			expectedStatus: absence.status,
			expectedApprovalWorkflowId: absence.approvalWorkflowId,
			expectedCanonicalRecordId: absence.canonicalRecordId,
		});
		return { snapshot: workflow("pending") };
	});
	const executeInTransactionWithDisposition = vi
		.fn()
		.mockImplementation(async (txContext, request) => ({
			result: await executeInTransaction(txContext, request),
			disposition: "executed" as const,
		}));
	const withTransaction = vi.fn().mockImplementation(async (operation) => {
		events.push("begin");
		transactionState = { ...committedState };
		const requestRowsSnapshot = requestRows.map((request) => ({ ...request }));
		try {
			const result = await operation(context);
			committedState = { ...transactionState };
			committed = true;
			events.push("commit");
			return result;
		} catch (error) {
			transactionState = { ...committedState };
			requestRows.splice(0, requestRows.length, ...requestRowsSnapshot);
			throw error;
		}
	});
	const runtime = {
		repository: { withTransaction },
		transitionEngine: {
			executeInTransaction,
			executeInTransactionWithDisposition,
		},
	};
	mockState.createRuntime.mockImplementation((input) => {
		adapterDelete = input.adapters.absence.deleteCancelledAbsence;
		return runtime;
	});
	mockState.captureLegacyState.mockReset();
	mockState.captureLegacyState
		.mockImplementationOnce(async () => {
			events.push("capture-before");
			return capture("pending");
		})
		.mockImplementationOnce(async () => {
			events.push("capture-after");
			return capture("cancelled");
		});
	mockState.removeCanonicalInTransaction.mockImplementation(async () => {
		events.push("canonical-delete");
		transactionState.canonicalPresent = false;
	});
	mockState.addCalendarSyncJob.mockImplementation(async () => {
		expect(committed).toBe(true);
		events.push("calendar");
	});
	return {
		actor,
		absence,
		committed: () => committed,
		snapshot: () => ({ ...committedState }),
		context,
		chainUpdateReturning,
		deleteReturning,
		events,
		executeInTransaction,
		executeInTransactionWithDisposition,
		mirrorLegacyToCanonical,
		requestDeleteReturning,
		requestRows: () => requestRows.map((request) => ({ ...request })),
		runtime,
		transactionDb,
		stageUpdateReturning,
		withTransaction,
	};
}

describe("absence cancellation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.nowInstant.mockReturnValue(parseInstant("2026-07-19T22:30:00Z"));
		mockState.getCurrentEmployee.mockResolvedValue({
			id: employeeId,
			organizationId,
			userId: "owner-user",
		});
		mockState.requireBillingForMutation.mockResolvedValue({ canAccess: true });
		mockState.isBillingMutationAllowed.mockReturnValue(true);
		mockState.findManagerLinks.mockResolvedValue([]);
		mockState.notifyManager.mockResolvedValue(undefined);
		mockState.addCalendarSyncJob.mockResolvedValue(undefined);
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("uses one transaction and the %s lifecycle path", async (mode) => {
		const test = harness({ mode });

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({ success: true });
		expect(test.withTransaction).toHaveBeenCalledOnce();
		expect(test.context.writeGate.acquire).toHaveBeenCalledOnce();
		if (mode === "shadow" || mode === "ready") {
			expect(mockState.captureLegacyState).toHaveBeenCalledTimes(2);
			expect(test.mirrorLegacyToCanonical).toHaveBeenCalledOnce();
			expect(test.events.indexOf("mirror")).toBeLessThan(
				test.events.indexOf("canonical-delete"),
			);
		} else {
			expect(test.mirrorLegacyToCanonical).not.toHaveBeenCalled();
		}
		if (mode === "canonical" || mode === "complete") {
			expect(test.executeInTransaction).toHaveBeenCalledOnce();
		} else {
			expect(test.executeInTransaction).not.toHaveBeenCalled();
			expect(mockState.removeCanonicalInTransaction).toHaveBeenCalledOnce();
		}
		expect(test.events.at(-1)).toBe("calendar");
	});

	it.each([
		[
			"legacy",
			[
				"begin",
				"gate",
				"legacy-mutation",
				"stage-update:stage-1",
				`chain-update:${chainId}`,
				`request-delete:${requestId}`,
				"source-delete",
				"canonical-delete",
				"commit",
				"calendar",
			],
		],
		[
			"shadow",
			[
				"begin",
				"gate",
				"capture-before",
				"legacy-mutation",
				"stage-update:stage-1",
				`chain-update:${chainId}`,
				`request-delete:${requestId}`,
				"capture-after",
				"mirror",
				"source-delete",
				"canonical-delete",
				"commit",
				"calendar",
			],
		],
		[
			"ready",
			[
				"begin",
				"gate",
				"capture-before",
				"legacy-mutation",
				"stage-update:stage-1",
				`chain-update:${chainId}`,
				`request-delete:${requestId}`,
				"capture-after",
				"mirror",
				"source-delete",
				"canonical-delete",
				"commit",
				"calendar",
			],
		],
		[
			"canonical",
			[
				"begin",
				"gate",
				"workflow-cancel",
				"source-delete",
				"canonical-delete",
				"commit",
				"calendar",
			],
		],
		[
			"complete",
			[
				"begin",
				"gate",
				"workflow-cancel",
				"source-delete",
				"canonical-delete",
				"commit",
				"calendar",
			],
		],
	] as const)("commits the exact %s cancellation timeline", async (mode, timeline) => {
		const test = harness({ mode });

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		expect(test.events).toEqual(timeline);
		expect(test.snapshot()).toEqual({
			absencePresent: false,
			canonicalPresent: false,
			legacyStatus:
				mode === "legacy" || mode === "shadow" || mode === "ready"
					? "cancelled"
					: "pending",
			workflowStatus: mode === "legacy" ? "pending" : "cancelled",
		});
	});

	it.each([
		"shadow",
		"ready",
	] as const)("cancels a chain-backed approved owner absence in the exact %s timeline", async (mode) => {
		const test = harness({
			mode,
			absence: source({ status: "approved", startDate: "2026-07-21" }),
			requests: [
				{
					id: requestId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					status: "approved",
				},
			],
			chains: [
				{
					id: chainId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					requesterEmployeeId: employeeId,
					status: "approved",
					stages: [
						{
							id: "stage-1",
							organizationId,
							chainInstanceId: chainId,
							approvalRequestId: requestId,
							status: "approved",
						},
					],
				},
			],
		});
		mockState.captureLegacyState
			.mockReset()
			.mockImplementationOnce(async () => {
				test.events.push("capture-before");
				return approvedChainCapture("approved");
			})
			.mockImplementationOnce(async () => {
				test.events.push("capture-after");
				return approvedChainCapture("cancelled");
			});

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		expect(test.events).toEqual([
			"begin",
			"gate",
			"capture-before",
			"legacy-mutation",
			`chain-update:${chainId}`,
			"capture-after",
			"mirror",
			"source-delete",
			"canonical-delete",
			"commit",
			"calendar",
		]);
		expect(test.requestDeleteReturning).not.toHaveBeenCalled();
	});

	it.each([
		"shadow",
		"ready",
	] as const)("mirrors an approved direct owner cancellation before deleting source and canonical rows in %s", async (mode) => {
		const test = harness({
			mode,
			absence: source({ status: "approved", startDate: "2026-07-21" }),
			requests: [
				{
					id: requestId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					status: "approved",
				},
			],
			chains: [],
		});
		mockState.captureLegacyState
			.mockReset()
			.mockImplementationOnce(async () => {
				test.events.push("capture-before");
				return approvedDirectCapture(true);
			})
			.mockImplementationOnce(async () => {
				test.events.push("capture-after");
				return approvedDirectCapture(false);
			});

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		expect(test.events).toEqual([
			"begin",
			"gate",
			"capture-before",
			`request-delete:${requestId}`,
			"capture-after",
			"mirror",
			"source-delete",
			"canonical-delete",
			"commit",
			"calendar",
		]);
		expect(test.requestDeleteReturning).toHaveBeenCalledOnce();
		expect(test.requestRows()).toEqual([]);
		expect(test.snapshot()).toMatchObject({
			absencePresent: false,
			canonicalPresent: false,
			workflowStatus: "cancelled",
		});
	});

	it.each([
		"shadow",
		"ready",
	] as const)("rolls back an approved direct owner cancellation when the %s mirror fails", async (mode) => {
		const test = harness({
			mode,
			absence: source({ status: "approved", startDate: "2026-07-21" }),
			requests: [
				{
					id: requestId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					status: "approved",
				},
			],
			chains: [],
		});
		mockState.captureLegacyState
			.mockReset()
			.mockResolvedValueOnce(approvedDirectCapture(true))
			.mockResolvedValueOnce(approvedDirectCapture(false));
		test.mirrorLegacyToCanonical.mockRejectedValueOnce(
			new Error("mirror failed"),
		);

		await expect(
			mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).resolves.toMatchObject({ success: false });
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toMatchObject({
			absencePresent: true,
			canonicalPresent: true,
			workflowStatus: "pending",
		});
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
	});

	it("allows an organization admin to cancel another employee's pending absence", async () => {
		const test = harness({
			actor: {
				id: actorId,
				userId: "admin-user",
				role: "admin",
				user: { id: "admin-user" },
			},
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: actorId,
			organizationId,
		});

		expect(result).toEqual({ success: true });
		expect(test.committed()).toBe(true);
	});

	it("preserves legacy cancellation for an exact null workflow link", async () => {
		const test = harness({
			mode: "legacy",
			absence: source({ approvalWorkflowId: null }),
			workflowRow: null,
		});

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		expect(test.deleteReturning).toHaveBeenCalledOnce();
	});

	it("uses the canonical adapter deletion callback inside the owning transaction", async () => {
		const test = harness({ mode: "canonical" });

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		expect(mockState.createRuntime).toHaveBeenCalledWith(
			expect.objectContaining({
				adapters: expect.objectContaining({
					absence: expect.objectContaining({
						deleteCancelledAbsence: expect.any(Function),
					}),
					timeCorrection: expect.objectContaining({
						deleteCancelledCorrections: expect.any(Function),
					}),
				}),
			}),
		);
		expect(test.deleteReturning).toHaveBeenCalledOnce();
		expect(mockState.removeCanonicalInTransaction).toHaveBeenCalledWith(
			test.transactionDb,
			{
				organizationId,
				canonicalRecordId,
				expectedEmployeeId: employeeId,
				expectedApprovalState: "pending",
			},
		);
	});

	it("cancels all legacy stages, then chains, then requests in three global phases", async () => {
		const test = harness(twoPendingStageRows());

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({ success: true });
		expect(test.stageUpdateReturning).toHaveBeenCalledOnce();
		expect(test.chainUpdateReturning).toHaveBeenCalledOnce();
		expect(test.requestDeleteReturning).toHaveBeenCalledOnce();
		const stageEvent = "stage-update:stage-1,stage-2";
		const chainEvent = `chain-update:${chainId}`;
		const requestEvent = `request-delete:${requestId},${secondRequestId}`;
		expect(test.events).toEqual(
			expect.arrayContaining([stageEvent, chainEvent, requestEvent]),
		);
		expect(test.events.indexOf(stageEvent)).toBeLessThan(
			test.events.indexOf(chainEvent),
		);
		expect(test.events.indexOf(chainEvent)).toBeLessThan(
			test.events.indexOf(requestEvent),
		);
		expect(test.requestRows()).toEqual([]);
	});

	it("fails closed before chains when only some legacy stages are updated", async () => {
		const test = harness({
			...twoPendingStageRows(),
			returnedStageIds: ["stage-1"],
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({
			success: false,
			error: "Legacy approval stage changed during cancellation",
		});
		expect(test.chainUpdateReturning).not.toHaveBeenCalled();
		expect(test.requestDeleteReturning).not.toHaveBeenCalled();
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
	});

	it("fails closed before requests when only some legacy chains are updated", async () => {
		const test = harness({
			...twoPendingStageRows(),
			returnedChainIds: [],
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({
			success: false,
			error: "Legacy approval chain changed during cancellation",
		});
		expect(test.stageUpdateReturning).toHaveBeenCalledOnce();
		expect(test.requestDeleteReturning).not.toHaveBeenCalled();
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
	});

	it("rolls back partially deleted legacy requests", async () => {
		const rows = twoPendingStageRows();
		const test = harness({
			...rows,
			returnedRequestIds: [requestId],
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({
			success: false,
			error: "Legacy approval request changed during cancellation",
		});
		expect(test.stageUpdateReturning).toHaveBeenCalledOnce();
		expect(test.chainUpdateReturning).toHaveBeenCalledOnce();
		expect(test.requestDeleteReturning).toHaveBeenCalledOnce();
		expect(test.deleteReturning).not.toHaveBeenCalled();
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
		expect(test.requestRows()).toEqual(rows.requests);
	});

	it("fails closed on duplicate legacy stage IDs returned by the database", async () => {
		const test = harness({
			...twoPendingStageRows(),
			returnedStageIds: ["stage-1", "stage-1"],
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({
			success: false,
			error: "Legacy approval stage changed during cancellation",
		});
		expect(test.chainUpdateReturning).not.toHaveBeenCalled();
		expect(test.requestDeleteReturning).not.toHaveBeenCalled();
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
	});

	it("fails closed on an equal-count unexpected legacy chain ID", async () => {
		const test = harness({
			...twoPendingStageRows(),
			returnedChainIds: ["unexpected-chain"],
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({
			success: false,
			error: "Legacy approval chain changed during cancellation",
		});
		expect(test.requestDeleteReturning).not.toHaveBeenCalled();
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
	});

	it("preserves historical approved legacy requests while cancelling the active stage", async () => {
		const historicalRequestId = requestId;
		const activeRequestId = "70000000-0000-4000-8000-000000000002";
		const test = harness({
			requests: [
				{
					id: historicalRequestId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					status: "approved",
				},
				{
					id: activeRequestId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					status: "pending",
				},
			],
			chains: [
				{
					id: chainId,
					organizationId,
					entityType: "absence_entry",
					entityId: absenceId,
					requesterEmployeeId: employeeId,
					status: "pending",
					stages: [
						{
							id: "stage-1",
							organizationId,
							chainInstanceId: chainId,
							approvalRequestId: historicalRequestId,
							status: "approved",
						},
						{
							id: "stage-2",
							organizationId,
							chainInstanceId: chainId,
							approvalRequestId: activeRequestId,
							status: "pending",
						},
					],
				},
			],
		});

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		// One active approval request plus the absence source are deleted.
		expect(test.transactionDb.delete).toHaveBeenCalledTimes(2);
		expect(test.requestRows()).toEqual([
			expect.objectContaining({
				id: historicalRequestId,
				status: "approved",
			}),
		]);
		expect(test.requestRows()).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: activeRequestId }),
			]),
		);
	});

	it.each([
		{
			instant: "2026-03-29T00:30:00Z",
			timezone: "Europe/Berlin",
			startDate: "2026-03-30",
			expected: true,
		},
		{
			instant: "2026-03-29T22:30:00Z",
			timezone: "Europe/Berlin",
			startDate: "2026-03-30",
			expected: false,
		},
		{
			instant: "2026-11-01T05:30:00Z",
			timezone: "America/New_York",
			startDate: "2026-11-02",
			expected: true,
		},
	])("uses organization-local PlainDate at $instant ($timezone)", async ({
		instant,
		timezone,
		startDate,
		expected,
	}) => {
		mockState.nowInstant.mockReturnValue(parseInstant(instant));
		harness({
			absence: source({ status: "approved", startDate }),
			organization: { id: organizationId, timezone },
			requests: [],
			chains: [],
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(expected);
		expect(result.error).toBe(
			expected
				? undefined
				: "Approved absences can only be cancelled before they start",
		);
	});

	it.each([
		{ status: "rejected", owner: true },
		{ status: "approved", owner: false },
	])("denies $status cancellation when owner=$owner", async ({
		status,
		owner,
	}) => {
		const actor = owner
			? undefined
			: {
					id: actorId,
					userId: "admin-user",
					role: "admin",
					user: { id: "admin-user" },
				};
		const test = harness({ absence: source({ status }), actor });

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: owner ? employeeId : actorId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.deleteReturning).not.toHaveBeenCalled();
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
	});

	it.each([
		["actor", { actor: { organizationId: "org-2" } }],
		["source", { absence: source({ organizationId: "org-2" }) }],
		[
			"category",
			{
				absence: source({
					category: {
						id: categoryId,
						organizationId: "org-2",
						name: "Foreign category",
					},
				}),
			},
		],
		[
			"owner employee",
			{
				absence: source({
					employee: {
						id: employeeId,
						organizationId: "org-2",
						userId: "owner-user",
						user: { id: "owner-user", name: "Foreign employee" },
					},
				}),
			},
		],
		[
			"workflow link",
			{ workflowRow: { ...workflow(), sourceId: "foreign-absence" } },
		],
		[
			"canonical record",
			{
				canonical: {
					id: canonicalRecordId,
					organizationId: "org-2",
					employeeId,
					recordKind: "absence",
				},
			},
		],
		[
			"canonical approval state",
			{
				canonical: {
					id: canonicalRecordId,
					organizationId,
					employeeId,
					recordKind: "absence",
					approvalState: "approved",
				},
			},
		],
	])("fails closed for cross-organization or mismatched %s", async (_label, setup) => {
		const test = harness(setup as never);

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.committed()).toBe(false);
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
	});

	it("loses an approval-versus-cancellation race when the source CAS affects no row", async () => {
		const test = harness();
		test.deleteReturning.mockResolvedValueOnce([]);

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.committed()).toBe(false);
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
	});

	it.each([
		"shadow",
		"ready",
	] as const)("rejects a missing source workflow link in %s before legacy mutation", async (mode) => {
		const test = harness({
			mode,
			absence: source({ approvalWorkflowId: null }),
			workflowRow: null,
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.committed()).toBe(false);
		expect(mockState.captureLegacyState).not.toHaveBeenCalled();
		expect(test.transactionDb.update).not.toHaveBeenCalled();
	});

	it.each([
		"shadow",
		"ready",
	] as const)("rolls back %s when observed cancellation workflow mismatches the source link", async (mode) => {
		const test = harness({ mode });
		test.mirrorLegacyToCanonical.mockResolvedValueOnce({
			snapshot: {
				id: "foreign-workflow",
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: absenceId,
				status: "cancelled",
			},
		});

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.committed()).toBe(false);
		expect(test.deleteReturning).not.toHaveBeenCalled();
		expect(mockState.removeCanonicalInTransaction).not.toHaveBeenCalled();
	});

	it.each([
		"capture",
		"capture-after",
		"mirror",
		"source-delete",
		"canonical-delete",
	] as const)("rolls back and emits no side effects when %s fails", async (failure) => {
		const test = harness({ mode: "shadow" });
		if (failure === "capture") {
			mockState.captureLegacyState
				.mockReset()
				.mockRejectedValue(new Error("capture"));
		}
		if (failure === "capture-after") {
			mockState.captureLegacyState
				.mockReset()
				.mockResolvedValueOnce(capture("pending"))
				.mockRejectedValueOnce(new Error("capture after"));
		}
		if (failure === "mirror") {
			test.mirrorLegacyToCanonical.mockRejectedValue(new Error("mirror"));
		}
		if (failure === "source-delete") {
			test.deleteReturning.mockResolvedValueOnce([]);
		}
		if (failure === "canonical-delete") {
			mockState.removeCanonicalInTransaction.mockRejectedValue(
				new Error("canonical"),
			);
		}

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
		expect(mockState.notifyManager).not.toHaveBeenCalled();
	});

	it.each([
		"transition",
		"source-delete",
		"canonical-delete",
	] as const)("rolls back all canonical state when %s fails", async (failure) => {
		const test = harness({ mode: "canonical" });
		if (failure === "transition") {
			test.executeInTransaction.mockRejectedValueOnce(
				new Error("transition failed"),
			);
		}
		if (failure === "source-delete") {
			test.deleteReturning.mockResolvedValueOnce([]);
		}
		if (failure === "canonical-delete") {
			mockState.removeCanonicalInTransaction.mockRejectedValueOnce(
				new Error("canonical delete failed"),
			);
		}

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result.success).toBe(false);
		expect(test.committed()).toBe(false);
		expect(test.snapshot()).toEqual({
			absencePresent: true,
			canonicalPresent: true,
			legacyStatus: "pending",
			workflowStatus: "pending",
		});
		expect(mockState.addCalendarSyncJob).not.toHaveBeenCalled();
	});

	it("publishes postcommit effects once for controlled concurrent canonical receipt replay", async () => {
		const test = harness({ mode: "canonical" });
		let calls = 0;
		let releaseFirst: (() => void) | undefined;
		const replayStarted = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		test.executeInTransactionWithDisposition.mockImplementation(async () => {
			calls += 1;
			if (calls === 1) {
				await replayStarted;
				return {
					result: { snapshot: workflow("pending") },
					disposition: "executed",
				};
			}
			releaseFirst?.();
			return {
				result: { snapshot: workflow("pending") },
				disposition: "replayed",
			};
		});

		const [first, replay] = await Promise.all([
			mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
			mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		]);

		expect(first).toEqual({ success: true });
		expect(replay).toEqual({ success: true });
		expect(test.executeInTransactionWithDisposition).toHaveBeenCalledTimes(2);
		expect(mockState.addCalendarSyncJob).toHaveBeenCalledOnce();
		expect(mockState.notifyManager).not.toHaveBeenCalled();
	});

	it("runs approved-self post-commit effects once and treats delivery failures as best effort", async () => {
		const test = harness({
			absence: source({ status: "approved", startDate: "2026-07-21" }),
			requests: [],
			chains: [],
		});
		mockState.findManagerLinks.mockResolvedValue([
			{ manager: { userId: "manager-user", organizationId } },
		]);
		mockState.addCalendarSyncJob.mockRejectedValue(
			new Error("queue unavailable"),
		);
		mockState.notifyManager.mockRejectedValue(
			new Error("notification unavailable"),
		);

		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});

		expect(result).toEqual({ success: true });
		expect(test.committed()).toBe(true);
		expect(mockState.addCalendarSyncJob).toHaveBeenCalledOnce();
		expect(mockState.notifyManager).toHaveBeenCalledOnce();
	});

	it("does not notify managers for pending cancellation", async () => {
		harness();
		mockState.findManagerLinks.mockResolvedValue([
			{ manager: { userId: "manager-user", organizationId } },
		]);

		expect(
			await mutations.cancelAbsenceRequestForEmployee(absenceId, {
				id: employeeId,
				organizationId,
			}),
		).toEqual({ success: true });
		expect(mockState.notifyManager).not.toHaveBeenCalled();
	});

	it("authenticates and applies billing guard before opening the transaction", async () => {
		const test = harness();
		mockState.isBillingMutationAllowed.mockReturnValue(false);

		const result = await mutations.cancelAbsenceRequest(absenceId);

		expect(mockState.getCurrentEmployee).toHaveBeenCalledOnce();
		expect(mockState.requireBillingForMutation).toHaveBeenCalledWith(
			organizationId,
		);
		expect(result).toEqual({ success: false, error: "billing_required" });
		expect(test.withTransaction).not.toHaveBeenCalled();
	});

	it.each([
		["owner", { id: "forged-owner", organizationId }],
		["admin", { id: actorId, organizationId }],
		["organization", { id: employeeId, organizationId: "org-2" }],
	] as const)("rejects a forged expected %s context before billing or transaction", async (_label, expectedEmployee) => {
		const test = harness();

		const result = await mutations.cancelAbsenceRequestForEmployee(
			absenceId,
			expectedEmployee,
		);

		expect(mockState.getCurrentEmployee).toHaveBeenCalledOnce();
		expect(result).toEqual({
			success: false,
			error: "Employee profile does not match the authenticated session",
		});
		expect(mockState.requireBillingForMutation).not.toHaveBeenCalled();
		expect(test.withTransaction).not.toHaveBeenCalled();
	});

	it("keeps the public response contract and contains no Luxon cancellation dependency", async () => {
		harness();
		const result = await mutations.cancelAbsenceRequestForEmployee(absenceId, {
			id: employeeId,
			organizationId,
		});
		const sourceText = await readFile(
			new URL("./mutations.ts", import.meta.url),
			"utf8",
		);

		expect(result).toEqual({ success: true });
		expect(Object.keys(result)).toEqual(["success"]);
		expect(sourceText).not.toMatch(/from ["']luxon["']/);
		expect(sourceText).not.toMatch(/new Date\(|Date\.now\(/);
	});
});
