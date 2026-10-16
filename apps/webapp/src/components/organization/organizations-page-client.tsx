"use client";

import { useTranslate } from "@tolgee/react";
import type * as authSchema from "@/db/auth-schema";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { OrganizationTab } from "./organization-tab";

interface OrganizationsPageClientProps {
	trackingSuggestedAt: string;
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	canCreateOrganizations: boolean;
	billableCurrency: BillableCurrency | null;
}

export function OrganizationsPageClient({
	trackingSuggestedAt,
	organization,
	memberCount,
	currentMemberRole,
	defaultNotificationLanguage,
	canCreateOrganizations,
	billableCurrency,
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
					trackingSuggestedAt={trackingSuggestedAt}
					organization={organization}
					memberCount={memberCount}
					currentMemberRole={currentMemberRole}
					defaultNotificationLanguage={defaultNotificationLanguage}
					canCreateOrganizations={canCreateOrganizations}
					billableCurrency={billableCurrency}
				/>
			</div>
		</div>
	);
}
