import { isOrganizationCreationDisabled } from "@/lib/organization/creation-policy.server";
import OrganizationPageClient from "./organization-page-client";

export default function OrganizationPage() {
	return <OrganizationPageClient canCreateOrganizations={!isOrganizationCreationDisabled()} />;
}
