import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getAuthContext } from "@/lib/auth-helpers";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { SkillCatalogManagement } from "@/components/settings/skill-catalog-management";

export default async function SkillsSettingsPage() {
	await connection();

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return <NoEmployeeError feature="manage skills" />;
	}

	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <SkillCatalogManagement organizationId={authContext.employee.organizationId} />;
}
