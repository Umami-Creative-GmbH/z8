import { connection } from "next/server";
import { getTranslate } from "@/tolgee/server";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense-policy-management";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function TravelExpenseSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	await getTranslate();
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return <TravelExpensePolicyManagement organizationId={organizationId} />;
}
