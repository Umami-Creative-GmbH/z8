import { db } from "@/db";
import { env } from "@/env";
import {
	getRenderAuthContext as getAuthContext,
	getRenderAbility,
	getRenderOrganizationAbility,
	getRenderOrganizationIdentity,
	getRenderSettingsAccess,
	getRenderUserOrganizations as getUserOrganizations,
} from "@/lib/auth/render-context";
import { systemClock } from "@/lib/datetime/temporal-core";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { readDrivingLicenceVisibilityForIdentity } from "@/lib/organization/driving-licence/visibility";
import {
	HIDDEN_DRIVING_LICENCE_VISIBILITY,
	showsMyDrivingLicence,
	showsTeamDrivingLicence,
} from "@/lib/organization/driving-licence/visibility-rules";
import { readEquipmentNavigation } from "@/lib/organization/equipment/access";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { resolvePersonnelFileAccessForIdentity } from "@/lib/personnel-file/access-store";
import {
	DEFAULT_SETTINGS_CAPABILITIES,
	resolveSettingsCapabilitiesForIdentity,
} from "@/lib/settings/capabilities.server";
import { loadCollectsPeriodSubmissions } from "@/lib/time-tracking/period-submissions/settings";
import { hasWhoIsInLocations } from "@/lib/time-tracking/who-is-in/queries";
import { loadFinanceActorForIdentity } from "@/lib/travel-expenses/finance-access";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { AppSidebar } from "./app-sidebar";

interface ServerAppSidebarProps extends Omit<
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
		equipmentEnabled: organization?.equipmentEnabled ?? false,
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
		settingsAccess,
		settingsCapabilities,
		showPayrollNav,
		showFinanceNav,
		canShowWorksCouncilNav,
		activeOrganizationId,
		showPersonnelFilesNav,
		showPeriodSubmissionsNav,
		showTeamPresenceNav,
		showMyDrivingLicenceNav,
		showTeamDrivingLicenceNav,
		authContext,
		canCreateOrganizations,
		capabilitiesUnavailable,
		equipmentAccess,
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
				compliance: meetsSettingsAccess(settingsAccess, "orgAdmin"),
				payroll: Boolean(showPayrollNav),
				finance: showFinanceNav,
				worksCouncil: canShowWorksCouncilNav,
				// My documents (#865): the employee's own shared documents, while the feature is on.
				myDocuments:
					featureFlags.personnelFilesEnabled &&
					Boolean(activeEmployee && activeEmployee.organizationId === activeOrganizationId),
				myEquipment: equipmentAccess.personal,
				equipment: equipmentAccess.staff,
				personnelFiles: showPersonnelFilesNav,
				periodSubmissions: showPeriodSubmissionsNav,
				teamPresence: showTeamPresenceNav,
				myDrivingLicence: showMyDrivingLicenceNav,
				teamDrivingLicence: showTeamDrivingLicenceNav,
				platformAdmin: authContext?.user.role === "admin",
			}}
			settingsAccess={settingsAccess}
			settingsCapabilities={settingsCapabilities}
			billingEnabled={env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
			canCreateOrganizations={canCreateOrganizations}
		/>
	);
}

async function resolveSidebarAccess(showWorksCouncilNav: boolean) {
	const [organizations, authContext, settingsAccess] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
		getRenderSettingsAccess(),
	]);

	const activeOrganizationId = authContext?.session.activeOrganizationId ?? null;
	const currentOrganization = activeOrganizationId
		? organizations.find((org) => org.id === activeOrganizationId) || null
		: null;
	const activeEmployee = authContext?.employee ?? null;
	const canCreateOrganizations = canCreateOrganizationsForDeployment(
		authContext?.user.canCreateOrganizations || authContext?.user.role === "admin",
	);
	const featureFlags = getOrganizationFeatureFlags(currentOrganization);
	const identity = await getRenderOrganizationIdentity();
	const hasEmployee = !!identity?.employee;
	const canSeeTeamNavigation =
		!!identity && (activeEmployee?.role === "admin" || activeEmployee?.role === "manager");
	let capabilitiesUnavailable = false;
	const capability = <T,>(read: PromiseLike<T> | T, fallback: T): Promise<T> =>
		Promise.resolve(read).catch(() => {
			capabilitiesUnavailable = true;
			return fallback;
		});

	const drivingLicenceVisibilityPromise = capability(
		identity
			? readDrivingLicenceVisibilityForIdentity(identity)
			: HIDDEN_DRIVING_LICENCE_VISIBILITY,
		HIDDEN_DRIVING_LICENCE_VISIBILITY,
	);
	const settingsCapabilitiesPromise = capability(
		Promise.all([
			drivingLicenceVisibilityPromise,
			settingsAccess !== null && identity?.employee
				? getRenderOrganizationAbility()
				: Promise.resolve(null),
		]).then(([drivingLicenceVisibility, orgAbility]) =>
			resolveSettingsCapabilitiesForIdentity({
				settingsAccess,
				identity,
				ability: orgAbility,
				drivingLicenceVisibility,
				projectsEnabled: featureFlags.projectsEnabled,
			}),
		),
		DEFAULT_SETTINGS_CAPABILITIES,
	);

	const [
		canShowWorksCouncilNav,
		showPayrollNav,
		financeActor,
		personnelFileAccess,
		showPeriodSubmissionsNav,
		showTeamPresenceNav,
		drivingLicenceVisibility,
		settingsCapabilities,
		equipmentAccess,
	] = await Promise.all([
		capability(
			showWorksCouncilNav && featureFlags.worksCouncilEnabled && identity
				? getRenderAbility().then(
						(ability) =>
							!!ability &&
							canViewWorksCouncilPortal(ability, identity.organizationId, identity.organizationId),
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
				? getRenderAbility().then((ability) => loadFinanceActorForIdentity(authContext, ability))
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
		drivingLicenceVisibilityPromise,
		settingsCapabilitiesPromise,
		capability(
			featureFlags.equipmentEnabled && identity
				? readEquipmentNavigation(db, identity)
				: { personal: false, staff: false },
			{ personal: false, staff: false },
		),
	]);
	const showFinanceNav = financeActor?.canRead ?? false;
	const showPersonnelFilesNav = !!personnelFileAccess && managesAnyDocuments(personnelFileAccess);
	const showMyDrivingLicenceNav = showsMyDrivingLicence(drivingLicenceVisibility);
	const showTeamDrivingLicenceNav = showsTeamDrivingLicence(drivingLicenceVisibility);
	return {
		organizations,
		currentOrganization,
		activeEmployee,
		featureFlags,
		settingsAccess,
		settingsCapabilities,
		showPayrollNav,
		showFinanceNav,
		canShowWorksCouncilNav,
		activeOrganizationId,
		showPersonnelFilesNav,
		showPeriodSubmissionsNav,
		showTeamPresenceNav,
		showMyDrivingLicenceNav,
		showTeamDrivingLicenceNav,
		authContext,
		canCreateOrganizations,
		capabilitiesUnavailable,
		equipmentAccess,
	};
}
