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
	loadDeputyDetailAccess: vi.fn(async (): Promise<unknown> => null),
	loadInboxCovers: vi.fn(async (): Promise<unknown[]> => []),
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
vi.mock("@/lib/approvals/deputy/deputy-decision-store", () => ({
	loadDeputyDetailAccess: state.loadDeputyDetailAccess,
	loadInboxCovers: state.loadInboxCovers,
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

const detail = {
	item: { id: "approval-1", requester: { id: "requester-1" } },
	sections: [],
	actions: {},
};

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

	describe("covering deputy (#1016)", () => {
		const absentApproversRequest = {
			id: "approval-1",
			entityType: "time_entry",
			approverId: "absent-1",
			requestedBy: "requester-1",
			organizationId: "org-1",
			status: "pending",
		};
		const pendingDetail = {
			item: {
				id: "approval-1",
				type: "time_entry",
				status: "pending",
				requester: { id: "requester-1" },
				capabilities: { canApprove: true, canReject: true, canBulkApprove: true },
			},
			sections: [],
			actions: { canApprove: true, canReject: true, canBulkApprove: true },
		};

		it("opens the absent approver's request to their covering deputy, in that section", async () => {
			state.findApprovalRequest.mockResolvedValue(absentApproversRequest);
			state.getApprovalInboxDetail.mockResolvedValue(pendingDetail);
			state.loadDeputyDetailAccess.mockResolvedValueOnce({
				kind: "covering",
				cover: { approverId: "absent-1", approverName: "Xenia" },
				decidedEarlierStage: false,
			});

			const result = await loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "approval-1",
			});

			expect(state.loadDeputyDetailAccess).toHaveBeenCalledWith(expect.anything(), {
				organizationId: "org-1",
				approvalRequestId: "approval-1",
				entityType: "time_entry",
				status: "pending",
				approverEmployeeId: "absent-1",
				deputyEmployeeId: "employee-1",
				at: expect.anything(),
			});
			expect(result).toMatchObject({
				status: "found",
				detail: {
					item: { coveringFor: { approverId: "absent-1", approverName: "Xenia" } },
					actions: { canApprove: true },
				},
			});
		});

		it("shows a four-eyes request without decisions", async () => {
			state.findApprovalRequest.mockResolvedValue(absentApproversRequest);
			state.getApprovalInboxDetail.mockResolvedValue(pendingDetail);
			state.loadDeputyDetailAccess.mockResolvedValueOnce({
				kind: "covering",
				cover: { approverId: "absent-1", approverName: "Xenia" },
				decidedEarlierStage: true,
			});

			const result = await loadAuthorizedApprovalDetail({
				userId: "user-1",
				organizationId: "org-1",
				approvalId: "approval-1",
			});

			expect(result).toMatchObject({
				status: "found",
				detail: {
					actions: { canApprove: false, canReject: false, decidedEarlierStage: true },
				},
			});
		});

		it("refuses someone who neither covers for the approver nor decided it as deputy", async () => {
			state.findApprovalRequest.mockResolvedValue(absentApproversRequest);

			await expect(
				loadAuthorizedApprovalDetail({
					userId: "user-1",
					organizationId: "org-1",
					approvalId: "approval-1",
				}),
			).resolves.toEqual({ status: "forbidden" });
		});
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
			covering: [],
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

	it.each([
		["compatibility", { approverId: "employee-2", requestedBy: "employee-1" }],
		["canonical", null],
	] as const)("offers the viewer no decision on their own %s request (#686)", async (kind, request) => {
		state.findApprovalRequest.mockResolvedValue(
			request && { id: "approval-1", entityType: "travel_expense_report", organizationId: "org-1", ...request },
		);
		state.isEligibleManagerForApprovalRequest.mockResolvedValue(true);
		const decisions = {
			canApprove: true,
			canReject: true,
			canBulkApprove: true,
			requiresRejectReason: true,
		};
		state.getApprovalInboxDetail.mockResolvedValue({
			item: {
				id: "approval-1",
				status: "pending",
				requester: { id: "employee-1" },
				capabilities: decisions,
			},
			sections: [],
			actions: decisions,
		});

		const result = await loadAuthorizedApprovalDetail({
			userId: "user-1",
			organizationId: "org-1",
			approvalId: "approval-1",
			kind,
		});

		const ownDecisions = {
			canApprove: false,
			canReject: false,
			canBulkApprove: false,
			requiresRejectReason: true,
			ownRequest: true,
		};
		expect(result).toMatchObject({
			status: "found",
			detail: { item: { capabilities: ownDecisions }, actions: ownDecisions },
		});
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
