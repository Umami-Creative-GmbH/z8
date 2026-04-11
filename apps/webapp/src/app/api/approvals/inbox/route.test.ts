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
	findEmployee: vi.fn(),
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
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => false),
		});
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		mockState.getApprovals.mockReturnValue(
			Effect.succeed({
				items: [],
				nextCursor: null,
				hasMore: false,
				total: 0,
			}),
		);
	});

	it("rejects unauthorized requests before delegating", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(401);
		expect(mockState.getApprovals).not.toHaveBeenCalled();
	});

	it("rejects forbidden requests before delegating", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => true),
		});

		const response = await GET(createRequest("https://app.example.com/api/approvals/inbox"));

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.getApprovals).not.toHaveBeenCalled();
	});

	it("preserves employee lookup and delegates approved reads to ApprovalQueryService", async () => {
		const response = await GET(
			createRequest(
				"https://app.example.com/api/approvals/inbox?status=pending&types=travel_expense_claim,absence_entry&limit=15",
			),
		);

		expect(response.status).toBe(200);
		expect(mockState.findEmployee).toHaveBeenCalledTimes(1);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.getApprovals).toHaveBeenCalledWith({
			approverId: "employee-1",
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
		});
	});
});
