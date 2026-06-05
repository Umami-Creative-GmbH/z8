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
	const activeEmployee = authContext?.employee ?? null;
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
	if (
		props.showWorksCouncilNav &&
		currentOrganization?.worksCouncilEnabled &&
		activeOrganizationId
	) {
		const ability = await requireAbility();
		showWorksCouncilNav = canViewWorksCouncilPortal(
			ability,
			activeOrganizationId,
			activeOrganizationId,
		);
	}
	let showPayrollNav = false;
	if (activeEmployee?.role === "admin") {
		showPayrollNav = true;
	} else if (
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
			shiftsEnabled={currentOrganization?.shiftsEnabled ?? false}
			showComplianceNav={settingsAccessTier === "orgAdmin"}
			showPayrollNav={showPayrollNav}
			showPlatformAdminNav={authContext?.user.role === "admin"}
			settingsAccessTier={settingsAccessTier ?? "member"}
			billingEnabled={env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
			canCreateOrganizations={canCreateOrganizations}
			showWorksCouncilNav={showWorksCouncilNav}
		/>
	);
}
