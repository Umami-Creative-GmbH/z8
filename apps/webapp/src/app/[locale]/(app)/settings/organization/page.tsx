import { and, count, eq } from "drizzle-orm";
import { Suspense } from "react";
import { OrganizationsPageClient } from "@/components/organization/organizations-page-client";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { organizationNotificationSettings } from "@/db/schema";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { readDrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import { countOutstandingEquipmentReturns } from "@/lib/organization/equipment/lifecycle";
import { getTranslate } from "@/tolgee/server";
import { getOrganizationProfile } from "./profile-actions";

async function OrganizationsPageContent() {
	const [settingsRouteContext, t] = await Promise.all([
		getCurrentSettingsRouteContext(),
		getTranslate(),
	]);

	if (!settingsRouteContext) {
		return redirectWithLocale("/settings");
	}

	if (settingsRouteContext.accessTier !== "orgAdmin") {
		return redirectWithLocale("/settings");
	}

	const { authContext } = settingsRouteContext;
	const organizationId = authContext.session.activeOrganizationId;

	if (!organizationId) {
		return redirectWithLocale("/settings");
	}

	const memberTable = authSchema.member;
	const [
		organization,
		currentMember,
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
			.select({ role: memberTable.role })
			.from(memberTable)
			.where(
				and(
					eq(memberTable.userId, authContext.user.id),
					eq(memberTable.organizationId, organizationId),
				),
			)
			.limit(1),
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
		// The orgAdmin tier above already limits this page to owners and admins.
		countOutstandingEquipmentReturns(db, organizationId),
	]);

	const [currentMemberRecord] = currentMember;
	if (!profileResult.success) throw new Error(profileResult.error);

	if (!organization || !currentMemberRecord) {
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
			currentMemberRole={
				currentMemberRecord.role as "owner" | "admin" | "member"
			}
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
