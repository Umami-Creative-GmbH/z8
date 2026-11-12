import { describe, expect, it } from "vitest";
import { defineAbilityFor } from "@/lib/authorization";
import type { PrincipalContext } from "@/lib/authorization/types";
import {
	isOwnerOrAdminSelfRecording,
	manualWorkChangePolicyRule,
	manualWorkExemption,
} from "./route-rules";

const ORG = "org_manual_rules";

function principal(input: {
	memberRole?: "owner" | "admin" | "member" | null;
	employeeRole?: "admin" | "manager" | "employee";
	customPermissions?: PrincipalContext["customRoles"][number]["permissions"];
}): PrincipalContext {
	const employeeRole = input.employeeRole ?? "employee";
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: ORG,
		orgMembership: input.memberRole
			? { organizationId: ORG, role: input.memberRole, status: "active" }
			: null,
		employee: { id: "employee-1", organizationId: ORG, role: employeeRole, teamId: null },
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: input.customPermissions
			? [
					{
						roleId: "role-1",
						roleName: "Custom",
						baseTier: employeeRole,
						permissions: input.customPermissions,
					},
				]
			: [],
	};
}

const recorder = (input: Parameters<typeof principal>[0]) => defineAbilityFor(principal(input));

const policy = (terms: Partial<{ selfServiceDays: number; approvalDays: number }> = {}) => ({
	noApprovalRequired: false,
	selfServiceDays: terms.selfServiceDays ?? 0,
	approvalDays: terms.approvalDays ?? 30,
});

describe("owner/admin self-recording is decided by the permission system", () => {
	it("lets organization owners and admins record their own work directly", () => {
		expect(isOwnerOrAdminSelfRecording(recorder({ memberRole: "owner" }))).toBe(true);
		expect(isOwnerOrAdminSelfRecording(recorder({ memberRole: "admin" }))).toBe(true);
	});

	it("does not exempt members, whatever their employee role", () => {
		expect(isOwnerOrAdminSelfRecording(recorder({ memberRole: "member" }))).toBe(false);
		expect(
			isOwnerOrAdminSelfRecording(recorder({ memberRole: "member", employeeRole: "admin" })),
		).toBe(false);
		expect(isOwnerOrAdminSelfRecording(recorder({ memberRole: null }))).toBe(false);
	});

	it("exempts a member whose custom role lets them manage the organization's settings", () => {
		expect(
			isOwnerOrAdminSelfRecording(
				recorder({
					memberRole: "member",
					customPermissions: [{ action: "manage", subject: "OrgSettings" }],
				}),
			),
		).toBe(true);
	});
});

describe("manual work exemption", () => {
	it("exempts entries made on someone's behalf, whoever records them", () => {
		expect(manualWorkExemption({ isOwnEntry: false, ownerOrAdminSelf: false })).toBe("on_behalf");
		expect(manualWorkExemption({ isOwnEntry: false, ownerOrAdminSelf: true })).toBe("on_behalf");
	});

	it("exempts owners and admins recording their own work, nobody else", () => {
		expect(manualWorkExemption({ isOwnEntry: true, ownerOrAdminSelf: true })).toBe(
			"owner_admin_self",
		);
		expect(manualWorkExemption({ isOwnEntry: true, ownerOrAdminSelf: false })).toBeNull();
	});
});

describe("manual work change-policy skip", () => {
	it("skips without a policy and in trust mode", () => {
		expect(manualWorkChangePolicyRule(null)).toEqual({ skip: "change_policy_no_policy" });
		expect(manualWorkChangePolicyRule({ ...policy(), noApprovalRequired: true })).toEqual({
			skip: "change_policy_trust_mode",
		});
	});

	it("routes a policy that requires approval, noting the self-service days that skip it", () => {
		expect(manualWorkChangePolicyRule(policy({ selfServiceDays: 2 }))).toEqual({
			skip: null,
			notes: [{ code: "within_self_service_skips", selfServiceDays: 2 }],
		});
		expect(manualWorkChangePolicyRule(policy())).toEqual({ skip: null, notes: [] });
	});

	it("routes a policy whose approval window is closed: such entries still go to approval", () => {
		expect(manualWorkChangePolicyRule(policy({ selfServiceDays: 1, approvalDays: 0 }))).toEqual({
			skip: null,
			notes: [{ code: "within_self_service_skips", selfServiceDays: 1 }],
		});
	});
});
