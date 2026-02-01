import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { CoverageRulesManagement } from "@/components/settings/coverage-rules-management";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function CoverageRulesSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.coverageRules.feature", "manage coverage rules")} />
			</div>
		);
	}

	// Only admins can access coverage rules settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <CoverageRulesManagement organizationId={authContext.employee.organizationId} />;
}
