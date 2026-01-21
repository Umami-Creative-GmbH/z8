import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { WorkPolicyManagement } from "@/components/settings/work-policy-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function WorkPoliciesPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage work policies" />
			</div>
		);
	}

	// Only admins can access work policy settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <WorkPolicyManagement organizationId={authContext.employee.organizationId} />;
}
