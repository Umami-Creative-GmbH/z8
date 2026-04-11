import { Effect } from "effect";
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
	getCounts: vi.fn(),
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
				getApprovals: vi.fn(),
				getCounts: mockState.getCounts,
			}),
		),
	};
});

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { GET } = await import("./route");

describe("GET /api/approvals/inbox/counts", () => {
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
		mockState.getCounts.mockReturnValue(
			Effect.succeed({
				absence_entry: 0,
				time_entry: 1,
				shift_request: 0,
				travel_expense_claim: 2,
			}),
		);
	});

	it("rejects requests without an active organization before delegating", async () => {
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: null },
		});

		const response = await GET();

		expect(response.status).toBe(400);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.getCounts).not.toHaveBeenCalled();
	});

	it("rejects missing employees before delegating", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await GET();

		expect(response.status).toBe(404);
		expect(mockState.getCounts).not.toHaveBeenCalled();
	});

	it("preserves employee lookup and delegates count reads to ApprovalQueryService", async () => {
		const response = await GET();

		expect(response.status).toBe(200);
		expect(mockState.findEmployee).toHaveBeenCalledTimes(1);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.getCounts).toHaveBeenCalledWith("employee-1", "org-1");
	});
});
