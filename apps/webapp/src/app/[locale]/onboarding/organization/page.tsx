import type { Metadata } from "next";
import { isOrganizationCreationDisabled } from "@/lib/organization/creation-policy.server";
import OrganizationPageClient from "./organization-page-client";

export const metadata: Metadata = {
	title: "Organization setup | Z8",
	description: "Create or connect your organization during Z8 workspace onboarding.",
};

export default function OrganizationPage() {
	return <OrganizationPageClient canCreateOrganizations={!isOrganizationCreationDisabled()} />;
}
