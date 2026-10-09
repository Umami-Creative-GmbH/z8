import { env } from "@/env";
import {
	getAuthContext,
	getCurrentSettingsAccessTier,
	getUserOrganizations,
	requireAbility,
} from "@/lib/auth-helpers";
import { canCreateOrganizationsForDeployment } from "@/lib/organization/creation-policy.server";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { loadFinanceActor } from "@/lib/travel-expenses/finance-access";
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
		billableTimeEnabled: organization?.billableTimeEnabled ?? false,
		personnelFilesEnabled: organization?.personnelFilesEnabled ?? false,
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
					Boolean(activeEmployee && activeEmployee.organizationId === activeOrganizationId),
				personnelFiles: showPersonnelFilesNav,
				platformAdmin: authContext?.user.role === "admin",
			}}
			settingsAccessTier={settingsAccessTier ?? "member"}
			billingEnabled={env.BILLING_ENABLED === "true"}
			featureFlags={featureFlags}
			canCreateOrganizations={canCreateOrganizations}
		/>
	);
}
