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
	findApprovalRequest: vi.fn(),
	isEligibleManagerForApprovalRequest: vi.fn(async () => false),
	handlerGetDetail: vi.fn(),
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
	isEligibleManagerForApprovalRequest: mockState.isEligibleManagerForApprovalRequest,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: {
				findFirst: mockState.findEmployee,
			},
			approvalRequest: {
				findFirst: mockState.findApprovalRequest,
			},
		},
	},
}));

vi.mock("@/db/schema", () => ({
	approvalRequest: {
		id: "approvalId",
	},
	employee: {
		userId: "userId",
		organizationId: "organizationId",
		isActive: "isActive",
	},
}));

vi.mock("@/lib/approvals/domain/registry", () => ({
	registerApprovalHandler: vi.fn(),
	getApprovalHandler: vi.fn(() => ({
		getDetail: mockState.handlerGetDetail,
	})),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { GET } = await import("./route");

function createRequest(): NextRequest {
	return {
		headers: new Headers(),
	} as NextRequest;
}

describe("GET /api/approvals/inbox/[id]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(false);
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.getAbility.mockResolvedValue({
			can: vi.fn(() => false),
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
		});
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});
		mockState.handlerGetDetail.mockReturnValue(
			Effect.succeed({ id: "entity-1", title: "Detail" }),
		);
	});

	it("does not delegate when no active employee is found in the active organization", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.handlerGetDetail).not.toHaveBeenCalled();
	});

	it("delegates detail reads for active employees", async () => {
		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.handlerGetDetail).toHaveBeenCalledWith("entity-1", "org-1");
	});

	it("returns 403 when an assigned approver lacks approve or manage permission", async () => {
		mockState.getAbility.mockResolvedValue({
			can: vi.fn(() => false),
			cannot: vi.fn(() => true),
		});

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.handlerGetDetail).not.toHaveBeenCalled();
	});

	it("allows an eligible fallback manager with approve permission to read a request assigned to another eligible manager", async () => {
		mockState.getAbility.mockResolvedValue({
			can: vi.fn(() => false),
			cannot: vi.fn((action) => action === "manage"),
		});
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(true);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(200);
		expect(mockState.handlerGetDetail).toHaveBeenCalledWith("entity-1", "org-1");
	});

	it("returns 403 when an eligible fallback manager lacks approve or manage permission", async () => {
		mockState.getAbility.mockResolvedValue({
			can: vi.fn(() => false),
			cannot: vi.fn(() => true),
		});
		mockState.isEligibleManagerForApprovalRequest.mockResolvedValue(true);
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		});

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(403);
		expect(mockState.handlerGetDetail).not.toHaveBeenCalled();
	});

	it("returns 404 before detail authorization when the approval belongs to another organization", async () => {
		mockState.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityId: "entity-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-2",
			status: "pending",
		});

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: "approval-1" }),
		});

		expect(response.status).toBe(404);
		expect(mockState.handlerGetDetail).not.toHaveBeenCalled();
	});
});
