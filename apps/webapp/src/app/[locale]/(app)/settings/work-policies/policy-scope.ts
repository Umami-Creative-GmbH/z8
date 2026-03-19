import type { SettingsAccessTier } from "@/lib/settings-access";

export function canAccessPolicyDefinitions(accessTier: SettingsAccessTier) {
	return accessTier !== "member";
}

export function canManagePolicyDefinitions(accessTier: SettingsAccessTier) {
	return accessTier === "orgAdmin";
}

export function canManagePolicyAssignmentType(
	accessTier: SettingsAccessTier,
	assignmentType: "organization" | "team" | "employee",
) {
	if (accessTier === "orgAdmin") {
		return true;
	}

	return accessTier === "manager" && assignmentType === "employee";
}

export function canManagePolicyTargetEmployee(
	accessTier: SettingsAccessTier,
	isManagedEmployee: boolean,
) {
	if (accessTier === "orgAdmin") {
		return true;
	}

	return accessTier === "manager" && isManagedEmployee;
}

export function canAccessWorkPolicyComplianceActions(accessTier: SettingsAccessTier) {
	return accessTier === "orgAdmin";
}

export function policyBelongsToOrganization(
	policyOrganizationId: string,
	organizationId: string,
) {
	return policyOrganizationId === organizationId;
}
