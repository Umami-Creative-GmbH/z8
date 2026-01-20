import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslate } from "@/tolgee/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ChangePolicyManagement } from "@/components/settings/change-policy-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function ChangePoliciesSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.changePolicies.feature", "manage change policies")} />
			</div>
		);
	}

	// Only admins can access change policy settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <ChangePolicyManagement organizationId={authContext.employee.organizationId} />;
}
