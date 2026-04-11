import { Effect } from "effect";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	bulkDecide: vi.fn(),
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

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

vi.mock("@/lib/approvals/application/bulk-approval.service", async () => {
	const { Context, Layer } = await import("effect");
	const BulkApprovalService = Context.GenericTag<any>("BulkApprovalService");

	return {
		BulkApprovalService,
		BulkApprovalServiceLive: Layer.succeed(
			BulkApprovalService,
			BulkApprovalService.of({
				bulkDecide: mockState.bulkDecide,
			}),
		),
	};
});

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { POST } = await import("./route");

function createRequest(body: unknown): NextRequest {
	return {
		json: vi.fn().mockResolvedValue(body),
		headers: new Headers(),
	} as unknown as NextRequest;
}

describe("POST /api/approvals/inbox/bulk-reject", () => {
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
		mockState.bulkDecide.mockReturnValue(
			Effect.succeed({
				succeeded: [],
				failed: [],
			}),
		);
	});

	it("does not delegate when no active employee is found", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await POST(createRequest({ approvalIds: ["approval-1"], reason: "Missing receipt" }));

		expect(response.status).toBe(404);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.bulkDecide).not.toHaveBeenCalled();
	});

	it("rejects forbidden requests before employee lookup or mutation", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => true),
		});

		const response = await POST(
			createRequest({ approvalIds: ["approval-1"], reason: "Missing receipt" }),
		);

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.bulkDecide).not.toHaveBeenCalled();
	});
});
