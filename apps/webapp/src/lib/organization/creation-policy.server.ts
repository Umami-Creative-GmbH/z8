import { env } from "@/env";
import {
	canCreateOrganizationsForDeployment as canCreateOrganizationsForDeploymentForFlag,
	isOrganizationCreationDisabled as isOrganizationCreationDisabledForFlag,
} from "./creation-policy";

export function isOrganizationCreationDisabled() {
	return isOrganizationCreationDisabledForFlag(env.DISABLE_ORGANIZATION_CREATION);
}

export function canCreateOrganizationsForDeployment(userCanCreateOrganizations: boolean) {
	return canCreateOrganizationsForDeploymentForFlag(
		userCanCreateOrganizations,
		env.DISABLE_ORGANIZATION_CREATION,
	);
}
