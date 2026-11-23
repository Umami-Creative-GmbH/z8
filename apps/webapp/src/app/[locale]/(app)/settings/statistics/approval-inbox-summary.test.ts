import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/auth-helpers";
import { defineAbilityFor, type PrincipalContext } from "@/lib/authorization/ability";

const mockState = vi.hoisted(() => ({
	getAbility: vi.fn(),
	getApprovalInboxCounts: vi.fn(),
	getEligibleApprovalScopesForManager: vi.fn(async (): Promise<unknown[]> => []),
	loadInboxCovers: vi.fn(async (): Promise<unknown[]> => []),
	resolveComplianceExceptionInboxScope: vi.fn(async (): Promise<unknown> => null),
	logger: { error: vi.fn() },
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/approvals/init", () => ({}));
vi.mock("@/lib/auth-helpers", () => ({ getAbility: mockState.getAbility }));
vi.mock("@/lib/approvals/inbox/read-service", () => ({
	getApprovalInboxCounts: mockState.getApprovalInboxCounts,
}));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getEligibleApprovalScopesForManager: mockState.getEligibleApprovalScopesForManager,
}));
vi.mock("@/lib/approvals/deputy/deputy-decision-store", () => ({
	loadInboxCovers: mockState.loadInboxCovers,
}));
vi.mock("@/lib/approvals/inbox/compliance-exception-inbox", () => ({
	resolveComplianceExceptionInboxScope: mockState.resolveComplianceExceptionInboxScope,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => mockState.logger }));

const { loadApprovalInboxSummary } = await import("./approval-inbox-summary");

function viewer(role: "admin" | "manager" | "employee"): AuthContext {
	return {
		user: { id: "user-1" } as AuthContext["user"],
		session: { activeOrganizationId: "org-1" },
		employee: { id: "employee-1", organizationId: "org-1", role, teamId: null },
	};
}

function abilityFor(input: {
	employeeRole: "admin" | "manager" | "employee";
	orgRole: "owner" | "admin" | "member";
}) {
	return defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: { organizationId: "org-1", role: input.orgRole, status: "active" },
		employee: {
			id: "employee-1",
			organizationId: "org-1",
			role: input.employeeRole,
			teamId: null,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: ["employee-2"],
		customRoles: [],
	} satisfies PrincipalContext);
}

describe("loadApprovalInboxSummary counts as the inbox badge does (#1977)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getEligibleApprovalScopesForManager.mockResolvedValue([]);
		mockState.loadInboxCovers.mockResolvedValue([]);
		mockState.resolveComplianceExceptionInboxScope.mockResolvedValue(null);
	});

	it("counts the compliance exceptions of a manager's employees", async () => {
		mockState.getAbility.mockResolvedValue(
			abilityFor({ employeeRole: "manager", orgRole: "member" }),
		);
		mockState.resolveComplianceExceptionInboxScope.mockResolvedValue({
			kind: "managed",
			employeeIds: ["employee-2"],
		});
		mockState.getApprovalInboxCounts.mockResolvedValue({
			absence_entry: 1,
			compliance_exception: 2,
		});

		const summary = await loadApprovalInboxSummary(viewer("manager"), "org-1");

		expect(summary).toEqual({ status: "ok", value: { pending: 3, absenceRequests: 1 } });
		// The eligibility the approvals were read with, not a second read (#1977).
		expect(mockState.resolveComplianceExceptionInboxScope).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			canManageCompliance: false,
			eligibleApprovalScopes: [],
		});
		expect(mockState.getEligibleApprovalScopesForManager).toHaveBeenCalledTimes(1);
		expect(mockState.getApprovalInboxCounts).toHaveBeenCalledWith(
			expect.objectContaining({
				approverId: "employee-1",
				organizationId: "org-1",
				status: "pending",
				complianceExceptionScope: { kind: "managed", employeeIds: ["employee-2"] },
			}),
		);
	});

	it("counts only compliance exceptions for an employee who just manages Compliance", async () => {
		mockState.getAbility.mockResolvedValue(
			abilityFor({ employeeRole: "employee", orgRole: "admin" }),
		);
		mockState.resolveComplianceExceptionInboxScope.mockResolvedValue({ kind: "organization" });
		mockState.getApprovalInboxCounts.mockResolvedValue({ compliance_exception: 4 });

		const summary = await loadApprovalInboxSummary(viewer("employee"), "org-1");

		expect(summary).toEqual({ status: "ok", value: { pending: 4, absenceRequests: 0 } });
		expect(mockState.getApprovalInboxCounts).toHaveBeenCalledWith({
			approverId: "employee-1",
			organizationId: "org-1",
			status: "pending",
			limit: 1,
			eligibleApprovalScopes: [],
			includeAllApprovers: undefined,
			covering: [],
			complianceExceptionsOnly: true,
			complianceExceptionScope: { kind: "organization" },
		});
		expect(mockState.getEligibleApprovalScopesForManager).not.toHaveBeenCalled();
		expect(mockState.loadInboxCovers).not.toHaveBeenCalled();
	});

	it("has no inbox for a plain employee", async () => {
		mockState.getAbility.mockResolvedValue(
			abilityFor({ employeeRole: "employee", orgRole: "member" }),
		);

		expect(await loadApprovalInboxSummary(viewer("employee"), "org-1")).toEqual({
			status: "ok",
			value: null,
		});
		expect(mockState.getApprovalInboxCounts).not.toHaveBeenCalled();
	});
});
