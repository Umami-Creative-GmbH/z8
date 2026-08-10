import { Suspense } from "react";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense/travel-expense-policy-management";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

async function TravelExpenseSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return <TravelExpensePolicyManagement organizationId={organizationId} />;
}

function TravelExpenseSettingsPageLoading() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function TravelExpenseSettingsPage() {
	return (
		<Suspense fallback={<TravelExpenseSettingsPageLoading />}>
			<TravelExpenseSettingsPageContent />
		</Suspense>
	);
}
