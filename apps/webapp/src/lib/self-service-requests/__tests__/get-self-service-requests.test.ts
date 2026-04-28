import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
	approvalRequests: vi.fn(),
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
			absenceEntry: { findMany: dbMocks.absenceEntries },
			travelExpenseClaim: { findMany: dbMocks.travelExpenseClaims },
		},
	},
}));

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
		...overrides,
	};
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
		dbMocks.absenceEntries.mockReset();
		dbMocks.travelExpenseClaims.mockReset();
		dbMocks.approvalRequests.mockResolvedValue([timeCorrection()]);
		dbMocks.absenceEntries.mockResolvedValue([absence()]);
		dbMocks.travelExpenseClaims.mockResolvedValue([travelExpense()]);
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
		expect(result.counts).toEqual({ pending: 1, requiredFixes: 1, recentDecisions: 2, total: 3 });
		expect(result.sourceErrors).toEqual([]);

		expectWhereConditions(dbMocks.approvalRequests, [
			{ left: "approvalRequest.organizationId", right: "org-1" },
			{ left: "approvalRequest.requestedBy", right: "employee-1" },
			{ left: "approvalRequest.entityType", right: "time_entry" },
		]);
		expect(dbMocks.approvalRequests).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
		expectWhereConditions(dbMocks.absenceEntries, [
			{ left: "absenceEntry.organizationId", right: "org-1" },
			{ left: "absenceEntry.employeeId", right: "employee-1" },
		]);
		expect(dbMocks.absenceEntries).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
		expectWhereConditions(dbMocks.travelExpenseClaims, [
			{ left: "travelExpenseClaim.organizationId", right: "org-1" },
			{ left: "travelExpenseClaim.employeeId", right: "employee-1" },
			{ left: "travelExpenseClaim.status", right: "draft", op: "ne" },
		]);
		expect(dbMocks.travelExpenseClaims).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 100 }),
		);
	});

	it("excludes draft travel expenses from result items and counts", async () => {
		dbMocks.travelExpenseClaims.mockResolvedValue([
			travelExpense({ id: "draft-claim", status: "draft" }),
			travelExpense({ id: "submitted-claim", status: "submitted", decidedAt: null }),
		]);

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items.map((item) => item.sourceId)).toEqual([
			"absence-1",
			"approval-time-1",
			"submitted-claim",
		]);
		expect(result.counts).toEqual({ pending: 2, requiredFixes: 1, recentDecisions: 1, total: 3 });
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

		expect(result.items.find((item) => item.sourceId === "absence-1")?.resolvedAt).toEqual(
			updatedAt,
		);
		expect(result.items.find((item) => item.sourceId === "pending-absence")?.resolvedAt).toBeNull();
	});

	it("filters by status, source type, and search text", async () => {
		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
			filters: { status: "rejected", sourceType: "absence", search: "coverage" },
		});

		expect(result.items).toHaveLength(1);
		expect(result.items[0]).toMatchObject({ sourceType: "absence", status: "rejected" });
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
		dbMocks.travelExpenseClaims.mockRejectedValue(new Error("database unavailable"));

		const result = await getSelfServiceRequests({
			employeeId: "employee-1",
			organizationId: "org-1",
			now: new Date("2026-04-28T12:00:00.000Z"),
		});

		expect(result.items.map((item) => item.sourceType)).toEqual(["absence", "time_correction"]);
		expect(result.sourceErrors).toEqual([
			{ sourceType: "travel_expense", message: "Travel expense requests could not be loaded." },
		]);
	});
});
