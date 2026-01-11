import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ProjectManagement } from "@/components/settings/project-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function ProjectSettingsPage() {
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage projects" />
			</div>
		);
	}

	// Only admins can access project settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <ProjectManagement organizationId={authContext.employee.organizationId} />;
}
