import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineAbilityFor } from "@/lib/authorization/ability";

const state = vi.hoisted(() => ({
	getEligibleApprovalScopesForManager: vi.fn(),
	loadInboxCovers: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getEligibleApprovalScopesForManager: state.getEligibleApprovalScopesForManager,
}));
vi.mock("@/lib/approvals/deputy/deputy-decision-store", () => ({
	loadInboxCovers: state.loadInboxCovers,
}));
vi.mock("@/lib/notifications/compliance-triggers", () => ({
	onComplianceExceptionApproved: vi.fn(),
	onComplianceExceptionRejected: vi.fn(),
}));

const { resolveApprovalInboxViewerScope } = await import("./viewer-scope");

const managerAbility = defineAbilityFor({
	userId: "user-1",
	isPlatformAdmin: false,
	activeOrganizationId: "org-1",
	orgMembership: { organizationId: "org-1", role: "member", status: "active" },
	employee: { id: "manager-1", organizationId: "org-1", role: "manager", teamId: null },
	permissions: { orgWide: null, byTeamId: new Map() },
	managedEmployeeIds: [],
	customRoles: [],
});

describe("resolveApprovalInboxViewerScope", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.getEligibleApprovalScopesForManager.mockResolvedValue([
			{ requesterEmployeeId: "employee-1", eligibleApproverIds: ["manager-1"] },
		]);
	});

	it("reads an approver-manager's eligibility once for approvals and compliance exceptions (#1977)", async () => {
		const scope = await resolveApprovalInboxViewerScope({
			ability: managerAbility,
			employee: { id: "manager-1", organizationId: "org-1", role: "manager" },
		});

		expect(state.getEligibleApprovalScopesForManager).toHaveBeenCalledTimes(1);
		expect(scope).toMatchObject({
			eligibleApprovalScopes: [
				{ requesterEmployeeId: "employee-1", eligibleApproverIds: ["manager-1"] },
			],
			complianceExceptionScope: { kind: "managed", employeeIds: ["employee-1"] },
		});
	});

	it("reads the viewer's Covering duties unless the caller shows no Covering sections (#1980)", async () => {
		await resolveApprovalInboxViewerScope({
			ability: managerAbility,
			employee: { id: "manager-1", organizationId: "org-1", role: "manager" },
		});
		expect(state.loadInboxCovers).toHaveBeenCalledTimes(1);

		state.loadInboxCovers.mockClear();
		const scope = await resolveApprovalInboxViewerScope({
			ability: managerAbility,
			employee: { id: "manager-1", organizationId: "org-1", role: "manager" },
			includeCovering: false,
		});

		expect(state.loadInboxCovers).not.toHaveBeenCalled();
		expect(scope?.covering).toEqual([]);
	});
});
