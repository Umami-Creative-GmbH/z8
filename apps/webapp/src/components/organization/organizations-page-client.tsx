"use client";

import { useTranslate } from "@tolgee/react";
import type * as authSchema from "@/db/auth-schema";
import { OrganizationTab } from "./organization-tab";

interface OrganizationsPageClientProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	canCreateOrganizations: boolean;
}

export function OrganizationsPageClient({
	organization,
	memberCount,
	currentMemberRole,
	defaultNotificationLanguage,
	canCreateOrganizations,
}: OrganizationsPageClientProps) {
	const { t } = useTranslate();
	const organizationTitle = t("settings.organizations.title", "Organization");
	const organizationDescription = t(
		"settings.organizations.description",
		"Manage organization details and configuration",
	);

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-6xl">
				<div className="mb-8">
					<h1 className="text-3xl font-semibold mb-2">{organizationTitle}</h1>
					<p className="text-muted-foreground">{organizationDescription}</p>
				</div>

				<OrganizationTab
					organization={organization}
					memberCount={memberCount}
					currentMemberRole={currentMemberRole}
					defaultNotificationLanguage={defaultNotificationLanguage}
					canCreateOrganizations={canCreateOrganizations}
				/>
			</div>
		</div>
	);
}
