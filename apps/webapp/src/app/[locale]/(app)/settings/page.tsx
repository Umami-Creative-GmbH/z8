import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { getResolvedSettingsVisibility } from "@/components/settings/settings-config";
import { SettingsGrid } from "@/components/settings/settings-grid";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { env } from "@/env";
import {
	getCurrentSettingsRouteContext,
	requireUser,
} from "@/lib/auth-helpers";
import { loadDrivingLicenceSettingsVisible } from "@/lib/organization/driving-licence/visibility";
import { managesProjectBelowManagerTier } from "@/lib/projects/project-manager-settings-access";

export default function SettingsPage() {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<SettingsPageContent />
		</Suspense>
	);
}

async function SettingsPageContent() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext) {
		await requireUser();
	}

	const { authContext, accessTier } = settingsRouteContext!;
	const billingEnabled = env.BILLING_ENABLED === "true";
	const activeOrganizationId =
		authContext.session.activeOrganizationId ??
		authContext.employee?.organizationId ??
		null;

	const currentOrganization = activeOrganizationId
		? await db.query.organization.findFirst({
				columns: {
					shiftsEnabled: true,
					projectsEnabled: true,
					surchargesEnabled: true,
					demoDataEnabled: true,
					worksCouncilEnabled: true,
					billableTimeEnabled: true,
					personnelFilesEnabled: true,
				},
				where: eq(authSchema.organization.id, activeOrganizationId),
			})
		: null;
	const featureFlags = currentOrganization
		? {
				shiftsEnabled: currentOrganization.shiftsEnabled ?? false,
				projectsEnabled: currentOrganization.projectsEnabled ?? false,
				surchargesEnabled: currentOrganization.surchargesEnabled ?? false,
				demoDataEnabled: currentOrganization.demoDataEnabled ?? true,
				worksCouncilEnabled: currentOrganization.worksCouncilEnabled ?? false,
				billableTimeEnabled: currentOrganization.billableTimeEnabled ?? false,
				personnelFilesEnabled:
					currentOrganization.personnelFilesEnabled ?? false,
			}
		: undefined;

	const [managesProject, drivingLicenceSettingsVisible] = await Promise.all([
		// The projects page grants the tasks-only view in the session's active organization.
		managesProjectBelowManagerTier(
			accessTier,
			authContext.user.id,
			authContext.session.activeOrganizationId ?? null,
		),
		loadDrivingLicenceSettingsVisible(
			accessTier,
			authContext.user.id,
			authContext.session.activeOrganizationId ?? null,
		),
	]);

	const { visibleSettings, visibleGroups } = getResolvedSettingsVisibility({
		accessTier,
		billingEnabled,
		featureFlags,
		managesProject,
		drivingLicenceSettingsVisible,
	});

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<SettingsGrid
					visibleSettings={visibleSettings}
					visibleGroups={visibleGroups}
				/>
			</div>
		</div>
	);
}
