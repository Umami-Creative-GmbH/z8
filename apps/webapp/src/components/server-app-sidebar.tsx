import {
	getAuthContext,
	getCurrentSettingsAccessTier,
	getUserOrganizations,
} from "@/lib/auth-helpers";
import { AppSidebar } from "./app-sidebar";

export async function ServerAppSidebar(props: React.ComponentProps<typeof AppSidebar>) {
	const [organizations, authContext, settingsAccessTier] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
		getCurrentSettingsAccessTier(),
	]);

	// Find current organization from the list
	const currentOrganization = authContext?.employee?.organizationId
		? organizations.find((org) => org.id === authContext.employee?.organizationId) || null
		: null;
	const featureFlags = {
		shiftsEnabled: currentOrganization?.shiftsEnabled ?? false,
		projectsEnabled: currentOrganization?.projectsEnabled ?? false,
		surchargesEnabled: false,
		demoDataEnabled: currentOrganization?.demoDataEnabled ?? true,
	};

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
		/>
	);
}
