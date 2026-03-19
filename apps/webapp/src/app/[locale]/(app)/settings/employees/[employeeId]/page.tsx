import { redirect } from "next/navigation";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { getEmployee } from "../actions";
import { EmployeeDetailPageClient } from "./employee-detail-page-client";

export default async function EmployeeDetailPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const settingsRouteContext = await getCurrentSettingsRouteContext();
	const { employeeId } = await params;

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const employeeResult = await getEmployee(employeeId);

	if (!employeeResult.success) {
		redirect("/settings/employees");
	}

	return (
		<EmployeeDetailPageClient
			params={Promise.resolve({ employeeId })}
			accessTier={settingsRouteContext.accessTier}
		/>
	);
}
