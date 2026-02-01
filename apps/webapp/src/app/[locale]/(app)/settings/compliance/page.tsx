import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ComplianceExceptionsManager } from "@/components/settings/compliance-exceptions-manager";
import { getAuthContext } from "@/lib/auth-helpers";

export const metadata = {
	title: "Compliance Settings | ArbZG",
	description: "Configure ArbZG compliance settings and manage exception requests",
};

export default async function ComplianceSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage compliance settings" />
			</div>
		);
	}

	// Only managers and admins can access compliance exception management
	if (authContext.employee.role === "employee") {
		redirect("/");
	}

	return (
		<ComplianceExceptionsManager
			organizationId={authContext.employee.organizationId}
			employeeId={authContext.employee.id}
			isAdmin={authContext.employee.role === "admin"}
		/>
	);
}
