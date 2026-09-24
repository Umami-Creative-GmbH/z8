import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineAbilityFor } from "@/lib/authorization/ability";
import { ApprovalInboxBadRequestError } from "./current-actor";

const state = vi.hoisted(() => ({
	getAbility: vi.fn(),
	findEmployee: vi.fn(),
	findApprovalRequest: vi.fn(),
	isEligibleManagerForApprovalRequest: vi.fn(async () => false),
	getEligibleApprovalScopesForManager: vi.fn(async () => []),
	getApprovalInboxDetail: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ getAbility: state.getAbility }));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	isEligibleManagerForApprovalRequest: state.isEligibleManagerForApprovalRequest,
	getEligibleApprovalScopesForManager: state.getEligibleApprovalScopesForManager,
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: state.findEmployee },
			approvalRequest: { findFirst: state.findApprovalRequest },
		},
	},
}));
vi.mock("./read-service", () => ({
	getApprovalInboxDetail: state.getApprovalInboxDetail,
}));

const { loadAuthorizedApprovalDetail } = await import("./authorized-detail");

const manager = {
	id: "employee-1",
	userId: "user-1",
	organizationId: "org-1",
	role: "manager" as const,
	teamId: null,
	isActive: true,
};

function managerAbility() {
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
	});
}

const detail = { item: { id: "approval-1" }, sections: [], actions: {} };

describe("loadAuthorizedApprovalDetail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.getAbility.mockResolvedValue(managerAbility());
		state.findEmployee.mockResolvedValue(manager);
		state.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityType: "absence_entry",
			approverId: "employee-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
		});
		state.getApprovalInboxDetail.mockResolvedValue(detail);
	});

	it("loads a compatibility request for its assigned approver", async () => {
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "approval-1",
				kind: "compatibility",
			}),
		).resolves.toEqual({ status: "found", detail });
	});

	it("never resolves a canonical target to a compatibility request", async () => {
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "approval-1",
				kind: "canonical",
			}),
		).resolves.toEqual({ status: "not_found" });
		expect(state.getApprovalInboxDetail).not.toHaveBeenCalled();
	});

	it("never falls through from a missing compatibility request to canonical reads", async () => {
		state.findApprovalRequest.mockResolvedValue(null);
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "assignment-1",
				kind: "compatibility",
			}),
		).resolves.toEqual({ status: "not_found" });
		expect(state.getApprovalInboxDetail).not.toHaveBeenCalled();
	});

	it("loads a canonical-only assignment through exact actor visibility", async () => {
		state.findApprovalRequest.mockResolvedValue(null);
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "assignment-1",
				kind: "canonical",
			}),
		).resolves.toEqual({ status: "found", detail });
		expect(state.getApprovalInboxDetail).toHaveBeenCalledWith({
			approvalId: "assignment-1",
			organizationId: "org-1",
			approverId: "employee-1",
			includeAllApprovers: undefined,
			eligibleApprovalScopes: [],
		});
	});

	it("reports an invisible canonical assignment as not found", async () => {
		state.findApprovalRequest.mockResolvedValue(null);
		state.getApprovalInboxDetail.mockRejectedValueOnce(
			new ApprovalInboxBadRequestError("Approval not found"),
		);
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "assignment-1",
				kind: "canonical",
			}),
		).resolves.toEqual({ status: "not_found" });
	});

	it("does not let a former assignee read a reassigned request", async () => {
		state.findApprovalRequest.mockResolvedValue({
			id: "approval-1",
			entityType: "absence_entry",
			approverId: "employee-2",
			requestedBy: "requester-1",
			organizationId: "org-1",
		});
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "approval-1",
				kind: "compatibility",
			}),
		).resolves.toEqual({ status: "forbidden" });
		expect(state.getApprovalInboxDetail).not.toHaveBeenCalled();
	});

	it("propagates infrastructure failures instead of reporting absence", async () => {
		state.findApprovalRequest.mockRejectedValueOnce(new Error("db down"));
		await expect(
			loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "approval-1",
				kind: "compatibility",
			}),
		).rejects.toThrow("db down");
	});
});
