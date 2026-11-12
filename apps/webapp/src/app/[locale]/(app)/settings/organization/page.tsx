import { count, eq } from "drizzle-orm";
import { Suspense } from "react";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
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
		getOrganizationProfile(organizationId),
		// The page guard above already limits this page to owners and admins.
		countOutstandingEquipmentReturns(db, organizationId),
	]);

	if (!profileResult.success) throw new Error(profileResult.error);

	if (!organization) {
		return (
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-4xl">
					<h1 className="text-2xl font-semibold">
						{t(
							"settings.organizations.notFound.title",
							"Organization Not Found",
						)}
					</h1>
					<p className="text-muted-foreground mt-2">
						{t(
							"settings.organizations.notFound.description",
							"The organization could not be found or you don't have access to it.",
						)}
					</p>
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
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-5 w-96" />
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
