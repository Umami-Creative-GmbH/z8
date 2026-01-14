import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { SurchargeManagement } from "@/components/settings/surcharge-management";
import { getAuthContext } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function SurchargeSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("settings.surcharges.feature", "manage surcharges")} />
			</div>
		);
	}

	// Only admins can access surcharge settings
	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <SurchargeManagement organizationId={authContext.employee.organizationId} />;
}
