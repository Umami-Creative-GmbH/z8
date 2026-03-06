import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslate } from "@/tolgee/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense-policy-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function TravelExpenseSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("settings.travelExpenses.feature", "manage travel expense policies")}
				/>
			</div>
		);
	}

	if (authContext.employee.role !== "admin") {
		redirect("/");
	}

	return <TravelExpensePolicyManagement organizationId={authContext.employee.organizationId} />;
}
