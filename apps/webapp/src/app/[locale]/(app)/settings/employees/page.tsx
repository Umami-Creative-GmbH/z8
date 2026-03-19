import { redirect } from "next/navigation";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { EmployeesPageClient } from "./employees-page-client";

export default async function EmployeesPage() {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	return (
		<EmployeesPageClient
			accessTier={settingsRouteContext.accessTier}
			organizationId={settingsRouteContext.authContext.session.activeOrganizationId ?? ""}
		/>
	);
}
