import { env } from "@/env";
import {
	getAuthContext,
	getCurrentSettingsAccessTier,
	getUserOrganizations,
	requireAbility,
} from "@/lib/auth-helpers";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { canViewWorksCouncilPortal } from "@/lib/works-council/permissions";
import { AppSidebar } from "./app-sidebar";

interface ServerAppSidebarProps
	extends Omit<React.ComponentProps<typeof AppSidebar>, "navigationCapabilities"> {
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
	};
}

export async function ServerAppSidebar({
	showWorksCouncilNav = false,
	...props
}: ServerAppSidebarProps) {
	const [organizations, authContext, settingsAccessTier] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
		getCurrentSettingsAccessTier(),
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
	let canShowWorksCouncilNav = false;
	if (showWorksCouncilNav && currentOrganization?.worksCouncilEnabled && activeOrganizationId) {
		const ability = await requireAbility();
		canShowWorksCouncilNav = canViewWorksCouncilPortal(
			ability,
			activeOrganizationId,
			activeOrganizationId,
		);
	}
	let showPayrollNav = false;
	if (
		activeEmployee &&
		activeOrganizationId &&
		activeEmployee.organizationId === activeOrganizationId
	) {
		showPayrollNav = await hasActivePayrollAccessGrant({
			organizationId: activeOrganizationId,
			payrollEmployeeId: activeEmployee.id,
		});
	}

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
				worksCouncil: canShowWorksCouncilNav,
				platformAdmin: authContext?.user.role === "admin",
			}}
			settingsAccessTier={settingsAccessTier ?? "member"}
			billingEnabled={env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
			canCreateOrganizations={canCreateOrganizations}
		/>
	);
}
