"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";
import type * as authSchema from "@/db/auth-schema";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { DrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import type { OrganizationProfile } from "@/lib/organization/profile";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import { OrganizationTab } from "./organization-tab";

interface OrganizationsPageClientProps {
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

export function OrganizationsPageClient({
	organizationProfile,
	organization,
	memberCount,
	settingsAccess,
	defaultNotificationLanguage,
	billableCurrency,
	drivingLicence,
	equipmentOutstandingReturns,
}: OrganizationsPageClientProps) {
	const { t } = useTranslate();
	const organizationTitle = t("settings.organizations.title", "Organization");
	const organizationDescription = t(
		"settings.organizations.description",
		"Manage organization details and configuration",
	);

	return (
		<div className="page-frame flex-1">
			<div className="page-measure space-y-6">
				<PageHeader title={organizationTitle} description={organizationDescription} />

				<OrganizationTab
					organizationProfile={organizationProfile}
					organization={organization}
					memberCount={memberCount}
					settingsAccess={settingsAccess}
					defaultNotificationLanguage={defaultNotificationLanguage}
					billableCurrency={billableCurrency}
					drivingLicence={drivingLicence}
					equipmentOutstandingReturns={equipmentOutstandingReturns}
				/>
			</div>
		</div>
	);
}
