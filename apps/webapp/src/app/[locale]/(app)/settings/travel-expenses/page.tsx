import { connection } from "next/server";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense-policy-management";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export default async function TravelExpenseSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const [, { organizationId }] = await Promise.all([
		getTranslate(),
		requireOrgAdminSettingsAccess(),
	]);

	return <TravelExpensePolicyManagement organizationId={organizationId} />;
}
