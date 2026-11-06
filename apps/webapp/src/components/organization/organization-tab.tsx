"use client";

import { IconBuilding } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type * as authSchema from "@/db/auth-schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { DrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import type { OrganizationProfile } from "@/lib/organization/profile";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { OrganizationDangerZoneCard } from "./organization-danger-zone-card";
import { OrganizationDetailsCard } from "./organization-details-card";
import { OrganizationFeaturesCard } from "./organization-features-card";
import { OrganizationLanguageCard } from "./organization-language-card";
import { OrganizationProfileCard } from "./organization-profile-card";
import { OrganizationTimezoneCard } from "./organization-timezone-card";

interface OrganizationTabProps {
	organizationProfile: OrganizationProfile;
	trackingSuggestedAt: string;
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	canCreateOrganizations: boolean;
	billableCurrency: BillableCurrency | null;
	drivingLicence: DrivingLicenceFeatureState;
	equipmentOutstandingReturns: number;
}

export function OrganizationTab({
	organizationProfile,
	trackingSuggestedAt,
	organization,
	memberCount,
	currentMemberRole,
	defaultNotificationLanguage,
	canCreateOrganizations,
	billableCurrency,
	drivingLicence,
	equipmentOutstandingReturns,
}: OrganizationTabProps) {
	const { t } = useTranslate();
	const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);

	return (
		<div className="space-y-6">
			{/* Create Organization Button */}
			{canCreateOrganizations && (
				<div className="flex justify-end">
					<Button
						onClick={() => setCreateOrgDialogOpen(true)}
						variant="outline"
					>
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

			{(hasOrganizationRole(currentMemberRole, "owner") ||
				hasOrganizationRole(currentMemberRole, "admin")) && (
				<OrganizationProfileCard
					key={organization.id}
					organizationId={organization.id}
					profile={organizationProfile}
				/>
			)}

			{/* Organization Features Card */}
			<OrganizationFeaturesCard
				organizationId={organization.id}
				shiftsEnabled={organization.shiftsEnabled ?? false}
				projectsEnabled={organization.projectsEnabled ?? false}
				surchargesEnabled={organization.surchargesEnabled ?? false}
				demoDataEnabled={organization.demoDataEnabled ?? true}
				worksCouncilEnabled={organization.worksCouncilEnabled ?? false}
				billableTimeEnabled={organization.billableTimeEnabled ?? false}
				billableCurrency={billableCurrency}
				personnelFilesEnabled={organization.personnelFilesEnabled ?? false}
				equipmentEnabled={organization.equipmentEnabled ?? false}
				equipmentOutstandingReturns={equipmentOutstandingReturns}
				drivingLicence={drivingLicence}
				organizationTimezone={organization.timezone ?? "UTC"}
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
			<CreateOrganizationDialog
				trackingSuggestedAt={trackingSuggestedAt}
				open={createOrgDialogOpen}
				onOpenChange={setCreateOrgDialogOpen}
			/>
		</div>
	);
}
