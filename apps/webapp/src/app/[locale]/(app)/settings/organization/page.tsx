import { count, eq } from "drizzle-orm";
import { Suspense } from "react";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { organizationNotificationSettings } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { readDrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import { countOutstandingEquipmentReturns } from "@/lib/organization/equipment/lifecycle";
import { getTranslate } from "@/tolgee/server";
import { getOrganizationProfile } from "./profile-actions";

async function OrganizationsPageContent() {
	// The shared settings access resolver (ADR 0002): org admins and owners only.
	const [{ organizationId, settingsAccess }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);

	const memberTable = authSchema.member;
	const [
		organization,
		memberCountRows,
		organizationNotificationSettingsRecord,
		billableTimeSettings,
		drivingLicence,
		profileResult,
		equipmentOutstandingReturns,
	] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, organizationId),
		}),
		db
			.select({ value: count() })
			.from(memberTable)
			.where(eq(memberTable.organizationId, organizationId)),
		db.query.organizationNotificationSettings.findFirst({
			where: eq(
				organizationNotificationSettings.organizationId,
				organizationId,
			),
			columns: { defaultLanguage: true },
		}),
		getBillableTimeSettings(organizationId, db),
		readDrivingLicenceFeatureState(organizationId),
		getOrganizationProfile(),
		// The page guard above already limits this page to owners and admins.
		countOutstandingEquipmentReturns(db, organizationId),
	]);

	if (!profileResult.success) throw new Error(profileResult.error);

	if (!organization) {
		return (
			<div className="page-frame flex-1">
				<div className="page-measure space-y-6">
					<PageHeader
						title={t(
							"settings.organizations.notFound.title",
							"Organization Not Found",
						)}
						description={t(
							"settings.organizations.notFound.description",
							"The organization could not be found or you don't have access to it.",
						)}
					/>
				</div>
			</div>
		);
	}

	return (
		<OrganizationsPageClient
			organizationProfile={profileResult.data}
			organization={organization}
			memberCount={memberCountRows[0]?.value ?? 0}
			settingsAccess={settingsAccess}
			defaultNotificationLanguage={
				organizationNotificationSettingsRecord?.defaultLanguage ?? "en"
			}
			billableCurrency={billableTimeSettings.currency}
			drivingLicence={drivingLicence}
			equipmentOutstandingReturns={equipmentOutstandingReturns}
		/>
	);
}

function OrganizationsPageLoading() {
	return (
		<div className="page-frame flex-1">
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-9 w-56 max-w-full" />
					<Skeleton className="h-5 w-96 max-w-full" />
				</div>
				<Skeleton className="h-[180px] w-full" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function OrganizationsPage() {
	return (
		<Suspense fallback={<OrganizationsPageLoading />}>
			<OrganizationsPageContent />
		</Suspense>
	);
}
