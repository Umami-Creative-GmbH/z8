import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { HolidayManagement } from "@/components/settings/holiday-management";
import { getAuthContext } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";

export default async function HolidaySettingsPage() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage holidays" />
			</div>
		);
	}

	// Only admins can access holiday settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <HolidayManagement organizationId={authContext.employee.organizationId} />;
}
