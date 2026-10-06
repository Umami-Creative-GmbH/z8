import { Suspense } from "react";
import { MileagePolicySettingsCard } from "@/components/settings/travel-expense/mileage-policy-settings";
import { TravelExpenseApproverSettingsCard } from "@/components/settings/travel-expense/travel-expense-approver-settings";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense/travel-expense-policy-management";
import { TravelExpenseReceiptExceptionSettingsCard } from "@/components/settings/travel-expense/travel-expense-receipt-exception-settings";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

async function TravelExpenseSettingsPageContent() {
	await requireOrgAdminSettingsAccess();

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<TravelExpenseApproverSettingsCard />
			<TravelExpenseReceiptExceptionSettingsCard />
			<MileagePolicySettingsCard />
			<TravelExpensePolicyManagement />
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
