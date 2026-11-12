"use client";

import type * as authSchema from "@/db/auth-schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { DrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import type { OrganizationProfile } from "@/lib/organization/profile";
import { OrganizationDangerZoneCard } from "./organization-danger-zone-card";
import { OrganizationDetailsCard } from "./organization-details-card";
import { OrganizationFeaturesCard } from "./organization-features-card";
import { OrganizationLanguageCard } from "./organization-language-card";
import { OrganizationProfileCard } from "./organization-profile-card";
import { OrganizationTimezoneCard } from "./organization-timezone-card";

interface OrganizationTabProps {
	organizationProfile: OrganizationProfile;
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
	defaultNotificationLanguage: string;
	billableCurrency: BillableCurrency | null;
	drivingLicence: DrivingLicenceFeatureState;
	equipmentOutstandingReturns: number;
}

export function OrganizationTab({
	organizationProfile,
	organization,
	memberCount,
	currentMemberRole,
	defaultNotificationLanguage,
	billableCurrency,
	drivingLicence,
	equipmentOutstandingReturns,
}: OrganizationTabProps) {
	return (
		<div className="space-y-6">
			{/* Organization Details Card */}
			<OrganizationDetailsCard
				organization={organization}
				memberCount={memberCount}
				currentMemberRole={currentMemberRole}
			/>

			{(hasOrganizationRole(currentMemberRole, "owner") ||
				hasOrganizationRole(currentMemberRole, "admin")) && (
				<OrganizationProfileCard key={organization.id} profile={organizationProfile} />
			)}

			{/* Organization Features Card */}
			<OrganizationFeaturesCard
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
				timezone={organization.timezone ?? "UTC"}
				currentMemberRole={currentMemberRole}
			/>

			{/* Organization Language Card */}
			<OrganizationLanguageCard
				defaultLanguage={defaultNotificationLanguage}
				currentMemberRole={currentMemberRole}
			/>

			{/* Danger Zone Card */}
			<OrganizationDangerZoneCard
				organization={organization}
				currentMemberRole={currentMemberRole}
			/>
		</div>
	);
}
