import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ComplianceRadarManagement } from "@/components/settings/compliance-radar/compliance-radar-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function ComplianceRadarPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage compliance radar" />
			</div>
		);
	}

	// Only admins and managers can access compliance radar
	if (authContext.employee.role !== "admin" && authContext.employee.role !== "manager") {
		redirect("/");
	}

	return (
		<ComplianceRadarManagement
			organizationId={authContext.employee.organizationId}
			isAdmin={authContext.employee.role === "admin"}
		/>
	);
}
