"use client";

import type * as authSchema from "@/db/auth-schema";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { DrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import type { OrganizationProfile } from "@/lib/organization/profile";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
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
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
	defaultNotificationLanguage: string;
	billableCurrency: BillableCurrency | null;
	drivingLicence: DrivingLicenceFeatureState;
	equipmentOutstandingReturns: number;
}

export function OrganizationTab({
	organizationProfile,
	organization,
	memberCount,
	settingsAccess,
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
				settingsAccess={settingsAccess}
			/>

			{meetsSettingsAccess(settingsAccess, "orgAdmin") && (
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
				settingsAccess={settingsAccess}
			/>

			{/* Organization Timezone Card */}
			<OrganizationTimezoneCard
				timezone={organization.timezone ?? "UTC"}
				settingsAccess={settingsAccess}
			/>

			{/* Organization Language Card */}
			<OrganizationLanguageCard
				defaultLanguage={defaultNotificationLanguage}
				settingsAccess={settingsAccess}
			/>

			{/* Danger Zone Card */}
			<OrganizationDangerZoneCard organization={organization} settingsAccess={settingsAccess} />
		</div>
	);
}
