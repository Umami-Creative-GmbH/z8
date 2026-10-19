import type { Metadata } from "next";
import { connection } from "next/server";
import { systemClock } from "@/lib/datetime/temporal-core";
import { isOrganizationCreationDisabled } from "@/lib/organization/creation-policy.server";
import OrganizationPageClient from "./organization-page-client";

export const metadata: Metadata = {
	title: "Organization setup | Z8",
	description:
		"Create or connect your organization during Z8 workspace onboarding.",
};

export default async function OrganizationPage() {
	// The onboarding tracking suggestion must use the current request time.
	await connection();
	const trackingSuggestedAt = systemClock.nowInstant().toString();
	return (
		<OrganizationPageClient
			canCreateOrganizations={!isOrganizationCreationDisabled()}
			trackingSuggestedAt={trackingSuggestedAt}
		/>
	);
}
