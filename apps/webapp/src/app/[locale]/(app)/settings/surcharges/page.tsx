import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function SurchargeSettingsPage() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage surcharges" />
			</div>
		);
	}

	// Only admins can access surcharge settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <SurchargeManagement organizationId={authContext.employee.organizationId} />;
}
