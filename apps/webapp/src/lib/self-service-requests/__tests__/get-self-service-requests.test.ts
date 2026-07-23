import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTimeCorrectionApprovalAdapter } from "@/lib/approvals/domain-adapters/time-correction.adapter";
import { buildRequesterCancellationMarker } from "@/lib/approvals/domain-adapters/time-correction-cancellation-marker";

const dbMocks = vi.hoisted(() => ({
	approvalRequests: vi.fn(),
	approvalWorkflows: vi.fn(),
	approvalWorkflowRollouts: vi.fn(),
	absenceEntries: vi.fn(),
	travelExpenseClaims: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ direction: "desc", column })),
	eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
	gte: vi.fn((left: unknown, right: unknown) => ({ op: "gte", left, right })),
	ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			approvalRequest: { findMany: dbMocks.approvalRequests },
			approvalWorkflow: { findMany: dbMocks.approvalWorkflows },
			approvalWorkflowRollout: {
				findFirst: dbMocks.approvalWorkflowRollouts,
			},
			absenceEntry: { findMany: dbMocks.absenceEntries },
			travelExpenseClaim: { findMany: dbMocks.travelExpenseClaims },
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({ member: {} }));

vi.mock("@/db/schema", () => ({
	absenceEntry: {
		createdAt: "absenceEntry.createdAt",
		employeeId: "absenceEntry.employeeId",
		organizationId: "absenceEntry.organizationId",
	},
	approvalRequest: {
		createdAt: "approvalRequest.createdAt",
		entityType: "approvalRequest.entityType",
		organizationId: "approvalRequest.organizationId",
		requestedBy: "approvalRequest.requestedBy",
	},
	approvalWorkflow: {
		createdAt: "approvalWorkflow.createdAt",
		organizationId: "approvalWorkflow.organizationId",
		requesterEmployeeId: "approvalWorkflow.requesterEmployeeId",
		sourceType: "approvalWorkflow.sourceType",
		workflowType: "approvalWorkflow.workflowType",
	},
	approvalWorkflowRollout: {
		organizationId: "approvalWorkflowRollout.organizationId",
		workflowType: "approvalWorkflowRollout.workflowType",
	},
	travelExpenseClaim: {
		createdAt: "travelExpenseClaim.createdAt",
		employeeId: "travelExpenseClaim.employeeId",
		organizationId: "travelExpenseClaim.organizationId",
		status: "travelExpenseClaim.status",
	},
	travelExpenseDecisionLog: {
		createdAt: "travelExpenseDecisionLog.createdAt",
	},
}));

import { getSelfServiceRequests } from "../get-self-service-requests";

function timeCorrection(overrides: Record<string, unknown> = {}) {
	return {
		id: "approval-time-1",
		entityId: "period-1",
		organizationId: "org-1",
		requestedBy: "employee-1",
		status: "pending",
		createdAt: new Date("2026-04-25T08:00:00.000Z"),
		approvedAt: null,
		rejectionReason: null,
		reason: "Missed punch",
		metadata: {
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
			},
		},
		...overrides,
	};
}

function requesterCancellationMarker(input: {
	cancelledAt: Date;
	chainInstanceId: string | null;
}) {
	return buildRequesterCancellationMarker({
		organizationId: "org-1",
		requesterEmployeeId: "employee-1",
		requesterUserId: "user-requester",
		workPeriodId: "period-1",
		chainInstanceId: input.chainInstanceId,
		cancelledAt: input.cancelledAt.toISOString(),
	});
}

function canonicalTimeCorrection(overrides: Record<string, unknown> = {}) {
	return {
		id: "10000000-0000-4000-8000-000000000010",
		organizationId: "org-1",
		workflowType: "time_correction",
		sourceType: "time_entry",
		sourceId: "10000000-0000-4000-8000-000000000011",
		requesterEmployeeId: "employee-1",
		status: "pending",
		contextSnapshot: {
			timeCorrection: {
				action: "edit",
				clockInCorrectionId: "10000000-0000-4000-8000-000000000012",
			},
			submission: {
				key: "submission-1",
				resultKind: "default_created",
				originalStatus: "pending",
			},
		},
		displaySnapshot: {
			displayPayload: {
				requesterEmployeeId: "employee-1",
				requesterName: "Avery Requester",
				title: "Time correction",
				action: "edit",
				endpoints: ["Clock in"],
			},
			searchText: "time correction edit",
		},
		submittedAt: new Date("2026-04-26T08:00:00.000Z"),
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		createdAt: new Date("2026-04-26T08:00:00.000Z"),
		...overrides,
	};
}

async function realCanonicalDisplay() {
	const adapter = createTimeCorrectionApprovalAdapter({
		clock: {} as never,
		finalizeTimeCorrectionTerminal: vi.fn(),
		deleteCancelledCorrections: vi.fn(),
	});
	return await adapter.projectDisplay({
		organizationId: "org-1",
		workflow: {
			id: "10000000-0000-4000-8000-000000000010",
			organizationId: "org-1",
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: "10000000-0000-4000-8000-000000000011",
			requesterEmployeeId: "employee-1",
			contextSnapshot: {
				timeCorrection: {
					action: "edit",
					clockInCorrectionId: "10000000-0000-4000-8000-000000000012",
				},
			},
		},
		sourceIdentity: {
			organizationId: "org-1",
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: "10000000-0000-4000-8000-000000000011",
		},
		source: {
			id: "10000000-0000-4000-8000-000000000011",
			organizationId: "org-1",
			employeeId: "employee-1",
			approvalWorkflowId: "10000000-0000-4000-8000-000000000010",
			requesterName: "Avery Requester",
			correction: {
				action: "edit",
				clockInCorrectionId: "10000000-0000-4000-8000-000000000012",
			},
			clockIn: {},
			clockOut: null,
		},
	} as never);
}

function absence(overrides: Record<string, unknown> = {}) {
	return {
		id: "absence-1",
		employeeId: "employee-1",
		organizationId: "org-1",
		status: "rejected",
		startDate: "2026-04-20",
		endDate: "2026-04-21",
		rejectionReason: "Coverage needed",
		approvedAt: new Date("2026-04-22T10:00:00.000Z"),
		createdAt: new Date("2026-04-18T09:00:00.000Z"),
		updatedAt: new Date("2026-04-22T10:00:00.000Z"),
		category: { name: "Vacation", type: "vacation", color: null },
		...overrides,
	};
}

function travelExpense(overrides: Record<string, unknown> = {}) {
	return {
		id: "claim-1",
		employeeId: "employee-1",
		organizationId: "org-1",
		type: "receipt",
		status: "approved",
		tripStart: new Date("2026-04-14T00:00:00.000Z"),
		tripEnd: new Date("2026-04-15T00:00:00.000Z"),
		destinationCity: "Berlin",
		destinationCountry: "DE",
		calculatedAmount: "42.50",
		calculatedCurrency: "EUR",
		submittedAt: new Date("2026-04-16T08:00:00.000Z"),
		decidedAt: new Date("2026-04-17T08:00:00.000Z"),
		createdAt: new Date("2026-04-16T07:00:00.000Z"),
		decisionLogs: [],
		...overrides,
	};
}

function expectWhereConditions(
	mock: ReturnType<typeof vi.fn>,
	conditions: Array<{ left: unknown; right: unknown; op?: "eq" | "ne" }>,
) {
	const queryArgs = mock.mock.calls[0]?.[0];

	expect(queryArgs?.where).toMatchObject({
		type: "and",
		conditions: expect.arrayContaining(
			conditions.map(({ op = "eq", ...condition }) =>
				expect.objectContaining({ op, ...condition }),
			),
		),
	});
}

describe("getSelfServiceRequests", () => {
	beforeEach(() => {
		dbMocks.approvalRequests.mockReset();
		dbMocks.approvalWorkflows.mockReset();
		dbMocks.approvalWorkflowRollouts.mockReset();
		dbMocks.absenceEntries.mockReset();
		dbMocks.travelExpenseClaims.mockReset();
		dbMocks.approvalRequests.mockResolvedValue([timeCorrection()]);
		dbMocks.approvalWorkflows.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "legacy",
		});
		dbMocks.absenceEntries.mockResolvedValue([absence()]);
		dbMocks.travelExpenseClaims.mockResolvedValue([travelExpense()]);
	});

	it("serves valid canonical time corrections in complete mode", async () => {
		dbMocks.approvalRequests.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		const displaySnapshot = await realCanonicalDisplay();
		dbMocks.approvalWorkflows.mockResolvedValue([
			canonicalTimeCorrection({ displaySnapshot }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toEqual({
			id: "10000000-0000-4000-8000-000000000010",
			sourceType: "time_correction",
			sourceId: "10000000-0000-4000-8000-000000000011",
			organizationId: "org-1",
			employeeId: "employee-1",
			status: "pending",
			submittedAt: new Date("2026-04-26T08:00:00.000Z"),
			resolvedAt: null,
			title: "Time correction",
			subtitle: "edit · Clock in",
			decisionReason: null,
			availableActions: ["cancel", "view"],
			sourceHref: "/time-tracking",
		});
		expect(JSON.stringify(result)).not.toContain(displaySnapshot.searchText);
		expectWhereConditions(dbMocks.approvalWorkflows, [
			{ left: "approvalWorkflow.organizationId", right: "org-1" },
			{
				left: "approvalWorkflow.requesterEmployeeId",
				right: "employee-1",
			},
			{ left: "approvalWorkflow.workflowType", right: "time_correction" },
			{ left: "approvalWorkflow.sourceType", right: "time_entry" },
		]);
	});

	it("maps complete-mode canonical lifecycle states without exposing private context", async () => {
		dbMocks.approvalRequests.mockResolvedValue([]);
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.travelExpenseClaims.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		const approvedAt = new Date("2026-04-27T08:00:00.000Z");
		const cancelledAt = new Date("2026-04-27T09:00:00.000Z");
		dbMocks.approvalWorkflows.mockResolvedValue([
			canonicalTimeCorrection({
				contextSnapshot: {
					...canonicalTimeCorrection().contextSnapshot,
					privateNote: "must-never-leak",
				},
			}),
			canonicalTimeCorrection({
				id: "10000000-0000-4000-8000-000000000020",
				sourceId: "10000000-0000-4000-8000-000000000021",
				status: "approved",
				completedAt: approvedAt,
				contextSnapshot: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000022",
					},
					submission: {
						key: "submission-approved",
						resultKind: "auto_completed",
						originalStatus: "approved",
					},
				},
			}),
			canonicalTimeCorrection({
				id: "10000000-0000-4000-8000-000000000030",
				sourceId: "10000000-0000-4000-8000-000000000031",
				status: "cancelled",
				cancelledAt,
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.counts).toEqual({
			pending: 1,
			requiredFixes: 0,
			recentDecisions: 1,
			total: 3,
		});
		expect(
			result.items.find((item) => item.status === "pending")?.availableActions,
		).toEqual(["cancel", "view"]);
		expect(
			result.items.find((item) => item.status === "approved"),
		).toMatchObject({ resolvedAt: approvedAt, availableActions: ["view"] });
		expect(
			result.items.find((item) => item.status === "cancelled"),
		).toMatchObject({ resolvedAt: cancelledAt, availableActions: ["view"] });
		const serialized = JSON.stringify(result);
		for (const privateValue of [
			"must-never-leak",
			"10000000-0000-4000-8000-000000000012",
			"Europe/Berlin",
		]) {
			expect(serialized).not.toContain(privateValue);
		}
	});

	it("treats safe bounded search text as a non-authoritative index", async () => {
		dbMocks.approvalRequests.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		const displaySnapshot = {
			...(await realCanonicalDisplay()),
			searchText: "independent safe display index",
		};
		dbMocks.approvalWorkflows.mockResolvedValue([
			canonicalTimeCorrection({ displaySnapshot }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({
			title: "Time correction",
			subtitle: "edit · Clock in",
		});
		expect(JSON.stringify(result)).not.toContain(displaySnapshot.searchText);
	});

	it("filters extra, private, accessor, inherited, foreign, and oversized projections", async () => {
		dbMocks.approvalRequests.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		const projected = await realCanonicalDisplay();
		const payload = projected.displayPayload;
		const accessorPayload = { ...payload };
		Object.defineProperty(accessorPayload, "title", {
			enumerable: true,
			get: () => "Time correction",
		});
		const inheritedPayload = Object.assign(
			Object.create({ privateNote: "inherited-private" }),
			payload,
		);
		const endpointsWithPrivate = ["Clock in"];
		Object.defineProperty(endpointsWithPrivate, "privateNote", {
			enumerable: false,
			value: "hidden-private",
		});
		const invalidDisplays = [
			{
				...projected,
				displayPayload: { ...payload, privateNote: "private-projection" },
			},
			{ ...projected, displayPayload: accessorPayload },
			{ ...projected, displayPayload: inheritedPayload },
			{
				...projected,
				displayPayload: {
					...payload,
					requesterEmployeeId: "foreign-employee",
				},
			},
			{
				...projected,
				displayPayload: {
					...payload,
					endpoints: endpointsWithPrivate,
				},
			},
			{ ...projected, searchText: "x".repeat(1001) },
		];
		dbMocks.approvalWorkflows.mockResolvedValue(
			invalidDisplays.map((displaySnapshot, index) =>
				canonicalTimeCorrection({
					id: `10000000-0000-4000-8000-0000000001${index}`,
					displaySnapshot,
				}),
			),
		);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.filter((item) => item.sourceType === "time_correction"),
		).toEqual([]);
		expect(JSON.stringify(result)).not.toContain("private-projection");
		expect(JSON.stringify(result)).not.toContain("inherited-private");
	});

	it("prefers the legacy compatibility DTO for an exact canonical workflow duplicate", async () => {
		const canonical = canonicalTimeCorrection();
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		dbMocks.approvalWorkflows.mockResolvedValue([canonical]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				metadata: {
					workflow: {
						id: canonical.id,
						organizationId: "org-1",
					},
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});
		const timeItems = result.items.filter(
			(item) => item.sourceType === "time_correction",
		);

		expect(timeItems).toEqual([
			expect.objectContaining({ id: "approval-time-1", sourceId: "period-1" }),
		]);
	});

	it("fails closed for malformed canonical submission identity evidence", async () => {
		dbMocks.approvalRequests.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		dbMocks.approvalWorkflows.mockResolvedValue([
			canonicalTimeCorrection({
				contextSnapshot: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000012",
					},
					submission: {
						key: "submission-1",
						submissionId: "not-a-uuid",
						resultKind: "default_created",
						originalStatus: "pending",
					},
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.filter((item) => item.sourceType === "time_correction"),
		).toEqual([]);
	});

	it("fails closed when canonical display data contradicts correction evidence", async () => {
		dbMocks.approvalRequests.mockResolvedValue([]);
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({
			lifecycleMode: "complete",
		});
		const displaySnapshot = await realCanonicalDisplay();
		dbMocks.approvalWorkflows.mockResolvedValue([
			canonicalTimeCorrection({
				displaySnapshot: {
					...displaySnapshot,
					displayPayload: {
						...displaySnapshot.displayPayload,
						action: "delete",
					},
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.filter((item) => item.sourceType === "time_correction"),
		).toEqual([]);
	});

	it("maps an exact requester-cancelled legacy tombstone to cancelled", async () => {
		const cancelledAt = new Date("2026-04-26T09:00:00.000Z");
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				status: "rejected",
				approvedAt: cancelledAt,
				rejectionReason: null,
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
					submission: {
						key: "submission-1",
						resultKind: "default_created",
						originalStatus: "pending",
					},
					cancellation: requesterCancellationMarker({
						cancelledAt,
						chainInstanceId: null,
					}),
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});
		const item = result.items.find(
			(candidate) => candidate.sourceType === "time_correction",
		);

		expect(item).toMatchObject({
			status: "cancelled",
			resolvedAt: cancelledAt,
			decisionReason: null,
			availableActions: ["view"],
		});
		expect(result.counts.requiredFixes).toBe(0);
	});

	it("maps an exact requester-cancelled legacy chain tombstone to cancelled", async () => {
		const cancelledAt = new Date("2026-04-26T09:00:00.000Z");
		const chainInstanceId = "10000000-0000-4000-8000-000000000099";
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				status: "rejected",
				approvedAt: cancelledAt,
				rejectionReason: null,
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
					submission: {
						key: "submission-1",
						resultKind: "chain_created",
						originalStatus: "pending",
					},
					cancellation: requesterCancellationMarker({
						cancelledAt,
						chainInstanceId,
					}),
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({
			status: "cancelled",
			resolvedAt: cancelledAt,
			availableActions: ["view"],
		});
	});

	it.each([
		[
			"direct marker with chain identity",
			"default_created",
			"10000000-0000-4000-8000-000000000099",
		],
		["chain marker without chain identity", "chain_created", null],
	] as const)("fails closed for a %s", async (_label, resultKind, chainInstanceId) => {
		const cancelledAt = new Date("2026-04-26T09:00:00.000Z");
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				status: "rejected",
				approvedAt: cancelledAt,
				rejectionReason: null,
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
					submission: {
						key: "submission-1",
						resultKind,
						originalStatus: "pending",
					},
					cancellation: requesterCancellationMarker({
						cancelledAt,
						chainInstanceId,
					}),
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({ status: "rejected", availableActions: ["view"] });
		expect(result.counts.requiredFixes).toBe(0);
	});

	it.each([
		[
			"extra field",
			(marker: Record<string, unknown>) => ({
				...marker,
				privateNote: "secret-extra",
			}),
		],
		[
			"accessor field",
			(marker: Record<string, unknown>) => {
				const malformed = { ...marker };
				Object.defineProperty(malformed, "requesterUserId", {
					enumerable: true,
					get: () => "secret-accessor",
				});
				return malformed;
			},
		],
		[
			"inherited field",
			(marker: Record<string, unknown>) =>
				Object.assign(
					Object.create({ privateNote: "secret-inherited" }),
					marker,
				),
		],
	] as const)("fails closed for a cancellation marker with an %s", async (_label, mutate) => {
		const cancelledAt = new Date("2026-04-26T09:00:00.000Z");
		const marker = requesterCancellationMarker({
			cancelledAt,
			chainInstanceId: null,
		});
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				status: "rejected",
				approvedAt: cancelledAt,
				rejectionReason: null,
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
					submission: {
						key: "submission-1",
						resultKind: "default_created",
						originalStatus: "pending",
					},
					cancellation: mutate(marker),
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({ status: "rejected", availableActions: ["view"] });
		expect(result.counts.requiredFixes).toBe(0);
		expect(JSON.stringify(result)).not.toContain("secret-");
	});

	it("maps a malformed cancellation marker on a non-terminal row to rejected view-only", async () => {
		const cancelledAt = new Date("2026-04-26T09:00:00.000Z");
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				status: "pending",
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
					submission: {
						key: "submission-1",
						resultKind: "default_created",
						originalStatus: "pending",
					},
					cancellation: {
						...requesterCancellationMarker({
							cancelledAt,
							chainInstanceId: null,
						}),
						privateNote: "secret-pending",
					},
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({ status: "rejected", availableActions: ["view"] });
		expect(result.counts).toMatchObject({ pending: 0, requiredFixes: 0 });
		expect(JSON.stringify(result)).not.toContain("secret-pending");
	});

	it("does not treat a manager-authored cancellation marker as requester cancellation", async () => {
		const cancelledAt = new Date("2026-04-26T09:00:00.000Z");
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				status: "rejected",
				approvedAt: cancelledAt,
				rejectionReason: "Rejected by manager",
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: "10000000-0000-4000-8000-000000000001",
					},
					submission: {
						key: "submission-1",
						resultKind: "default_created",
						originalStatus: "pending",
					},
					cancellation: {
						...requesterCancellationMarker({
							cancelledAt,
							chainInstanceId: null,
						}),
						kind: "manager",
						requesterUserId: "user-manager",
					},
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({
			status: "rejected",
			decisionReason: "Rejected by manager",
			availableActions: ["view"],
		});
	});

	it("maps mixed request sources into one employee-scoped result", async () => {
		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items).toHaveLength(3);
		expect(result.items.map((item) => item.sourceType)).toEqual([
			"absence",
			"time_correction",
			"travel_expense",
		]);
		expect(result.counts).toEqual({
			pending: 1,
			requiredFixes: 1,
			recentDecisions: 2,
			total: 3,
		});
		expect(result.sourceErrors).toEqual([]);
		expect(
			result.items.find((item) => item.sourceType === "time_correction"),
		).toMatchObject({
			id: "approval-time-1",
			sourceId: "period-1",
			availableActions: ["cancel", "view"],
		});

		expectWhereConditions(dbMocks.approvalRequests, [
			{ left: "approvalRequest.organizationId", right: "org-1" },
			{ left: "approvalRequest.requestedBy", right: "employee-1" },
			{ left: "approvalRequest.entityType", right: "time_entry" },
		]);
		expect(dbMocks.approvalRequests).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 100 }),
		);
		expectWhereConditions(dbMocks.absenceEntries, [
			{ left: "absenceEntry.organizationId", right: "org-1" },
			{ left: "absenceEntry.employeeId", right: "employee-1" },
		]);
		expect(dbMocks.absenceEntries).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 100 }),
		);
		expectWhereConditions(dbMocks.travelExpenseClaims, [
			{ left: "travelExpenseClaim.organizationId", right: "org-1" },
			{ left: "travelExpenseClaim.employeeId", right: "employee-1" },
			{ left: "travelExpenseClaim.status", right: "draft", op: "ne" },
		]);
		expect(dbMocks.travelExpenseClaims).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 100 }),
		);
	});

	it("strictly excludes manual, policy, and unclassified time approvals from corrections", async () => {
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection(),
			timeCorrection({
				id: "manual-1",
				entityId: "period-manual",
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			}),
			timeCorrection({
				id: "policy-1",
				entityId: "period-policy",
				metadata: { timeRequest: { kind: "policy_clock_out" } },
			}),
			timeCorrection({ id: "unknown-1", metadata: null, reason: "Other" }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(
			result.items.filter((item) => item.sourceType === "time_correction"),
		).toEqual([
			expect.objectContaining({ id: "approval-time-1", sourceId: "period-1" }),
		]);
	});

	it.each([
		"legacy",
		"shadow",
		"ready",
		"canonical",
		"complete",
	] as const)("excludes ordinary compatibility and canonical requester rows in %s mode", async (lifecycleMode) => {
		dbMocks.approvalWorkflowRollouts.mockResolvedValue({ lifecycleMode });
		dbMocks.absenceEntries.mockResolvedValue([]);
		dbMocks.travelExpenseClaims.mockResolvedValue([]);
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection({
				id: `${lifecycleMode}-manual-compatibility`,
				metadata: { timeRequest: { kind: "manual_time_submission" } },
			}),
			timeCorrection({
				id: `${lifecycleMode}-policy-compatibility`,
				metadata: { timeRequest: { kind: "policy_clock_out" } },
			}),
		]);
		dbMocks.approvalWorkflows.mockResolvedValue([
			canonicalTimeCorrection({
				id: `${lifecycleMode}-manual-workflow`,
				workflowType: "manual_time_submission",
				contextSnapshot: {
					timeRequest: { kind: "manual_time_submission" },
				},
				displaySnapshot: {
					displayPayload: {
						title: "Manual time submission",
						privatePendingChanges: "must-not-leak",
					},
					searchText: "private-workflow-id",
				},
			}),
			canonicalTimeCorrection({
				id: `${lifecycleMode}-policy-workflow`,
				workflowType: "policy_clock_out",
				contextSnapshot: {
					timeRequest: { kind: "policy_clock_out" },
				},
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});

		expect(
			result.items.filter((item) => item.sourceType === "time_correction"),
		).toEqual([]);
		expect(result.items.flatMap((item) => item.availableActions)).not.toContain(
			"cancel",
		);
		expect(JSON.stringify(result)).not.toMatch(
			/privatePendingChanges|private-workflow-id/,
		);
	});

	it("offers correction cancellation only while the exact correction request is pending", async () => {
		dbMocks.approvalRequests.mockResolvedValue([
			timeCorrection(),
			timeCorrection({ id: "approved-1", status: "approved" }),
			timeCorrection({ id: "rejected-1", status: "rejected" }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
		});
		const timeItems = result.items.filter(
			(item) => item.sourceType === "time_correction",
		);

		expect(
			timeItems.find((item) => item.id === "approval-time-1")?.availableActions,
		).toEqual(["cancel", "view"]);
		expect(
			timeItems.find((item) => item.id === "approved-1")?.availableActions,
		).toEqual(["view"]);
		expect(
			timeItems.find((item) => item.id === "rejected-1")?.availableActions,
		).not.toContain("cancel");
	});

	it("excludes draft travel expenses from result items and counts", async () => {
		dbMocks.travelExpenseClaims.mockResolvedValue([
			travelExpense({ id: "draft-claim", status: "draft" }),
			travelExpense({
				id: "submitted-claim",
				status: "submitted",
				decidedAt: null,
			}),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items.map((item) => item.sourceId)).toEqual([
			"absence-1",
			"period-1",
			"submitted-claim",
		]);
		expect(result.counts).toEqual({
			pending: 2,
			requiredFixes: 1,
			recentDecisions: 1,
			total: 3,
		});
	});

	it("uses updatedAt as rejected absence resolvedAt when approvedAt is missing", async () => {
		const updatedAt = new Date("2026-04-23T11:00:00.000Z");
		dbMocks.absenceEntries.mockResolvedValue([
			absence({ approvedAt: null, updatedAt }),
			absence({ id: "pending-absence", status: "pending", approvedAt: null }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(
			result.items.find((item) => item.sourceId === "absence-1")?.resolvedAt,
		).toEqual(updatedAt);
		expect(
			result.items.find((item) => item.sourceId === "pending-absence")
				?.resolvedAt,
		).toBeNull();
	});

	it("filters by status, source type, and search text", async () => {
		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
			filters: {
				status: "rejected",
				sourceType: "absence",
				search: "coverage",
			},
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({
			sourceType: "absence",
			status: "rejected",
		});
	});

	it("excludes decisions outside the 30 day recent window from recent decision count", async () => {
		dbMocks.travelExpenseClaims.mockResolvedValue([
			travelExpense({ decidedAt: new Date("2026-02-01T08:00:00.000Z") }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.counts.recentDecisions).toBe(1);
	});

	it("returns partial data with a source error when one adapter fails", async () => {
		dbMocks.travelExpenseClaims.mockRejectedValue(
			new Error("database unavailable"),
		);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items.map((item) => item.sourceType)).toEqual([
			"absence",
			"time_correction",
		]);
		expect(result.sourceErrors).toEqual([
			{
				sourceType: "travel_expense",
				message: "Travel expense requests could not be loaded.",
			},
		]);
	});
});
