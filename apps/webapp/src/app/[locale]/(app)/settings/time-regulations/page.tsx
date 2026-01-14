import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TimeRegulationManagement } from "@/components/settings/time-regulation-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function TimeRegulationSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage time regulations" />
			</div>
		);
	}

	// Only admins can access time regulation settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <TimeRegulationManagement organizationId={authContext.employee.organizationId} />;
}
