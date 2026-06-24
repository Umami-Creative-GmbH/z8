"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type * as authSchema from "@/db/auth-schema";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { OrganizationDangerZoneCard } from "./organization-danger-zone-card";
import { OrganizationDetailsCard } from "./organization-details-card";
import { OrganizationFeaturesCard } from "./organization-features-card";
import { OrganizationLanguageCard } from "./organization-language-card";
import { OrganizationTimezoneCard } from "./organization-timezone-card";

interface OrganizationTabProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	canCreateOrganizations: boolean;
}

export function OrganizationTab({
	organization,
	memberCount,
	currentMemberRole,
	defaultNotificationLanguage,
	canCreateOrganizations,
}: OrganizationTabProps) {
	const { t } = useTranslate();
	const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);

	return (
		<div className="space-y-6">
			{/* Create Organization Button */}
			{canCreateOrganizations && (
				<div className="flex justify-end">
					<Button onClick={() => setCreateOrgDialogOpen(true)} variant="outline">
						<IconBuilding aria-hidden="true" className="mr-2 size-4" />
						{t("organization.createNew", "Create New Organization")}
					</Button>
				</div>
			)}

			{/* Organization Details Card */}
			<OrganizationDetailsCard
				organization={organization}
				memberCount={memberCount}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Features Card */}
			<OrganizationFeaturesCard
				organizationId={organization.id}
				shiftsEnabled={organization.shiftsEnabled ?? false}
				projectsEnabled={organization.projectsEnabled ?? false}
				surchargesEnabled={organization.surchargesEnabled ?? false}
				demoDataEnabled={organization.demoDataEnabled ?? true}
				worksCouncilEnabled={organization.worksCouncilEnabled ?? false}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Timezone Card */}
			<OrganizationTimezoneCard
				organizationId={organization.id}
				timezone={organization.timezone ?? "UTC"}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Language Card */}
			<OrganizationLanguageCard
				organizationId={organization.id}
				defaultLanguage={defaultNotificationLanguage}
				currentMemberRole={currentMemberRole}
			/>

			{/* Danger Zone Card */}
			<OrganizationDangerZoneCard
				organization={organization}
				currentMemberRole={currentMemberRole}
			/>

			{/* Create Organization Dialog */}
			<CreateOrganizationDialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen} />
		</div>
	);
}
