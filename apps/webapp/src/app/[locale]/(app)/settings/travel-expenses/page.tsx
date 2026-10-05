import { Suspense } from "react";
import { TravelExpenseApproverSettingsCard } from "@/components/settings/travel-expense/travel-expense-approver-settings";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense/travel-expense-policy-management";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

async function TravelExpenseSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return (
		<div className="flex flex-1 flex-col">
			<div className="px-4 pt-4">
				<TravelExpenseApproverSettingsCard />
			</div>
			<TravelExpensePolicyManagement organizationId={organizationId} />
		</div>
	);
}

function TravelExpenseSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.travelExpenseSettings",
				labelDefault: "Loading travel expense settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function TravelExpenseSettingsPage() {
	return (
		<Suspense fallback={<TravelExpenseSettingsPageLoading />}>
			<TravelExpenseSettingsPageContent />
		</Suspense>
	);
}
