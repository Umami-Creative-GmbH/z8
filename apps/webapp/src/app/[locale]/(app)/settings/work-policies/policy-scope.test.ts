import { describe, expect, it } from "vitest";
import {
	canAccessPolicyDefinitions,
	canManagePolicyDefinitions,
	canManagePolicyTargetEmployee,
	canManagePolicyAssignmentType,
	canAccessWorkPolicyComplianceActions,
	policyBelongsToOrganization,
} from "./policy-scope";

describe("policy scope helpers", () => {
	it("lets managers read policy definitions without granting edit access", () => {
		expect(canAccessPolicyDefinitions("manager")).toBe(true);
		expect(canManagePolicyDefinitions("manager")).toBe(false);
		expect(canManagePolicyDefinitions("orgAdmin")).toBe(true);
	});

	it("limits managers to employee-only assignments and managed members", () => {
		expect(canManagePolicyAssignmentType("manager", "employee")).toBe(true);
		expect(canManagePolicyAssignmentType("manager", "team")).toBe(false);
		expect(canManagePolicyAssignmentType("manager", "organization")).toBe(false);
		expect(canManagePolicyTargetEmployee("manager", true)).toBe(true);
		expect(canManagePolicyTargetEmployee("manager", false)).toBe(false);
	});

	it("keeps work-policy compliance actions org-admin-only", () => {
		expect(canAccessWorkPolicyComplianceActions("orgAdmin")).toBe(true);
		expect(canAccessWorkPolicyComplianceActions("manager")).toBe(false);
	});

	it("requires assignments to stay within the actor organization", () => {
		expect(policyBelongsToOrganization("org-1", "org-1")).toBe(true);
		expect(policyBelongsToOrganization("org-2", "org-1")).toBe(false);
	});
});
