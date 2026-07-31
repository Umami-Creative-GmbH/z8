import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEmptyAbility,
	defineAbilityFor,
	type PrincipalContext,
} from "@/lib/authorization/ability";

const mockState = vi.hoisted(() => ({
	headers: vi.fn(),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	getEligibleApprovalScopesForManager: vi.fn(),
	bulkApproveApprovalInboxItems: vi.fn(),
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
}));

vi.mock("@/lib/approvals/inbox/decision-service", () => ({
	bulkApproveApprovalInboxItems: mockState.bulkApproveApprovalInboxItems,
}));

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

function createManagerAbility() {
	return defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: { organizationId: "org-1", role: "member", status: "active" },
		employee: {
			id: "employee-1",
			organizationId: "org-1",
			role: "manager",
			teamId: null,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	} satisfies PrincipalContext);
}

describe("POST /api/approvals/inbox/bulk-approve", () => {
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
			role: "manager",
		});
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue([]);
		mockState.bulkApproveApprovalInboxItems.mockResolvedValue({
			succeeded: [],
			failed: [],
		});
	});

	it("delegates bulk approval to the DB-backed inbox decision service", async () => {
		const response = await POST(createRequest({ approvalIds: ["approval-1"] }));

		expect(response.status).toBe(200);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.bulkApproveApprovalInboxItems).toHaveBeenCalledWith({
			approvalIds: ["approval-1"],
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			includeAllApprovers: true,
			eligibleApprovalScopes: [],
		});
	});

	it("passes team-primary scopes for a manager with no direct reports", async () => {
		const eligibleApprovalScopes = [
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1", "employee-3"] },
		];
		mockState.getAbility.mockResolvedValue(createManagerAbility());
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue(eligibleApprovalScopes);

		const response = await POST(createRequest({ approvalIds: ["approval-1"] }));

		expect(response.status).toBe(200);
		expect(mockState.getEligibleApprovalScopesForManager).toHaveBeenCalledWith({
			db: expect.anything(),
			managerEmployeeId: "employee-1",
			organizationId: "org-1",
		});
		expect(mockState.bulkApproveApprovalInboxItems).toHaveBeenCalledWith({
			approvalIds: ["approval-1"],
			actorEmployeeId: "employee-1",
			organizationId: "org-1",
			includeAllApprovers: undefined,
			eligibleApprovalScopes,
		});
	});

	it("rejects an active manager when approved membership is absent from the ability", async () => {
		mockState.getAbility.mockResolvedValue(createEmptyAbility());

		const response = await POST(createRequest({ approvalIds: ["approval-1"] }));

		expect(response.status).toBe(403);
		expect(mockState.getEligibleApprovalScopesForManager).not.toHaveBeenCalled();
		expect(mockState.bulkApproveApprovalInboxItems).not.toHaveBeenCalled();
	});

	it("does not delegate when no active employee is found", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await POST(createRequest({ approvalIds: ["approval-1"] }));

		expect(response.status).toBe(404);
		expect(mockState.bulkApproveApprovalInboxItems).not.toHaveBeenCalled();
	});

	it("rejects forbidden ordinary employees before mutation", async () => {
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn(() => true),
		});
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			role: "employee",
		});

		const response = await POST(createRequest({ approvalIds: ["approval-1"] }));

		expect(response.status).toBe(403);
		expect(mockState.findEmployee).toHaveBeenCalledTimes(1);
		expect(mockState.bulkApproveApprovalInboxItems).not.toHaveBeenCalled();
	});
});
