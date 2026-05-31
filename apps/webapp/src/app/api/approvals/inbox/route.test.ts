import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	accessibleByDrizzle: vi.fn(),
	UnsupportedAuthorizationConditionError: class UnsupportedAuthorizationConditionError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "UnsupportedAuthorizationConditionError";
		}
	},
	findEmployee: vi.fn(),
	getEligibleApprovalScopesForManager: vi.fn(async () => []),
	getApprovalInboxList: vi.fn(),
	logger: {
		error: vi.fn(),
	},
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAbility: mockState.getAbility,
}));

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getEligibleApprovalScopesForManager: mockState.getEligibleApprovalScopesForManager,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
	},
	approvalRequest: {
		organizationId: "approvalRequest.organizationId",
		requestedBy: "approvalRequest.requestedBy",
		approverId: "approvalRequest.approverId",
		status: "approvalRequest.status",
	},
}));

vi.mock("@/lib/authorization", () => ({
	UnsupportedAuthorizationConditionError: mockState.UnsupportedAuthorizationConditionError,
	accessibleByDrizzle: mockState.accessibleByDrizzle,
	ForbiddenError: class ForbiddenError extends Error {},
	toHttpError: vi.fn(() => ({ body: { error: "Forbidden" }, status: 403 })),
}));

vi.mock("@/lib/approvals/inbox/read-service", () => ({
	getApprovalInboxList: mockState.getApprovalInboxList,
}));

vi.mock("@/lib/approvals/inbox/source-adapters", () => ({
	isSupportedInboxType: (type: string) =>
		["absence_entry", "time_entry", "travel_expense_claim"].includes(type),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { GET } = await import("./route");

function createRequest(url: string): NextRequest {
	return {
		url,
		nextUrl: new URL(url),
		headers: new Headers(),
	} as unknown as NextRequest;
}

describe("GET /api/approvals/inbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.accessibleByDrizzle.mockReset();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue([]);
		mockState.accessibleByDrizzle.mockReturnValue({ type: "sql", source: "approval-access" });
		mockState.getApprovalInboxList.mockResolvedValue({
			items: [],
			nextCursor: null,
			hasMore: false,
			total: 0,
			counts: {},
			supportedTypes: [],
			warnings: [],
		});
	});

	it("rejects unauthorized requests before delegating", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(401);
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("rejects requests when ability cannot be resolved before delegating", async () => {
		mockState.getAbility.mockResolvedValue(null);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("rejects users without approval permission even when they have eligible requesters", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => true),
		});
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue([
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] },
		]);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(403);
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("preserves employee lookup and delegates assigned approval reads to the inbox list service", async () => {
		mockState.getApprovalInboxList.mockResolvedValue({
			items: [],
			nextCursor: "cursor-2",
			hasMore: true,
			total: 12,
			counts: { absence_entry: 2, time_entry: 3, travel_expense_claim: 7 },
			supportedTypes: ["absence_entry", "time_entry", "travel_expense_claim"],
			warnings: [{ source: "travel_expense_claim", message: "Some claims were skipped" }],
		});

		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?status=pending&types=travel_expense_claim,shift_request,absence_entry&limit=15",
			),
		);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			items: [],
			nextCursor: "cursor-2",
			hasMore: true,
			total: 12,
			counts: { absence_entry: 2, time_entry: 3, travel_expense_claim: 7 },
			supportedTypes: ["absence_entry", "time_entry", "travel_expense_claim"],
			warnings: [{ source: "travel_expense_claim", message: "Some claims were skipped" }],
		});
		expect(mockState.accessibleByDrizzle).not.toHaveBeenCalled();
		expect(mockState.findEmployee).toHaveBeenCalledTimes(1);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.getApprovalInboxList).toHaveBeenCalledWith({
			approverId: "employee-1",
			includeAllApprovers: undefined,
			organizationId: "org-1",
			status: "pending",
			types: ["travel_expense_claim", "absence_entry"],
			teamId: undefined,
			search: undefined,
			priority: undefined,
			minAgeDays: undefined,
			dateRange: undefined,
			cursor: undefined,
			limit: 15,
			eligibleApprovalScopes: [],
		});
	});

	it("rejects partial date ranges", async () => {
		const response = await GET(
			createRequest("https://app.example.com/api/approvals/inbox?dateFrom=2026-01-01"),
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: "Both dateFrom and dateTo are required" });
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("rejects malformed date ranges", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?dateFrom=not-a-date&dateTo=2026-01-31",
			),
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: "Invalid date range" });
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("rejects normalized calendar overflow date ranges", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?dateFrom=2026-02-31&dateTo=2026-03-01T00:00:00.000Z",
			),
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: "Invalid date range" });
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("rejects ambiguous non-ISO date ranges", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?dateFrom=01/02/2026&dateTo=2026-01-31T00:00:00.000Z",
			),
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: "Invalid date range" });
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("rejects inverted date ranges", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?dateFrom=2026-02-01&dateTo=2026-01-31",
			),
		);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body).toEqual({ error: "Invalid date range" });
		expect(mockState.getApprovalInboxList).not.toHaveBeenCalled();
	});

	it("passes validated date ranges to the inbox list service", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?dateFrom=2026-05-31T00:00:00.000Z&dateTo=2026-05-31T23:59:59.000Z",
			),
		);

		expect(response.status).toBe(200);
		expect(mockState.getApprovalInboxList).toHaveBeenCalledWith(
			expect.objectContaining({
				dateRange: {
					from: new Date("2026-05-31T00:00:00.000Z"),
					to: new Date("2026-05-31T23:59:59.000Z"),
				},
			}),
		);
	});

	it("does not require read-rule translation for directly assigned approval reads", async () => {
		mockState.accessibleByDrizzle.mockImplementation(() => {
			throw new mockState.UnsupportedAuthorizationConditionError(
				"Unconditional database authorization is not supported",
			);
		});

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(200);
		expect(mockState.accessibleByDrizzle).not.toHaveBeenCalled();
		expect(mockState.getEligibleApprovalScopesForManager).toHaveBeenCalled();
		expect(mockState.getApprovalInboxList).toHaveBeenCalledWith(
			expect.objectContaining({
				approverId: "employee-1",
			}),
		);
	});

	it("sets includeAllApprovers for manage-Approval users so admins see org-wide approvals", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action !== "manage"),
		});

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(200);
		expect(mockState.accessibleByDrizzle).not.toHaveBeenCalled();
		expect(mockState.getApprovalInboxList).toHaveBeenCalledWith(
			expect.objectContaining({ includeAllApprovers: true }),
		);
	});

	it("uses eligible approval scopes without also applying the manager direct-report predicate", async () => {
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue([
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] },
		]);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(200);
		expect(mockState.getApprovalInboxList).toHaveBeenCalledWith(
			expect.objectContaining({
				eligibleApprovalScopes: [
					{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1"] },
				],
			}),
		);
	});
});
