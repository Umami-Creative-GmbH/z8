import {
	getAuthContext,
	getCurrentSettingsAccessTier,
	getUserOrganizations,
	requireAbility,
} from "@/lib/auth-helpers";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { AppSidebar } from "./app-sidebar";

export async function ServerAppSidebar(props: React.ComponentProps<typeof AppSidebar>) {
	const [organizations, authContext, settingsAccessTier] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
		getCurrentSettingsAccessTier(),
	]);

	const activeOrganizationId = authContext?.session.activeOrganizationId ?? null;
	const currentOrganization = activeOrganizationId
		? organizations.find((org) => org.id === activeOrganizationId) || null
		: null;
	const canCreateOrganizations = canCreateOrganizationsForDeployment(
		authContext?.user.canCreateOrganizations || authContext?.user.role === "admin",
	);
	const featureFlags = {
		shiftsEnabled: currentOrganization?.shiftsEnabled ?? false,
		projectsEnabled: currentOrganization?.projectsEnabled ?? false,
		surchargesEnabled: currentOrganization?.surchargesEnabled ?? false,
		demoDataEnabled: currentOrganization?.demoDataEnabled ?? true,
		worksCouncilEnabled: currentOrganization?.worksCouncilEnabled ?? false,
	};
	let showWorksCouncilNav = false;
	if (props.showWorksCouncilNav && currentOrganization?.worksCouncilEnabled && activeOrganizationId) {
		const ability = await requireAbility();
		showWorksCouncilNav = canViewWorksCouncilPortal(
			ability,
			activeOrganizationId,
			activeOrganizationId,
		);
	}

	return (
		<AppSidebar
			{...props}
			organizations={organizations}
			currentOrganization={currentOrganization}
			employeeRole={authContext?.employee?.role ?? null}
			shiftsEnabled={currentOrganization?.shiftsEnabled ?? false}
			showComplianceNav={settingsAccessTier === "orgAdmin"}
			showPlatformAdminNav={authContext?.user.role === "admin"}
			settingsAccessTier={settingsAccessTier ?? "member"}
			billingEnabled={process.env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
			canCreateOrganizations={canCreateOrganizations}
			showWorksCouncilNav={showWorksCouncilNav}
		/>
	);
}
