import { getAuthContext, getUserOrganizations } from "@/lib/auth-helpers";
import { AppSidebar } from "./app-sidebar";

export async function ServerAppSidebar(props: React.ComponentProps<typeof AppSidebar>) {
	const [organizations, authContext] = await Promise.all([
		getUserOrganizations(),
		getAuthContext(),
	]);

	// Find current organization from the list
	const currentOrganization = authContext?.employee?.organizationId
		? organizations.find((org) => org.id === authContext.employee?.organizationId) || null
		: null;

	return (
		<AppSidebar
			{...props}
			organizations={organizations}
			currentOrganization={currentOrganization}
			employeeRole={authContext?.employee?.role ?? null}
		/>
	);
}
