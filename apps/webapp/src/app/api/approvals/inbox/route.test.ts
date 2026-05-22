import { readFileSync } from "node:fs";
import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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
	getApprovals: vi.fn(),
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

vi.mock("@/lib/approvals/application/approval-query.service", async () => {
	const { Context, Layer } = await import("effect");
	const ApprovalQueryService = Context.GenericTag<any>("ApprovalQueryService");

	return {
		ApprovalQueryService,
		ApprovalQueryServiceLive: Layer.succeed(
			ApprovalQueryService,
			ApprovalQueryService.of({
				getApprovals: mockState.getApprovals,
				getCounts: vi.fn(),
			}),
		),
	};
});

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
		mockState.getApprovals.mockReturnValue(
			Effect.succeed({
				items: [],
				nextCursor: null,
				hasMore: false,
				total: 0,
			}),
		);
	});

	it("uses the Approval query adapter fields before delegating approval reads", () => {
		const source = readFileSync("src/app/api/approvals/inbox/route.ts", "utf8");

		expect(source).toContain("accessibleByDrizzle");
		expect(source).toContain('"Approval"');
		expect(source).toContain("approvalRequest.organizationId");
		expect(source).toContain("approvalRequest.requestedBy");
		expect(source).toContain("approvalRequest.approverId");
	});

	it("rejects unauthorized requests before delegating", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(401);
		expect(mockState.getApprovals).not.toHaveBeenCalled();
	});

	it("rejects requests when ability cannot be resolved before delegating", async () => {
		mockState.getAbility.mockResolvedValue(null);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.getApprovals).not.toHaveBeenCalled();
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
		expect(mockState.getApprovals).not.toHaveBeenCalled();
	});

	it("preserves employee lookup and delegates approved reads to ApprovalQueryService", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?status=pending&types=travel_expense_claim,absence_entry&limit=15",
			),
		);

		expect(response.status).toBe(200);
		expect(mockState.accessibleByDrizzle).toHaveBeenCalledWith(
			expect.anything(),
			"read",
			"Approval",
			{
				organizationId: "approvalRequest.organizationId",
				requestedBy: "approvalRequest.requestedBy",
				approverId: "approvalRequest.approverId",
				status: "approvalRequest.status",
			},
		);
		expect(mockState.findEmployee).toHaveBeenCalledTimes(1);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.getApprovals).toHaveBeenCalledWith({
			approverId: "employee-1",
			authorizationPredicate: { type: "sql", source: "approval-access" },
			includeAllApprovers: undefined,
			organizationId: "org-1",
			status: "pending",
			types: ["travel_expense_claim", "absence_entry"],
			teamId: undefined,
			search: undefined,
			priority: null,
			minAgeDays: undefined,
			dateRange: undefined,
			cursor: undefined,
			limit: 15,
			eligibleApprovalScopes: [],
		});
	});

	it("denies non-managers when Approval query rules cannot be translated", async () => {
		mockState.accessibleByDrizzle.mockImplementation(() => {
			throw new mockState.UnsupportedAuthorizationConditionError(
				"Unconditional database authorization is not supported",
			);
		});

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(403);
		expect(mockState.getEligibleApprovalScopesForManager).not.toHaveBeenCalled();
		expect(mockState.getApprovals).not.toHaveBeenCalled();
	});

	it("sets includeAllApprovers for manage-Approval users so admins see org-wide approvals", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn((action) => action !== "manage"),
		});

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(200);
		expect(mockState.accessibleByDrizzle).toHaveBeenCalled();
		expect(mockState.getApprovals).toHaveBeenCalledWith(
			expect.objectContaining({ includeAllApprovers: true }),
		);
	});
});
