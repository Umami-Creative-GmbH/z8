import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createEmptyAbility,
	defineAbilityFor,
	type PrincipalContext,
} from "@/lib/authorization/ability";

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
	getEligibleApprovalScopesForManager: vi.fn(),
	getApprovalInboxCounts: vi.fn(),
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
}));

vi.mock("@/lib/approvals/inbox/read-service", () => ({
	getApprovalInboxCounts: mockState.getApprovalInboxCounts,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { GET } = await import("./route");

function createEmployeeAbility(role: "admin" | "manager" = "manager") {
	return defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: { organizationId: "org-1", role: "member", status: "active" },
		employee: {
			id: "employee-1",
			organizationId: "org-1",
			role,
			teamId: null,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	} satisfies PrincipalContext);
}

describe("GET /api/approvals/inbox/counts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
			role: "manager",
		});
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue([]);
		mockState.getApprovalInboxCounts.mockResolvedValue({
			absence_entry: 0,
			time_entry: 1,
			travel_expense_claim: 2,
		});
	});

	it("rejects requests without an active organization before delegating", async () => {
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: null },
		});

		const response = await GET();

		expect(response.status).toBe(400);
		expect(mockState.findEmployee).not.toHaveBeenCalled();
		expect(mockState.getApprovalInboxCounts).not.toHaveBeenCalled();
	});

	it("rejects missing employees before delegating", async () => {
		mockState.findEmployee.mockResolvedValue(null);

		const response = await GET();

		expect(response.status).toBe(404);
		expect(mockState.getApprovalInboxCounts).not.toHaveBeenCalled();
	});

	it("rejects an active manager when approved membership is absent from the ability", async () => {
		mockState.getAbility.mockResolvedValue(createEmptyAbility());

		const response = await GET();

		expect(response.status).toBe(403);
		expect(mockState.getEligibleApprovalScopesForManager).not.toHaveBeenCalled();
		expect(mockState.getApprovalInboxCounts).not.toHaveBeenCalled();
	});

	it("preserves employee lookup and delegates count reads to the inbox counts service", async () => {
		const response = await GET();

		expect(response.status).toBe(200);
		expect(mockState.findEmployee).toHaveBeenCalledTimes(1);
		expect(eq).toHaveBeenCalledWith("isActive", true);
		expect(mockState.getApprovalInboxCounts).toHaveBeenCalledWith({
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
			limit: 1,
			eligibleApprovalScopes: [],
			includeAllApprovers: undefined,
		});
	});

	it("includes all organization approvals in counts for manage-Approval users", async () => {
		mockState.getAbility.mockResolvedValue(createEmployeeAbility("admin"));
		mockState.findEmployee.mockResolvedValue({
			id: "employee-1",
			organizationId: "org-1",
			role: "admin",
		});

		const response = await GET();

		expect(response.status).toBe(200);
		expect(mockState.getEligibleApprovalScopesForManager).not.toHaveBeenCalled();
		expect(mockState.getApprovalInboxCounts).toHaveBeenCalledWith({
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
			limit: 1,
			eligibleApprovalScopes: [],
			includeAllApprovers: true,
		});
	});

	it("includes team-primary scopes for a manager with no direct reports", async () => {
		const eligibleApprovalScopes = [
			{ requesterEmployeeId: "employee-2", eligibleApproverIds: ["employee-1", "employee-3"] },
		];
		mockState.getAbility.mockResolvedValue(createEmployeeAbility());
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue(eligibleApprovalScopes);

		const response = await GET();

		expect(response.status).toBe(200);
		expect(mockState.getEligibleApprovalScopesForManager).toHaveBeenCalledWith({
			db: expect.anything(),
			managerEmployeeId: "employee-1",
			organizationId: "org-1",
		});
		expect(mockState.getApprovalInboxCounts).toHaveBeenCalledWith({
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
			limit: 1,
			eligibleApprovalScopes,
			includeAllApprovers: undefined,
		});
	});
});
