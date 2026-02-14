import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAuthContext } from "@/lib/auth-helpers";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { CustomRolesManagement } from "@/components/settings/custom-roles/custom-roles-management";

export default async function CustomRolesSettingsPage() {
	await connection();

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return <NoEmployeeError feature="manage custom roles" />;
	}

	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <CustomRolesManagement organizationId={authContext.employee.organizationId} />;
}
