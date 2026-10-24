import { db } from "@/db";
import { env } from "@/env";
import {
	getRenderAuthContext as getAuthContext,
	getRenderSettingsAccessTier as getCurrentSettingsAccessTier,
	getRenderAbility,
	getRenderOrganizationIdentity,
	getRenderUserOrganizations as getUserOrganizations,
} from "@/lib/auth/render-context";
import { systemClock } from "@/lib/datetime/temporal-core";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { readDrivingLicenceVisibilityForIdentity } from "@/lib/organization/driving-licence/visibility";
import {
	HIDDEN_DRIVING_LICENCE_VISIBILITY,
	showsDrivingLicenceNavigation,
	showsDrivingLicenceSettings,
} from "@/lib/organization/driving-licence/visibility-rules";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { resolvePersonnelFileAccessForIdentity } from "@/lib/personnel-file/access-store";
import { managesProjectBelowManagerTierForIdentity } from "@/lib/projects/project-manager-settings-access";
import { loadCollectsPeriodSubmissions } from "@/lib/time-tracking/period-submissions/settings";
import { hasWhoIsInLocations } from "@/lib/time-tracking/who-is-in/queries";
import { loadFinanceActorForIdentity } from "@/lib/travel-expenses/finance-access";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { AppSidebar } from "./app-sidebar";

interface ServerAppSidebarProps
	extends Omit<
		React.ComponentProps<typeof AppSidebar>,
		"navigationCapabilities"
	> {
	showWorksCouncilNav?: boolean;
}

function getOrganizationFeatureFlags(
	organization: Awaited<ReturnType<typeof getUserOrganizations>>[number] | null,
) {
	return {
		shiftsEnabled: organization?.shiftsEnabled ?? false,
		projectsEnabled: organization?.projectsEnabled ?? false,
		surchargesEnabled: organization?.surchargesEnabled ?? false,
		demoDataEnabled: organization?.demoDataEnabled ?? true,
		worksCouncilEnabled: organization?.worksCouncilEnabled ?? false,
		billableTimeEnabled: organization?.billableTimeEnabled ?? false,
		personnelFilesEnabled: organization?.personnelFilesEnabled ?? false,
	};
}

export async function ServerAppSidebar({
	showWorksCouncilNav = false,
	...props
}: ServerAppSidebarProps) {
	const {
		organizations,
		currentOrganization,
		activeEmployee,
		featureFlags,
		settingsAccessTier,
		showPayrollNav,
		showFinanceNav,
		canShowWorksCouncilNav,
		activeOrganizationId,
		showPersonnelFilesNav,
		showPeriodSubmissionsNav,
		showTeamPresenceNav,
		showDrivingLicenceNav,
		drivingLicenceSettingsVisible,
		managesProject,
		authContext,
		canCreateOrganizations,
		capabilitiesUnavailable,
	} = await resolveSidebarAccess(showWorksCouncilNav);
	return (
		<AppSidebar
			{...props}
			capabilitiesUnavailable={capabilitiesUnavailable}
			organizations={organizations}
			currentOrganization={currentOrganization}
			employeeRole={activeEmployee?.role ?? null}
			navigationCapabilities={{
				scheduling: featureFlags.shiftsEnabled,
				compliance: settingsAccessTier === "orgAdmin",
				payroll: Boolean(showPayrollNav),
				finance: showFinanceNav,
				worksCouncil: canShowWorksCouncilNav,
				// My documents (#865): the employee's own shared documents, while the feature is on.
				myDocuments:
					featureFlags.personnelFilesEnabled &&
					Boolean(
						activeEmployee &&
							activeEmployee.organizationId === activeOrganizationId,
					),
				personnelFiles: showPersonnelFilesNav,
				periodSubmissions: showPeriodSubmissionsNav,
				teamPresence: showTeamPresenceNav,
				drivingLicence: showDrivingLicenceNav,
				platformAdmin: authContext?.user.role === "admin",
			}}
			settingsAccessTier={settingsAccessTier ?? "member"}
			billingEnabled={env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
			managesProject={managesProject}
			drivingLicenceSettingsVisible={drivingLicenceSettingsVisible}
			canCreateOrganizations={canCreateOrganizations}
		/>
	);
}

async function resolveSidebarAccess(showWorksCouncilNav: boolean) {
	const [organizations, authContext, settingsAccessTier] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
		getCurrentSettingsAccessTier(),
	]);

	const activeOrganizationId =
		authContext?.session.activeOrganizationId ?? null;
	const currentOrganization = activeOrganizationId
		? organizations.find((org) => org.id === activeOrganizationId) || null
		: null;
	const activeEmployee = authContext?.employee ?? null;
	const canCreateOrganizations = canCreateOrganizationsForDeployment(
		authContext?.user.canCreateOrganizations ||
			authContext?.user.role === "admin",
	);
	const featureFlags = getOrganizationFeatureFlags(currentOrganization);
	const identity = await getRenderOrganizationIdentity();
	const hasEmployee = !!identity?.employee;
	const canSeeTeamNavigation =
		!!identity &&
		(activeEmployee?.role === "admin" || activeEmployee?.role === "manager");
	let capabilitiesUnavailable = false;
	const capability = <T,>(read: PromiseLike<T> | T, fallback: T): Promise<T> =>
		Promise.resolve(read).catch(() => {
			capabilitiesUnavailable = true;
			return fallback;
		});
	const [
		canShowWorksCouncilNav,
		showPayrollNav,
		financeActor,
		personnelFileAccess,
		showPeriodSubmissionsNav,
		showTeamPresenceNav,
		drivingLicenceVisibility,
		managesProject,
	] = await Promise.all([
		capability(
			showWorksCouncilNav && featureFlags.worksCouncilEnabled && identity
				? getRenderAbility().then(
						(ability) =>
							!!ability &&
							canViewWorksCouncilPortal(
								ability,
								identity.organizationId,
								identity.organizationId,
							),
					)
				: false,
			false,
		),
		capability(
			hasEmployee && identity?.employee
				? hasActivePayrollAccessGrant({
						organizationId: identity.organizationId,
						payrollEmployeeId: identity.employee.id,
					})
				: false,
			false,
		),
		capability(
			hasEmployee
				? getRenderAbility().then((ability) =>
						loadFinanceActorForIdentity(authContext, ability),
					)
				: null,
			null,
		),
		capability(
			featureFlags.personnelFilesEnabled && identity
				? resolvePersonnelFileAccessForIdentity(db, {
						...identity,
						selfEmployeeId: identity.employee?.id ?? null,
					})
				: null,
			null,
		),
		capability(
			canSeeTeamNavigation && identity
				? loadCollectsPeriodSubmissions(db, identity.organizationId, {
						clock: systemClock,
					})
				: false,
			false,
		),
		capability(
			canSeeTeamNavigation && identity
				? hasWhoIsInLocations(db, { organizationId: identity.organizationId })
				: false,
			false,
		),
		capability(
			identity
				? readDrivingLicenceVisibilityForIdentity(identity)
				: HIDDEN_DRIVING_LICENCE_VISIBILITY,
			HIDDEN_DRIVING_LICENCE_VISIBILITY,
		),
		capability(
			featureFlags.projectsEnabled && identity
				? managesProjectBelowManagerTierForIdentity(
						settingsAccessTier,
						identity,
					)
				: false,
			false,
		),
	]);
	const showFinanceNav = financeActor?.canRead ?? false;
	const showPersonnelFilesNav =
		!!personnelFileAccess && managesAnyDocuments(personnelFileAccess);
	const showDrivingLicenceNav = showsDrivingLicenceNavigation(
		drivingLicenceVisibility,
	);
	const drivingLicenceSettingsVisible = showsDrivingLicenceSettings(
		drivingLicenceVisibility,
	);
	return {
		organizations,
		currentOrganization,
		activeEmployee,
		featureFlags,
		settingsAccessTier,
		showPayrollNav,
		showFinanceNav,
		canShowWorksCouncilNav,
		activeOrganizationId,
		showPersonnelFilesNav,
		showPeriodSubmissionsNav,
		showTeamPresenceNav,
		showDrivingLicenceNav,
		drivingLicenceSettingsVisible,
		managesProject,
		authContext,
		canCreateOrganizations,
		capabilitiesUnavailable,
	};
}
