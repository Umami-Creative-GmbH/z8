export type OrganizationCreationFlag = "true" | "false";

export function normalizeOrganizationCreationFlag(
	flag: string | undefined,
): OrganizationCreationFlag {
	return flag === "true" ? "true" : "false";
}

export function isOrganizationCreationDisabled(
	flag: OrganizationCreationFlag = "false",
) {
	return flag === "true";
}

export function canCreateOrganizationsForDeployment(
	userCanCreateOrganizations: boolean,
	flag: OrganizationCreationFlag = "false",
) {
	return !isOrganizationCreationDisabled(flag) && userCanCreateOrganizations;
}
