import { db } from "@/db";
import { env } from "@/env";
import {
	getAuthContext,
	getCurrentSettingsAccessTier,
	getUserOrganizations,
	requireAbility,
} from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { readDrivingLicenceVisibility } from "@/lib/organization/driving-licence/visibility";
import {
	HIDDEN_DRIVING_LICENCE_VISIBILITY,
	showsDrivingLicenceNavigation,
	showsDrivingLicenceSettings,
} from "@/lib/organization/driving-licence/visibility-rules";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { managesProjectBelowManagerTier } from "@/lib/projects/project-manager-settings-access";
import { loadCollectsPeriodSubmissions } from "@/lib/time-tracking/period-submissions/settings";
import { listWhoIsInLocations } from "@/lib/time-tracking/who-is-in/queries";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
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
	} = await resolveSidebarAccess(showWorksCouncilNav);
	return (
		<AppSidebar
			{...props}
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
	let canShowWorksCouncilNav = false;
	if (
		showWorksCouncilNav &&
		currentOrganization?.worksCouncilEnabled &&
		activeOrganizationId
	) {
		const ability = await requireAbility();
		canShowWorksCouncilNav = canViewWorksCouncilPortal(
			ability,
			activeOrganizationId,
			activeOrganizationId,
		);
	}
	let showPayrollNav = false;
	let showFinanceNav = false;
	if (
		activeEmployee &&
		activeOrganizationId &&
		activeEmployee.organizationId === activeOrganizationId
	) {
		const [payrollGrant, financeActor] = await Promise.all([
			hasActivePayrollAccessGrant({
				organizationId: activeOrganizationId,
				payrollEmployeeId: activeEmployee.id,
			}),
			loadFinanceActor(),
		]);
		showPayrollNav = payrollGrant;
		// Read access: owners, admins and any active expense officer grant (#753).
		showFinanceNav = financeActor?.canRead ?? false;
	}
	// Personnel files (#866): decided by the personnel file access resolver, never by roles.
	let showPersonnelFilesNav = false;
	if (featureFlags.personnelFilesEnabled) {
		const personnelFileAccess = await loadCurrentPersonnelFileAccess();
		showPersonnelFilesNav =
			personnelFileAccess.status === "resolved" &&
			managesAnyDocuments(personnelFileAccess.access);
	}
	// Period submissions (#1075): the Team section's overview, only while the active
	// organization collects them. Members never see the Team section, so skip the read.
	const canSeeTeamNavigation =
		activeOrganizationId !== null &&
		(activeEmployee?.role === "admin" || activeEmployee?.role === "manager");
	const [showPeriodSubmissionsNav, presenceLocations] = await Promise.all([
		canSeeTeamNavigation &&
			loadCollectsPeriodSubmissions(db, activeOrganizationId, {
				clock: systemClock,
			}),
		canSeeTeamNavigation
			? listWhoIsInLocations(db, { organizationId: activeOrganizationId })
			: [],
	]);
	const showTeamPresenceNav = presenceLocations.length > 0;
	// Driving licence (#1420): the item and the settings entry follow the visibility reader only.
	const drivingLicenceVisibility =
		activeOrganizationId && authContext
			? await readDrivingLicenceVisibility({
					organizationId: activeOrganizationId,
					userId: authContext.user.id,
				})
			: HIDDEN_DRIVING_LICENCE_VISIBILITY;
	const showDrivingLicenceNav = showsDrivingLicenceNavigation(drivingLicenceVisibility);
	const drivingLicenceSettingsVisible = showsDrivingLicenceSettings(drivingLicenceVisibility);
	// App search offers project managers below the manager tier their Projects view (#928).
	const managesProject =
		featureFlags.projectsEnabled &&
		(await managesProjectBelowManagerTier(
			settingsAccessTier,
			authContext?.user.id ?? null,
			activeOrganizationId,
		));

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
	};
}
